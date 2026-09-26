"""Tests accepting or rejecting supplier-delivered PO substitutions."""
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
async def substitution_db(monkeypatch):
    client = AsyncMongoMockClient()
    database = client["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(routes_purchasing, "db", database)
    monkeypatch.setattr(inventory_lib, "db", database)
    await database.settings.insert_one({"org_id": core.ORG_ID, "purchasing": {"cost_variance_threshold_pct": 5}})
    await database.products.insert_many([
        {"id": "generic", "org_id": core.ORG_ID, "name": "Paracetamol 500 mg (Generic)",
         "average_cost": 2, "latest_cost": 2, "track_inventory": True,
         "track_lots": False, "track_expiry": False},
        {"id": "brand", "org_id": core.ORG_ID, "name": "Paracetamol 500 mg (Brand)",
         "average_cost": 4, "latest_cost": 4, "track_inventory": True,
         "track_lots": False, "track_expiry": False},
    ])
    await database.inventory_levels.insert_one({
        "id": "brand-level", "org_id": core.ORG_ID, "store_id": "store_main",
        "product_id": "brand", "quantity": 5,
    })
    await database.purchase_orders.insert_one({
        "id": "po-sub", "number": "PO-SUB-1", "org_id": core.ORG_ID,
        "supplier_id": "supplier1", "store_id": "store_main", "status": "SENT",
        "items": [{"product_id": "generic", "name": "Paracetamol 500 mg (Generic)",
                   "qty_ordered": 10, "qty_received": 0, "qty_cancelled": 0,
                   "ordered_unit_cost": 2, "unit_cost": 2}],
    })
    return database


@pytest.mark.asyncio
async def test_accepting_substitute_fulfills_po_and_adds_stock_to_delivered_item(substitution_db):
    result = await routes_purchasing.receive_po(
        "po-sub",
        routes_purchasing.POReceiveIn(lines=[routes_purchasing.POReceiveLine(
            product_id="generic", qty=3, substitution_decision="ACCEPT",
            received_product_id="brand", actual_unit_cost=4,
            variance_reason="Approved supplier adjustment",
        )]),
        principal=MANAGER,
    )

    assert result["items"][0]["qty_received"] == 3
    assert result["items"][0]["qty_outstanding"] == 7
    brand_level = await substitution_db.inventory_levels.find_one({"product_id": "brand"})
    assert brand_level["quantity"] == 8
    brand = await substitution_db.products.find_one({"id": "brand"}, {"_id": 0})
    assert brand["average_cost"] == 4
    assert brand["latest_cost"] == 4
    generic_level = await substitution_db.inventory_levels.find_one({"product_id": "generic"})
    assert generic_level is None
    receipt = await substitution_db.po_receipts.find_one({"po_id": "po-sub"}, {"_id": 0})
    assert receipt["product_id"] == "brand"
    assert receipt["ordered_product_id"] == "generic"
    assert receipt["substitution_status"] == "ACCEPTED"


@pytest.mark.asyncio
async def test_rejecting_substitute_records_rejection_without_receiving_stock(substitution_db):
    result = await routes_purchasing.receive_po(
        "po-sub",
        routes_purchasing.POReceiveIn(lines=[routes_purchasing.POReceiveLine(
            product_id="generic", qty=3, substitution_decision="REJECT",
            substitute_description="Different brand supplied",
        )]),
        principal=MANAGER,
    )

    assert result["items"][0]["qty_received"] == 0
    assert result["items"][0]["qty_outstanding"] == 10
    assert result["status"] == "SENT"
    assert await substitution_db.inventory_movements.count_documents({}) == 0
    rejection = await substitution_db.po_receipts.find_one({"po_id": "po-sub"}, {"_id": 0})
    assert rejection["substitution_status"] == "REJECTED"
    assert rejection["qty_rejected"] == 3
    assert rejection["substitute_description"] == "Different brand supplied"


@pytest.mark.asyncio
async def test_only_active_stock_tracked_regular_items_can_be_accepted_as_substitutes(substitution_db):
    await substitution_db.products.insert_one({
        "id": "promo", "org_id": core.ORG_ID, "name": "Promo",
        "product_type": "PROMO", "track_inventory": False,
    })
    with pytest.raises(routes_purchasing.HTTPException, match="does not track stock"):
        await routes_purchasing.receive_po(
            "po-sub",
            routes_purchasing.POReceiveIn(lines=[routes_purchasing.POReceiveLine(
                product_id="generic", qty=1, substitution_decision="ACCEPT",
                received_product_id="promo", actual_unit_cost=2,
            )]),
            principal=MANAGER,
        )
