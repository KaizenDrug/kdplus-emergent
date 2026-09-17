"""Focused regression tests for the production POS completion work."""
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
import routes_pos  # noqa: E402
import routes_reports  # noqa: E402


PRINCIPAL = {"id": "emp_cashier", "name": "Test Cashier", "role": "cashier", "permissions": ["pos.sell", "pos.refund", "pos.open_drawer", "pos.discount"]}


@pytest_asyncio.fixture
async def pos_db(monkeypatch):
    client = AsyncMongoMockClient()
    database = client["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(routes_pos, "db", database)
    monkeypatch.setattr(routes_reports, "db", database)
    monkeypatch.setattr(inventory_lib, "db", database)
    await database.settings.insert_one({
        "org_id": core.ORG_ID,
        "tax": {"vat_rate": 12},
        "senior_pwd": {"enabled": True, "discount_pct": 20, "vat_exempt": True},
        "negative_stock_policy": "PROHIBIT",
    })
    await database.products.insert_many([
        {"id": "p_med", "org_id": core.ORG_ID, "name": "Eligible Medicine", "price": 112,
         "average_cost": 50, "tax_mode": "VAT", "track_inventory": True,
         "track_lots": True, "discount_eligible": True},
        {"id": "p_other", "org_id": core.ORG_ID, "name": "Ineligible Item", "price": 112,
         "average_cost": 40, "tax_mode": "VAT", "track_inventory": True,
         "track_lots": False, "discount_eligible": False},
    ])
    await database.inventory_levels.insert_many([
        {"id": "lv1", "org_id": core.ORG_ID, "store_id": "store_main", "product_id": "p_med", "quantity": 10},
        {"id": "lv2", "org_id": core.ORG_ID, "store_id": "store_main", "product_id": "p_other", "quantity": 10},
    ])
    await database.inventory_lots.insert_one({
        "id": "lot1", "org_id": core.ORG_ID, "store_id": "store_main", "product_id": "p_med",
        "lot_number": "LOT-1", "expiry_date": "2028-01-01", "quantity": 10,
        "unit_cost": 50, "status": "ACTIVE",
    })
    await database.shifts.insert_one({
        "id": "shift1", "org_id": core.ORG_ID, "store_id": "store_main", "register_id": "reg_1",
        "employee_id": PRINCIPAL["id"], "employee_name": PRINCIPAL["name"], "opening_cash": 100,
        "status": "OPEN", "opened_at": core.now_iso(), "closed_at": None,
    })
    return database


def senior_sale(shift_id="shift1"):
    return routes_pos.SaleIn(
        store_id="store_main", register_id="reg_1", shift_id=shift_id,
        items=[
            routes_pos.SaleLine(product_id="p_med", qty=1, discount_eligible=True),
            routes_pos.SaleLine(product_id="p_other", qty=1, discount_eligible=False),
        ],
        payments=[routes_pos.PaymentIn(method="Cash", amount=192)],
        discount_type="SENIOR",
        senior_pwd=routes_pos.SeniorPwdInfo(id_number="SC-001", name="Test Senior"),
        client_txn_id="txn-senior-1",
    )


@pytest.mark.asyncio
async def test_shift_required_for_register_sale(pos_db):
    with pytest.raises(HTTPException) as exc:
        await routes_pos.create_sale(senior_sale(shift_id=None), principal=PRINCIPAL)
    assert exc.value.status_code == 400
    assert "Open a shift" in exc.value.detail


@pytest.mark.asyncio
async def test_senior_discount_only_applies_to_selected_items(pos_db):
    sale = await routes_pos.create_sale(senior_sale(), principal=PRINCIPAL)
    assert sale["shift_id"] == "shift1"
    assert sale["subtotal"] == 224
    assert sale["vat_exempt_amount"] == 12
    assert sale["spwd_discount"] == 20
    assert sale["vat_amount"] == 12
    assert sale["total"] == 192
    assert sale["items"][0]["discount_eligible"] is True
    assert sale["items"][1]["discount_eligible"] is False


@pytest.mark.asyncio
async def test_refund_restores_original_lot_and_records_refund_method(pos_db):
    sale = await routes_pos.create_sale(senior_sale(), principal=PRINCIPAL)
    lot_after_sale = await pos_db.inventory_lots.find_one({"id": "lot1"})
    assert lot_after_sale["quantity"] == 9

    refund = await routes_pos.create_refund(routes_pos.RefundIn(
        sale_id=sale["id"], reason="Customer returned sealed item",
        refund_method="GCash",
        lines=[routes_pos.RefundLine(product_id="p_med", qty=1, restore_stock=True)],
    ), principal=PRINCIPAL)

    assert refund["total"] == 80
    assert refund["payments"] == [{"method": "GCash", "amount": 80.0}]
    assert refund["shift_id"] == "shift1"
    restored_lot = await pos_db.inventory_lots.find_one({"id": "lot1"})
    restored_level = await pos_db.inventory_levels.find_one({"product_id": "p_med"})
    assert restored_lot["quantity"] == 10
    assert restored_level["quantity"] == 10


@pytest.mark.asyncio
async def test_shift_reconciliation_excludes_change_and_non_cash_refunds(pos_db):
    body = routes_pos.SaleIn(
        store_id="store_main", register_id="reg_1", shift_id="shift1",
        items=[routes_pos.SaleLine(product_id="p_other", qty=1)],
        payments=[routes_pos.PaymentIn(method="Cash", amount=200)],
        client_txn_id="txn-change-1",
    )
    await routes_pos.create_sale(body, principal=PRINCIPAL)
    closed = await routes_pos.close_shift(
        routes_pos.CloseShiftIn(shift_id="shift1", counted_cash=212), principal=PRINCIPAL,
    )
    assert closed["cash_sales"] == 112
    assert closed["expected_cash"] == 212
    assert closed["difference"] == 0


@pytest.mark.asyncio
async def test_dashboard_deducts_refunds_and_restored_cost(pos_db):
    sale = await routes_pos.create_sale(senior_sale(), principal=PRINCIPAL)
    await routes_pos.create_refund(routes_pos.RefundIn(
        sale_id=sale["id"], reason="Returned", refund_method="GCash",
        lines=[routes_pos.RefundLine(product_id="p_med", qty=1, restore_stock=True)],
    ), principal=PRINCIPAL)

    report = await routes_reports.dashboard(
        period="today", store_id="store_main", start=None, end=None, principal=PRINCIPAL,
    )
    assert report["kpi"]["net_sales"] == 112
    assert report["kpi"]["refunds"] == 80
    assert report["kpi"]["cogs"] == 40
    assert report["kpi"]["gross_profit"] == 72
