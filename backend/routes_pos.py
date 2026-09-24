from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from collections import defaultdict
import math
import re

from core import (db, ORG_ID, uid, now_iso, m, D, MANILA,
                  get_current_principal, require_perm, audit, next_number, notify)
from inventory_lib import record_movement, allocate_fefo, consume_lots, get_level

router = APIRouter(prefix="/api/pos", tags=["pos"])


# ---------------- Schemas ----------------
class SaleLine(BaseModel):
    product_id: str
    qty: float
    unit_price: Optional[float] = None      # override if authorized
    line_discount: float = 0                 # peso amount off the line
    discount_eligible: Optional[bool] = None # per-sale Senior/PWD eligibility
    discount_eligible_qty: Optional[float] = None  # supports part of a multi-qty line

class PaymentIn(BaseModel):
    method: str
    amount: float
    reference: Optional[str] = ""

class SeniorPwdInfo(BaseModel):
    id_number: Optional[str] = ""
    name: Optional[str] = ""
    representative: Optional[str] = ""

class SaleIn(BaseModel):
    store_id: str
    register_id: Optional[str] = None
    shift_id: Optional[str] = None
    customer_id: Optional[str] = None
    items: List[SaleLine]
    payments: List[PaymentIn]
    discount_type: str = "REGULAR"           # REGULAR / SENIOR / PWD
    order_discount: float = 0                 # peso amount off whole ticket (regular only)
    senior_pwd: Optional[SeniorPwdInfo] = None
    notes: Optional[str] = ""
    client_txn_id: Optional[str] = None       # offline dedupe UUID


class UnavailableItemIn(BaseModel):
    store_id: str
    item_name: str
    quantity: float = 1
    customer_name: Optional[str] = ""
    notes: Optional[str] = ""


async def get_settings():
    s = await db.settings.find_one({"org_id": ORG_ID}, {"_id": 0})
    return s or {}


@router.post("/unavailable-items")
async def record_unavailable_item(body: UnavailableItemIn,
                                  principal=Depends(require_perm("pos.sell"))):
    item_name = re.sub(r"\s+", " ", body.item_name).strip()
    customer_name = re.sub(r"\s+", " ", body.customer_name or "").strip()
    notes = (body.notes or "").strip()
    if not item_name:
        raise HTTPException(status_code=400, detail="Enter the requested item name")
    if len(item_name) > 200 or len(customer_name) > 200 or len(notes) > 1000:
        raise HTTPException(status_code=400, detail="Requested item details are too long")
    if not math.isfinite(body.quantity) or body.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
    doc = {
        "id": uid(), "org_id": ORG_ID, "store_id": body.store_id,
        "item_name": item_name, "normalized_name": item_name.casefold(),
        "quantity": m(body.quantity), "customer_name": customer_name,
        "notes": notes, "status": "OPEN",
        "recorded_by_id": principal.get("id"),
        "recorded_by_name": principal.get("name"), "created_at": now_iso(),
    }
    await db.unavailable_item_requests.insert_one(doc)
    await audit(principal, "unavailable_item.recorded", "unavailable_item_request", doc["id"],
                after={"item_name": item_name, "quantity": doc["quantity"]},
                store_id=body.store_id)
    doc.pop("_id", None)
    return doc


