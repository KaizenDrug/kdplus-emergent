from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta

from core import (db, ORG_ID, uid, now_iso, m, D, MANILA,
                  get_current_principal, require_perm, audit, next_number, notify)
from inventory_lib import record_movement, get_level, set_missing_barcodes

router = APIRouter(prefix="/api", tags=["inventory"])


# ---------------- Stores & Registers ----------------
@router.get("/stores")
async def list_stores(principal=Depends(get_current_principal)):
    return await db.stores.find(
        {"org_id": ORG_ID, "id": {"$ne": "store_annex"}, "active": {"$ne": False}},
        {"_id": 0},
    ).to_list(100)

@router.get("/registers")
async def list_registers(store_id: Optional[str] = None, principal=Depends(get_current_principal)):
    q = {"org_id": ORG_ID, "store_id": {"$ne": "store_annex"}, "active": {"$ne": False}}
    if store_id:
        if store_id == "store_annex":
            return []
        q["store_id"] = store_id
    return await db.registers.find(q, {"_id": 0}).to_list(100)


# ---------------- Inventory levels ----------------
@router.get("/inventory/levels")
async def inventory_levels(store_id: Optional[str] = None, low_only: bool = False,
                           principal=Depends(get_current_principal)):
    products = await db.products.find({"org_id": ORG_ID, "active": True}, {"_id": 0}).to_list(10000)
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
        is_promo = p.get("product_type", "REGULAR") == "PROMO"
        if is_promo and p.get("components"):
            possible = [int(lmap.get(c.get("product_id"), 0) // float(c.get("quantity") or 1))
                        for c in p["components"]]
            qty = min(possible) if possible else 0
        else:
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
                     "virtual_promo_stock": is_promo,
                     "stock_value": 0 if is_promo else m(D(qty) * D(p.get("average_cost", 0)))})
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
    products = await db.products.find({"org_id": ORG_ID, "active": True}, {"_id": 0}).to_list(10000)
    pmap = {p["id"]: p for p in products}
    q["product_id"] = product_id if product_id in pmap else {"$in": list(pmap)}
    if product_id and product_id not in pmap:
        return []
    q["quantity"] = {"$gt": 0}
    levels_q = {"org_id": ORG_ID}
    if store_id:
        levels_q["store_id"] = store_id
    levels = await db.inventory_levels.find(levels_q, {"_id": 0}).to_list(20000)
    positive = {(l["store_id"], l["product_id"]) for l in levels if float(l.get("quantity", 0)) > 0}
    lots = await db.inventory_lots.find(q, {"_id": 0}).to_list(20000)
    return [{**l, "product_name": pmap[l["product_id"]]["name"], "sku": pmap[l["product_id"]].get("sku")}
            for l in lots if (l["store_id"], l["product_id"]) in positive]


class LotEditIn(BaseModel):
    lot_number: str
    expiry_date: Optional[str] = None
    quantity: int = Field(ge=0)


