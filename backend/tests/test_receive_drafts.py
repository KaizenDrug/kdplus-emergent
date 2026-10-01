"""Receiving drafts must not post stock until explicitly received."""
import os
import sys
from pathlib import Path
import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")
os.environ.setdefault("JWT_SECRET", "test-secret")
import core
import inventory_lib
import routes_inventory as routes

@pytest.mark.asyncio
async def test_draft_resume_update_and_receive(monkeypatch):
    db = AsyncMongoMockClient()["test"]
    for module in (core, inventory_lib, routes):
        monkeypatch.setattr(module, "db", db)
    principal = {"id": "tester", "name": "Tester", "kind": "employee", "role": "owner"}
    body = routes.ReceiveDraftIn(store_id="store_main", supplier_id="supplier1", lines=[
        routes.ReceiveDraftLine(product_id="p1", quantity="", unit_cost="12", lot_number="B1", expiry_date="2028-12-31")])
    await routes.save_receive_draft("draft1", body, principal)
    drafts = await routes.receive_drafts("store_main", principal)
    assert drafts[0]["lines"][0]["quantity"] == ""
    assert await db.inventory_levels.count_documents({}) == 0
    assert await db.inventory_movements.count_documents({}) == 0
    assert await routes.receive_drafts("other_store", principal) == []
    body.lines[0].quantity = "5"
    await routes.save_receive_draft("draft1", body, principal)
    assert await db.receive_drafts.count_documents({}) == 1
    await db.products.insert_one({"id": "p1", "org_id": core.ORG_ID, "name": "Item", "average_cost": 10})
    await routes.receive_stock(routes.ReceiveIn(store_id="store_main", supplier_id="supplier1", draft_id="draft1", lines=[
        routes.ReceiveLine(product_id="p1", quantity=5, unit_cost=12)]), principal)
    assert await inventory_lib.get_level("store_main", "p1") == 5
    assert await routes.receive_drafts("store_main", principal) == []
