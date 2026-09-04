from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta

from core import (db, ORG_ID, uid, now_iso, m, D, MANILA,
                  get_current_principal, require_perm, audit, next_number, notify)
from inventory_lib import record_movement, get_level

router = APIRouter(prefix="/api", tags=["inventory"])


# ---------------- Stores & Registers ----------------
@router.get("/stores")
async def list_stores(principal=Depends(get_current_principal)):
    return await db.stores.find({"org_id": ORG_ID}, {"_id": 0}).to_list(100)

@router.get("/registers")
async def list_registers(store_id: Optional[str] = None, principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID}
    if store_id:
        q["store_id"] = store_id
    return await db.registers.find(q, {"_id": 0}).to_list(100)


# ---------------- Inventory levels ----------------
@router.get("/inventory/levels")
async def inventory_levels(store_id: Optional[str] = None, low_only: bool = False,
                           principal=Depends(get_current_principal)):
    products = await db.products.find({"org_id": ORG_ID, "active": True}, {"_id": 0}).to_list(2000)
    lq = {"org_id": ORG_ID}
    if store_id:
        lq["store_id"] = store_id
    levels = await db.inventory_levels.find(lq, {"_id": 0}).to_list(10000)
    lmap = {}
    for l in levels:
        lmap.setdefault(l["product_id"], 0)
        lmap[l["product_id"]] += float(l["quantity"])
    rows = []
    for p in products:
        qty = lmap.get(p["id"], 0)
        status = "OUT" if qty <= 0 else ("LOW" if qty <= float(p.get("reorder_level", 0)) else "OK")
        if low_only and status == "OK":
            continue
        rows.append({"product_id": p["id"], "name": p["name"], "sku": p.get("sku"),
                     "category_id": p.get("category_id"), "shelf_code": p.get("shelf_code"),
                     "quantity": m(qty), "reorder_level": p.get("reorder_level", 0),
                     "reorder_qty": p.get("reorder_qty", 0), "uom": p.get("uom"),
                     "average_cost": p.get("average_cost", 0), "price": p.get("price", 0),
                     "supplier_id": p.get("supplier_id"), "status": status,
                     "stock_value": m(D(qty) * D(p.get("average_cost", 0)))})
    return rows


@router.get("/inventory/movements")
async def inventory_movements(product_id: Optional[str] = None, store_id: Optional[str] = None,
                              type: Optional[str] = None, limit: int = 300,
                              principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID}
    if product_id:
        q["product_id"] = product_id
    if store_id:
        q["store_id"] = store_id
    if type:
        q["type"] = type
    return await db.inventory_movements.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


# ---------------- Lots ----------------
@router.get("/inventory/lots")
async def list_lots(product_id: Optional[str] = None, store_id: Optional[str] = None,
                    status: Optional[str] = "ACTIVE", principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID}
    if product_id:
        q["product_id"] = product_id
    if store_id:
        q["store_id"] = store_id
    if status:
        q["status"] = status
    lots = await db.inventory_lots.find(q, {"_id": 0}).to_list(2000)
    pmap = {p["id"]: p for p in await db.products.find({"org_id": ORG_ID}, {"_id": 0, "id": 1, "name": 1, "sku": 1}).to_list(3000)}
    for l in lots:
        l["product_name"] = pmap.get(l["product_id"], {}).get("name")
    return lots


# ---------------- Goods receiving (creates lots + movements + avg cost) ----------------
class ReceiveLine(BaseModel):
    product_id: str
    lot_number: Optional[str] = ""
    expiry_date: Optional[str] = None      # YYYY-MM-DD
    quantity: float                          # in selling UOM (pieces)
    unit_cost: float                         # cost per selling UOM
    supplier_id: Optional[str] = None

class ReceiveIn(BaseModel):
    store_id: str
    supplier_id: Optional[str] = None
    reference: Optional[str] = ""            # e.g. PO number
    po_id: Optional[str] = None
    lines: List[ReceiveLine]

