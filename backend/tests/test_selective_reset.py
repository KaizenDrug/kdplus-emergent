"""Regression tests for admin-selectable data reset groups."""
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
import seed  # noqa: E402


@pytest_asyncio.fixture
async def reset_db(monkeypatch):
    database = AsyncMongoMockClient()["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(seed, "db", database)
    for collection in ("products", "categories", "inventory_levels", "sales", "settings", "users", "stores"):
        await database[collection].insert_one({"id": collection, "org_id": core.ORG_ID})
    return database


@pytest.mark.asyncio
async def test_selective_reset_only_deletes_chosen_groups(reset_db):
    deleted = await seed.reset_selected_data(["catalog"])

    assert deleted == {"products": 1, "categories": 1, "inventory_levels": 1}
    assert await reset_db.products.count_documents({}) == 0
    assert await reset_db.categories.count_documents({}) == 0
    assert await reset_db.inventory_levels.count_documents({}) == 0
    assert await reset_db.sales.count_documents({}) == 1
    assert await reset_db.settings.count_documents({}) == 1
    assert await reset_db.users.count_documents({}) == 1
    assert await reset_db.stores.count_documents({}) == 1


@pytest.mark.asyncio
async def test_selective_reset_rejects_unknown_category(reset_db):
    with pytest.raises(ValueError, match="Invalid reset categories"):
        await seed.reset_selected_data(["not-a-real-group"])