@router.post("/sales")
async def create_sale(body: SaleIn, principal=Depends(require_perm("pos.sell"))):
    # ---- Offline duplicate prevention ----
    if body.client_txn_id:
        existing = await db.sales.find_one({"org_id": ORG_ID, "client_txn_id": body.client_txn_id}, {"_id": 0})
        if existing:
            return existing

    if not body.items:
        raise HTTPException(status_code=400, detail="Add at least one item to the sale")
    if not body.payments:
        raise HTTPException(status_code=400, detail="Add at least one payment")
    if body.discount_type not in ("REGULAR", "SENIOR", "PWD"):
        raise HTTPException(status_code=400, detail="Invalid discount type")
    if any(D(p.amount) <= 0 for p in body.payments):
        raise HTTPException(status_code=400, detail="Payment amounts must be greater than zero")

    settings = await get_settings()
    vat_rate = D(settings.get("tax", {}).get("vat_rate", 12)) / D(100)
    spwd = settings.get("senior_pwd", {})
    spwd_pct = D(spwd.get("discount_pct", 20)) / D(100)
    spwd_vat_exempt = spwd.get("vat_exempt", True)
    neg_policy = settings.get("negative_stock_policy", "WARN")
    is_spwd = body.discount_type in ("SENIOR", "PWD") and spwd.get("enabled", True)
    if body.discount_type in ("SENIOR", "PWD") and not is_spwd:
        raise HTTPException(status_code=400, detail="Senior/PWD discounts are disabled")
    if is_spwd and (not body.senior_pwd or not body.senior_pwd.id_number.strip() or not body.senior_pwd.name.strip()):
        raise HTTPException(status_code=400, detail="Senior/PWD ID number and cardholder name are required")

    if body.register_id and not body.shift_id:
        raise HTTPException(status_code=400, detail="Open a shift before completing a sale")
    shift = None
    if body.shift_id:
        shift = await db.shifts.find_one({"id": body.shift_id, "org_id": ORG_ID})
        if not shift:
            raise HTTPException(status_code=400, detail="The selected shift no longer exists")
        if shift.get("status") != "OPEN":
            raise HTTPException(status_code=400, detail="The selected shift is already closed")
        if shift.get("store_id") != body.store_id or shift.get("register_id") != body.register_id:
            raise HTTPException(status_code=400, detail="The shift does not belong to this store and register")

    line_docs = []
    subtotal = D(0)        # gross (VAT-inclusive) before order/senior discount
    vat_amount = D(0)
    vat_exempt_amount = D(0)
    spwd_discount = D(0)
    cost_total = D(0)
    net_total = D(0)

    # Resolve all physical stock requirements before pricing any lines. A promotional
    # SKU is a sellable wrapper: its component products own the stock and lots.
    prepared_items = []
    inventory_requirements = defaultdict(lambda: D(0))
    inventory_products = {}
    for it in body.items:
        p = await db.products.find_one({"id": it.product_id, "org_id": ORG_ID})
        if not p:
            raise HTTPException(status_code=400, detail="A selected product is no longer available")
        qty = D(it.qty)
        if qty <= 0:
            raise HTTPException(status_code=400, detail=f"Quantity for {p['name']} must be greater than zero")
        stock_specs = []
        if p.get("product_type", "REGULAR") == "PROMO":
            if not p.get("components"):
                raise HTTPException(status_code=400, detail=f"{p['name']} has no promotional components")
            for component in p["components"]:
                cp = await db.products.find_one({"id": component.get("product_id"), "org_id": ORG_ID})
                if not cp or not cp.get("active", True) or cp.get("product_type", "REGULAR") == "PROMO":
                    raise HTTPException(status_code=400, detail=f"A component of {p['name']} is unavailable")
                required = qty * D(component.get("quantity"))
                stock_specs.append((cp, required, D(component.get("quantity"))))
        elif p.get("track_inventory", True):
            stock_specs.append((p, qty, D(1)))
        for cp, required, _ in stock_specs:
            if cp.get("track_inventory", True):
                inventory_requirements[cp["id"]] += required
                inventory_products[cp["id"]] = cp
        prepared_items.append((it, p, qty, stock_specs))

    allocation_pools = {}
    for product_id, required in inventory_requirements.items():
        product = inventory_products[product_id]
        available = D(await get_level(body.store_id, product_id))
        if available < required and neg_policy == "PROHIBIT":
            raise HTTPException(status_code=400, detail=f"Not enough stock for {product['name']} ({m(available)} available; {m(required)} needed)")
        allocations = []
        if product.get("track_lots"):
            allocations, _, _ = await allocate_fefo(body.store_id, product_id, float(required))
        allocation_pools[product_id] = [{**a, "remaining": D(a["qty"])} for a in allocations]

    def take_allocations(product_id, required):
        """Reserve part of the aggregate FEFO allocation for one receipt line."""
        need = D(required)
        taken = []
        for allocation in allocation_pools.get(product_id, []):
            if need <= 0:
                break
            take = min(allocation["remaining"], need)
            if take <= 0:
                continue
            taken.append({k: v for k, v in allocation.items() if k != "remaining"} | {"qty": m(take)})
            allocation["remaining"] -= take
            need -= take
        return taken, need

    for it, p, qty, stock_specs in prepared_items:
        if D(it.line_discount) < 0:
            raise HTTPException(status_code=400, detail=f"Discount for {p['name']} cannot be negative")
        catalog_price = D(p.get("price", 0))
        unit_price = D(it.unit_price if it.unit_price is not None else catalog_price)
        if unit_price < 0:
            raise HTTPException(status_code=400, detail=f"Price for {p['name']} cannot be negative")
        if it.unit_price is not None and unit_price != catalog_price:
            perms = principal.get("permissions", [])
            if "*" not in perms and "pos.price_override" not in perms:
                raise HTTPException(status_code=403, detail="A manager is required to override an item price")
        line_gross = unit_price * qty - D(it.line_discount)
        if line_gross < 0:
            line_gross = D(0)

        tax_mode = p.get("tax_mode", "VAT")
        vatable = tax_mode == "VAT"

        # ---- component-aware lot allocation (FEFO) ----
        inventory_components = []
        line_cost = D(0)
        for component, required, qty_per_sale in stock_specs:
            allocations, unallocated = take_allocations(component["id"], required)
            fallback_cost = D(component.get("average_cost") or component.get("acquisition_cost") or 0)
            component_cost = sum(D(a.get("unit_cost", fallback_cost)) * D(a["qty"]) for a in allocations)
            component_cost += unallocated * fallback_cost
            line_cost += component_cost
            inventory_components.append({
                "product_id": component["id"], "name": component["name"],
                "sku": component.get("sku"), "qty_per_sale": m(qty_per_sale),
                "total_qty": m(required),
                "unit_cost": m(component_cost / required if required > 0 else fallback_cost),
                "line_cost": m(component_cost), "lot_allocations": allocations,
                "unallocated_qty": m(unallocated),
                "track_lots": component.get("track_lots", False), "track_inventory": True,
            })
        wcost = m(line_cost / qty) if qty > 0 else 0
        cost_total += line_cost

        # ---- senior/PWD vs regular math ----
        line_vat = D(0)
        line_exempt = D(0)
        line_spwd_disc = D(0)
        default_eligible = it.discount_eligible if it.discount_eligible is not None else p.get("discount_eligible", True)
        eligible_qty = (D(it.discount_eligible_qty) if it.discount_eligible_qty is not None
                        else (qty if default_eligible else D(0)))
        if eligible_qty < 0 or eligible_qty > qty:
            raise HTTPException(status_code=400, detail=f"Eligible quantity for {p['name']} must be between 0 and {m(qty)}")
        if is_spwd and eligible_qty > 0:
            eligible_gross = line_gross * eligible_qty / qty
            regular_gross = line_gross - eligible_gross
            if vatable and spwd_vat_exempt:
                eligible_net = eligible_gross / (D(1) + vat_rate)
                line_exempt = eligible_gross - eligible_net
            else:
                eligible_net = eligible_gross
            line_spwd_disc = eligible_net * spwd_pct
            line_net = eligible_net - line_spwd_disc + regular_gross
            if vatable and regular_gross > 0:
                line_vat = regular_gross - regular_gross / (D(1) + vat_rate)
        else:
            if vatable:
                net = line_gross / (D(1) + vat_rate)
                line_vat = line_gross - net
            line_net = line_gross

        subtotal += line_gross
        vat_amount += line_vat
        vat_exempt_amount += line_exempt
        spwd_discount += line_spwd_disc
        net_total += line_net

        line_docs.append({
            "product_id": it.product_id, "name": p["name"], "sku": p.get("sku"),
            "generic_name": p.get("generic_name"), "qty": m(qty), "unit_price": m(unit_price),
            "line_discount": m(it.line_discount), "tax_mode": tax_mode,
            "line_gross": m(line_gross), "line_net": m(line_net), "vat": m(line_vat),
            "vat_exempt": m(line_exempt), "spwd_discount": m(line_spwd_disc),
            "unit_cost": m(wcost), "line_cost": m(line_cost),
            "sale_line_id": uid(),
            "lot_allocations": (inventory_components[0]["lot_allocations"]
                                if len(inventory_components) == 1 and inventory_components[0]["product_id"] == it.product_id
                                else []),
            "refunded_qty": 0,
            "discount_eligible": bool(eligible_qty > 0), "discount_eligible_qty": m(eligible_qty),
            "track_lots": p.get("track_lots", False),
            "track_inventory": bool(inventory_components), "inventory_components": inventory_components,
        })

    # order-level discount (regular sales only)
    order_disc = D(0)
    if not is_spwd and body.order_discount:
        order_disc = D(body.order_discount)
        if order_disc < 0:
            raise HTTPException(status_code=400, detail="Order discount cannot be negative")
        net_total = net_total - order_disc
        if net_total < 0:
            net_total = D(0)

    total = net_total
    amount_paid = sum(D(pmt.amount) for pmt in body.payments)
    if amount_paid < total:
        raise HTTPException(status_code=400, detail=f"Insufficient payment: {m(total - amount_paid)} still due")
    change = amount_paid - total
    gross_profit = total - cost_total

    number = await next_number("SALE")
    customer = None
    if body.customer_id:
        customer = await db.customers.find_one({"id": body.customer_id, "org_id": ORG_ID}, {"_id": 0})

    sale = {
        "id": uid(), "number": number, "org_id": ORG_ID, "store_id": body.store_id,
        "register_id": body.register_id, "shift_id": body.shift_id,
        "cashier_id": principal.get("id"), "cashier_name": principal.get("name"),
        "customer_id": body.customer_id, "customer_name": (f"{customer.get('first_name','')} {customer.get('last_name','')}".strip() if customer else None),
        "status": "COMPLETED", "items": line_docs,
        "subtotal": m(subtotal), "order_discount": m(order_disc),
        "vat_amount": m(vat_amount), "vat_exempt_amount": m(vat_exempt_amount),
        "spwd_discount": m(spwd_discount), "discount_type": body.discount_type,
        "senior_pwd": (body.senior_pwd.model_dump() if body.senior_pwd else None),
        "discount_total": m(order_disc + spwd_discount),
        "total": m(total), "cost_total": m(cost_total), "gross_profit": m(gross_profit),
        "gross_margin": m((gross_profit / total * 100) if total > 0 else 0),
        "payments": [pmt.model_dump() for pmt in body.payments],
        "amount_paid": m(amount_paid), "change": m(change if change > 0 else 0),
        "notes": body.notes, "client_txn_id": body.client_txn_id, "refund_version": 0,
        "created_at": now_iso(),
    }
    await db.sales.insert_one(dict(sale))

    # ---- inventory reduction + ledger ----
    for ln in line_docs:
        if not ln["track_inventory"]:
            continue
        components = ln.get("inventory_components") or [{
            "product_id": ln["product_id"], "name": ln["name"], "total_qty": ln["qty"],
            "unit_cost": ln["unit_cost"], "lot_allocations": ln.get("lot_allocations", []),
            "unallocated_qty": 0, "track_lots": ln.get("track_lots", False),
        }]
        for component in components:
            if component.get("track_lots") and component.get("lot_allocations"):
                await consume_lots(component["lot_allocations"], principal)
                for allocation in component["lot_allocations"]:
                    await record_movement(body.store_id, component["product_id"], "SALE", -float(allocation["qty"]),
                                           unit_cost=allocation["unit_cost"], lot_id=allocation["lot_id"],
                                           reference=number, ref_id=sale["id"], principal=principal,
                                           note=f"Component of {ln['name']}" if component["product_id"] != ln["product_id"] else "")
                if D(component.get("unallocated_qty", 0)) > 0:
                    await record_movement(body.store_id, component["product_id"], "SALE", -float(component["unallocated_qty"]),
                                           unit_cost=component["unit_cost"], reference=number, ref_id=sale["id"],
                                           principal=principal, note=f"Unallocated component of {ln['name']}")
            else:
                await record_movement(body.store_id, component["product_id"], "SALE", -float(component["total_qty"]),
                                       unit_cost=component["unit_cost"], reference=number, ref_id=sale["id"],
                                       principal=principal,
                                       note=f"Component of {ln['name']}" if component["product_id"] != ln["product_id"] else "")

    # ---- loyalty ----
    if customer:
        loy = settings.get("loyalty", {})
        pts = 0
        if loy.get("enabled", True):
            pts = int(D(total) / D(loy.get("peso_per_point", 100)) * D(loy.get("points_per", 1)))
        await db.customers.update_one({"id": customer["id"]}, {
            "$inc": {"loyalty_points": pts, "lifetime_spend": m(total), "visit_count": 1},
            "$set": {"last_visit": now_iso()}})
        if pts:
            await db.loyalty_transactions.insert_one({
                "id": uid(), "org_id": ORG_ID, "customer_id": customer["id"], "type": "EARN",
                "points": pts, "sale_id": sale["id"], "note": f"Sale {number}", "created_at": now_iso()})

    # ---- senior/pwd record ----
    if is_spwd:
        await db.senior_pwd_transactions.insert_one({
            "id": uid(), "org_id": ORG_ID, "sale_id": sale["id"], "sale_number": number,
            "type": body.discount_type, "id_number": (body.senior_pwd.id_number if body.senior_pwd else ""),
            "name": (body.senior_pwd.name if body.senior_pwd else ""),
            "gross": m(subtotal), "vat_exempt": m(vat_exempt_amount), "discount": m(spwd_discount),
            "net": m(total), "store_id": body.store_id, "created_at": now_iso()})

    await audit(principal, "sale.created", "sale", sale["id"], after={"number": number, "total": m(total)}, store_id=body.store_id)
    sale.pop("_id", None)
    return sale


