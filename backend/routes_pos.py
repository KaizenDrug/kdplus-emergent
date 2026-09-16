from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

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


async def get_settings():
    s = await db.settings.find_one({"org_id": ORG_ID}, {"_id": 0})
    return s or {}


@router.post("/sales")
async def create_sale(body: SaleIn, principal=Depends(require_perm("pos.sell"))):
    # ---- Offline duplicate prevention ----
    if body.client_txn_id:
        existing = await db.sales.find_one({"org_id": ORG_ID, "client_txn_id": body.client_txn_id}, {"_id": 0})
        if existing:
            return existing

    # ---- Shift enforcement: staff must sell under their own open shift ----
    if body.shift_id:
        sh = await db.shifts.find_one({"id": body.shift_id, "org_id": ORG_ID, "status": "OPEN"}, {"_id": 0})
        if not sh:
            raise HTTPException(status_code=400, detail="Your shift is no longer open. Please start a shift.")
    elif principal.get("kind") == "employee":
        raise HTTPException(status_code=400, detail="You need to start a shift before processing sales.")

    settings = await get_settings()
    vat_rate = D(settings.get("tax", {}).get("vat_rate", 12)) / D(100)
    spwd = settings.get("senior_pwd", {})
    spwd_pct = D(spwd.get("discount_pct", 20)) / D(100)
    spwd_vat_exempt = spwd.get("vat_exempt", True)
    neg_policy = settings.get("negative_stock_policy", "WARN")
    is_spwd = body.discount_type in ("SENIOR", "PWD") and spwd.get("enabled", True)

    line_docs = []
    subtotal = D(0)        # gross (VAT-inclusive) before order/senior discount
    vat_amount = D(0)
    vat_exempt_amount = D(0)
    spwd_discount = D(0)
    cost_total = D(0)
    net_total = D(0)

    for it in body.items:
        p = await db.products.find_one({"id": it.product_id, "org_id": ORG_ID})
        if not p:
            raise HTTPException(status_code=400, detail="A selected product is no longer available")
        unit_price = D(it.unit_price if it.unit_price is not None else p.get("price", 0))
        qty = D(it.qty)
        line_gross = unit_price * qty - D(it.line_discount)
        if line_gross < 0:
            line_gross = D(0)

        # stock check
        if p.get("track_inventory", True):
            avail = D(await get_level(body.store_id, it.product_id))
            if avail < qty and neg_policy == "PROHIBIT":
                raise HTTPException(status_code=400, detail=f"Not enough stock for {p['name']} ({m(avail)} available)")

        tax_mode = p.get("tax_mode", "VAT")
        vatable = tax_mode == "VAT"

        # ---- lot allocation (FEFO) ----
        allocations, wcost, shortfall = ([], p.get("average_cost", 0), 0)
        if p.get("track_lots"):
            allocations, wcost, shortfall = await allocate_fefo(body.store_id, it.product_id, float(qty))
            if not allocations:
                wcost = p.get("average_cost", 0)
        line_cost = D(wcost) * qty
        cost_total += line_cost

        # ---- senior/PWD vs regular math ----
        line_vat = D(0)
        line_exempt = D(0)
        line_spwd_disc = D(0)
        if is_spwd:
            if vatable and spwd_vat_exempt:
                net = line_gross / (D(1) + vat_rate)
                line_exempt = line_gross - net
            else:
                net = line_gross
            line_spwd_disc = net * spwd_pct
            line_net = net - line_spwd_disc
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
            "lot_allocations": allocations, "refunded_qty": 0,
            "track_lots": p.get("track_lots", False), "track_inventory": p.get("track_inventory", True),
        })

    # order-level discount (regular sales only)
    order_disc = D(0)
    if not is_spwd and body.order_discount:
        order_disc = D(body.order_discount)
        net_total = net_total - order_disc
        if net_total < 0:
            net_total = D(0)

    total = net_total
    amount_paid = sum(D(pmt.amount) for pmt in body.payments)
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
        "notes": body.notes, "client_txn_id": body.client_txn_id, "created_at": now_iso(),
    }
    await db.sales.insert_one(dict(sale))

    # ---- inventory reduction + ledger ----
    for ln in line_docs:
        if not ln["track_inventory"]:
            continue
        if ln["track_lots"] and ln["lot_allocations"]:
            await consume_lots(ln["lot_allocations"], principal)
            for a in ln["lot_allocations"]:
                await record_movement(body.store_id, ln["product_id"], "SALE", -float(a["qty"]),
                                       unit_cost=a["unit_cost"], lot_id=a["lot_id"],
                                       reference=number, ref_id=sale["id"], principal=principal)
        else:
            await record_movement(body.store_id, ln["product_id"], "SALE", -float(ln["qty"]),
                                   unit_cost=ln["unit_cost"], reference=number, ref_id=sale["id"], principal=principal)

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


