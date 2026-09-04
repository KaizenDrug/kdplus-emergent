"""Backend tests for CSV Import wizard + Reorder Suggestions (iteration 3)."""
import os
import math
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"

ADMIN_EMAIL = "nt7yzjc88t@privaterelay.appleid.com"
ADMIN_PASS = "KdplusOwner#2026"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def cleanup(client):
    yield
    # remove QA Import Aspirin if present
    prods = client.get(f"{BASE_URL}/api/products?q=QA Import Aspirin").json()
    for p in prods:
        if p.get("name") == "QA Import Aspirin":
            # soft-delete by marking inactive if no delete endpoint
            try:
                client.put(f"{BASE_URL}/api/products/{p['id']}", json={**p, "active": False, "sku": ""})
            except Exception:
                pass


# ---------- CSV import ----------
CSV = (
    "name,generic_name,brand,sku,barcode,category,cost,price,stock,reorder_level,supplier,batch,expiry\n"
    "QA Import Aspirin,Aspirin,QAbrand,QA-ASP-1,4808888000001,Pain & Fever,3.50,8.00,40,15,Zuellig Pharma Corp.,QALOT1,2027-10-31\n"
    "Paracetamol 500mg Tablet,Paracetamol,Biogesic,,,,2.10,4.50,,,,,\n"
    "Broken,,,,,,abc,5,,,,,\n"
)


def test_import_template(client):
    r = client.get(f"{BASE_URL}/api/products/import/template")
    assert r.status_code == 200
    assert "name,generic_name" in r.json()["template"]


def test_import_validate(client):
    r = client.post(f"{BASE_URL}/api/products/import/validate", json={"csv": CSV})
    assert r.status_code == 200, r.text
    data = r.json()
    s = data["summary"]
    assert s["new"] == 1, f"expected new=1, got {s}"
    assert s["duplicate"] == 1, f"expected duplicate=1, got {s}"
    assert s["error"] == 1, f"expected error=1, got {s}"
    assert s["total"] == 3
    # row-level statuses
    statuses = [r["status"] for r in data["rows"]]
    assert statuses == ["new", "duplicate", "error"]


