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
    assert rows[0]["cashier"] == "'=BAD()" and 'Item, "A"' in rows[0]["items"]
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
