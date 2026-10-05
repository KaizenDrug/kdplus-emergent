import csv
import io
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
import routes_reports as reports

@pytest.mark.asyncio
async def test_sales_export_dates_branch_refunds_and_csv_quoting(monkeypatch):
    db = AsyncMongoMockClient()["test"]
    monkeypatch.setattr(reports, "db", db)
    base = {"org_id": core.ORG_ID, "store_id": "store_main", "total": 100,
            "cashier_name": "=BAD()", "items": [{"name": 'Item, "A"', "qty": 2}]}
    await db.sales.insert_many([
        {**base, "number": "included", "created_at": "2026-10-04T16:00:00+00:00"},
        {**base, "number": "last", "created_at": "2026-10-05T15:59:59+00:00"},
        {**base, "number": "early", "created_at": "2026-10-04T15:59:59+00:00"},
        {**base, "number": "late", "created_at": "2026-10-05T16:00:00+00:00"},
        {**base, "number": "other", "store_id": "store_annex", "created_at": "2026-10-05T00:00:00+00:00"},
        {**base, "number": "foreign", "org_id": "other", "created_at": "2026-10-05T00:00:00+00:00"},
    ])
    await db.refunds.insert_one({**base, "number": "refund", "sale_number": "older-sale",
        "type": "REFUND", "total": 25, "created_at": "2026-10-05T01:00:00+00:00"})
    result = await reports.export_sales("2026-10-05", "2026-10-05", "store_main", {})
    rows = list(csv.DictReader(io.StringIO(result["csv"])))
    assert result["count"] == 3
    assert [r["receipt"] for r in rows] == ["included", "refund", "last"]
    assert rows[0]["date_time_ph"] == "2026-10-05T00:00:00+08:00"
    assert rows[0]["cashier"] == "'=BAD()" and 'Item, "A"' in rows[0]["item"]
    assert rows[1]["total"] == "-25.0" and rows[1]["original_receipt"] == "older-sale"

@pytest.mark.asyncio
async def test_empty_export_and_invalid_ranges(monkeypatch):
    monkeypatch.setattr(reports, "db", AsyncMongoMockClient()["test"])
    result = await reports.export_sales("2026-10-01", "2026-10-05", None, {})
    assert result["count"] == 0
    assert list(csv.DictReader(io.StringIO(result["csv"]))) == []
    for start, end in [("invalid", "2026-10-05"), ("2026-10-06", "2026-10-05")]:
        with pytest.raises(HTTPException) as error:
            await reports.export_sales(start, end, None, {})
        assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_multiple_items_have_separate_quantities_without_repeated_totals(monkeypatch):
    db = AsyncMongoMockClient()["test"]
    monkeypatch.setattr(reports, "db", db)
    base = {"org_id": core.ORG_ID, "store_id": "store_main", "created_at": "2026-10-05T00:00:00+00:00"}
    await db.sales.insert_one({**base, "number": "sale-1", "subtotal": 150, "discount_total": 10,
        "vat_amount": 15, "total": 140, "items": [
            {"name": "Tablet", "sku": "SKU10000", "qty": 3, "unit_price": 20, "line_net": 60},
            {"name": "Syrup", "sku": "SKU10001", "qty": 1, "unit_price": 90, "line_net": 90}]})
    await db.refunds.insert_one({**base, "number": "refund-1", "sale_number": "sale-1", "total": 46.67,
        "items": [{"name": "Tablet", "qty": 1, "amount": 18.67}, {"name": "Syrup", "qty": 1, "amount": 28}]})
    result = await reports.export_sales("2026-10-05", "2026-10-05", "store_main", {})
    rows = list(csv.DictReader(io.StringIO(result["csv"])))
    sales = [r for r in rows if r["type"] == "SALE"]
    refunds = [r for r in rows if r["type"] == "REFUND"]
    assert result["count"] == 4
    assert [r["receipt"] for r in sales] == ["sale-1", "sale-1"]
    assert [r["item"] for r in sales] == ["Tablet", "Syrup"]
    assert [r["sku"] for r in sales] == ["SKU10000", "SKU10001"]
    assert [r["quantity"] for r in sales] == ["3.0", "1.0"]
    assert [r["unit_price"] for r in sales] == ["20", "90"]
    assert [r["line_total"] for r in sales] == ["60", "90"]
    assert sales[1]["total"] == sales[1]["subtotal"] == sales[1]["discount"] == sales[1]["vat"] == ""
    assert sum(float(r["total"] or 0) for r in rows) == pytest.approx(93.33)
    assert [r["quantity"] for r in refunds] == ["-1.0", "-1.0"]
    assert [r["line_total"] for r in refunds] == ["-18.67", "-28.0"]
    assert [r["original_receipt"] for r in refunds] == ["sale-1", "sale-1"]
