"""Posted receipt cost corrections preserve stock and original transaction records."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import FastAPI, Header
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import core
import inventory_lib
import receipt_costs
import routes_inventory
import routes_purchasing

ORG = {"org_id": core.ORG_ID}
ADMIN = {"role": "admin", "id": "admin", "name": "Admin Tester"}
BASE = {**ORG, "store_id": "store_main", "product_id": "bear", "lot_id": "lot1"}
REQUEST = {"unit_cost": "104.76", "invoice_reference": " INV-123 ", "reason": " Typo at receiving ", "expected_revision": 0}
HISTORY_URL = "/api/inventory/receiving-history"


@pytest_asyncio.fixture
async def receipts(monkeypatch):
    database = AsyncMongoMockClient()["test"]
    for module in (core, inventory_lib, receipt_costs, routes_inventory, routes_purchasing):
        monkeypatch.setattr(module, "db", database)
    await database.products.insert_one({**ORG, "id": "bear", "name": "Bear Brand", "average_cost": 104.76})
    await database.inventory_levels.insert_one({**BASE, "quantity": 2})
    await database.inventory_lots.insert_one({**BASE, "id": "lot1", "lot_number": "GRN-20261019-00001",
                                              "quantity": 2, "unit_cost": 211.62})
    await database.inventory_movements.insert_many([
        {**BASE, "id": "legacy", "type": "PURCHASE_RECEIPT", "reference": "Manual GRN",
         "qty_change": 2, "unit_cost": 211.62, "created_at": "2026-10-19"},
        {**BASE, "id": "po_move", "type": "PURCHASE_RECEIPT", "ref_id": "po1",
         "qty_change": 2, "unit_cost": 211.62, "created_at": "2026-10-20"},
        {**BASE, "id": "sale", "type": "SALE", "qty_change": -1, "unit_cost": 211.62, "reference": "SALE-001", "created_at": "2026-11-20"},
        {**BASE, "id": "refund", "type": "REFUND", "qty_change": 1, "unit_cost": 211.62, "reference": "RFND-001", "created_at": "2026-11-20"},
    ])
    await database.po_receipts.insert_many([
        {**BASE, "id": "po_receipt", "po_id": "po1", "qty_received": 2,
         "actual_unit_cost": 211.62, "received_at": "2026-10-20"},
        {**BASE, "id": "rejected", "po_id": "po1", "qty_rejected": 2, "substitution_status": "REJECTED",
         "received_at": "2026-10-20"},
    ])
    app = FastAPI()
    app.include_router(routes_inventory.router)
    app.include_router(routes_purchasing.router)

    def principal(x_test_role: str = Header("admin")):
        return {**ADMIN, "role": x_test_role}

    app.dependency_overrides[core.get_current_principal] = principal
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield database, client


@pytest.mark.asyncio
async def test_existing_manual_receipt_keeps_original_cost_and_flags_related_sales(receipts):
    db, client = receipts
    params = {"store_id": "store_main", "product_id": "bear"}
    page = (await client.get(f"{HISTORY_URL}/manual", params=params)).json()
    assert [r["id"] for r in page["rows"]] == ["legacy"]
    assert page["rows"][0]["lot_number"] == "GRN-20261019-00001"
    saved = await client.post(f"{HISTORY_URL}/manual/legacy/cost-corrections", json=REQUEST)
    assert saved.status_code == 201
    change = saved.json()
    assert (change["original_unit_cost"], change["corrected_unit_cost"]) == (211.62, 104.76)
    assert (change["invoice_reference"], change["reason"], change["user_name"]) == ("INV-123", "Typo at receiving", "Admin Tester")
    assert change["sales_cost_review_needed"]
    assert set(change["linked_transaction_references"]) == {"SALE-001", "RFND-001"}
    page = (await client.get(f"{HISTORY_URL}/manual", params=params)).json()
    assert page["rows"][0]["cost_corrections"] == [change]
    assert page["rows"][0]["unit_cost"] == 211.62
    assert (await db.inventory_levels.find_one(BASE))["quantity"] == 2
    assert (await db.inventory_lots.find_one({"id": "lot1"}))["unit_cost"] == 211.62
    assert (await db.products.find_one({"id": "bear"}))["average_cost"] == 104.76
    assert (await db.inventory_movements.find_one({"id": "sale"}))["unit_cost"] == 211.62
    assert await db.inventory_movements.count_documents({}) == 4


@pytest.mark.asyncio
async def test_po_correction_requires_admin_and_stale_writes_do_not_duplicate_history(receipts):
    db, client = receipts
    path = f"{HISTORY_URL}/po/po_receipt/cost-corrections"
    cashier = {"x-test-role": "cashier"}
    assert (await client.post(path, json=REQUEST, headers=cashier)).status_code == 403
    assert (await client.get(f"{HISTORY_URL}/manual", params={"store_id": "store_main", "product_id": "bear"}, headers=cashier)).status_code == 403
    assert (await client.post(path, json={**REQUEST, "reason": " "})).status_code == 422
    assert (await client.post(path, json={**REQUEST, "unit_cost": "104.765"})).status_code == 422
    assert (await client.post(f"{HISTORY_URL}/po/rejected/cost-corrections", json=REQUEST)).status_code == 404
    results = await asyncio.gather(*(client.post(path, json=REQUEST) for _ in range(2)))
    assert sorted(r.status_code for r in results) == [201, 409]
    assert (await client.post(path, json={**REQUEST, "expected_revision": 1})).status_code == 400
    second = await client.post(path, json={**REQUEST, "expected_revision": 1, "unit_cost": "105"})
    assert second.status_code == 201
    assert second.json()["previous_unit_cost"] == 104.76
    row = (await client.get("/api/purchase-orders/po1/receipts", headers=cashier)).json()[0]
    assert row["actual_unit_cost"] == 211.62 and row["corrected_unit_cost"] == 105
    assert "cost_corrections" not in row
    assert (await db.po_receipts.find_one({"id": "po_receipt"}))["actual_unit_cost"] == 211.62


@pytest.mark.asyncio
async def test_manual_history_pages_by_receipt_and_keeps_manual_grn_number(receipts):
    db, client = receipts
    await routes_inventory.receive_stock(routes_inventory.ReceiveIn(
        store_id="store_main", reference="Invoice A",
        lines=[routes_inventory.ReceiveLine(product_id="bear", quantity=1, unit_cost=100)],
    ), principal=ADMIN)
    new_receipt = await db.inventory_movements.find_one({"reference": "Invoice A"})
    assert new_receipt["receipt_number"].startswith("GRN-")
    await db.inventory_movements.insert_many([
        {**BASE, "id": f"older-{i:02}", "type": "PURCHASE_RECEIPT", "qty_change": 1,
         "unit_cost": 10, "created_at": "2026-09-01"}
        for i in range(50)
    ])
    params = {"store_id": "store_main", "product_id": "bear"}
    first = (await client.get(f"{HISTORY_URL}/manual", params=params)).json()
    second = (await client.get(f"{HISTORY_URL}/manual", params={**params, "before": first["next_cursor"]})).json()
    ids = [row["id"] for row in first["rows"] + second["rows"]]
    assert len(ids) == len(set(ids)) == 52
    assert second["next_cursor"] is None