@router.get("/sales")
async def list_sales(store_id: Optional[str] = None, limit: int = 100,
                     principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID}
    if store_id:
        q["store_id"] = store_id
    return await db.sales.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/sales/{sid}")
async def get_sale(sid: str, principal=Depends(get_current_principal)):
    s = await db.sales.find_one({"id": sid, "org_id": ORG_ID}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Sale not found")
    return s


# ---------------- Refunds ----------------
class RefundLine(BaseModel):
    product_id: str
    qty: float
    restore_stock: bool = True

class RefundIn(BaseModel):
    sale_id: str
    reason: str
    lines: List[RefundLine]

@router.post("/refunds")
async def create_refund(body: RefundIn, principal=Depends(require_perm("pos.refund"))):
    sale = await db.sales.find_one({"id": body.sale_id, "org_id": ORG_ID})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    number = await next_number("RFND")
    refund_total = D(0)
    refund_items = []
    for rl in body.lines:
        sline = next((x for x in sale["items"] if x["product_id"] == rl.product_id), None)
        if not sline:
            continue
        remaining = D(sline["qty"]) - D(sline.get("refunded_qty", 0))
        qty = min(D(rl.qty), remaining)
        if qty <= 0:
            continue
        unit_net = D(sline["line_net"]) / D(sline["qty"]) if D(sline["qty"]) > 0 else D(0)
        amount = unit_net * qty
        refund_total += amount
        sline["refunded_qty"] = m(D(sline.get("refunded_qty", 0)) + qty)
        refund_items.append({"product_id": rl.product_id, "name": sline["name"], "qty": m(qty),
                             "amount": m(amount), "restore_stock": rl.restore_stock})
        if rl.restore_stock and sline.get("track_inventory", True):
            await record_movement(sale["store_id"], rl.product_id, "REFUND", float(qty),
                                   unit_cost=sline.get("unit_cost", 0), reference=number,
                                   ref_id=sale["id"], principal=principal, note=body.reason)

    all_refunded = all(D(x["qty"]) <= D(x.get("refunded_qty", 0)) for x in sale["items"])
    new_status = "REFUNDED" if all_refunded else "PARTIAL_REFUND"
    await db.sales.update_one({"id": sale["id"]}, {"$set": {"items": sale["items"], "status": new_status}})

    refund = {"id": uid(), "number": number, "org_id": ORG_ID, "sale_id": sale["id"],
              "sale_number": sale["number"], "store_id": sale["store_id"],
              "cashier_id": principal.get("id"), "cashier_name": principal.get("name"),
              "reason": body.reason, "items": refund_items, "total": m(refund_total),
              "created_at": now_iso()}
    await db.refunds.insert_one(dict(refund))
    await audit(principal, "sale.refunded", "refund", refund["id"],
                after={"number": number, "total": m(refund_total), "sale": sale["number"]}, store_id=sale["store_id"])
    refund.pop("_id", None)
    return refund


@router.get("/refunds")
async def list_refunds(limit: int = 100, principal=Depends(get_current_principal)):
    return await db.refunds.find({"org_id": ORG_ID}, {"_id": 0}).sort("created_at", -1).to_list(limit)


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
    sales = await db.sales.find({"org_id": ORG_ID, "shift_id": body.shift_id}, {"_id": 0}).to_list(10000)
    cash_sales = D(0)
    sales_total = D(0)
    for s in sales:
        sales_total += D(s["total"])
        for p in s.get("payments", []):
            if p["method"].lower() == "cash":
                cash_sales += D(p["amount"])
    moves = await db.cash_movements.find({"shift_id": body.shift_id}, {"_id": 0}).to_list(1000)
    cash_in = sum(D(x["amount"]) for x in moves if x["type"] in ("IN", "PETTY"))
    cash_out = sum(D(x["amount"]) for x in moves if x["type"] in ("OUT", "DROP"))
    refunds = await db.refunds.find({"org_id": ORG_ID, "store_id": shift["store_id"]}, {"_id": 0}).to_list(10000)
    refunds_total = sum(D(r["total"]) for r in refunds if r.get("created_at", "") >= shift["opened_at"])
    expected = D(shift["opening_cash"]) + cash_sales + cash_in - cash_out - refunds_total
    diff = D(body.counted_cash) - expected
    upd = {"status": "CLOSED", "closed_at": now_iso(), "closed_by": principal.get("name"),
           "sales_total": m(sales_total), "cash_sales": m(cash_sales), "cash_in": m(cash_in),
           "cash_out": m(cash_out), "refunds_total": m(refunds_total), "expected_cash": m(expected),
           "counted_cash": m(body.counted_cash), "difference": m(diff), "transaction_count": len(sales)}
    await db.shifts.update_one({"id": body.shift_id}, {"$set": upd})
    await audit(principal, "shift.closed", "shift", body.shift_id, after={"difference": m(diff)}, store_id=shift["store_id"])
    return {**{k: v for k, v in shift.items() if k != "_id"}, **upd}
