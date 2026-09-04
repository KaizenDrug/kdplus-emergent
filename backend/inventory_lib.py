from core import db, ORG_ID, uid, now_iso, m, D
from datetime import datetime


async def get_level(store_id: str, product_id: str) -> float:
    lvl = await db.inventory_levels.find_one({"org_id": ORG_ID, "store_id": store_id, "product_id": product_id})
    return float(lvl["quantity"]) if lvl else 0.0


async def record_movement(store_id, product_id, mtype, qty_change, unit_cost=0,
                          lot_id=None, reference=None, ref_id=None, principal=None, note=""):
    """Update inventory level and append an immutable ledger entry. Returns new qty."""
    before = await get_level(store_id, product_id)
    after = m(D(before) + D(qty_change))
    await db.inventory_levels.update_one(
        {"org_id": ORG_ID, "store_id": store_id, "product_id": product_id},
        {"$set": {"quantity": after, "updated_at": now_iso()},
         "$setOnInsert": {"id": uid()}}, upsert=True)
    await db.inventory_movements.insert_one({
        "id": uid(), "org_id": ORG_ID, "store_id": store_id, "product_id": product_id,
        "lot_id": lot_id, "type": mtype, "qty_before": before, "qty_change": m(qty_change),
        "qty_after": after, "unit_cost": m(unit_cost), "reference": reference, "ref_id": ref_id,
        "user_id": (principal or {}).get("id"), "user_name": (principal or {}).get("name"),
        "note": note, "created_at": now_iso(),
    })
    return after


async def active_lots(store_id, product_id):
    lots = await db.inventory_lots.find(
        {"org_id": ORG_ID, "store_id": store_id, "product_id": product_id,
         "status": "ACTIVE", "quantity": {"$gt": 0}}, {"_id": 0}).to_list(1000)
    # FEFO: nearest expiry first; lots without expiry go last
    def key(l):
        return l.get("expiry_date") or "9999-12-31"
    return sorted(lots, key=key)


async def allocate_fefo(store_id, product_id, qty, allow_expired=False):
    """Allocate qty across lots FEFO. Returns (allocations, weighted_cost, shortfall)."""
    need = D(qty)
    lots = await active_lots(store_id, product_id)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    allocations = []
    total_cost = D(0)
    for lot in lots:
        if need <= 0:
            break
        if not allow_expired and lot.get("expiry_date") and lot["expiry_date"] < today:
            continue
        avail = D(lot["quantity"])
        take = min(avail, need)
        if take <= 0:
            continue
        allocations.append({"lot_id": lot["id"], "lot_number": lot.get("lot_number"),
                            "qty": m(take), "unit_cost": lot.get("unit_cost", 0),
                            "expiry_date": lot.get("expiry_date")})
        total_cost += take * D(lot.get("unit_cost", 0))
        need -= take
    weighted = m(total_cost / D(qty)) if D(qty) > 0 else 0
    return allocations, weighted, m(need)


async def consume_lots(allocations, principal=None):
    for a in allocations:
        await db.inventory_lots.update_one(
            {"id": a["lot_id"]}, {"$inc": {"quantity": -float(a["qty"])}})