def normalize_sale_lines(sale):
    """Give legacy sales stable line IDs without requiring a destructive migration."""
    if not sale:
        return sale
    for index, line in enumerate(sale.get("items", [])):
        line.setdefault("sale_line_id", f"{sale['id']}-line-{index + 1}")
        line.setdefault("discount_eligible_qty", line.get("qty", 0) if line.get("discount_eligible", True) else 0)
        line.setdefault("refunded_qty", 0)
    sale.setdefault("refund_version", 0)
    return sale


def ensure_receipt_access(principal):
    perms = principal.get("permissions", [])
    if "*" not in perms and "pos.view_receipts" not in perms:
        raise HTTPException(status_code=403, detail="You don't have permission to view receipts")


@router.get("/sales")
async def list_sales(store_id: Optional[str] = None, limit: int = 100,
                     page: int = 1, page_size: int = 25, q: Optional[str] = None,
                     paginated: bool = False, principal=Depends(get_current_principal)):
    ensure_receipt_access(principal)
    query = {"org_id": ORG_ID}
    if store_id:
        query["store_id"] = store_id
    # Cashiers may reprint/refund their own receipts without gaining back-office visibility.
    if principal.get("kind") == "employee" and principal.get("role") == "cashier":
        query["cashier_id"] = principal.get("id")
    if q and q.strip():
        pattern = re.escape(q.strip())
        query["$or"] = [
            {"number": {"$regex": pattern, "$options": "i"}},
            {"customer_name": {"$regex": pattern, "$options": "i"}},
            {"cashier_name": {"$regex": pattern, "$options": "i"}},
        ]
    if not paginated:
        rows = await db.sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 1000))
        return [normalize_sale_lines(row) for row in rows]
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    total = await db.sales.count_documents(query)
    rows = await db.sales.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [normalize_sale_lines(row) for row in rows], "total": total,
            "page": page, "page_size": page_size, "pages": max(1, math.ceil(total / page_size))}


