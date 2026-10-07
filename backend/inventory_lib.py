from fastapi import HTTPException
from core import db, ORG_ID, uid, now_iso, m, D, audit
from datetime import datetime, timezone


def _normalize_barcode(value):
    return " ".join(str(value or "").strip().split()).casefold()


async def set_missing_barcodes(assignments, principal=None):
    """Assign barcodes only to products that do not already have one.

    Validate the whole batch before updating any product so one duplicate cannot
    leave a partially updated catalog.
    """
    products = await db.products.find(
        {"org_id": ORG_ID}, {"_id": 0, "id": 1, "name": 1, "barcode": 1}
    ).to_list(20000)
    by_id = {product["id"]: product for product in products}
    used = {
        _normalize_barcode(product.get("barcode")): product
        for product in products if _normalize_barcode(product.get("barcode"))
    }
    pending = {}
    pending_owner = {}

    for product_id, raw_barcode in assignments:
        barcode = str(raw_barcode or "").strip()
        normalized = _normalize_barcode(barcode)
        if not normalized:
            continue
        product = by_id.get(product_id)
        if not product:
            raise HTTPException(status_code=404, detail="A product selected for receiving was not found")
        current = str(product.get("barcode") or "").strip()
        if current:
            if _normalize_barcode(current) != normalized:
                raise HTTPException(status_code=409, detail=f"{product.get('name', 'Product')} already has a barcode")
            continue
        duplicate = used.get(normalized)
        if duplicate and duplicate.get("id") != product_id:
            raise HTTPException(status_code=409, detail=f"Barcode already belongs to {duplicate.get('name', 'another product')}")
        other_pending = pending_owner.get(normalized)
        if other_pending and other_pending != product_id:
            raise HTTPException(status_code=409, detail="The same barcode cannot be assigned to multiple products in one receipt")
        pending[product_id] = barcode
        pending_owner[normalized] = product_id

    for product_id, barcode in pending.items():
        product = by_id[product_id]
        query = {"id": product_id, "org_id": ORG_ID}
        if "barcode" in product:
            query["barcode"] = product["barcode"]
        else:
            query["barcode"] = {"$exists": False}
        result = await db.products.update_one(
            query,
            {"$set": {"barcode": barcode, "updated_at": now_iso()}},
        )
        if result.matched_count != 1:
            raise HTTPException(status_code=409, detail="Product barcode changed during receipt; refresh and try again")
        await audit(principal, "item.barcode_added", "product", product_id,
                    after={"barcode": barcode})


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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