@router.post("/inventory/receive")
async def receive_stock(body: ReceiveIn, principal=Depends(require_perm("inventory.receive"))):
    number = await next_number("GRN")
    for ln in body.lines:
        p = await db.products.find_one({"id": ln.product_id, "org_id": ORG_ID})
        if not p:
            continue
        lot_id = None
        if p.get("track_lots") or p.get("track_expiry"):
            lot_id = uid()
            await db.inventory_lots.insert_one({
                "id": lot_id, "org_id": ORG_ID, "store_id": body.store_id, "product_id": ln.product_id,
                "lot_number": ln.lot_number or number, "expiry_date": ln.expiry_date,
                "quantity": m(ln.quantity), "unit_cost": m(ln.unit_cost),
                "supplier_id": ln.supplier_id or body.supplier_id, "status": "ACTIVE",
                "received_date": now_iso(), "created_at": now_iso()})
        # weighted average cost
        old_qty = D(await get_level(body.store_id, ln.product_id))
        old_cost = D(p.get("average_cost", 0))
        new_qty = old_qty + D(ln.quantity)
        avg = m((old_qty * old_cost + D(ln.quantity) * D(ln.unit_cost)) / new_qty) if new_qty > 0 else m(ln.unit_cost)
        await db.products.update_one({"id": ln.product_id}, {"$set": {
            "average_cost": avg, "latest_cost": m(ln.unit_cost), "updated_at": now_iso()}})
        await record_movement(body.store_id, ln.product_id, "PURCHASE_RECEIPT", ln.quantity,
                              unit_cost=ln.unit_cost, lot_id=lot_id, reference=body.reference or number,
                              ref_id=body.po_id, principal=principal)
    await audit(principal, "goods.received", "receipt", number, after={"lines": len(body.lines)}, store_id=body.store_id)
    return {"number": number, "received": len(body.lines)}


# ---------------- Stock adjustments ----------------
class AdjustLine(BaseModel):
    product_id: str
    quantity: float          # signed: negative to remove, positive to add
    lot_id: Optional[str] = None

class AdjustIn(BaseModel):
    store_id: str
    reason: str              # damaged/expired/lost/theft/correction/...
    notes: Optional[str] = ""
    lines: List[AdjustLine]

@router.post("/inventory/adjust")
async def adjust_stock(body: AdjustIn, principal=Depends(require_perm("inventory.adjust"))):
    number = await next_number("ADJ")
    for ln in body.lines:
        if ln.lot_id:
            await db.inventory_lots.update_one({"id": ln.lot_id}, {"$inc": {"quantity": float(ln.quantity)}})
        p = await db.products.find_one({"id": ln.product_id, "org_id": ORG_ID})
        cost = p.get("average_cost", 0) if p else 0
        await record_movement(body.store_id, ln.product_id, "ADJUSTMENT", ln.quantity,
                              unit_cost=cost, lot_id=ln.lot_id, reference=number,
                              principal=principal, note=f"{body.reason}: {body.notes}")
    await audit(principal, "inventory.adjust", "adjustment", number,
                after={"reason": body.reason, "lines": len(body.lines)}, store_id=body.store_id)
    return {"number": number, "adjusted": len(body.lines)}


@router.get("/inventory/adjustment-reasons")
async def adjustment_reasons(principal=Depends(get_current_principal)):
    s = await db.settings.find_one({"org_id": ORG_ID}, {"_id": 0})
    return (s or {}).get("adjustment_reasons",
            ["damaged", "expired", "lost", "theft", "breakage", "recalled", "supplier return", "correction", "promotional use", "internal use", "other"])


# ---------------- Expiry monitoring ----------------
@router.get("/inventory/expiry")
async def expiry_report(store_id: Optional[str] = None, principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID, "status": "ACTIVE", "quantity": {"$gt": 0}, "expiry_date": {"$ne": None}}
    if store_id:
        q["store_id"] = store_id
    lots = await db.inventory_lots.find(q, {"_id": 0}).to_list(5000)
    pmap = {p["id"]: p for p in await db.products.find({"org_id": ORG_ID}, {"_id": 0}).to_list(3000)}
    today = datetime.now(MANILA).date()
    buckets = {"EXPIRED": [], "0-30": [], "31-60": [], "61-90": [], "91-180": []}
    out = []
    for l in lots:
        try:
            exp = datetime.strptime(l["expiry_date"], "%Y-%m-%d").date()
        except Exception:
            continue
        days = (exp - today).days
        p = pmap.get(l["product_id"], {})
        row = {**l, "product_name": p.get("name"), "sku": p.get("sku"),
               "supplier_id": l.get("supplier_id"), "days_remaining": days,
               "stock_value": m(D(l["quantity"]) * D(l.get("unit_cost", 0)))}
        if days < 0:
            bucket = "EXPIRED"
        elif days <= 30:
            bucket = "0-30"
        elif days <= 60:
            bucket = "31-60"
        elif days <= 90:
            bucket = "61-90"
        elif days <= 180:
            bucket = "91-180"
        else:
            continue
        row["bucket"] = bucket
        buckets[bucket].append(row)
        out.append(row)
    out.sort(key=lambda r: r["days_remaining"])
    summary = {k: {"count": len(v), "value": m(sum(D(x["stock_value"]) for x in v))} for k, v in buckets.items()}
    return {"summary": summary, "lots": out}
