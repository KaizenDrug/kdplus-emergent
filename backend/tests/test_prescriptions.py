"""Prescription log access, dispensing status, and audit regressions."""
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
os.environ.setdefault("DB_NAME", "kdplus_prescription_test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import core  # noqa: E402
import routes_admin  # noqa: E402

PHARMACIST = {"id": "ph-1", "name": "Test Pharmacist", "kind": "employee", "role": "pharmacist",
              "permissions": ["pharmacy.prescription"]}
CASHIER = {"id": "cashier-1", "name": "Test Cashier", "kind": "employee", "role": "cashier",
           "permissions": ["pos.sell"]}


@pytest_asyncio.fixture
async def rx_db(monkeypatch):
    client = AsyncMongoMockClient()
    database = client["kdplus_prescription_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(routes_admin, "db", database)
    return database


def sample_rx():
    return routes_admin.PrescriptionIn(
        patient_name="Jane Doe", reference="RX-123", prescription_date="2026-10-12",
        prescriber="Dr. Example", license_number="PRC-123", ptr_number="PTR-456",
        items=[
            routes_admin.PrescriptionItemIn(product_name="Medicine A 10mg", qty_prescribed=10, qty_dispensed=4,
                                             directions="Take one daily"),
            routes_admin.PrescriptionItemIn(product_name="Medicine B 5mg", qty_prescribed=5, qty_dispensed=5),
        ],
    )


@pytest.mark.asyncio
async def test_records_multi_item_prescription_and_audits_without_exposing_image_in_list(rx_db):
    body = sample_rx().model_copy(update={"prescription_image": "data:image/png;base64,ZmFrZQ=="})
    created = await routes_admin.create_prescription(body, principal=PHARMACIST)
    assert created["status"] == "PARTIALLY_FILLED"
    assert created["pharmacist"] == "Test Pharmacist"
    assert created["items"][0]["qty_prescribed"] == 10
    assert created["items"][0]["qty_dispensed"] == 4

    rows = await routes_admin.list_prescriptions(principal=PHARMACIST)
    assert rows[0]["id"] == created["id"]
    assert rows[0]["item_count"] == 2
    assert "prescription_image" not in rows[0]
    details = await routes_admin.get_prescription(created["id"], principal=PHARMACIST)
    assert details["prescription_image"].startswith("data:image/png;base64,")
    assert await rx_db.audit_logs.count_documents({"event": "prescription.created"}) == 1


@pytest.mark.asyncio
async def test_dispensing_quantities_must_not_exceed_prescribed(rx_db):
    bad = sample_rx()
    bad.items[0].qty_dispensed = 11
    with pytest.raises(HTTPException) as exc:
        await routes_admin.create_prescription(bad, principal=PHARMACIST)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_cancellation_is_audited_and_prevents_editing(rx_db):
    created = await routes_admin.create_prescription(sample_rx(), principal=PHARMACIST)
    await routes_admin.cancel_prescription(created["id"], routes_admin.PrescriptionCancelIn(reason="Entered in error"),
                                           principal=PHARMACIST)
    record = await routes_admin.get_prescription(created["id"], principal=PHARMACIST)
    assert record["status"] == "CANCELLED"
    with pytest.raises(HTTPException) as exc:
        await routes_admin.update_prescription(created["id"], sample_rx(), principal=PHARMACIST)
    assert exc.value.status_code == 409
    assert await rx_db.audit_logs.count_documents({"event": "prescription.cancelled"}) == 1


@pytest.mark.asyncio
async def test_cashier_does_not_have_prescription_permission():
    with pytest.raises(HTTPException) as exc:
        await core.require_perm("pharmacy.prescription")(CASHIER)
    assert exc.value.status_code == 403