@router.get("/sales/{sid}")
async def get_sale(sid: str, principal=Depends(get_current_principal)):
    ensure_receipt_access(principal)
    s = await db.sales.find_one({"id": sid, "org_id": ORG_ID}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Sale not found")
    if principal.get("kind") == "employee" and principal.get("role") == "cashier" and s.get("cashier_id") != principal.get("id"):
        raise HTTPException(status_code=403, detail="Cashiers can only view their own receipts")
    return normalize_sale_lines(s)


# ---------------- Refunds ----------------
class RefundLine(BaseModel):
    sale_line_id: Optional[str] = None
    product_id: Optional[str] = None  # legacy clients
    qty: float
    restore_stock: bool = True

class RefundIn(BaseModel):
    sale_id: str
    reason: str
    lines: List[RefundLine]
    refund_method: Optional[str] = None
    client_txn_id: Optional[str] = None


class CancelSaleIn(BaseModel):
    reason: str
    refund_method: Optional[str] = None
    client_txn_id: Optional[str] = None


async def restore_refunded_lots(sale, sline, qty, already_refunded, number, principal, reason, movement_type="REFUND"):
    """Restore the exact originally sold lots before falling back to unallocated stock."""
    remaining = D(qty)
    skip = D(already_refunded)
    for allocation in sline.get("lot_allocations", []):
        allocated = D(allocation.get("qty", 0))
        if skip >= allocated:
            skip -= allocated
            continue
        available_to_restore = allocated - skip
        restore_qty = min(available_to_restore, remaining)
        skip = D(0)
        if restore_qty <= 0:
            continue
        await db.inventory_lots.update_one(
            {"id": allocation.get("lot_id"), "org_id": ORG_ID},
            {"$inc": {"quantity": float(restore_qty)}, "$set": {"status": "ACTIVE"}},
        )
        await record_movement(
            sale["store_id"], sline["product_id"], movement_type, float(restore_qty),
            unit_cost=allocation.get("unit_cost", sline.get("unit_cost", 0)),
            lot_id=allocation.get("lot_id"), reference=number, ref_id=sale["id"],
            principal=principal, note=reason,
        )
        remaining -= restore_qty
        if remaining <= 0:
            break
    if remaining > 0:
        await record_movement(
            sale["store_id"], sline["product_id"], movement_type, float(remaining),
            unit_cost=sline.get("unit_cost", 0), reference=number,
            ref_id=sale["id"], principal=principal, note=reason,
        )


async def restore_sale_line_stock(sale, sline, qty, already_refunded, number, principal, reason, movement_type):
    """Restore either a regular product or every physical component of a promo SKU."""
    components = sline.get("inventory_components") or []
    if not components:
        if sline.get("track_lots") and sline.get("lot_allocations"):
            await restore_refunded_lots(
                sale, sline, qty, already_refunded, number, principal, reason, movement_type,
            )
        else:
            await record_movement(
                sale["store_id"], sline["product_id"], movement_type, float(qty),
                unit_cost=sline.get("unit_cost", 0), reference=number,
                ref_id=sale["id"], principal=principal, note=reason,
            )
        return

    for component in components:
        qty_per_sale = D(component.get("qty_per_sale", 1))
        component_qty = D(qty) * qty_per_sale
        component_skip = D(already_refunded) * qty_per_sale
        stock_line = {
            "product_id": component["product_id"],
            "unit_cost": component.get("unit_cost", 0),
            "lot_allocations": component.get("lot_allocations", []),
        }
        component_reason = f"{reason} — component of {sline['name']}"
        if component.get("track_lots") and component.get("lot_allocations"):
            await restore_refunded_lots(
                sale, stock_line, component_qty, component_skip, number, principal,
                component_reason, movement_type,
            )
        else:
            await record_movement(
                sale["store_id"], component["product_id"], movement_type, float(component_qty),
                unit_cost=component.get("unit_cost", 0), reference=number,
                ref_id=sale["id"], principal=principal, note=component_reason,
            )

async def _create_refund(body: RefundIn, principal, kind="REFUND", final_status=None):
    sale = await db.sales.find_one({"id": body.sale_id, "org_id": ORG_ID})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if (principal.get("kind") == "employee" and principal.get("role") == "cashier"
            and sale.get("cashier_id") != principal.get("id")):
        raise HTTPException(status_code=403, detail="Cashiers can only refund their own receipts")
    if body.client_txn_id:
        existing = await db.refunds.find_one(
            {"org_id": ORG_ID, "client_txn_id": body.client_txn_id}, {"_id": 0})
        if existing:
            if existing.get("sale_id") != body.sale_id:
                raise HTTPException(status_code=409, detail="This transaction ID was already used for another receipt")
            return existing
    if sale.get("status") == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cancelled receipts cannot be refunded")
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="Refund reason is required")
    if not body.lines:
        raise HTTPException(status_code=400, detail="Select at least one item to refund")
    sale = normalize_sale_lines(sale)
    # Persist normalized legacy lines and establish the optimistic-lock version.
    await db.sales.update_one({"id": sale["id"], "org_id": ORG_ID},
                              {"$set": {"items": sale["items"], "refund_version": sale["refund_version"]}})
    refund_total = D(0)
    refund_cost = D(0)
    refund_vat = D(0)
    refund_items = []
    prepared = []
    sale_line_total = sum(D(x.get("line_net", x.get("line_gross", 0))) for x in sale.get("items", []))
    for rl in body.lines:
        if not rl.sale_line_id and not rl.product_id:
            raise HTTPException(status_code=400, detail="Each refund line needs a sale line ID")
        sline = next((x for x in sale["items"] if
                      (rl.sale_line_id and x.get("sale_line_id") == rl.sale_line_id) or
                      (not rl.sale_line_id and rl.product_id and x.get("product_id") == rl.product_id)), None)
        if not sline:
            raise HTTPException(status_code=400, detail="A selected sale line no longer exists")
        if D(rl.qty) <= 0:
            raise HTTPException(status_code=400, detail="Refund quantities must be greater than zero")
        already_refunded = D(sline.get("refunded_qty", 0))
        remaining = D(sline["qty"]) - already_refunded
        qty = D(rl.qty)
        if qty > remaining:
            raise HTTPException(status_code=409, detail=f"Only {m(remaining)} of {sline['name']} remains refundable")
        # Allocate any order-level discount proportionally so partial refunds never
        # reimburse more than the amount actually paid for the line.
        line_paid = (D(sale.get("total", 0)) * D(sline.get("line_net", sline.get("line_gross", 0))) / sale_line_total
                     if sale_line_total > 0 else D(0))
        unit_net = line_paid / D(sline["qty"]) if D(sline["qty"]) > 0 else D(0)
        amount = unit_net * qty
        cost_amount = D(sline.get("unit_cost", 0)) * qty
        vat_amount = (D(sline.get("vat", 0)) / D(sline["qty"]) * qty
                      if D(sline["qty"]) > 0 else D(0))
        refund_total += amount
        refund_vat += vat_amount
        if rl.restore_stock:
            refund_cost += cost_amount
        sline["refunded_qty"] = m(D(sline.get("refunded_qty", 0)) + qty)
        refund_items.append({"sale_line_id": sline["sale_line_id"], "product_id": sline["product_id"],
                             "name": sline["name"], "qty": m(qty),
                             "amount": m(amount), "unit_cost": m(sline.get("unit_cost", 0)),
                             "vat_refunded": m(vat_amount),
                             "cost_restored": m(cost_amount if rl.restore_stock else 0),
                             "restore_stock": rl.restore_stock})
        prepared.append((sline, qty, already_refunded, rl.restore_stock))

    if not refund_items:
        raise HTTPException(status_code=400, detail="None of the selected items can be refunded")

    all_refunded = all(D(x["qty"]) <= D(x.get("refunded_qty", 0)) for x in sale["items"])
    new_status = (final_status or "REFUNDED") if all_refunded else "PARTIAL_REFUND"
    version = sale.get("refund_version", 0)
    claimed = await db.sales.update_one(
        {"id": sale["id"], "org_id": ORG_ID, "refund_version": version, "status": {"$ne": "CANCELLED"}},
        {"$set": {"items": sale["items"], "status": new_status}, "$inc": {"refund_version": 1}},
    )
    if claimed.modified_count != 1:
        raise HTTPException(status_code=409, detail="This receipt changed while the refund was being processed. Review it and try again.")

    number = await next_number("VOID" if kind == "VOID" else "RFND")
    for sline, qty, already_refunded, restore_stock in prepared:
        if restore_stock and sline.get("track_inventory", True):
            await restore_sale_line_stock(
                sale, sline, qty, already_refunded, number, principal,
                body.reason.strip(), "VOID" if kind == "VOID" else "REFUND",
            )

    refund_method = (body.refund_method or (sale.get("payments") or [{}])[0].get("method") or "Cash").strip()
    refund = {"id": uid(), "number": number, "org_id": ORG_ID, "sale_id": sale["id"],
              "sale_number": sale["number"], "store_id": sale["store_id"],
              "shift_id": sale.get("shift_id"),
              "cashier_id": principal.get("id"), "cashier_name": principal.get("name"),
              "reason": body.reason.strip(), "items": refund_items, "total": m(refund_total),
              "type": kind, "client_txn_id": body.client_txn_id,
              "cost_restored": m(refund_cost),
              "vat_refunded": m(refund_vat),
              "payments": [{"method": refund_method, "amount": m(refund_total)}],
              "created_at": now_iso()}
    await db.refunds.insert_one(dict(refund))
    await audit(principal, "sale.cancelled" if kind == "VOID" else "sale.refunded", "refund", refund["id"],
                after={"number": number, "total": m(refund_total), "sale": sale["number"]}, store_id=sale["store_id"])
    refund.pop("_id", None)
    return refund


