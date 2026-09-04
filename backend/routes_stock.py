from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from core import (db, ORG_ID, uid, now_iso, m, D, get_current_principal, require_perm, audit, next_number)
from inventory_lib import record_movement, get_level

router = APIRouter(prefix="/api", tags=["stock"])


# ==================== STOCK TRANSFERS ====================
class TransferLine(BaseModel):
    product_id: str
    qty: float

class TransferIn(BaseModel):
    source_store: str
    dest_store: str
    items: List[TransferLine]
    notes: Optional[str] = ""


@router.get("/stock-transfers")
async def list_transfers(principal=Depends(get_current_principal)):
    return await db.stock_transfers.find({"org_id": ORG_ID}, {"_id": 0}).sort("created_at", -1).to_list(300)


@router.get("/stock-transfers/{tid}")
async def get_transfer(tid: str, principal=Depends(get_current_principal)):
    t = await db.stock_transfers.find_one({"id": tid, "org_id": ORG_ID}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return t


@router.post("/stock-transfers")
async def create_transfer(body: TransferIn, principal=Depends(require_perm("inventory.adjust"))):
    if body.source_store == body.dest_store:
        raise HTTPException(status_code=400, detail="Source and destination must be different stores")
    number = await next_number("TR")
    items = []
    for ln in body.items:
        p = await db.products.find_one({"id": ln.product_id, "org_id": ORG_ID}, {"_id": 0})
        if not p:
            continue
        items.append({"product_id": ln.product_id, "name": p["name"], "sku": p.get("sku"),
                      "qty": m(ln.qty), "unit_cost": p.get("average_cost", 0)})
    if not items:
        raise HTTPException(status_code=400, detail="Add at least one valid product")
    doc = {"id": uid(), "number": number, "org_id": ORG_ID, "source_store": body.source_store,
           "dest_store": body.dest_store, "items": items, "notes": body.notes,
           "status": "DRAFT", "sender": None, "receiver": None,
           "sent_at": None, "received_at": None, "created_at": now_iso()}
    await db.stock_transfers.insert_one(dict(doc))
    await audit(principal, "transfer.created", "stock_transfer", doc["id"], after={"number": number}, store_id=body.source_store)
    doc.pop("_id", None)
    return doc


@router.put("/stock-transfers/{tid}/send")
async def send_transfer(tid: str, principal=Depends(require_perm("inventory.adjust"))):
    t = await db.stock_transfers.find_one({"id": tid, "org_id": ORG_ID})
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if t["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail="Only draft transfers can be sent")
    for it in t["items"]:
        await record_movement(t["source_store"], it["product_id"], "TRANSFER_OUT", -float(it["qty"]),
                              unit_cost=it.get("unit_cost", 0), reference=t["number"], ref_id=tid, principal=principal)
    await db.stock_transfers.update_one({"id": tid}, {"$set": {
        "status": "IN_TRANSIT", "sender": principal.get("name"), "sent_at": now_iso()}})
    await audit(principal, "transfer.sent", "stock_transfer", tid, store_id=t["source_store"])
    return await db.stock_transfers.find_one({"id": tid}, {"_id": 0})


@router.put("/stock-transfers/{tid}/receive")
async def receive_transfer(tid: str, principal=Depends(require_perm("inventory.receive"))):
    t = await db.stock_transfers.find_one({"id": tid, "org_id": ORG_ID})
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if t["status"] != "IN_TRANSIT":
        raise HTTPException(status_code=400, detail="Only in-transit transfers can be received")
    for it in t["items"]:
        await record_movement(t["dest_store"], it["product_id"], "TRANSFER_IN", float(it["qty"]),
                              unit_cost=it.get("unit_cost", 0), reference=t["number"], ref_id=tid, principal=principal)
    await db.stock_transfers.update_one({"id": tid}, {"$set": {
        "status": "RECEIVED", "receiver": principal.get("name"), "received_at": now_iso()}})
    await audit(principal, "transfer.received", "stock_transfer", tid, store_id=t["dest_store"])
    return await db.stock_transfers.find_one({"id": tid}, {"_id": 0})


@router.put("/stock-transfers/{tid}/cancel")
async def cancel_transfer(tid: str, principal=Depends(require_perm("inventory.adjust"))):
    t = await db.stock_transfers.find_one({"id": tid, "org_id": ORG_ID})
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if t["status"] == "RECEIVED":
        raise HTTPException(status_code=400, detail="Cannot cancel a received transfer")
    if t["status"] == "IN_TRANSIT":
        # restore stock back to source
        for it in t["items"]:
            await record_movement(t["source_store"], it["product_id"], "TRANSFER_IN", float(it["qty"]),
                                  unit_cost=it.get("unit_cost", 0), reference=t["number"] + "-CANCEL",
                                  ref_id=tid, principal=principal, note="Transfer cancelled")
    await db.stock_transfers.update_one({"id": tid}, {"$set": {"status": "CANCELLED"}})
    await audit(principal, "transfer.cancelled", "stock_transfer", tid, store_id=t["source_store"])
    return await db.stock_transfers.find_one({"id": tid}, {"_id": 0})


# ==================== INVENTORY COUNTS ====================
class CountIn(BaseModel):
    store_id: str
    category_id: Optional[str] = None   # None = full count
    notes: Optional[str] = ""


@router.get("/inventory-counts")
async def list_counts(principal=Depends(get_current_principal)):
    return await db.inventory_counts.find({"org_id": ORG_ID}, {"_id": 0}).sort("created_at", -1).to_list(300)


@router.get("/inventory-counts/{cid}")
async def get_count(cid: str, principal=Depends(get_current_principal)):
    c = await db.inventory_counts.find_one({"id": cid, "org_id": ORG_ID}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Count not found")
    return c


@router.post("/inventory-counts")
async def create_count(body: CountIn, principal=Depends(require_perm("inventory.adjust"))):
    number = await next_number("COUNT")
    q = {"org_id": ORG_ID, "active": True, "track_inventory": True}
    if body.category_id:
        q["category_id"] = body.category_id
    products = await db.products.find(q, {"_id": 0}).sort("name", 1).to_list(3000)
    items = []
    for p in products:
        expected = await get_level(body.store_id, p["id"])
        items.append({"product_id": p["id"], "name": p["name"], "sku": p.get("sku"),
                      "expected": m(expected), "counted": None, "unit_cost": p.get("average_cost", 0)})
    doc = {"id": uid(), "number": number, "org_id": ORG_ID, "store_id": body.store_id,
           "category_id": body.category_id, "scope": "Full" if not body.category_id else "Partial",
           "items": items, "notes": body.notes, "status": "OPEN",
           "created_by": principal.get("name"), "created_at": now_iso(), "approved_at": None}
    await db.inventory_counts.insert_one(dict(doc))
    await audit(principal, "count.created", "inventory_count", doc["id"], after={"number": number, "items": len(items)}, store_id=body.store_id)
    doc.pop("_id", None)
    return doc


class CountItemsIn(BaseModel):
    items: List[dict]   # [{product_id, counted}]

@router.put("/inventory-counts/{cid}/items")
async def save_count_items(cid: str, body: CountItemsIn, principal=Depends(require_perm("inventory.adjust"))):
    c = await db.inventory_counts.find_one({"id": cid, "org_id": ORG_ID})
    if not c:
        raise HTTPException(status_code=404, detail="Count not found")
    if c["status"] != "OPEN":
        raise HTTPException(status_code=400, detail="Count is not open")
    counted_map = {x["product_id"]: x.get("counted") for x in body.items}
    for it in c["items"]:
        if it["product_id"] in counted_map:
            v = counted_map[it["product_id"]]
            it["counted"] = None if v in (None, "") else m(v)
    await db.inventory_counts.update_one({"id": cid}, {"$set": {"items": c["items"]}})
    return {"saved": True}


@router.post("/inventory-counts/{cid}/approve")
async def approve_count(cid: str, principal=Depends(require_perm("inventory.adjust"))):
    c = await db.inventory_counts.find_one({"id": cid, "org_id": ORG_ID})
    if not c:
        raise HTTPException(status_code=404, detail="Count not found")
    if c["status"] != "OPEN":
        raise HTTPException(status_code=400, detail="Count already processed")
    corrections = 0
    variance_value = D(0)
    for it in c["items"]:
        if it.get("counted") is None:
            continue
        current = D(await get_level(c["store_id"], it["product_id"]))
        delta = D(it["counted"]) - current
        if delta != 0:
            await record_movement(c["store_id"], it["product_id"], "COUNT_CORRECTION", float(delta),
                                  unit_cost=it.get("unit_cost", 0), reference=c["number"], ref_id=cid,
                                  principal=principal, note="Inventory count correction")
            corrections += 1
            variance_value += delta * D(it.get("unit_cost", 0))
    await db.inventory_counts.update_one({"id": cid}, {"$set": {
        "status": "APPROVED", "approved_at": now_iso(), "approved_by": principal.get("name"),
        "corrections": corrections, "variance_value": m(variance_value)}})
    await audit(principal, "count.approved", "inventory_count", cid,
                after={"corrections": corrections, "variance_value": m(variance_value)}, store_id=c["store_id"])
    return await db.inventory_counts.find_one({"id": cid}, {"_id": 0})
