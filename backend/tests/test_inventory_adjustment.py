"""Regression tests for manual inventory adjustments."""
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
import routes_inventory  # noqa: E402


MANAGER = {"id": "manager", "name": "Manager", "permissions": ["*"]}


@pytest_asyncio.fixture
async def inventory_db(monkeypatch):
    database = AsyncMongoMockClient()["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(inventory_lib, "db", database)
    monkeypatch.setattr(routes_inventory, "db", database)
    await database.products.insert_one({
        "id": "p1", "org_id": core.ORG_ID, "name": "Test Product", "sku": "TEST-1",
        "active": True, "average_cost": 5, "reorder_level": 2, "uom": "piece",
    })
    await database.inventory_levels.insert_one({
        "id": "level-1", "org_id": core.ORG_ID, "store_id": "store_main",
        "product_id": "p1", "quantity": 10,
    })
    return database


@pytest.mark.asyncio
async def test_adjustment_changes_stock_on_hand_and_returns_before_after(inventory_db):
    result = await routes_inventory.adjust_stock(
        routes_inventory.AdjustIn(
            store_id="store_main", reason="correction", notes="Physical count",
            lines=[routes_inventory.AdjustLine(product_id="p1", new_quantity=7)],
        ),
        principal=MANAGER,
    )

    assert result["adjusted"] == 1
    assert result["lines"][0]["quantity_before"] == 10
    assert result["lines"][0]["quantity_change"] == -3
    assert result["lines"][0]["quantity_after"] == 7

    levels = await routes_inventory.inventory_levels(store_id="store_main", principal=MANAGER)
    assert levels[0]["quantity"] == 7

    movement = await inventory_db.inventory_movements.find_one({"product_id": "p1"}, {"_id": 0})
    assert movement["qty_before"] == 10
    assert movement["qty_after"] == 7


@pytest.mark.asyncio
async def test_adjustment_rejects_unknown_product(inventory_db):
    with pytest.raises(routes_inventory.HTTPException) as exc:
        await routes_inventory.adjust_stock(
            routes_inventory.AdjustIn(
                store_id="store_main", reason="correction",
                lines=[routes_inventory.AdjustLine(product_id="missing", quantity=1)],
            ),
            principal=MANAGER,
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_adjustment_to_zero_clears_hidden_lot_balances(inventory_db):
    await inventory_db.inventory_lots.insert_many([
        {"id": "lot-1", "org_id": core.ORG_ID, "store_id": "store_main",
         "product_id": "p1", "quantity": 6, "status": "ACTIVE"},
        {"id": "lot-2", "org_id": core.ORG_ID, "store_id": "store_main",
         "product_id": "p1", "quantity": 4, "status": "ACTIVE"},
    ])

    await routes_inventory.adjust_stock(
        routes_inventory.AdjustIn(
            store_id="store_main", reason="correction",
            lines=[routes_inventory.AdjustLine(product_id="p1", new_quantity=0)],
        ),
        principal=MANAGER,
    )

    lots = await inventory_db.inventory_lots.find({"product_id": "p1"}, {"_id": 0}).to_list(10)
    assert all(lot["quantity"] == 0 for lot in lots)
    assert all(lot["status"] == "DEPLETED" for lot in lots)


@pytest.mark.asyncio
async def test_product_level_decrease_reconciles_lots_fefo(inventory_db):
    await inventory_db.products.update_one(
        {"id": "p1"}, {"$set": {"track_lots": True, "track_expiry": True}},
    )
    await inventory_db.inventory_lots.insert_many([
        {"id": "later", "org_id": core.ORG_ID, "store_id": "store_main",
         "product_id": "p1", "quantity": 6, "status": "ACTIVE", "expiry_date": "2028-01-01"},
        {"id": "sooner", "org_id": core.ORG_ID, "store_id": "store_main",
         "product_id": "p1", "quantity": 4, "status": "ACTIVE", "expiry_date": "2027-01-01"},
    ])

    await routes_inventory.adjust_stock(
        routes_inventory.AdjustIn(
            store_id="store_main", reason="correction",
            lines=[routes_inventory.AdjustLine(product_id="p1", new_quantity=7)],
        ),
        principal=MANAGER,
    )

    sooner = await inventory_db.inventory_lots.find_one({"id": "sooner"})
    later = await inventory_db.inventory_lots.find_one({"id": "later"})
    assert sooner["quantity"] == 1
    assert later["quantity"] == 6


@pytest.mark.asyncio
async def test_product_level_increase_creates_adjustment_lot(inventory_db):
    await inventory_db.products.update_one(
        {"id": "p1"}, {"$set": {"track_lots": True, "track_expiry": True}},
    )

    await routes_inventory.adjust_stock(
        routes_inventory.AdjustIn(
            store_id="store_main", reason="correction",
            lines=[routes_inventory.AdjustLine(product_id="p1", new_quantity=14)],
        ),
        principal=MANAGER,
    )

    lot = await inventory_db.inventory_lots.find_one({"product_id": "p1", "source": "STOCK_ADJUSTMENT"})
    assert lot["quantity"] == 4
    assert lot["expiry_date"] is None
    assert lot["status"] == "ACTIVE"