@router.post("/refunds")
async def create_refund(body: RefundIn, principal=Depends(require_perm("pos.refund"))):
    return await _create_refund(body, principal)


@router.post("/sales/{sid}/cancel")
async def cancel_sale(sid: str, body: CancelSaleIn, principal=Depends(require_perm("pos.void"))):
    sale = await db.sales.find_one({"id": sid, "org_id": ORG_ID}, {"_id": 0})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if body.client_txn_id:
        existing = await db.refunds.find_one(
            {"org_id": ORG_ID, "client_txn_id": body.client_txn_id}, {"_id": 0})
        if existing:
            if existing.get("sale_id") != sid:
                raise HTTPException(status_code=409, detail="This transaction ID was already used for another receipt")
            return existing
    if sale.get("status") != "COMPLETED":
        raise HTTPException(status_code=400, detail="Only an untouched completed receipt can be cancelled")
    sale = normalize_sale_lines(sale)
    lines = [RefundLine(sale_line_id=line["sale_line_id"], product_id=line.get("product_id"),
                        qty=line.get("qty", 0), restore_stock=True) for line in sale.get("items", [])]
    refund = await _create_refund(RefundIn(
        sale_id=sid, reason=body.reason, refund_method=body.refund_method,
        client_txn_id=body.client_txn_id, lines=lines,
    ), principal, kind="VOID", final_status="CANCELLED")
    return refund


