from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from core import (db, ORG_ID, uid, now_iso, m, D, get_current_principal,
                  require_perm, audit, next_number)

router = APIRouter(prefix="/api", tags=["purchasing"])


# ---------------- Models ----------------
class POItemIn(BaseModel):
    product_id: str
    name: Optional[str] = ""
    qty_ordered: float
    unit_cost: float  # ordered / expected unit cost


class POIn(BaseModel):
    supplier_id: str
    store_id: str
    expected_date: Optional[str] = None
    items: List[POItemIn]
    discount: float = 0
    tax: float = 0
    shipping: float = 0
    additional_costs: float = 0
    notes: Optional[str] = ""


class POStatusIn(BaseModel):
    status: str


class POReceiveLine(BaseModel):
    product_id: str
    qty: float
    substitution_decision: Optional[str] = None  # ACCEPT or REJECT when a different product was delivered
    received_product_id: Optional[str] = None    # catalog product actually delivered (accepted substitutions only)
    substitute_description: Optional[str] = ""   # optional description when a substitute is rejected
    actual_unit_cost: Optional[float] = None  # actual invoice cost; defaults to ordered
    lot_number: Optional[str] = ""
    expiry_date: Optional[str] = None
    variance_reason: Optional[str] = ""
    variance_note: Optional[str] = ""


class POReceiveIn(BaseModel):
    lines: List[POReceiveLine]
    note: Optional[str] = ""


class CancelRemainingIn(BaseModel):
    reason: Optional[str] = ""


# ---------------- Helpers ----------------
def _norm_item(it: dict) -> dict:
    """Backfill new cost/qty fields on a PO line for backward compatibility."""
    ordered = it.get("ordered_unit_cost", it.get("unit_cost", 0))
    qo = D(it.get("qty_ordered", 0))
    qr = D(it.get("qty_received", 0))
    qc = D(it.get("qty_cancelled", 0))
    it["ordered_unit_cost"] = m(ordered)
    it["unit_cost"] = m(ordered)  # kept for backward compatibility
    it["qty_cancelled"] = m(qc)
    it["qty_outstanding"] = m(max(D(0), qo - qr - qc))
    it["qty_over_received"] = m(max(D(0), qr - qo))
    return it


def _norm_po(po: dict) -> dict:
    po.pop("_id", None)
    po["items"] = sorted(
        (_norm_item(dict(i)) for i in po.get("items", [])),
        key=lambda item: (item.get("name") or "").strip().casefold(),
    )
    return po


def po_totals(items, discount, tax, shipping, additional):
    subtotal = sum(D(i["qty_ordered"]) * D(i.get("ordered_unit_cost", i.get("unit_cost", 0))) for i in items)
    total = subtotal - D(discount) + D(tax) + D(shipping) + D(additional)
    return m(subtotal), m(total)


async def _variance_threshold() -> float:
    s = await db.settings.find_one({"org_id": ORG_ID}, {"_id": 0})
    return float((s or {}).get("purchasing", {}).get("cost_variance_threshold_pct", 5))


def _compute_status(items) -> str:
    fully_received = all(D(i["qty_received"]) >= D(i["qty_ordered"]) for i in items)
    all_settled = all(D(i["qty_received"]) + D(i.get("qty_cancelled", 0)) >= D(i["qty_ordered"]) for i in items)
    any_received = any(D(i["qty_received"]) > 0 for i in items)
    if fully_received:
        return "RECEIVED"
    if all_settled:
        return "CLOSED_PARTIAL" if any_received else "CANCELLED"
    return "PARTIALLY_RECEIVED"


# ---------------- List / Get ----------------
@router.get("/purchase-orders")
async def list_pos(status: Optional[str] = None, principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID}
    if status:
        q["status"] = status
    rows = await db.purchase_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_norm_po(r) for r in rows]