def test_import_commit_and_persist(client, cleanup):
    r = client.post(f"{BASE_URL}/api/products/import/commit",
                    json={"csv": CSV, "skip_duplicates": True, "store_id": "store_main"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["created"] == 1
    assert d["skipped"] == 1
    assert d["errors"] == 1
    # verify persisted
    prods = client.get(f"{BASE_URL}/api/products?q=QA Import Aspirin").json()
    names = [p["name"] for p in prods]
    assert "QA Import Aspirin" in names


# ---------- Reorder suggestions ----------
def test_reorder_endpoint_shape(client):
    r = client.get(f"{BASE_URL}/api/reports/reorder-suggestions?days_window=30&lead_time_days=7")
    assert r.status_code == 200
    d = r.json()
    assert "rows" in d and "params" in d
    assert d["params"]["days_window"] == 30
    assert d["params"]["lead_time_days"] == 7
    for row in d["rows"]:
        for k in ("product_id", "name", "supplier_id", "supplier_name",
                  "current_stock", "incoming", "avg_daily_sales",
                  "days_of_stock", "suggested_qty", "est_cost"):
            assert k in row, f"missing key {k}"


def test_reorder_math_and_supplier_filter(client):
    # Force a suggestion: create product with 0 stock and high reorder_level
    body = {
        "name": "TEST_ReorderProd_XYZ", "generic_name": "", "brand": "QA",
        "category_id": None, "supplier_id": None, "sku": f"TEST-RO-{os.getpid()}",
        "barcode": "", "strength": "", "dosage_form": "", "pack_size": "",
        "rx_classification": "OTC", "uom": "piece", "purchase_uom": "box",
        "conversion_factor": 1, "acquisition_cost": 5.0, "average_cost": 5.0,
        "price": 10.0, "reorder_level": 25, "reorder_qty": 100, "max_stock": 0,
        "track_inventory": True, "track_lots": True, "track_expiry": True,
        "tax_mode": "VAT", "vat_inclusive": True, "shelf_code": "", "storage": "",
        "refrigerated": False, "controlled": False, "active": True,
    }
    # assign preferred supplier
    sups = client.get(f"{BASE_URL}/api/suppliers").json()
    zpc = next((s for s in sups if s["company"] == "Zuellig Pharma Corp."), sups[0])
    body["preferred_supplier_id"] = zpc["id"]
    body["supplier_id"] = zpc["id"]
    cr = client.post(f"{BASE_URL}/api/products", json=body)
    assert cr.status_code == 200, cr.text
    prod = cr.json()

    try:
        r = client.get(f"{BASE_URL}/api/reports/reorder-suggestions"
                       f"?days_window=30&lead_time_days=7&supplier_id={zpc['id']}")
        assert r.status_code == 200
        rows = r.json()["rows"]
        target = next((x for x in rows if x["product_id"] == prod["id"]), None)
        assert target is not None, "created product missing from suggestions"
        # supplier filter honored
        assert all(row["supplier_id"] == zpc["id"] for row in rows)
        # math: current=0, incoming=0, avg_daily=0, reorder_level=25 -> suggested>0
        # formula: ceil(avg*lead + reorder - cur - inc) then max with reorder_qty if cur<=0
        expected = math.ceil(target["avg_daily_sales"] * 7 + 25 - target["current_stock"] - target["incoming"])
        expected = max(expected, 100)  # reorder_qty applied when cur<=0
        assert target["suggested_qty"] == expected, \
            f"expected {expected}, got {target['suggested_qty']}"
        assert target["est_cost"] == round(target["suggested_qty"] * 5.0, 2)
    finally:
        # deactivate to remove from future suggestions
        client.put(f"{BASE_URL}/api/products/{prod['id']}",
                   json={**body, "active": False, "sku": ""})


def test_create_draft_po_from_suggestions(client):
    # create suggestion product
    sups = client.get(f"{BASE_URL}/api/suppliers").json()
    zpc = next((s for s in sups if s["company"] == "Zuellig Pharma Corp."), sups[0])
    body = {
        "name": "TEST_POFromReorder", "generic_name": "", "brand": "QA",
        "category_id": None, "supplier_id": zpc["id"], "preferred_supplier_id": zpc["id"],
        "sku": f"TEST-PO-{os.getpid()}", "barcode": "", "strength": "", "dosage_form": "",
        "pack_size": "", "rx_classification": "OTC", "uom": "piece", "purchase_uom": "box",
        "conversion_factor": 1, "acquisition_cost": 5.0, "average_cost": 5.0,
        "price": 10.0, "reorder_level": 30, "reorder_qty": 40, "max_stock": 0,
        "track_inventory": True, "track_lots": True, "track_expiry": True,
        "tax_mode": "VAT", "vat_inclusive": True, "shelf_code": "", "storage": "",
        "refrigerated": False, "controlled": False, "active": True,
    }
    prod = client.post(f"{BASE_URL}/api/products", json=body).json()
    try:
        r = client.get(f"{BASE_URL}/api/reports/reorder-suggestions"
                       f"?days_window=30&lead_time_days=7&supplier_id={zpc['id']}")
        rows = r.json()["rows"]
        my = [x for x in rows if x["product_id"] == prod["id"]]
        assert my, "product not in suggestions"
        items = [{"product_id": x["product_id"], "name": x["name"],
                  "qty_ordered": x["suggested_qty"], "unit_cost": x["unit_cost"]} for x in my]
        po = client.post(f"{BASE_URL}/api/purchase-orders",
                         json={"supplier_id": zpc["id"], "store_id": "store_main", "items": items})
        assert po.status_code == 200, po.text
        pod = po.json()
        assert pod.get("status") == "DRAFT"
        assert pod.get("number", "").startswith("PO")
        assert any(it["product_id"] == prod["id"] for it in pod["items"])
    finally:
        client.put(f"{BASE_URL}/api/products/{prod['id']}",
                   json={**body, "active": False, "sku": ""})