@router.put("/inventory/lots/{lot_id}")
async def edit_lot(lot_id: str, body: LotEditIn, principal=Depends(get_current_principal)):
    if principal.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only Owner/Admin can edit batches and expiry dates")
    if body.expiry_date:
        try:
            datetime.strptime(body.expiry_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Expiry date must be YYYY-MM-DD")
    if not body.lot_number.strip():
        raise HTTPException(status_code=422, detail="Batch number is required")
    lot = await db.inventory_lots.find_one({"id": lot_id, "org_id": ORG_ID}, {"_id": 0})
    if not lot or lot.get("status") != "ACTIVE":
        raise HTTPException(status_code=404, detail="Active lot not found")
    product = await db.products.find_one({"id": lot["product_id"], "org_id": ORG_ID, "active": True})
    if not product:
        raise HTTPException(status_code=409, detail="Product is inactive or missing")
    change = D(body.quantity) - D(lot["quantity"])
    level = await get_level(lot["store_id"], lot["product_id"])
    if D(level) + change < 0:
        raise HTTPException(status_code=409, detail="Lot correction would make stock negative")
    updates = {"lot_number": body.lot_number.strip(), "expiry_date": body.expiry_date or None,
               "quantity": body.quantity, "updated_at": now_iso()}
    # Compare the original lot so a concurrent sale cannot be overwritten silently.
    result = await db.inventory_lots.update_one(
        {"org_id": ORG_ID, "id": lot_id, "quantity": lot["quantity"],
         "lot_number": lot.get("lot_number"), "expiry_date": lot.get("expiry_date")}, {"$set": updates})
    if result.matched_count != 1:
        raise HTTPException(status_code=409, detail="Batch changed. Refresh and try again")
    if change:
        await record_movement(lot["store_id"], lot["product_id"], "ADJUSTMENT", m(change),
                              lot.get("unit_cost", 0), lot_id=lot_id, reference="LOT_CORRECTION",
                              principal=principal, note="Owner/Admin batch quantity correction")
    await audit(principal, "inventory.lot.updated", "inventory_lot", lot_id,
                before={k: lot.get(k) for k in updates}, after=updates, store_id=lot["store_id"])
    return {**lot, **updates}


# Drafts preserve incomplete input without changing inventory.
class ReceiveDraftLine(BaseModel):
    product_id: str = ""
    quantity: str = ""
    unit_cost: str = ""
    lot_number: str = ""
    expiry_date: str = ""

class ReceiveDraftIn(BaseModel):
    store_id: str
    supplier_id: str = ""
    lines: List[ReceiveDraftLine]

@router.get("/inventory/receive-drafts")
async def receive_drafts(store_id: str, principal=Depends(require_perm("inventory.receive"))):
    return await db.receive_drafts.find(
        {"org_id": ORG_ID, "store_id": store_id}, {"_id": 0}
    ).sort("updated_at", -1).to_list(1000)

@router.put("/inventory/receive-drafts/{draft_id}")
async def save_receive_draft(draft_id: str, body: ReceiveDraftIn,
                             principal=Depends(require_perm("inventory.receive"))):
    doc = {**body.model_dump(), "updated_at": now_iso()}
    await db.receive_drafts.update_one(
        {"org_id": ORG_ID, "id": draft_id},
        {"$set": doc, "$setOnInsert": {"created_at": now_iso()}}, upsert=True)
    return {"id": draft_id, **doc}

@router.delete("/inventory/receive-drafts/{draft_id}")
async def delete_receive_draft(draft_id: str, principal=Depends(require_perm("inventory.receive"))):
    await db.receive_drafts.delete_one({"org_id": ORG_ID, "id": draft_id})
    return {"ok": True}


# ---------------- Goods receiving (creates lots + movements + avg cost) ----------------
class ReceiveLine(BaseModel):
    product_id: str
    barcode: Optional[str] = None
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
    draft_id: Optional[str] = None
    lines: List[ReceiveLine]

@router.post("/inventory/receive")
async def receive_stock(body: ReceiveIn, principal=Depends(require_perm("inventory.receive"))):
    # Validate product lines and barcode assignments before posting any stock.
    for ln in body.lines:
        p = await db.products.find_one(
            {"id": ln.product_id, "org_id": ORG_ID},
            {"_id": 0, "name": 1, "product_type": 1},
        )
        if not p:
            raise HTTPException(status_code=404, detail="A selected product was not found")
        if p.get("product_type", "REGULAR") == "PROMO":
            raise HTTPException(status_code=400, detail=f"Receive stock under the regular products included in {p['name']}")
        if D(ln.quantity) <= 0:
            raise HTTPException(status_code=400, detail=f"{p['name']}: received quantity must be greater than zero")
    await set_missing_barcodes([(ln.product_id, ln.barcode) for ln in body.lines], principal)
    number = await next_number("GRN")
    for ln in body.lines:
        p = await db.products.find_one({"id": ln.product_id, "org_id": ORG_ID})
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
    if body.draft_id:
        await db.receive_drafts.delete_one({"org_id": ORG_ID, "id": body.draft_id, "store_id": body.store_id})
    return {"number": number, "received": len(body.lines)}


# ---------------- Stock adjustments ----------------
class AdjustLine(BaseModel):
    product_id: str
    quantity: Optional[float] = None      # legacy signed change
    new_quantity: Optional[float] = None  # preferred final on-hand quantity
    lot_id: Optional[str] = None

class AdjustIn(BaseModel):
    store_id: str
    reason: str              # damaged/expired/lost/theft/correction/...
    notes: Optional[str] = ""
    lines: List[AdjustLine]

@router.post("/inventory/adjust")
async def adjust_stock(body: AdjustIn, principal=Depends(require_perm("inventory.adjust"))):
    number = await next_number("ADJ")
    if not body.lines:
        raise HTTPException(status_code=400, detail="Add at least one product to adjust")
    if len({line.product_id for line in body.lines}) != len(body.lines):
        raise HTTPException(status_code=400, detail="Each product can only appear once per adjustment")

    planned = []
    for ln in body.lines:
        p = await db.products.find_one({"id": ln.product_id, "org_id": ORG_ID})
        if not p:
            raise HTTPException(status_code=404, detail=f"Product {ln.product_id} was not found")
        if p.get("product_type", "REGULAR") == "PROMO":
            raise HTTPException(status_code=400, detail=f"Adjust the regular component products instead of {p['name']}")
        before = await get_level(body.store_id, ln.product_id)
        if ln.new_quantity is not None:
            if ln.new_quantity < 0:
                raise HTTPException(status_code=400, detail=f"{p.get('name')}: stock on hand cannot be negative")
            change = m(D(ln.new_quantity) - D(before))
        elif ln.quantity is not None:
            change = m(ln.quantity)
        else:
            raise HTTPException(status_code=400, detail=f"{p.get('name')}: enter a new on-hand quantity")
        planned.append((ln, p, before, change))

    results = []
    for ln, p, before, change in planned:
        if ln.lot_id:
            lot = await db.inventory_lots.find_one({
                "id": ln.lot_id, "org_id": ORG_ID, "store_id": body.store_id,
                "product_id": ln.product_id,
            })
            if not lot:
                raise HTTPException(status_code=404, detail=f"{p.get('name')}: inventory lot was not found")
            lot_after = m(D(lot.get("quantity")) + D(change))
            if lot_after < 0:
                raise HTTPException(status_code=400, detail=f"{p.get('name')}: lot quantity cannot be negative")
            await db.inventory_lots.update_one(
                {"id": ln.lot_id},
                {"$set": {"quantity": lot_after,
                          "status": "DEPLETED" if lot_after == 0 else "ACTIVE",
                          "updated_at": now_iso()}},
            )
        elif ln.new_quantity is not None and D(ln.new_quantity) == 0:
            # Product-level corrections must clear the lot balances too; otherwise the
            # visible on-hand quantity is zero while expiry/FEFO still sees hidden stock.
            await db.inventory_lots.update_many(
                {"org_id": ORG_ID, "store_id": body.store_id,
                 "product_id": ln.product_id, "quantity": {"$ne": 0}},
                {"$set": {"quantity": 0, "status": "DEPLETED", "updated_at": now_iso()}},
            )
        elif (p.get("track_lots") or p.get("track_expiry")) and D(change) < 0:
            # A product-level count must reconcile the FEFO lot balances as well as
            # the aggregate level. Reduce the oldest-expiring lots first.
            remaining = -D(change)
            lots = await db.inventory_lots.find(
                {"org_id": ORG_ID, "store_id": body.store_id,
                 "product_id": ln.product_id, "quantity": {"$gt": 0}},
                {"_id": 0},
            ).to_list(10000)
            lots.sort(key=lambda lot: lot.get("expiry_date") or "9999-12-31")
            for lot in lots:
                if remaining <= 0:
                    break
                available = D(lot.get("quantity"))
                deducted = min(available, remaining)
                lot_after = m(available - deducted)
                await db.inventory_lots.update_one(
                    {"id": lot["id"]},
                    {"$set": {"quantity": lot_after,
                              "status": "DEPLETED" if lot_after == 0 else "ACTIVE",
                              "updated_at": now_iso()}},
                )
                remaining -= deducted
        elif (p.get("track_lots") or p.get("track_expiry")) and D(change) > 0:
            # Stock-count increases have no supplier lot. Keep FEFO totals aligned
            # by creating a clearly identified adjustment lot without an expiry.
            await db.inventory_lots.insert_one({
                "id": uid(), "org_id": ORG_ID, "store_id": body.store_id,
                "product_id": ln.product_id, "lot_number": number,
                "expiry_date": None, "quantity": m(change),
                "unit_cost": m(p.get("average_cost", 0)), "supplier_id": None,
                "status": "ACTIVE", "received_date": now_iso(),
                "created_at": now_iso(), "updated_at": now_iso(),
                "source": "STOCK_ADJUSTMENT",
            })
        after = await record_movement(body.store_id, ln.product_id, "ADJUSTMENT", change,
                                      unit_cost=p.get("average_cost", 0), lot_id=ln.lot_id,
                                      reference=number, principal=principal,
                                      note=f"{body.reason}: {body.notes}")
        results.append({"product_id": ln.product_id, "name": p.get("name"),
                        "quantity_before": before, "quantity_change": change,
                        "quantity_after": after})
    await audit(principal, "inventory.adjust", "adjustment", number,
                after={"reason": body.reason, "lines": len(body.lines)}, store_id=body.store_id)
    return {"number": number, "adjusted": len(body.lines), "lines": results}


@router.get("/inventory/adjustment-reasons")
async def adjustment_reasons(principal=Depends(get_current_principal)):
    s = await db.settings.find_one({"org_id": ORG_ID}, {"_id": 0})
    return (s or {}).get("adjustment_reasons",
            ["damaged", "expired", "lost", "theft", "breakage", "recalled", "supplier return", "correction", "promotional use", "internal use", "other"])


# ---------------- Expiry monitoring ----------------
@router.get("/inventory/expiry")
async def expiry_report(store_id: Optional[str] = None, principal=Depends(get_current_principal)):
    lots = await list_lots(store_id=store_id, product_id=None, status="ACTIVE", principal=principal)
    pmap = {p["id"]: p for p in await db.products.find({"org_id": ORG_ID, "active": True}, {"_id": 0}).to_list(10000)}
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
