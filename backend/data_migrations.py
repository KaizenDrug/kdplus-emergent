"""Small, idempotent production-data corrections for KDPLUS."""

from pymongo import ReturnDocument

from core import db, ORG_ID, D, m, now_iso


GASAIDE_RECEIPT_FIX = "fix-po-20260917-00001-gasaide-received-200-v1"


def _po_status(items):
    fully_received = all(D(item.get("qty_received")) >= D(item.get("qty_ordered")) for item in items)
    all_settled = all(
        D(item.get("qty_received")) + D(item.get("qty_cancelled")) >= D(item.get("qty_ordered"))
        for item in items
    )
    any_received = any(D(item.get("qty_received")) > 0 for item in items)
    if fully_received:
        return "RECEIVED"
    if all_settled:
        return "CLOSED_PARTIAL" if any_received else "CANCELLED"
    return "PARTIALLY_RECEIVED"


async def correct_gasaide_receipt():
    """Correct one mistyped receipt from 22 to 200 without double-posting stock."""
    completed = await db.data_migrations.find_one({"id": GASAIDE_RECEIPT_FIX, "status": "DONE"})
    if completed:
        return {"status": "already_applied", "delta": completed.get("delta", 0)}

    po = await db.purchase_orders.find_one({
        "org_id": ORG_ID, "number": "PO-20260917-00001",
    })
    if not po:
        return {"status": "not_applicable", "reason": "purchase order not found"}

    items = [dict(item) for item in po.get("items", [])]
    line = next((item for item in items if
                 (item.get("name") or "").strip().casefold() == "dicycloverine 10mg tab (gasaide)"), None)
    if not line:
        return {"status": "not_applicable", "reason": "purchase-order line not found"}

    target = D(200)
    current = D(line.get("qty_received"))
    if current > target:
        raise RuntimeError("Gasaide receipt is already greater than the requested correction target")
    if current == target:
        return {"status": "already_correct", "delta": 0}

    receipts = await db.po_receipts.find({
        "org_id": ORG_ID, "po_id": po["id"], "product_id": line["product_id"],
    }, {"_id": 0}).sort("received_at", -1).to_list(100)
    if not receipts:
        raise RuntimeError("Cannot correct Gasaide receipt because its original receipt record is missing")
    source_receipt = receipts[0]
    product = await db.products.find_one({
        "org_id": ORG_ID, "id": line["product_id"],
    }, {"_id": 0})
    if not product:
        raise RuntimeError("Cannot correct Gasaide receipt because its product record is missing")

    level = await db.inventory_levels.find_one({
        "org_id": ORG_ID, "store_id": po["store_id"], "product_id": line["product_id"],
    }, {"_id": 0})
    old_level = D((level or {}).get("quantity"))
    old_average = D(product.get("average_cost"))
    actual_cost = D(source_receipt.get("actual_unit_cost", line.get("ordered_unit_cost", 0)))
    delta = target - current
    new_level = old_level + delta
    corrected_average = m(
        (old_level * old_average + delta * actual_cost) / new_level
    ) if new_level > 0 else m(actual_cost)

    plan = await db.data_migrations.find_one_and_update(
        {"id": GASAIDE_RECEIPT_FIX},
        {"$setOnInsert": {
            "id": GASAIDE_RECEIPT_FIX, "org_id": ORG_ID, "status": "PLANNED",
            "po_id": po["id"], "product_id": line["product_id"],
            "store_id": po["store_id"], "before_received": m(current),
            "target_received": 200, "delta": m(delta), "actual_unit_cost": m(actual_cost),
            "old_level": m(old_level), "corrected_average": corrected_average,
            "created_at": now_iso(),
        }},
        upsert=True, return_document=ReturnDocument.AFTER,
    )
    delta = D(plan["delta"])
    correction_receipt_id = f"{GASAIDE_RECEIPT_FIX}-receipt"
    correction_movement_id = f"{GASAIDE_RECEIPT_FIX}-movement"
    correction_lot_id = source_receipt.get("lot_id")

    level_result = await db.inventory_levels.update_one(
        {"org_id": ORG_ID, "store_id": po["store_id"], "product_id": line["product_id"],
         "applied_corrections": {"$ne": GASAIDE_RECEIPT_FIX}},
        {"$inc": {"quantity": float(delta)},
         "$addToSet": {"applied_corrections": GASAIDE_RECEIPT_FIX},
         "$set": {"updated_at": now_iso()}},
        upsert=level is None,
    )
    corrected_level = await db.inventory_levels.find_one({
        "org_id": ORG_ID, "store_id": po["store_id"], "product_id": line["product_id"],
    }, {"_id": 0})

    if product.get("track_lots") or product.get("track_expiry"):
        if correction_lot_id:
            await db.inventory_lots.update_one(
                {"id": correction_lot_id, "applied_corrections": {"$ne": GASAIDE_RECEIPT_FIX}},
                {"$inc": {"quantity": float(delta)},
                 "$addToSet": {"applied_corrections": GASAIDE_RECEIPT_FIX},
                 "$set": {"status": "ACTIVE", "updated_at": now_iso()}},
            )
        else:
            correction_lot_id = f"{GASAIDE_RECEIPT_FIX}-lot"
            await db.inventory_lots.update_one(
                {"id": correction_lot_id},
                {"$setOnInsert": {
                    "id": correction_lot_id, "org_id": ORG_ID, "store_id": po["store_id"],
                    "product_id": line["product_id"], "lot_number": source_receipt.get("lot_number") or po["number"],
                    "expiry_date": source_receipt.get("expiry_date"), "quantity": m(delta),
                    "unit_cost": m(actual_cost), "supplier_id": po.get("supplier_id"),
                    "status": "ACTIVE", "source": "RECEIPT_CORRECTION",
                    "received_date": now_iso(), "created_at": now_iso(),
                }}, upsert=True,
            )

    await db.inventory_movements.update_one(
        {"id": correction_movement_id},
        {"$setOnInsert": {
            "id": correction_movement_id, "org_id": ORG_ID, "store_id": po["store_id"],
            "product_id": line["product_id"], "lot_id": correction_lot_id,
            "type": "RECEIPT_CORRECTION", "qty_before": plan["old_level"],
            "qty_change": m(delta), "qty_after": (corrected_level or {}).get("quantity", m(D(plan["old_level"]) + delta)),
            "unit_cost": m(actual_cost), "reference": po["number"], "ref_id": po["id"],
            "user_id": "system", "user_name": "System data correction",
            "note": "Corrected received quantity from 22 to 200", "created_at": now_iso(),
        }}, upsert=True,
    )

    await db.po_receipts.update_one(
        {"id": correction_receipt_id},
        {"$setOnInsert": {
            "id": correction_receipt_id, "receipt_group_id": GASAIDE_RECEIPT_FIX,
            "receipt_no": "BACKEND-CORRECTION", "org_id": ORG_ID,
            "po_id": po["id"], "po_number": po["number"],
            "po_line_id": line["product_id"], "product_id": line["product_id"],
            "product_name": line["name"], "supplier_id": po.get("supplier_id"),
            "store_id": po["store_id"], "qty_received": m(delta),
            "qty_outstanding_before": m(delta), "qty_over_received": 0,
            "ordered_unit_cost": m(line.get("ordered_unit_cost", line.get("unit_cost", 0))),
            "actual_unit_cost": m(actual_cost), "variance_amount": 0, "variance_percent": 0,
            "variance_reason": "backend correction", "variance_note": "Original receipt entered as 22 instead of 200",
            "lot_id": correction_lot_id, "lot_number": source_receipt.get("lot_number") or po["number"],
            "expiry_date": source_receipt.get("expiry_date"), "received_at": now_iso(),
            "received_by": "system", "received_by_name": "System data correction",
        }}, upsert=True,
    )

    await db.products.update_one(
        {"id": line["product_id"]},
        {"$set": {"average_cost": plan["corrected_average"], "latest_cost": m(actual_cost),
                  "updated_at": now_iso()}},
    )

    for item in items:
        if item.get("product_id") == line["product_id"]:
            item["qty_received"] = 200
            item["qty_cancelled"] = m(max(D(0), D(item.get("qty_cancelled")) - delta))
        item["qty_outstanding"] = m(max(
            D(0), D(item.get("qty_ordered")) - D(item.get("qty_received")) - D(item.get("qty_cancelled")),
        ))
        item["qty_over_received"] = m(max(D(0), D(item.get("qty_received")) - D(item.get("qty_ordered"))))
    status = _po_status(items)
    await db.purchase_orders.update_one(
        {"id": po["id"], "org_id": ORG_ID},
        {"$set": {"items": items, "status": status, "updated_at": now_iso()}},
    )

    await db.audit_logs.update_one(
        {"id": f"{GASAIDE_RECEIPT_FIX}-audit"},
        {"$setOnInsert": {
            "id": f"{GASAIDE_RECEIPT_FIX}-audit", "org_id": ORG_ID,
            "event": "po.receipt_corrected", "record_type": "purchase_order",
            "record_id": po["id"], "before": {"received": plan["before_received"]},
            "after": {"received": 200, "stock_added": m(delta), "status": status},
            "user_id": "system", "user_name": "System data correction",
            "store_id": po["store_id"], "created_at": now_iso(),
        }}, upsert=True,
    )
    await db.data_migrations.update_one(
        {"id": GASAIDE_RECEIPT_FIX},
        {"$set": {"status": "DONE", "completed_at": now_iso(),
                  "inventory_updated": level_result.modified_count > 0, "po_status": status}},
    )
    return {"status": "corrected", "delta": m(delta), "po_status": status}


async def run_data_migrations():
    return [await correct_gasaide_receipt()]
