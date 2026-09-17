"""Regression coverage for purchase-order over-delivery receiving."""
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
import inventory_lib  # noqa: E402
import routes_purchasing  # noqa: E402


MANAGER = {"id": "emp_manager", "name": "Test Manager", "kind": "employee",
           "role": "manager", "permissions": ["*"]}


@pytest_asyncio.fixture
async def purchasing_db(monkeypatch):
    client = AsyncMongoMockClient()
    database = client["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(routes_purchasing, "db", database)
    monkeypatch.setattr(inventory_lib, "db", database)
    await database.settings.insert_one({
        "org_id": core.ORG_ID,
        "purchasing": {"cost_variance_threshold_pct": 5},
    })
    await database.products.insert_one({
        "id": "p1", "org_id": core.ORG_ID, "name": "Test Product",
        "average_cost": 10, "latest_cost": 10, "track_lots": False,
        "track_expiry": False,
    })
    await database.inventory_levels.insert_one({
        "id": "level1", "org_id": core.ORG_ID, "store_id": "store_main",
        "product_id": "p1", "quantity": 5,
    })
    await database.purchase_orders.insert_one({
        "id": "po1", "number": "PO-0001", "org_id": core.ORG_ID,
        "supplier_id": "supplier1", "store_id": "store_main", "status": "SENT",
        "items": [{
            "product_id": "p1", "name": "Test Product", "qty_ordered": 10,
            "qty_received": 0, "qty_cancelled": 0, "ordered_unit_cost": 10,
            "unit_cost": 10,
        }],
    })
    return database


@pytest.mark.asyncio
async def test_receive_more_than_original_po_quantity(purchasing_db):
    result = await routes_purchasing.receive_po(
        "po1",
        routes_purchasing.POReceiveIn(lines=[
            routes_purchasing.POReceiveLine(product_id="p1", qty=12, actual_unit_cost=10),
        ]),
        principal=MANAGER,
    )

    assert result["status"] == "RECEIVED"
    assert result["items"][0]["qty_received"] == 12
    assert result["items"][0]["qty_outstanding"] == 0
    assert result["items"][0]["qty_over_received"] == 2

    level = await purchasing_db.inventory_levels.find_one({"product_id": "p1"})
    receipt = await purchasing_db.po_receipts.find_one({"po_id": "po1"})
    movement = await purchasing_db.inventory_movements.find_one({"ref_id": "po1"})
    assert level["quantity"] == 17
    assert receipt["qty_received"] == 12
    assert receipt["qty_outstanding_before"] == 10
    assert receipt["qty_over_received"] == 2
    assert movement["qty_change"] == 12
