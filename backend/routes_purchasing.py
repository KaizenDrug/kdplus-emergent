from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from core import (db, ORG_ID, uid, now_iso, m, D, get_current_principal, require_perm, audit, next_number)

router = APIRouter(prefix="/api", tags=["purchasing"])


class POItemIn(BaseModel):
    product_id: str
    name: Optional[str] = ""
    qty_ordered: float
    unit_cost: float

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


def po_totals(items, discount, tax, shipping, additional):
    subtotal = sum(D(i["qty_ordered"]) * D(i["unit_cost"]) for i in items)
    total = subtotal - D(discount) + D(tax) + D(shipping) + D(additional)
    return m(subtotal), m(total)


@router.get("/purchase-orders")
async def list_pos(status: Optional[str] = None, principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID}
    if status:
        q["status"] = status
    return await db.purchase_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/purchase-orders/{pid}")
async def get_po(pid: str, principal=Depends(get_current_principal)):
    po = await db.purchase_orders.find_one({"id": pid, "org_id": ORG_ID}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


@router.post("/purchase-orders")
async def create_po(body: POIn, principal=Depends(require_perm("*"))):
    number = await next_number("PO")
    items = []
    for it in body.items:
        p = await db.products.find_one({"id": it.product_id, "org_id": ORG_ID}, {"_id": 0})
        items.append({"product_id": it.product_id, "name": it.name or (p or {}).get("name", ""),
                      "qty_ordered": m(it.qty_ordered), "qty_received": 0, "unit_cost": m(it.unit_cost)})
    subtotal, total = po_totals(items, body.discount, body.tax, body.shipping, body.additional_costs)
    doc = {"id": uid(), "number": number, "org_id": ORG_ID, "supplier_id": body.supplier_id,
           "store_id": body.store_id, "order_date": now_iso(), "expected_date": body.expected_date,
           "items": items, "discount": m(body.discount), "tax": m(body.tax), "shipping": m(body.shipping),
           "additional_costs": m(body.additional_costs), "subtotal": subtotal, "total": total,
           "status": "DRAFT", "notes": body.notes, "created_at": now_iso()}
    await db.purchase_orders.insert_one(dict(doc))
    await audit(principal, "po.created", "purchase_order", doc["id"], after={"number": number, "total": total})
    doc.pop("_id", None)
    return doc


class POStatusIn(BaseModel):
    status: str

@router.put("/purchase-orders/{pid}/status")
async def set_po_status(pid: str, body: POStatusIn, principal=Depends(require_perm("*"))):
    await db.purchase_orders.update_one({"id": pid, "org_id": ORG_ID}, {"$set": {"status": body.status}})
    await audit(principal, "po.status", "purchase_order", pid, after={"status": body.status})
    return await db.purchase_orders.find_one({"id": pid}, {"_id": 0})


class POReceiveLine(BaseModel):
    product_id: str
    qty: float
    lot_number: Optional[str] = ""
    expiry_date: Optional[str] = None
    unit_cost: Optional[float] = None

class POReceiveIn(BaseModel):
    lines: List[POReceiveLine]

@router.post("/purchase-orders/{pid}/receive")
async def receive_po(pid: str, body: POReceiveIn, principal=Depends(require_perm("inventory.receive"))):
    from inventory_lib import record_movement, get_level
    po = await db.purchase_orders.find_one({"id": pid, "org_id": ORG_ID})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    for ln in body.lines:
        poi = next((x for x in po["items"] if x["product_id"] == ln.product_id), None)
        if not poi:
            continue
        unit_cost = ln.unit_cost if ln.unit_cost is not None else poi["unit_cost"]
        p = await db.products.find_one({"id": ln.product_id, "org_id": ORG_ID})
        lot_id = None
        if p and (p.get("track_lots") or p.get("track_expiry")):
            lot_id = uid()
            await db.inventory_lots.insert_one({"id": lot_id, "org_id": ORG_ID, "store_id": po["store_id"],
                "product_id": ln.product_id, "lot_number": ln.lot_number or po["number"],
                "expiry_date": ln.expiry_date, "quantity": m(ln.qty), "unit_cost": m(unit_cost),
                "supplier_id": po["supplier_id"], "status": "ACTIVE", "received_date": now_iso(), "created_at": now_iso()})
        old_qty = D(await get_level(po["store_id"], ln.product_id))
        old_cost = D((p or {}).get("average_cost", 0))
        new_qty = old_qty + D(ln.qty)
        avg = m((old_qty * old_cost + D(ln.qty) * D(unit_cost)) / new_qty) if new_qty > 0 else m(unit_cost)
        await db.products.update_one({"id": ln.product_id}, {"$set": {"average_cost": avg, "latest_cost": m(unit_cost)}})
        await record_movement(po["store_id"], ln.product_id, "PURCHASE_RECEIPT", ln.qty,
                              unit_cost=unit_cost, lot_id=lot_id, reference=po["number"], ref_id=pid, principal=principal)
        poi["qty_received"] = m(D(poi.get("qty_received", 0)) + D(ln.qty))
    all_recv = all(D(x["qty_received"]) >= D(x["qty_ordered"]) for x in po["items"])
    status = "RECEIVED" if all_recv else "PARTIALLY_RECEIVED"
    await db.purchase_orders.update_one({"id": pid}, {"$set": {"items": po["items"], "status": status}})
    await audit(principal, "goods.received", "purchase_order", pid, after={"status": status}, store_id=po["store_id"])
    return await db.purchase_orders.find_one({"id": pid}, {"_id": 0})
