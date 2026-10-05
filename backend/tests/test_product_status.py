"""Product visibility changes must preserve inventory and transaction records."""
import os
import sys
from pathlib import Path
import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")
os.environ.setdefault("JWT_SECRET", "test")
import core
import routes_catalog as catalog


@pytest.fixture
def database(monkeypatch):
    db = AsyncMongoMockClient()["test"]
    monkeypatch.setattr(core, "db", db)
    monkeypatch.setattr(catalog, "db", db)
    return db


@pytest.mark.asyncio
async def test_deactivate_and_reactivate_preserves_product_stock_and_sales(database):
    product = {"id": "p", "org_id": core.ORG_ID, "name": "Item", "sku": "SKU10000",
               "active": True, "price": 70, "average_cost": 49}
    await database.products.insert_one(product.copy())
    stock = {"product_id": "p", "quantity": 8}
    sale = {"items": [{"product_id": "p", "qty": 2}]}
    await database.inventory_levels.insert_one(stock.copy())
    await database.sales.insert_one(sale.copy())
    result = await catalog.set_product_status("p", catalog.ProductStatusIn(active=False), {})
    assert result["active"] is False and result["price"] == 70 and result["average_cost"] == 49
    assert await catalog.list_products({}, active=True, limit=100) == []
    assert (await database.inventory_levels.find_one({}, {"_id": 0})) == stock
    assert (await database.sales.find_one({}, {"_id": 0})) == sale
    result = await catalog.set_product_status("p", catalog.ProductStatusIn(active=True), {})
    assert result["active"] is True
    assert len(await catalog.list_products({}, active=True, limit=100)) == 1
    assert await database.audit_logs.count_documents({"event": "item.status_changed"}) == 2


@pytest.mark.asyncio
async def test_reactivate_duplicate_is_blocked(database):
    await database.products.insert_many([
        {"id": "p", "org_id": core.ORG_ID, "name": "Item", "sku": "SKU10000", "active": False},
        {"id": "other", "org_id": core.ORG_ID, "name": "Item", "sku": "SKU10000", "active": True},
    ])
    with pytest.raises(HTTPException) as error:
        await catalog.set_product_status("p", catalog.ProductStatusIn(active=True), {})
    assert error.value.status_code == 409
    assert (await database.products.find_one({"id": "p"}))["active"] is False


@pytest.mark.asyncio
async def test_status_change_cannot_access_another_organization(database):
    await database.products.insert_one({"id": "p", "org_id": "other", "active": True})
    with pytest.raises(HTTPException) as error:
        await catalog.set_product_status("p", catalog.ProductStatusIn(active=False), {})
    assert error.value.status_code == 404
    assert (await database.products.find_one({"id": "p"}))["active"] is True