@router.get("/refunds")
async def list_refunds(sale_id: Optional[str] = None, limit: int = 100,
                       principal=Depends(get_current_principal)):
    ensure_receipt_access(principal)
    query = {"org_id": ORG_ID}
    if sale_id:
        sale = await db.sales.find_one({"id": sale_id, "org_id": ORG_ID}, {"_id": 0})
        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")
        if (principal.get("kind") == "employee" and principal.get("role") == "cashier"
                and sale.get("cashier_id") != principal.get("id")):
            raise HTTPException(status_code=403, detail="Cashiers can only view their own receipts")
        query["sale_id"] = sale_id
    elif principal.get("kind") == "employee" and principal.get("role") == "cashier":
        own_sales = await db.sales.find(
            {"org_id": ORG_ID, "cashier_id": principal.get("id")}, {"id": 1, "_id": 0}
        ).to_list(10000)
        query["sale_id"] = {"$in": [sale["id"] for sale in own_sales]}
    return await db.refunds.find(query, {"_id": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 1000))


# ---------------- Shifts & cash management ----------------
class OpenShiftIn(BaseModel):
    store_id: str
    register_id: Optional[str] = None
    opening_cash: float = 0

@router.post("/shifts/open")
async def open_shift(body: OpenShiftIn, principal=Depends(require_perm("pos.sell"))):
    oc = body.opening_cash
    # Opening cash: 0 is valid; reject negative / NaN / non-numeric
    if oc is None or not isinstance(oc, (int, float)) or oc != oc or oc < 0:
        raise HTTPException(status_code=400, detail="Opening cash must be zero or a positive amount")
    if not body.store_id:
        raise HTTPException(status_code=400, detail="No store assigned — cannot open a shift")
    # Resume an existing OPEN shift for this store + register instead of duplicating
    existing = await db.shifts.find_one({"org_id": ORG_ID, "store_id": body.store_id,
                                         "register_id": body.register_id, "status": "OPEN"}, {"_id": 0})
    if existing:
        return existing
    now = now_iso()
    shift = {"id": uid(), "org_id": ORG_ID, "store_id": body.store_id, "register_id": body.register_id,
             "employee_id": principal.get("id"), "employee_name": principal.get("name"),
             "opening_cash": m(oc), "status": "OPEN", "opened_at": now, "closed_at": None,
             "created_at": now, "created_by": principal.get("name")}
    await db.shifts.insert_one(dict(shift))
    await audit(principal, "shift.opened", "shift", shift["id"], after={"opening_cash": m(oc)}, store_id=body.store_id)
    shift.pop("_id", None)
    return shift

