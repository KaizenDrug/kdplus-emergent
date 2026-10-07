"""Barcode assignment while receiving goods or PO lines."""
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import core  # noqa: E402
import inventory_lib  # noqa: E402
import routes_inventory  # noqa: E402
import routes_purchasing  # noqa: E402


MANAGER = {"id": "manager", "name": "Test Manager", "role": "manager", "permissions": ["*"]}


@pytest_asyncio.fixture
async def receiving_db(monkeypatch):
    database = AsyncMongoMockClient()["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(inventory_lib, "db", database)
    monkeypatch.setattr(routes_inventory, "db", database)
    monkeypatch.setattr(routes_purchasing, "db", database)
    await database.products.insert_many([
        {"id": "p1", "org_id": core.ORG_ID, "name": "Product without barcode",
         "average_cost": 4, "latest_cost": 4, "track_inventory": True,
         "track_lots": False, "track_expiry": False},
        {"id": "p2", "org_id": core.ORG_ID, "name": "Product with existing barcode",
         "barcode": "4800000000002", "average_cost": 5, "latest_cost": 5,
         "track_inventory": True, "track_lots": False, "track_expiry": False},
    ])
    await database.purchase_orders.insert_one({
        "id": "po1", "number": "PO-0001", "org_id": core.ORG_ID,
        "supplier_id": "supplier1", "store_id": "store_main", "status": "SENT",
        "items": [{"product_id": "p1", "name": "Product without barcode", "qty_ordered": 5,
                   "qty_received": 0, "qty_cancelled": 0, "ordered_unit_cost": 4, "unit_cost": 4}],
    })
    return database


@pytest.mark.asyncio
async def test_goods_receiving_saves_barcode_on_catalog_product(receiving_db):
    await routes_inventory.receive_stock(
        routes_inventory.ReceiveIn(store_id="store_main", supplier_id="supplier1", lines=[
            routes_inventory.ReceiveLine(product_id="p1", barcode="4800000000001", quantity=3, unit_cost=4),
        ]),
        principal=MANAGER,
    )

    product = await receiving_db.products.find_one({"id": "p1"}, {"_id": 0})
    level = await receiving_db.inventory_levels.find_one({"product_id": "p1"}, {"_id": 0})
    assert product["barcode"] == "4800000000001"
    assert level["quantity"] == 3


@pytest.mark.asyncio
async def test_po_receiving_saves_barcode_on_catalog_product(receiving_db):
    await routes_purchasing.receive_po(
        "po1",
        routes_purchasing.POReceiveIn(lines=[
            routes_purchasing.POReceiveLine(product_id="p1", barcode="4800000000001", qty=2, actual_unit_cost=4),
        ]),
        principal=MANAGER,
    )

    product = await receiving_db.products.find_one({"id": "p1"}, {"_id": 0})
    level = await receiving_db.inventory_levels.find_one({"product_id": "p1"}, {"_id": 0})
    assert product["barcode"] == "4800000000001"
    assert level["quantity"] == 2


@pytest.mark.asyncio
async def test_duplicate_barcode_rejects_receipt_before_stock_changes(receiving_db):
    with pytest.raises(HTTPException) as exc:
        await routes_inventory.receive_stock(
            routes_inventory.ReceiveIn(store_id="store_main", supplier_id="supplier1", lines=[
                routes_inventory.ReceiveLine(product_id="p1", barcode="4800000000002", quantity=3, unit_cost=4),
            ]),
            principal=MANAGER,
        )

    assert exc.value.status_code == 409
    product = await receiving_db.products.find_one({"id": "p1"}, {"_id": 0})
    assert not product.get("barcode")
    assert await receiving_db.inventory_movements.count_documents({}) == 0