@router.get("/purchase-orders/{pid}")
async def get_po(pid: str, principal=Depends(get_current_principal)):
    po = await db.purchase_orders.find_one({"id": pid, "org_id": ORG_ID}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return _norm_po(po)


@router.get("/purchase-orders/{pid}/receipts")
async def po_receipts(pid: str, principal=Depends(get_current_principal)):
    return await db.po_receipts.find({"org_id": ORG_ID, "po_id": pid}, {"_id": 0}).sort("received_at", 1).to_list(1000)


# ---------------- Create ----------------
async def _build_items(body_items):
    items = []
    for it in body_items:
        p = await db.products.find_one({"id": it.product_id, "org_id": ORG_ID}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="A selected purchase-order product was not found")
        if p.get("product_type", "REGULAR") == "PROMO":
            raise HTTPException(status_code=400, detail=f"Order the regular products included in {p['name']} instead of the promotional SKU")
        items.append({"product_id": it.product_id, "name": it.name or (p or {}).get("name", ""),
                      "qty_ordered": m(it.qty_ordered), "qty_received": 0, "qty_cancelled": 0,
                      "ordered_unit_cost": m(it.unit_cost), "unit_cost": m(it.unit_cost)})
    return sorted(items, key=lambda item: (item.get("name") or "").strip().casefold())


@router.post("/purchase-orders")
async def create_po(body: POIn, principal=Depends(require_perm("*"))):
    number = await next_number("PO")
    items = await _build_items(body.items)
    subtotal, total = po_totals(items, body.discount, body.tax, body.shipping, body.additional_costs)
    doc = {"id": uid(), "number": number, "org_id": ORG_ID, "supplier_id": body.supplier_id,
           "store_id": body.store_id, "order_date": now_iso(), "expected_date": body.expected_date,
           "items": items, "discount": m(body.discount), "tax": m(body.tax), "shipping": m(body.shipping),
           "additional_costs": m(body.additional_costs), "subtotal": subtotal, "total": total,
           "status": "DRAFT", "notes": body.notes, "created_at": now_iso()}
    await db.purchase_orders.insert_one(dict(doc))
    await audit(principal, "po.created", "purchase_order", doc["id"], after={"number": number, "total": total})
    return _norm_po(doc)


# ---------------- Edit (DRAFT only) ----------------
@router.put("/purchase-orders/{pid}")
async def update_po(pid: str, body: POIn, principal=Depends(require_perm("*"))):
    po = await db.purchase_orders.find_one({"id": pid, "org_id": ORG_ID})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.get("status") != "DRAFT":
        raise HTTPException(status_code=400, detail="Only draft purchase orders can be edited")
    items = await _build_items(body.items)
    subtotal, total = po_totals(items, body.discount, body.tax, body.shipping, body.additional_costs)
    upd = {"supplier_id": body.supplier_id, "store_id": body.store_id, "expected_date": body.expected_date,
           "items": items, "discount": m(body.discount), "tax": m(body.tax), "shipping": m(body.shipping),
           "additional_costs": m(body.additional_costs), "subtotal": subtotal, "total": total,
           "notes": body.notes, "updated_at": now_iso()}
    await db.purchase_orders.update_one({"id": pid, "org_id": ORG_ID}, {"$set": upd})
    await audit(principal, "po.updated", "purchase_order", pid, after={"number": po.get("number"), "total": total})
    return await get_po(pid, principal)


# ---------------- Status (Mark Sent, etc.) ----------------
@router.put("/purchase-orders/{pid}/status")
async def set_po_status(pid: str, body: POStatusIn, principal=Depends(require_perm("*"))):
    await db.purchase_orders.update_one({"id": pid, "org_id": ORG_ID}, {"$set": {"status": body.status}})
    await audit(principal, "po.status", "purchase_order", pid, after={"status": body.status})
    return await get_po(pid, principal)


# ---------------- Cancel remaining / undelivered ----------------
@router.post("/purchase-orders/{pid}/cancel-remaining")
async def cancel_remaining(pid: str, body: CancelRemainingIn, principal=Depends(require_perm("*"))):
    po = await db.purchase_orders.find_one({"id": pid, "org_id": ORG_ID})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.get("status") in ("RECEIVED", "CLOSED_PARTIAL", "CANCELLED"):
        raise HTTPException(status_code=400, detail="This PO has no outstanding quantity to cancel")
    items = [_norm_item(dict(i)) for i in po["items"]]
    cancelled_total = 0
    for it in items:
        outstanding = D(it["qty_ordered"]) - D(it["qty_received"]) - D(it["qty_cancelled"])
        if outstanding > 0:
            it["qty_cancelled"] = m(D(it["qty_cancelled"]) + outstanding)
            cancelled_total += float(outstanding)
        it["qty_outstanding"] = 0
    status = _compute_status(items)
    await db.purchase_orders.update_one({"id": pid, "org_id": ORG_ID},
                                        {"$set": {"items": items, "status": status, "updated_at": now_iso()}})
    await audit(principal, "po.remaining_cancelled", "purchase_order", pid,
                after={"number": po.get("number"), "qty_cancelled": m(cancelled_total),
                       "status": status, "reason": body.reason}, store_id=po.get("store_id"))
    return await get_po(pid, principal)


# ---------------- Receive (with cost variance) ----------------
@router.post("/purchase-orders/{pid}/receive")
async def receive_po(pid: str, body: POReceiveIn, principal=Depends(require_perm("inventory.receive"))):
    from inventory_lib import record_movement, get_level

    po = await db.purchase_orders.find_one({"id": pid, "org_id": ORG_ID})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.get("status") not in ("SENT", "PARTIALLY_RECEIVED"):
        raise HTTPException(status_code=400, detail="Mark the PO as Sent before receiving items")

    items = [_norm_item(dict(i)) for i in po["items"]]
    item_by_pid = {i["product_id"]: i for i in items}
    threshold = D(await _variance_threshold())

    # ---------- Phase 1: validate ALL lines up-front (no mutation) ----------
    planned = []
    rejected = []
    for ln in body.lines:
        qty = D(ln.qty)
        decision = (ln.substitution_decision or "").strip().upper()
        if decision and decision not in ("ACCEPT", "REJECT"):
            raise HTTPException(status_code=400, detail="Substitution decision must be ACCEPT or REJECT")
        if decision == "REJECT":
            if qty <= 0:
                raise HTTPException(status_code=400, detail="Enter the quantity of the substitute delivery being rejected")
            poi = item_by_pid.get(ln.product_id)
            if not poi:
                raise HTTPException(status_code=400, detail=f"Product {ln.product_id} is not on this PO")
            rejected.append({"ln": ln, "poi": poi, "qty": qty})
            continue
        if qty <= 0:
            continue
        poi = item_by_pid.get(ln.product_id)
        if not poi:
            raise HTTPException(status_code=400, detail=f"Product {ln.product_id} is not on this PO")
        received_product_id = ln.product_id
        if decision == "ACCEPT":
            received_product_id = (ln.received_product_id or "").strip()
            if not received_product_id or received_product_id == ln.product_id:
                raise HTTPException(status_code=400, detail=f"{poi['name']}: select a different catalog product to accept as a substitute")
            substitute = await db.products.find_one({"id": received_product_id, "org_id": ORG_ID}, {"_id": 0})
            if not substitute or not substitute.get("active", True):
                raise HTTPException(status_code=400, detail=f"{poi['name']}: the selected substitute is unavailable")
            if substitute.get("product_type", "REGULAR") == "PROMO" or substitute.get("track_inventory") is False:
                raise HTTPException(status_code=400, detail=f"{substitute.get('name', 'Selected substitute')} does not track stock and cannot be received")
        elif ln.received_product_id:
            raise HTTPException(status_code=400, detail=f"{poi['name']}: choose Accept before selecting a substitute product")
        outstanding = max(D(0), D(poi["qty_ordered"]) - D(poi["qty_received"]) - D(poi["qty_cancelled"]))
        over_received = max(D(0), qty - outstanding)
        ordered = D(poi["ordered_unit_cost"])
        actual = D(ln.actual_unit_cost) if ln.actual_unit_cost is not None else ordered
        var_amt = actual - ordered
        var_pct = (var_amt / ordered * D(100)) if ordered > 0 else D(0)
        reason = (ln.variance_reason or "").strip()
        note = (ln.variance_note or "").strip()
        if abs(var_pct) > threshold:
            if not reason:
                raise HTTPException(status_code=400,
                                    detail=f"{poi['name']}: cost variance {m(var_pct)}% exceeds {m(threshold)}% — a reason is required")
            if reason.lower() == "other" and not note:
                raise HTTPException(status_code=400,
                                    detail=f"{poi['name']}: please add a note for the 'Other' variance reason")
        planned.append({"ln": ln, "poi": poi, "qty": qty, "received_product_id": received_product_id, "outstanding": outstanding,
                        "over_received": over_received, "ordered": ordered, "actual": actual,
                        "var_amt": var_amt, "var_pct": var_pct, "reason": reason, "note": note})

    if not planned and not rejected:
        raise HTTPException(status_code=400, detail="Enter a received quantity for at least one line")

    # ---------- Phase 2: apply ----------
    receipt_group_id = uid()
    receipt_no = await next_number("GRN")
    store_id = po["store_id"]
    for entry in rejected:
        ln, poi, qty = entry["ln"], entry["poi"], entry["qty"]
        description = (ln.substitute_description or "").strip()
        await db.po_receipts.insert_one({
            "id": uid(), "receipt_group_id": receipt_group_id, "receipt_no": receipt_no, "org_id": ORG_ID,
            "po_id": pid, "po_number": po["number"], "po_line_id": ln.product_id,
            "product_id": ln.product_id, "product_name": poi["name"], "ordered_product_id": ln.product_id,
            "ordered_product_name": poi["name"], "substitution_status": "REJECTED",
            "substitute_description": description, "qty_received": 0, "qty_rejected": m(qty),
            "supplier_id": po["supplier_id"], "store_id": store_id, "received_at": now_iso(),
            "received_by": (principal or {}).get("id"), "received_by_name": (principal or {}).get("name"),
        })
        await audit(principal, "po.substitute_rejected", "purchase_order", pid,
                    after={"number": po["number"], "product": poi["name"],
                           "substitute_description": description, "qty_rejected": m(qty)}, store_id=store_id)
    for pl in planned:
        ln, poi, qty, actual = pl["ln"], pl["poi"], pl["qty"], pl["actual"]
        received_product_id = pl["received_product_id"]
        p = await db.products.find_one({"id": received_product_id, "org_id": ORG_ID})
        is_substitute = received_product_id != ln.product_id

        # 1) lot with ITS OWN actual cost (never rewrite existing lots)
        lot_id = None
        if p and (p.get("track_lots") or p.get("track_expiry")):
            lot_id = uid()
            await db.inventory_lots.insert_one({
                "id": lot_id, "org_id": ORG_ID, "store_id": store_id, "product_id": received_product_id,
                "lot_number": ln.lot_number or po["number"], "expiry_date": ln.expiry_date,
                "quantity": m(qty), "unit_cost": m(actual), "supplier_id": po["supplier_id"],
                "status": "ACTIVE", "received_date": now_iso(), "created_at": now_iso()})

        # 2) weighted average + latest cost (product level)
        old_qty = D(await get_level(store_id, received_product_id))
        old_cost = D((p or {}).get("average_cost", 0))
        new_qty = old_qty + qty
        avg = m((old_qty * old_cost + qty * actual) / new_qty) if new_qty > 0 else m(actual)
        await db.products.update_one({"id": received_product_id},
                                     {"$set": {"average_cost": avg, "latest_cost": m(actual), "updated_at": now_iso()}})

        # 3) inventory movement at ACTUAL cost
        await record_movement(store_id, received_product_id, "PURCHASE_RECEIPT", float(qty),
                              unit_cost=float(actual), lot_id=lot_id, reference=po["number"],
                              ref_id=pid, principal=principal)

        # 4) immutable receipt history record
        await db.po_receipts.insert_one({
            "id": uid(), "receipt_group_id": receipt_group_id, "receipt_no": receipt_no, "org_id": ORG_ID,
            "po_id": pid, "po_number": po["number"], "po_line_id": ln.product_id, "product_id": received_product_id,
            "product_name": (p or {}).get("name", poi["name"]), "ordered_product_id": ln.product_id,
            "ordered_product_name": poi["name"], "substitution_status": "ACCEPTED" if is_substitute else None,
            "supplier_id": po["supplier_id"], "store_id": store_id,
            "qty_received": m(qty), "qty_outstanding_before": m(pl["outstanding"]),
            "qty_over_received": m(pl["over_received"]),
            "ordered_unit_cost": m(pl["ordered"]), "actual_unit_cost": m(actual),
            "variance_amount": m(pl["var_amt"]), "variance_percent": m(pl["var_pct"]),
            "variance_reason": pl["reason"], "variance_note": pl["note"],
            "lot_id": lot_id, "lot_number": ln.lot_number or po["number"], "expiry_date": ln.expiry_date,
            "received_at": now_iso(), "received_by": (principal or {}).get("id"),
            "received_by_name": (principal or {}).get("name")})

        # 5) update PO line received qty (in memory)
        poi["qty_received"] = m(D(poi["qty_received"]) + qty)

        # 6) audit
        await audit(principal, "po.received", "purchase_order", pid,
                    after={"number": po["number"], "product": (p or {}).get("name", poi["name"]),
                           "ordered_product": poi["name"] if is_substitute else None,
                           "substitution_status": "ACCEPTED" if is_substitute else None, "qty": m(qty),
                           "qty_over_received": m(pl["over_received"]),
                           "ordered_unit_cost": m(pl["ordered"]), "actual_unit_cost": m(actual),
                           "lot": ln.lot_number, "expiry": ln.expiry_date}, store_id=store_id)
        if pl["var_amt"] != 0:
            await audit(principal, "po.cost_variance", "purchase_order", pid,
                        after={"number": po["number"], "product": poi["name"],
                               "variance_amount": m(pl["var_amt"]), "variance_percent": m(pl["var_pct"]),
                               "reason": pl["reason"], "note": pl["note"]}, store_id=store_id)

    # recompute outstanding + status
    for it in items:
        it["qty_outstanding"] = m(max(D(0), D(it["qty_ordered"]) - D(it["qty_received"]) - D(it["qty_cancelled"])))
        it["qty_over_received"] = m(max(D(0), D(it["qty_received"]) - D(it["qty_ordered"])))
    # A rejected substitute does not count as a receipt and must not advance
    # a SENT PO into PARTIALLY_RECEIVED by itself.
    status = _compute_status(items) if planned else po.get("status", "SENT")
    await db.purchase_orders.update_one({"id": pid, "org_id": ORG_ID},
                                        {"$set": {"items": items, "status": status, "updated_at": now_iso()}})
    return await get_po(pid, principal)
