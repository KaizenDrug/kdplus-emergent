"""Regression coverage for targeted, idempotent production data corrections."""
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import core  # noqa: E402
import data_migrations  # noqa: E402


@pytest_asyncio.fixture
async def migration_db(monkeypatch):
    database = AsyncMongoMockClient()["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(data_migrations, "db", database)
    await database.products.insert_one({
        "id": "gasaide", "org_id": core.ORG_ID, "name": "DICYCLOVERINE 10MG TAB (GASAIDE)",
        "average_cost": 0.30, "latest_cost": 0.30, "track_lots": True, "track_expiry": True,
    })
    await database.inventory_levels.insert_one({
        "id": "level-gasaide", "org_id": core.ORG_ID, "store_id": "store_main",
        "product_id": "gasaide", "quantity": 22,
    })
    await database.inventory_lots.insert_one({
        "id": "lot-gasaide", "org_id": core.ORG_ID, "store_id": "store_main",
        "product_id": "gasaide", "lot_number": "GAS-LOT", "expiry_date": "2028-01-01",
        "quantity": 22, "unit_cost": 0.30, "status": "ACTIVE",
    })
    await database.purchase_orders.insert_one({
        "id": "po-gasaide", "number": "PO-20260917-00001", "org_id": core.ORG_ID,
        "supplier_id": "ntpk", "store_id": "store_main", "status": "CLOSED_PARTIAL",
        "items": [
            {"product_id": "gasaide", "name": "DICYCLOVERINE 10MG TAB (GASAIDE)",
             "qty_ordered": 200, "qty_received": 22, "qty_cancelled": 178,
             "ordered_unit_cost": 0.30, "unit_cost": 0.30},
            {"product_id": "other", "name": "Other cancelled product", "qty_ordered": 5,
             "qty_received": 0, "qty_cancelled": 5, "ordered_unit_cost": 1, "unit_cost": 1},
        ],
    })
    await database.po_receipts.insert_one({
        "id": "receipt-original", "org_id": core.ORG_ID, "po_id": "po-gasaide",
        "po_number": "PO-20260917-00001", "product_id": "gasaide",
        "qty_received": 22, "actual_unit_cost": 0.30, "ordered_unit_cost": 0.30,
        "lot_id": "lot-gasaide", "lot_number": "GAS-LOT", "expiry_date": "2028-01-01",
        "received_at": "2026-09-17T00:00:00+00:00",
    })
    return database


@pytest.mark.asyncio
async def test_gasaide_receipt_correction_is_complete_and_idempotent(migration_db):
    result = await data_migrations.correct_gasaide_receipt()

    assert result == {"status": "corrected", "delta": 178.0, "po_status": "CLOSED_PARTIAL"}
    po = await migration_db.purchase_orders.find_one({"id": "po-gasaide"})
    gasaide = next(item for item in po["items"] if item["product_id"] == "gasaide")
    assert gasaide["qty_received"] == 200
    assert gasaide["qty_cancelled"] == 0
    assert gasaide["qty_outstanding"] == 0
    assert po["status"] == "CLOSED_PARTIAL"

    level = await migration_db.inventory_levels.find_one({"product_id": "gasaide"})
    lot = await migration_db.inventory_lots.find_one({"id": "lot-gasaide"})
    assert level["quantity"] == 200
    assert lot["quantity"] == 200
    assert await migration_db.po_receipts.count_documents({"po_id": "po-gasaide"}) == 2
    correction = await migration_db.po_receipts.find_one({"receipt_no": "BACKEND-CORRECTION"})
    assert correction["qty_received"] == 178

    second = await data_migrations.correct_gasaide_receipt()
    assert second == {"status": "already_applied", "delta": 178.0}
    level = await migration_db.inventory_levels.find_one({"product_id": "gasaide"})
    lot = await migration_db.inventory_lots.find_one({"id": "lot-gasaide"})
    assert level["quantity"] == 200
    assert lot["quantity"] == 200
    assert await migration_db.inventory_movements.count_documents({"product_id": "gasaide"}) == 1
