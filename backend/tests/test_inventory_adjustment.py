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
