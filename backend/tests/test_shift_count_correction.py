"""Owner-only audited correction of a closed shift's counted cash."""
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
import routes_pos  # noqa: E402


OWNER = {"id": "owner-1", "name": "Store Owner", "kind": "user", "role": "owner"}
MANAGER = {"id": "manager-1", "name": "Store Manager", "kind": "employee", "role": "manager", "permissions": ["*"]}


@pytest_asyncio.fixture
async def shift_db(monkeypatch):
    client = AsyncMongoMockClient()
    database = client["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(routes_pos, "db", database)
    await database.shifts.insert_one({
        "id": "closed-shift-1", "org_id": core.ORG_ID, "store_id": "store_main",
        "employee_name": "Test Cashier", "status": "CLOSED", "opening_cash": 100,
        "expected_cash": 5808, "counted_cash": 5345, "difference": -463,
    })
    return database


@pytest.mark.asyncio
async def test_owner_correction_updates_count_and_writes_audit_record(shift_db):
    corrected = await routes_pos.correct_closed_shift_count(
        "closed-shift-1",
        routes_pos.CorrectShiftCountIn(counted_cash=5845, reason="Actual drawer count was entered incorrectly."),
        principal=OWNER,
    )

    assert corrected["status"] == "CLOSED"
    assert corrected["expected_cash"] == 5808
    assert corrected["counted_cash"] == 5845
    assert corrected["difference"] == 37
    assert corrected["count_correction_reason"] == "Actual drawer count was entered incorrectly."

    logs = await shift_db.audit_logs.find({"event": "shift.count_corrected"}, {"_id": 0}).to_list(10)
    assert len(logs) == 1
    assert logs[0]["user_id"] == OWNER["id"]
    assert logs[0]["before"] == {"counted_cash": 5345.0, "difference": -463.0}
    assert logs[0]["after"] == {"counted_cash": 5845.0, "difference": 37.0, "reason": "Actual drawer count was entered incorrectly."}


@pytest.mark.asyncio
async def test_manager_cannot_correct_even_with_wildcard_permissions(shift_db):
    with pytest.raises(HTTPException) as exc:
        await routes_pos.correct_closed_shift_count(
            "closed-shift-1",
            routes_pos.CorrectShiftCountIn(counted_cash=5845, reason="Correction"),
            principal=MANAGER,
        )
    assert exc.value.status_code == 403
    assert await shift_db.audit_logs.count_documents({"event": "shift.count_corrected"}) == 0


@pytest.mark.asyncio
async def test_correction_requires_a_reason(shift_db):
    with pytest.raises(HTTPException) as exc:
        await routes_pos.correct_closed_shift_count(
            "closed-shift-1",
            routes_pos.CorrectShiftCountIn(counted_cash=5845, reason="  "),
            principal=OWNER,
        )
    assert exc.value.status_code == 400
    assert await shift_db.shifts.find_one({"id": "closed-shift-1"}, {"_id": 0, "counted_cash": 1}) == {
        "counted_cash": 5345,
    }
