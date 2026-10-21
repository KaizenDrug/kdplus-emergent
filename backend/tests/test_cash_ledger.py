"""Regression tests for the read-only cash movement ledger.

Run from the backend directory: python -m pytest tests/test_cash_ledger.py
"""
import asyncio
import os

import pytest
from fastapi import HTTPException

# Importing core constructs a Mongo client but these tests never connect to it.
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")

import routes_pos  # noqa: E402


class FakeCollection:
    def __init__(self, rows):
        self.rows = rows

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if self._matches(row, query)), None)

    def find(self, query, projection=None):
        async def rows():
            for row in self.rows:
                if self._matches(row, query):
                    yield dict(row)
        return rows()

    @staticmethod
    def _matches(row, query):
        return all(row.get(key) == value for key, value in query.items())


class FakeDb:
    def __init__(self, shifts, sales, refunds, movements):
        self.shifts = FakeCollection(shifts)
        self.sales = FakeCollection(sales)
        self.refunds = FakeCollection(refunds)
        self.cash_movements = FakeCollection(movements)


def sample_db():
    org = routes_pos.ORG_ID
    return FakeDb(
        shifts=[{
            "id": "shift-1", "org_id": org, "employee_name": "Cashier A",
            "opening_cash": 2000, "opened_at": "2026-10-21T00:00:00+00:00",
            "status": "OPEN",
        }],
        sales=[
            {
                "id": "sale-1", "org_id": org, "shift_id": "shift-1",
                "created_at": "2026-10-21T00:10:00+00:00",
                "cashier_name": "Cashier A", "number": "SALE-001",
                "payments": [{"method": "Cash", "amount": 500}], "change": 150,
            },
            {
                "id": "sale-card", "org_id": org, "shift_id": "shift-1",
                "created_at": "2026-10-21T00:11:00+00:00",
                "payments": [{"method": "GCash", "amount": 400}], "change": 0,
            },
            {
                "id": "other-shift", "org_id": org, "shift_id": "shift-2",
                "created_at": "2026-10-21T00:12:00+00:00",
                "payments": [{"method": "Cash", "amount": 999}], "change": 0,
            },
        ],
        refunds=[
            {
                "id": "refund-1", "org_id": org, "shift_id": "shift-1",
                "created_at": "2026-10-21T00:40:00+00:00",
                "cashier_name": "Cashier A", "number": "REF-001",
                "reason": "Returned item", "payments": [{"method": "Cash", "amount": 100}],
            },
            {
                "id": "refund-card", "org_id": org, "shift_id": "shift-1",
                "created_at": "2026-10-21T00:41:00+00:00",
                "payments": [{"method": "GCash", "amount": 50}],
            },
        ],
        movements=[
            {
                "id": "in-1", "org_id": org, "shift_id": "shift-1", "type": "IN",
                "amount": 200, "created_at": "2026-10-21T00:20:00+00:00",
                "employee_name": "Cashier A", "reason": "Added change",
            },
            {
                "id": "out-1", "org_id": org, "shift_id": "shift-1", "type": "OUT",
                "amount": 50, "created_at": "2026-10-21T00:25:00+00:00",
            },
            {
                "id": "drop-1", "org_id": org, "shift_id": "shift-1", "type": "DROP",
                "amount": 500, "created_at": "2026-10-21T00:30:00+00:00",
            },
            {
                "id": "petty-1", "org_id": org, "shift_id": "shift-1", "type": "PETTY",
                "amount": 20, "created_at": "2026-10-21T00:35:00+00:00",
            },
        ],
    )


def test_cash_ledger_includes_sales_refunds_and_manual_movements(monkeypatch):
    monkeypatch.setattr(routes_pos, "db", sample_db())
    result = asyncio.run(routes_pos.cash_ledger("shift-1", principal={"permissions": ["*"]}))
    totals = result["totals"]

    assert totals == {
        "opening_cash": 2000.0, "cash_sales": 350.0, "cash_in": 200.0,
        "cash_out": 570.0, "cash_refunds": 100.0, "expected_cash": 1880.0,
    }
    assert [row["type"] for row in result["entries"]] == [
        "OPENING", "SALE", "IN", "OUT", "DROP", "PETTY", "REFUND",
    ]
    assert [row["balance"] for row in result["entries"]] == [
        2000.0, 2350.0, 2550.0, 2500.0, 2000.0, 1980.0, 1880.0,
    ]
    assert result["entries"][1]["reference"] == "SALE-001"
    assert result["entries"][-1]["reason"] == "Returned item"


def test_cash_ledger_rejects_non_managers(monkeypatch):
    monkeypatch.setattr(routes_pos, "db", sample_db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes_pos.cash_ledger("shift-1", principal={"permissions": ["pos.view_receipts"]}))
    assert exc.value.status_code == 403


def test_cash_ledger_rejects_unknown_shift(monkeypatch):
    monkeypatch.setattr(routes_pos, "db", sample_db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes_pos.cash_ledger("missing", principal={"permissions": ["*"]}))
    assert exc.value.status_code == 404
