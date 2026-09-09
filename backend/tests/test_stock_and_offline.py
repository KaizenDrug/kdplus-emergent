"""
KDPLUS - New feature tests: Stock Transfers, Inventory Counts, POS offline dedupe.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip()
                break
BASE = BASE.rstrip("/")

from creds import ADMIN_EMAIL, ADMIN_PASSWORD
CASHIER_PIN = "4444"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200
    return s


@pytest.fixture(scope="module")
def cashier():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/pin-login", json={"pin": CASHIER_PIN}, timeout=30)
    assert r.status_code == 200
    return s


def get_level(admin, store_id, product_id):
    r = admin.get(f"{BASE}/api/inventory/levels?store_id={store_id}", timeout=30)
    assert r.status_code == 200
    for x in r.json():
        if x["product_id"] == product_id:
            return float(x["quantity"])
    return 0.0


def pick_product_with_stock(admin, store_id="store_main", min_qty=5):
    r = admin.get(f"{BASE}/api/inventory/levels?store_id={store_id}", timeout=30)
    assert r.status_code == 200
    for x in r.json():
        if float(x.get("quantity", 0)) >= min_qty:
            return x["product_id"]
    pytest.skip("no product with sufficient stock found")


# ============ STOCK TRANSFERS ============
class TestStockTransfers:
    def test_full_flow_draft_send_receive(self, admin):
        pid = pick_product_with_stock(admin, "store_main", 5)
        main_before = get_level(admin, "store_main", pid)
        annex_before = get_level(admin, "store_annex", pid)

        # Create draft
        r = admin.post(f"{BASE}/api/stock-transfers", json={
            "source_store": "store_main", "dest_store": "store_annex",
            "items": [{"product_id": pid, "qty": 2}], "notes": "TEST_transfer"
        }, timeout=30)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["status"] == "DRAFT"
        assert t["number"].startswith("TR")
        tid = t["id"]

        # Send -> IN_TRANSIT; stock leaves source, NOT yet in dest
        r = admin.put(f"{BASE}/api/stock-transfers/{tid}/send", timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "IN_TRANSIT"

        main_mid = get_level(admin, "store_main", pid)
        annex_mid = get_level(admin, "store_annex", pid)
        assert main_mid == pytest.approx(main_before - 2, abs=0.001)
        assert annex_mid == pytest.approx(annex_before, abs=0.001)

        # Receive
        r = admin.put(f"{BASE}/api/stock-transfers/{tid}/receive", timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "RECEIVED"

        main_after = get_level(admin, "store_main", pid)
        annex_after = get_level(admin, "store_annex", pid)
        assert main_after == pytest.approx(main_before - 2, abs=0.001)
        assert annex_after == pytest.approx(annex_before + 2, abs=0.001)

        # Verify ledger has TRANSFER_OUT/IN
        r = admin.get(f"{BASE}/api/inventory/movements?product_id={pid}&limit=50", timeout=30)
        assert r.status_code == 200
        movs = r.json()
        types = [m.get("type") for m in movs]
        assert "TRANSFER_OUT" in types
        assert "TRANSFER_IN" in types

    def test_transfer_cancel_restores_stock(self, admin):
        pid = pick_product_with_stock(admin, "store_main", 5)
        main_before = get_level(admin, "store_main", pid)

        r = admin.post(f"{BASE}/api/stock-transfers", json={
            "source_store": "store_main", "dest_store": "store_annex",
            "items": [{"product_id": pid, "qty": 1}]
        }, timeout=30)
        assert r.status_code == 200
        tid = r.json()["id"]

        assert admin.put(f"{BASE}/api/stock-transfers/{tid}/send").status_code == 200
        assert get_level(admin, "store_main", pid) == pytest.approx(main_before - 1, abs=0.001)

        r = admin.put(f"{BASE}/api/stock-transfers/{tid}/cancel", timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "CANCELLED"
        assert get_level(admin, "store_main", pid) == pytest.approx(main_before, abs=0.001)

    def test_same_source_dest_rejected(self, admin):
        r = admin.post(f"{BASE}/api/stock-transfers", json={
            "source_store": "store_main", "dest_store": "store_main",
            "items": [{"product_id": "x", "qty": 1}]
        }, timeout=30)
        assert r.status_code == 400

    def test_receive_before_send_rejected(self, admin):
        pid = pick_product_with_stock(admin, "store_main", 5)
        r = admin.post(f"{BASE}/api/stock-transfers", json={
            "source_store": "store_main", "dest_store": "store_annex",
            "items": [{"product_id": pid, "qty": 1}]
        }, timeout=30)
        tid = r.json()["id"]
        r = admin.put(f"{BASE}/api/stock-transfers/{tid}/receive", timeout=30)
        assert r.status_code == 400


# ============ INVENTORY COUNTS ============
class TestInventoryCounts:
    def test_count_create_save_approve(self, admin):
        # find a category
        r = admin.get(f"{BASE}/api/categories", timeout=30)
        cats = r.json()
        assert cats
        cat_id = cats[0]["id"]

        # Create partial count
        r = admin.post(f"{BASE}/api/inventory-counts", json={
            "store_id": "store_main", "category_id": cat_id, "notes": "TEST_count"
        }, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["status"] == "OPEN"
        assert c["number"].startswith("COUNT")
        assert len(c["items"]) > 0
        cid = c["id"]

        # Pick first item, set counted = expected + 3 -> should post +3 correction
        first = c["items"][0]
        pid = first["product_id"]
        expected = float(first["expected"])
        new_counted = expected + 3

        pre_level = get_level(admin, "store_main", pid)

        r = admin.put(f"{BASE}/api/inventory-counts/{cid}/items", json={
            "items": [{"product_id": pid, "counted": new_counted}]
        }, timeout=30)
        assert r.status_code == 200
        assert r.json()["saved"] is True

        # Approve
        r = admin.post(f"{BASE}/api/inventory-counts/{cid}/approve", timeout=30)
        assert r.status_code == 200
        approved = r.json()
        assert approved["status"] == "APPROVED"
        assert approved["corrections"] >= 1

        # Verify level matches counted
        post_level = get_level(admin, "store_main", pid)
        assert post_level == pytest.approx(new_counted, abs=0.001)
        assert post_level == pytest.approx(pre_level + 3, abs=0.001)

        # Ledger has COUNT_CORRECTION
        r = admin.get(f"{BASE}/api/inventory/movements?product_id={pid}&limit=30", timeout=30)
        types = [m.get("type") for m in r.json()]
        assert "COUNT_CORRECTION" in types

        # Cannot re-approve
        r = admin.post(f"{BASE}/api/inventory-counts/{cid}/approve", timeout=30)
        assert r.status_code == 400


# ============ POS OFFLINE DEDUPE (client_txn_id) ============
class TestPosOfflineDedupe:
    def test_duplicate_client_txn_id_returns_same_sale(self, cashier, admin):
        pid = pick_product_with_stock(admin, "store_main", 3)
        ctx = str(uuid.uuid4())
        body = {
            "store_id": "store_main", "register_id": "reg_1",
            "items": [{"product_id": pid, "qty": 1}],
            "payments": [{"method": "Cash", "amount": 10000, "reference": ""}],
            "discount_type": "REGULAR", "order_discount": 0,
            "client_txn_id": ctx,
        }
        r1 = cashier.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        assert r1.status_code == 200, r1.text
        s1 = r1.json()
        assert s1["number"].startswith("SALE")

        # Repost the same body
        r2 = cashier.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        assert r2.status_code == 200
        s2 = r2.json()
        assert s2["number"] == s1["number"]
        assert s2.get("id") == s1.get("id")

    def test_online_regular_sale_persists(self, cashier, admin):
        pid = pick_product_with_stock(admin, "store_main", 3)
        body = {
            "store_id": "store_main", "register_id": "reg_1",
            "items": [{"product_id": pid, "qty": 1}],
            "payments": [{"method": "Cash", "amount": 10000, "reference": ""}],
            "discount_type": "REGULAR", "order_discount": 0,
            "client_txn_id": str(uuid.uuid4()),
        }
        r = cashier.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        assert r.status_code == 200
        sale = r.json()
        sid = sale["id"]

        r = cashier.get(f"{BASE}/api/pos/sales", timeout=30)
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert sid in ids
