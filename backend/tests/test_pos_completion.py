"""Focused regression tests for the production POS completion work."""
import os
import sys
from pathlib import Path
from datetime import datetime, time, timedelta

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
import routes_catalog  # noqa: E402
import routes_pos  # noqa: E402
import routes_reports  # noqa: E402


PRINCIPAL = {"id": "emp_cashier", "name": "Test Cashier", "kind": "employee", "role": "cashier", "permissions": ["pos.sell", "pos.refund", "pos.view_receipts", "pos.open_drawer", "pos.discount"]}
MANAGER = {"id": "emp_manager", "name": "Test Manager", "kind": "employee", "role": "manager", "permissions": ["*"]}


@pytest_asyncio.fixture
async def pos_db(monkeypatch):
    client = AsyncMongoMockClient()
    database = client["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(routes_pos, "db", database)
    monkeypatch.setattr(routes_reports, "db", database)
    monkeypatch.setattr(routes_catalog, "db", database)
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


@pytest.mark.asyncio
async def test_dashboard_uses_manila_calendar_day_for_utc_sales(pos_db):
    today = datetime.now(core.MANILA).date()
    early_today = datetime.combine(today, time(hour=0, minute=30), tzinfo=core.MANILA).astimezone(core.timezone.utc).isoformat()
    late_yesterday = datetime.combine(today - timedelta(days=1), time(hour=23, minute=30), tzinfo=core.MANILA).astimezone(core.timezone.utc).isoformat()
    await pos_db.sales.insert_many([
        {"id": "sale-today", "org_id": core.ORG_ID, "store_id": "store_main", "created_at": early_today},
        {"id": "sale-yesterday", "org_id": core.ORG_ID, "store_id": "store_main", "created_at": late_yesterday},
    ])

    today_sales = await routes_reports.fetch_sales("today", None, None, "store_main")
    yesterday_sales = await routes_reports.fetch_sales("yesterday", None, None, "store_main")

    assert [sale["id"] for sale in today_sales] == ["sale-today"]
    assert [sale["id"] for sale in yesterday_sales] == ["sale-yesterday"]


@pytest.mark.asyncio
async def test_promotional_sku_deducts_and_refunds_regular_component_stock(pos_db):
    await pos_db.products.insert_one({
        "id": "p_promo", "org_id": core.ORG_ID, "name": "Eligible Medicine (7+1)",
        "sku": "PROMO-7P1", "barcode": "PROMO-BARCODE", "price": 350,
        "average_cost": 400, "tax_mode": "VAT", "product_type": "PROMO",
        "track_inventory": False, "track_lots": False, "discount_eligible": True,
        "active": True, "components": [{"product_id": "p_med", "quantity": 8}],
    })
    sale = await routes_pos.create_sale(routes_pos.SaleIn(
        store_id="store_main", register_id="reg_1", shift_id="shift1",
        items=[routes_pos.SaleLine(product_id="p_promo", qty=1)],
        payments=[routes_pos.PaymentIn(method="Cash", amount=350)],
        client_txn_id="txn-promo-1",
    ), principal=PRINCIPAL)

    assert sale["items"][0]["product_id"] == "p_promo"
    assert sale["items"][0]["inventory_components"][0]["product_id"] == "p_med"
    assert sale["items"][0]["inventory_components"][0]["total_qty"] == 8
    assert (await pos_db.inventory_levels.find_one({"product_id": "p_med"}))["quantity"] == 2
    assert (await pos_db.inventory_lots.find_one({"id": "lot1"}))["quantity"] == 2

    await routes_pos.create_refund(routes_pos.RefundIn(
        sale_id=sale["id"], reason="Promo returned sealed",
        lines=[routes_pos.RefundLine(sale_line_id=sale["items"][0]["sale_line_id"], qty=1, restore_stock=True)],
    ), principal=PRINCIPAL)
    assert (await pos_db.inventory_levels.find_one({"product_id": "p_med"}))["quantity"] == 10
    assert (await pos_db.inventory_lots.find_one({"id": "lot1"}))["quantity"] == 10


@pytest.mark.asyncio
async def test_promotional_product_configuration_uses_component_cost(pos_db):
    data = routes_catalog.ProductIn(
        name="Eligible Medicine (7+1)", product_type="PROMO", price=350,
        components=[routes_catalog.ProductComponent(product_id="p_med", quantity=8)],
    ).model_dump()

    prepared = await routes_catalog.prepare_product_components(data)

    assert prepared["components"] == [{
        "product_id": "p_med", "quantity": 8.0,
        "name": "Eligible Medicine", "sku": None,
    }]
    assert prepared["average_cost"] == 400
    assert prepared["track_inventory"] is False
    assert prepared["track_lots"] is False


@pytest.mark.asyncio
async def test_zero_level_product_with_stale_lots_can_convert_to_promo(pos_db):
    await pos_db.products.insert_one({
        "id": "p_candidate", "org_id": core.ORG_ID, "name": "Old Promo Shell",
        "sku": "OLD-PROMO", "price": 10, "average_cost": 2,
        "product_type": "REGULAR", "track_inventory": True, "track_lots": True,
    })
    await pos_db.inventory_levels.insert_one({
        "id": "candidate-level", "org_id": core.ORG_ID, "store_id": "store_main",
        "product_id": "p_candidate", "quantity": 0,
    })
    await pos_db.inventory_lots.insert_one({
        "id": "stale-lot", "org_id": core.ORG_ID, "store_id": "store_main",
        "product_id": "p_candidate", "quantity": 5, "status": "ACTIVE",
    })

    updated = await routes_catalog.update_product(
        "p_candidate",
        routes_catalog.ProductIn(
            name="Old Promo Shell", sku="OLD-PROMO", product_type="PROMO", price=350,
            components=[routes_catalog.ProductComponent(product_id="p_med", quantity=8)],
        ),
        principal=MANAGER,
    )

    assert updated["product_type"] == "PROMO"
    stale_lot = await pos_db.inventory_lots.find_one({"id": "stale-lot"})
    assert stale_lot["quantity"] == 0
    assert stale_lot["status"] == "DEPLETED"


@pytest.mark.asyncio
async def test_promotional_and_regular_lines_share_stock_limit(pos_db):
    await pos_db.products.insert_one({
        "id": "p_promo", "org_id": core.ORG_ID, "name": "Eligible Medicine (7+1)",
        "price": 350, "average_cost": 400, "tax_mode": "VAT", "product_type": "PROMO",
        "track_inventory": False, "track_lots": False, "discount_eligible": True,
        "active": True, "components": [{"product_id": "p_med", "quantity": 8}],
    })
    with pytest.raises(HTTPException) as exc:
        await routes_pos.create_sale(routes_pos.SaleIn(
            store_id="store_main", register_id="reg_1", shift_id="shift1",
            items=[routes_pos.SaleLine(product_id="p_promo", qty=1), routes_pos.SaleLine(product_id="p_med", qty=3)],
            payments=[routes_pos.PaymentIn(method="Cash", amount=700)],
        ), principal=PRINCIPAL)
    assert exc.value.status_code == 400
    assert "11" in exc.value.detail


@pytest.mark.asyncio
async def test_partial_quantity_senior_discount_and_stable_line_ids(pos_db):
    sale = await routes_pos.create_sale(routes_pos.SaleIn(
        store_id="store_main", register_id="reg_1", shift_id="shift1",
        items=[routes_pos.SaleLine(
            product_id="p_med", qty=2, discount_eligible=True, discount_eligible_qty=1,
        )],
        payments=[routes_pos.PaymentIn(method="Cash", amount=192)],
        discount_type="SENIOR",
        senior_pwd=routes_pos.SeniorPwdInfo(id_number="SC-002", name="One eligible unit"),
        client_txn_id="txn-partial-eligible",
    ), principal=PRINCIPAL)

    assert sale["subtotal"] == 224
    assert sale["vat_exempt_amount"] == 12
    assert sale["spwd_discount"] == 20
    assert sale["vat_amount"] == 12
    assert sale["total"] == 192
    assert sale["items"][0]["discount_eligible_qty"] == 1
    assert sale["items"][0]["sale_line_id"]


@pytest.mark.asyncio
async def test_refund_idempotency_and_over_refund_protection(pos_db):
    sale = await routes_pos.create_sale(senior_sale(), principal=PRINCIPAL)
    request = routes_pos.RefundIn(
        sale_id=sale["id"], reason="Returned once", refund_method="Cash",
        client_txn_id="refund-once",
        lines=[routes_pos.RefundLine(
            sale_line_id=sale["items"][0]["sale_line_id"], qty=1, restore_stock=True,
        )],
    )
    first = await routes_pos.create_refund(request, principal=PRINCIPAL)
    duplicate = await routes_pos.create_refund(request, principal=PRINCIPAL)

    assert duplicate["id"] == first["id"]
    assert await pos_db.refunds.count_documents({"sale_id": sale["id"]}) == 1
    assert (await pos_db.inventory_lots.find_one({"id": "lot1"}))["quantity"] == 10

    with pytest.raises(HTTPException) as exc:
        await routes_pos.create_refund(routes_pos.RefundIn(
            sale_id=sale["id"], reason="Attempted twice",
            lines=[routes_pos.RefundLine(
                sale_line_id=sale["items"][0]["sale_line_id"], qty=1,
            )],
        ), principal=PRINCIPAL)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_manager_can_cancel_untouched_receipt(pos_db):
    sale = await routes_pos.create_sale(routes_pos.SaleIn(
        store_id="store_main", register_id="reg_1", shift_id="shift1",
        items=[routes_pos.SaleLine(product_id="p_other", qty=1)],
        payments=[routes_pos.PaymentIn(method="Cash", amount=112)],
        client_txn_id="txn-to-cancel",
    ), principal=PRINCIPAL)
    assert (await pos_db.inventory_levels.find_one({"product_id": "p_other"}))["quantity"] == 9

    void = await routes_pos.cancel_sale(sale["id"], routes_pos.CancelSaleIn(
        reason="Cashier entered wrong receipt", refund_method="Cash", client_txn_id="void-once",
    ), principal=MANAGER)

    assert void["type"] == "VOID"
    assert void["total"] == 112
    assert (await pos_db.sales.find_one({"id": sale["id"]}))["status"] == "CANCELLED"
    assert (await pos_db.inventory_levels.find_one({"product_id": "p_other"}))["quantity"] == 10
    movement = await pos_db.inventory_movements.find_one({"reference": void["number"]})
    assert movement["type"] == "VOID"

    duplicate = await routes_pos.cancel_sale(sale["id"], routes_pos.CancelSaleIn(
        reason="Cashier entered wrong receipt", refund_method="Cash", client_txn_id="void-once",
    ), principal=MANAGER)
    assert duplicate["id"] == void["id"]
    assert (await pos_db.inventory_levels.find_one({"product_id": "p_other"}))["quantity"] == 10


@pytest.mark.asyncio
async def test_cashier_cannot_open_or_refund_another_cashiers_receipt(pos_db):
    sale = await routes_pos.create_sale(senior_sale(), principal=PRINCIPAL)
    other = {**PRINCIPAL, "id": "emp_other", "name": "Other Cashier"}

    with pytest.raises(HTTPException) as view_exc:
        await routes_pos.get_sale(sale["id"], principal=other)
    assert view_exc.value.status_code == 403

    with pytest.raises(HTTPException) as refund_exc:
        await routes_pos.create_refund(routes_pos.RefundIn(
            sale_id=sale["id"], reason="Not my sale",
            lines=[routes_pos.RefundLine(sale_line_id=sale["items"][0]["sale_line_id"], qty=1)],
        ), principal=other)
    assert refund_exc.value.status_code == 403


@pytest.mark.asyncio
async def test_receipt_search_pagination_and_legacy_line_normalization(pos_db):
    sale = await routes_pos.create_sale(senior_sale(), principal=PRINCIPAL)
    await pos_db.sales.update_one(
        {"id": sale["id"]},
        {"$unset": {"items.0.sale_line_id": "", "refund_version": ""}},
    )

    result = await routes_pos.list_sales(
        store_id=None, limit=100, page=1, page_size=1,
        q=sale["number"], paginated=True, principal=PRINCIPAL,
    )

    assert result["total"] == 1
    assert result["pages"] == 1
    assert result["items"][0]["items"][0]["sale_line_id"] == f"{sale['id']}-line-1"
    assert result["items"][0]["refund_version"] == 0


@pytest.mark.asyncio
async def test_records_unavailable_item_for_purchasing_review(pos_db):
    result = await routes_pos.record_unavailable_item(routes_pos.UnavailableItemIn(
        store_id="store_main", item_name="  Abdominal   Binder XL  ", quantity=2,
        customer_name="Juan Dela Cruz", notes="Customer will return Friday",
    ), principal=PRINCIPAL)

    assert result["item_name"] == "Abdominal Binder XL"
    assert result["normalized_name"] == "abdominal binder xl"
    assert result["quantity"] == 2
    assert result["recorded_by_name"] == "Test Cashier"
    report = await routes_reports.unavailable_items_report(
        period="30d", store_id="store_main", start=None, end=None, principal=MANAGER,
    )
    assert report["count"] == 1
    assert report["total_quantity"] == 2
    assert report["unique_items"] == 1


@pytest.mark.asyncio
async def test_rejects_invalid_unavailable_item_quantity(pos_db):
    with pytest.raises(HTTPException) as exc:
        await routes_pos.record_unavailable_item(routes_pos.UnavailableItemIn(
            store_id="store_main", item_name="Requested item", quantity=0,
        ), principal=PRINCIPAL)
    assert exc.value.status_code == 400