@router.get("/shifts/current")
async def current_shift(store_id: str, register_id: Optional[str] = None, principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID, "store_id": store_id, "status": "OPEN"}
    if register_id:
        q["register_id"] = register_id
    return await db.shifts.find_one(q, {"_id": 0})

@router.get("/shifts")
async def list_shifts(limit: int = 50, principal=Depends(get_current_principal)):
    return await db.shifts.find({"org_id": ORG_ID}, {"_id": 0}).sort("opened_at", -1).to_list(limit)

class CashMoveIn(BaseModel):
    shift_id: str
    store_id: str
    type: str            # IN / OUT / DROP / PETTY
    amount: float
    reason: str = ""

@router.post("/cash-movements")
async def cash_movement(body: CashMoveIn, principal=Depends(require_perm("pos.open_drawer"))):
    if body.type not in ("IN", "OUT", "DROP", "PETTY"):
        raise HTTPException(status_code=400, detail="Invalid cash movement type")
    if D(body.amount) <= 0:
        raise HTTPException(status_code=400, detail="Cash movement amount must be greater than zero")
    shift = await db.shifts.find_one({"id": body.shift_id, "org_id": ORG_ID, "status": "OPEN"})
    if not shift or shift.get("store_id") != body.store_id:
        raise HTTPException(status_code=400, detail="An open shift is required for this cash movement")
    doc = {"id": uid(), "org_id": ORG_ID, "shift_id": body.shift_id, "store_id": body.store_id,
           "type": body.type, "amount": m(body.amount), "reason": body.reason,
           "employee_id": principal.get("id"), "employee_name": principal.get("name"), "created_at": now_iso()}
    await db.cash_movements.insert_one(dict(doc))
    await audit(principal, "cash.movement", "cash_movement", doc["id"], after={"type": body.type, "amount": m(body.amount)}, store_id=body.store_id)
    doc.pop("_id", None)
    return doc

