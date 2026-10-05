import os
import sys
from pathlib import Path
from datetime import datetime, timedelta, time, timezone
import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")
os.environ.setdefault("JWT_SECRET", "test")
import core
import routes_reports as reports


@pytest.fixture
def database(monkeypatch):
    db = AsyncMongoMockClient()["test"]
    monkeypatch.setattr(reports, "db", db)
    return db


def timestamp(days_ago):
    day = datetime.now(core.MANILA).date() - timedelta(days=days_ago)
    return datetime.combine(day, time.min, tzinfo=core.MANILA).astimezone(timezone.utc).isoformat()


@pytest.mark.asyncio
async def test_net_regular_and_promo_consumption_without_double_counting(database):
    await database.sales.insert_many([
        {"org_id": core.ORG_ID, "store_id": "store_main", "created_at": timestamp(1),
         "status": "PARTIAL_REFUND", "items": [{"product_id": "regular", "qty": 10, "refunded_qty": 2,
             "inventory_components": [{"product_id": "regular", "qty_per_sale": 1}]}]},
        {"org_id": core.ORG_ID, "store_id": "store_main", "created_at": timestamp(2),
         "status": "PARTIAL_REFUND", "items": [{"product_id": "promo", "qty": 2, "refunded_qty": 1,
             "inventory_components": [{"product_id": "regular", "qty_per_sale": 8}]}]},
    ])
    result = await reports.product_consumption("store_main", {})
    rows = {r["product_id"]: r for r in result["rows"]}
    assert rows["regular"] == {"product_id": "regular", "net_quantity": 16,
                              "daily": 0.53, "weekly": 3.73, "monthly": 16}
    assert rows["promo"]["net_quantity"] == 1


@pytest.mark.asyncio
async def test_completed_manila_days_branch_and_org_boundaries(database):
    for days, store, org, status in [
        (30, "store_main", core.ORG_ID, "COMPLETED"),
        (31, "store_main", core.ORG_ID, "COMPLETED"),
        (0, "store_main", core.ORG_ID, "COMPLETED"),
        (1, "store_annex", core.ORG_ID, "COMPLETED"),
        (1, "store_main", "other", "COMPLETED"),
        (1, "store_main", core.ORG_ID, "CANCELLED"),
        (1, "store_main", core.ORG_ID, "DRAFT"),
    ]:
        await database.sales.insert_one({"org_id": org, "store_id": store, "created_at": timestamp(days),
                                         "status": status, "items": [{"product_id": "p", "qty": 30}]})
    result = await reports.product_consumption("store_main", {})
    assert result["rows"] == [{"product_id": "p", "net_quantity": 30, "daily": 1, "weekly": 7, "monthly": 30}]
    assert result["days"] == 30
