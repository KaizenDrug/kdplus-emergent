from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core import ORG_ID, db, get_current_principal, m, now_iso, uid

router = APIRouter()


def require_receipt_admin(principal=Depends(get_current_principal)):
    if principal.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only Owner/Admin can correct receipt costs")
    return principal


def manual_receipt_query():
    return {
        "org_id": ORG_ID,
        "type": "PURCHASE_RECEIPT",
        "qty_change": {"$gt": 0},
        "$or": [{"ref_id": None}, {"receipt_number": {"$exists": True}}],
    }


@router.get("/inventory/receiving-history/manual")
async def manual_receipt_history(
    store_id: str, product_id: str, before: str | None = None,
    principal=Depends(require_receipt_admin),
):
    query = {**manual_receipt_query(), "store_id": store_id, "product_id": product_id}
    if before:
        query["id"] = before
        cursor = await db.inventory_movements.find_one(query, {"created_at": 1, "id": 1})
        if cursor is None:
            raise HTTPException(status_code=404, detail="Receipt history page not found")
        del query["id"]
        query["$and"] = [{"$or": [
            {"created_at": {"$lt": cursor["created_at"]}},
            {"created_at": cursor["created_at"], "id": {"$lt": before}},
        ]}]
    rows = await db.inventory_movements.find(query, {"_id": 0}).sort(
        [("created_at", -1), ("id", -1)]
    ).to_list(51)
    page = rows[:50]
    lot_ids = [row["lot_id"] for row in page if row.get("lot_id")]
    lots = await db.inventory_lots.find(
        {"org_id": ORG_ID, "id": {"$in": lot_ids}},
        {"_id": 0, "id": 1, "lot_number": 1},
    ).to_list(50)
    lot_numbers = {lot["id"]: lot.get("lot_number") for lot in lots}
    for row in page:
        row["lot_number"] = lot_numbers.get(row.get("lot_id"))
    return {"rows": page, "next_cursor": page[-1]["id"] if len(rows) > 50 else None}


class ReceiptCostCorrection(BaseModel):
    unit_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    invoice_reference: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=500)
    expected_revision: int = Field(ge=0)

    @field_validator("invoice_reference", "reason", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


@router.post("/inventory/receiving-history/{source}/{receipt_id}/cost-corrections", status_code=201)
async def correct_receipt_cost(
    source: Literal["manual", "po"], receipt_id: str, body: ReceiptCostCorrection,
    principal=Depends(require_receipt_admin),
):
    if source == "manual":
        collection = db.inventory_movements
        query = manual_receipt_query()
        cost_field, date_field = "unit_cost", "created_at"
    else:
        collection = db.po_receipts
        query = {"org_id": ORG_ID, "qty_received": {"$gt": 0}, "substitution_status": {"$ne": "REJECTED"}}
        cost_field, date_field = "actual_unit_cost", "received_at"
    query["id"] = receipt_id
    receipt = await collection.find_one(query, {"_id": 0})
    if not receipt:
        raise HTTPException(status_code=404, detail="Posted receipt line not found")
    history = receipt.get("cost_corrections", [])
    if len(history) != body.expected_revision:
        raise HTTPException(status_code=409, detail="Receipt cost changed. Reload the history before correcting it.")

    original_cost = m(receipt.get(cost_field))
    previous_cost = history[-1]["corrected_unit_cost"] if history else original_cost
    corrected_cost = m(body.unit_cost)
    if corrected_cost == previous_cost:
        raise HTTPException(status_code=400, detail="Enter a cost different from the current receipt cost.")

    # Unallocated movements on the same product may belong to this receipt.
    usage_query = {
        "org_id": ORG_ID, "store_id": receipt["store_id"], "product_id": receipt["product_id"],
        "type": {"$in": ["SALE", "REFUND", "VOID"]},
        "created_at": {"$gte": receipt[date_field]}, "lot_id": {"$in": [receipt.get("lot_id"), None]},
    }
    affected = await db.inventory_movements.find(
        usage_query, {"_id": 0, "reference": 1, "lot_id": 1, "type": 1},
    ).sort("created_at", -1).to_list(11)
    references = list(dict.fromkeys(
        movement["reference"] for movement in affected
        if receipt.get("lot_id") and movement.get("lot_id") == receipt["lot_id"] and movement.get("reference")
    ))[:10]
    correction = {
        "id": uid(), "created_at": now_iso(), "user_id": principal.get("id"),
        "user_name": principal.get("name"), "original_unit_cost": original_cost,
        "previous_unit_cost": previous_cost, "corrected_unit_cost": corrected_cost,
        "invoice_reference": body.invoice_reference, "reason": body.reason,
        "sales_cost_review_needed": bool(affected),
        "linked_transaction_references": references,
    }
    # The correction and audit metadata are saved in one conditional write.
    result = await collection.update_one(
        {**query, f"cost_corrections.{body.expected_revision}": {"$exists": False}},
        {"$push": {"cost_corrections": correction}},
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="Receipt cost changed. Reload the history before correcting it.")
    return correction