class CloseShiftIn(BaseModel):
    shift_id: str
    counted_cash: float

@router.post("/shifts/close")
async def close_shift(body: CloseShiftIn, principal=Depends(require_perm("pos.sell"))):
    shift = await db.shifts.find_one({"id": body.shift_id, "org_id": ORG_ID})
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    if shift.get("status") != "OPEN":
        raise HTTPException(status_code=400, detail="Shift is already closed")
    if D(body.counted_cash) < 0:
        raise HTTPException(status_code=400, detail="Counted cash cannot be negative")
    sales = await db.sales.find({"org_id": ORG_ID, "shift_id": body.shift_id}, {"_id": 0}).to_list(10000)
    cash_sales = D(0)
    sales_total = D(0)
    for s in sales:
        sales_total += D(s["total"])
        cash_tendered = D(0)
        for p in s.get("payments", []):
            if p["method"].lower() == "cash":
                cash_tendered += D(p["amount"])
        # Only cash retained in the drawer belongs in reconciliation; change
        # handed back to the customer does not.
        cash_sales += max(D(0), cash_tendered - D(s.get("change", 0)))
    moves = await db.cash_movements.find({"shift_id": body.shift_id}, {"_id": 0}).to_list(1000)
    cash_in = sum(D(x["amount"]) for x in moves if x["type"] == "IN")
    cash_out = sum(D(x["amount"]) for x in moves if x["type"] in ("OUT", "DROP", "PETTY"))
    refunds = await db.refunds.find({"org_id": ORG_ID, "shift_id": body.shift_id}, {"_id": 0}).to_list(10000)
    cash_refunds = D(0)
    for r in refunds:
        payments = r.get("payments", [])
        if not payments:  # legacy refunds were implicitly cash refunds
            cash_refunds += D(r.get("total", 0))
        else:
            cash_refunds += sum(D(p.get("amount", 0)) for p in payments
                                if p.get("method", "").lower() == "cash")
    expected = D(shift["opening_cash"]) + cash_sales + cash_in - cash_out - cash_refunds
    diff = D(body.counted_cash) - expected
    upd = {"status": "CLOSED", "closed_at": now_iso(), "closed_by": principal.get("name"),
           "sales_total": m(sales_total), "cash_sales": m(cash_sales), "cash_in": m(cash_in),
           "cash_out": m(cash_out), "refunds_total": m(cash_refunds), "expected_cash": m(expected),
           "counted_cash": m(body.counted_cash), "difference": m(diff), "transaction_count": len(sales)}
    await db.shifts.update_one({"id": body.shift_id}, {"$set": upd})
    await audit(principal, "shift.closed", "shift", body.shift_id, after={"difference": m(diff)}, store_id=shift["store_id"])
    return {**{k: v for k, v in shift.items() if k != "_id"}, **upd}
