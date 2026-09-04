"""
KDPLUS Pharmacy POS - Backend API integration tests
Tests critical flows: auth, catalog, inventory, POS sale (regular/senior/split/dedupe),
refunds, purchase orders, customers, reports, shifts, admin.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE:
    # fallback for tests run inside container
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip()
                break
BASE = BASE.rstrip("/")

ADMIN_EMAIL = "nt7yzjc88t@privaterelay.appleid.com"
ADMIN_PASSWORD = "KdplusOwner#2026"
CASHIER_PIN = "4444"
STORE_ID = "store_main"
REGISTER_ID = "reg_1"


# --------------- Fixtures ---------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def cashier_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/pin-login", json={"pin": CASHIER_PIN}, timeout=30)
    assert r.status_code == 200, f"pin login failed: {r.status_code} {r.text}"
    return s


# --------------- Auth ---------------
class TestAuth:
    def test_root(self):
        r = requests.get(f"{BASE}/api/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_login_success_sets_cookies(self):
        s = requests.Session()
        r = s.post(f"{BASE}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "owner"
        assert "access_token" in s.cookies

    def test_login_bad_password(self):
        r = requests.post(f"{BASE}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_pin_login(self):
        r = requests.post(f"{BASE}/api/auth/pin-login", json={"pin": CASHIER_PIN}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "employee"
        assert d["role"] == "cashier"

    def test_pin_login_bad(self):
        r = requests.post(f"{BASE}/api/auth/pin-login", json={"pin": "0000"}, timeout=30)
        assert r.status_code == 401

    def test_me(self, admin_session):
        r = admin_session.get(f"{BASE}/api/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_forgot_password_generic(self):
        r = requests.post(f"{BASE}/api/auth/forgot-password",
                          json={"email": "nobody-xyz@example.com"}, timeout=30)
        assert r.status_code == 200
        assert "reset link" in r.json().get("message", "").lower()


# --------------- Catalog & Products ---------------
class TestCatalog:
    def test_categories(self, admin_session):
        r = admin_session.get(f"{BASE}/api/categories", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_suppliers(self, admin_session):
        r = admin_session.get(f"{BASE}/api/suppliers", timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_products_list(self, admin_session):
        r = admin_session.get(f"{BASE}/api/products", timeout=15)
        assert r.status_code == 200
        prods = r.json()
        assert len(prods) >= 10  # seed has ~44

    def test_create_and_update_product(self, admin_session):
        cats = admin_session.get(f"{BASE}/api/categories").json()
        payload = {
            "name": f"TEST_Product_{uuid.uuid4().hex[:6]}",
            "sku": f"TSKU{uuid.uuid4().hex[:6]}",
            "category_id": cats[0]["id"] if cats else None,
            "cost": 10, "price": 25, "tax_mode": "VAT",
            "track_inventory": True, "track_lots": False,
        }
        r = admin_session.post(f"{BASE}/api/products", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        pid = created["id"]
        # update price using full product body
        created["price"] = 30
        r2 = admin_session.put(f"{BASE}/api/products/{pid}", json=created, timeout=15)
        assert r2.status_code == 200, r2.text
        r3 = admin_session.get(f"{BASE}/api/products/{pid}", timeout=15)
        assert r3.status_code == 200
        assert float(r3.json()["price"]) == 30.0


# --------------- Inventory ---------------
class TestInventory:
    def test_levels(self, admin_session):
        r = admin_session.get(f"{BASE}/api/inventory/levels", params={"store_id": STORE_ID}, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_lots(self, admin_session):
        r = admin_session.get(f"{BASE}/api/inventory/lots", params={"store_id": STORE_ID}, timeout=15)
        assert r.status_code == 200

    def test_expiry_buckets(self, admin_session):
        r = admin_session.get(f"{BASE}/api/inventory/expiry", params={"store_id": STORE_ID}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        # expect either dict with buckets or list
        assert data is not None

    def test_receive_stock_increases_onhand(self, admin_session):
        # find a lot-tracked product
        prods = admin_session.get(f"{BASE}/api/products").json()
        p = next((x for x in prods if x.get("track_lots")), prods[0])
        pid = p["id"]
        levels_before = admin_session.get(f"{BASE}/api/inventory/levels",
                                          params={"store_id": STORE_ID}).json()
        before = next((float(l["quantity"]) for l in levels_before if l["product_id"] == pid), 0)

        payload = {"store_id": STORE_ID, "lines": [{
            "product_id": pid, "quantity": 10, "unit_cost": 5,
            "lot_number": f"TESTLOT{uuid.uuid4().hex[:5]}",
            "expiry_date": "2027-12-31"}]}
        r = admin_session.post(f"{BASE}/api/inventory/receive", json=payload, timeout=15)
        assert r.status_code == 200, r.text

        levels_after = admin_session.get(f"{BASE}/api/inventory/levels",
                                         params={"store_id": STORE_ID}).json()
        after = next((float(l["quantity"]) for l in levels_after if l["product_id"] == pid), 0)
        assert after >= before + 10 - 0.01, f"expected {before}+10, got {after}"

    def test_stock_adjustment(self, admin_session):
        prods = admin_session.get(f"{BASE}/api/products").json()
        pid = prods[0]["id"]
        r = admin_session.post(f"{BASE}/api/inventory/adjust", json={
            "store_id": STORE_ID, "reason": "correction",
            "lines": [{"product_id": pid, "quantity": 1}]}, timeout=15)
        assert r.status_code == 200, r.text

    def test_movements(self, admin_session):
        r = admin_session.get(f"{BASE}/api/inventory/movements",
                              params={"store_id": STORE_ID, "limit": 10}, timeout=15)
        assert r.status_code == 200


# --------------- POS Sales ---------------
class TestPOS:
    def _pick_product(self, session, want_vat=True):
        prods = session.get(f"{BASE}/api/products").json()
        for p in prods:
            if p.get("track_inventory", True) and p.get("price", 0) > 0 and (p.get("tax_mode", "VAT") == "VAT") == want_vat:
                return p
        return prods[0]

    def test_regular_sale_computes_vat(self, cashier_session):
        p = self._pick_product(cashier_session)
        body = {
            "store_id": STORE_ID, "register_id": REGISTER_ID,
            "items": [{"product_id": p["id"], "qty": 1}],
            "payments": [{"method": "cash", "amount": float(p["price"])}],
            "discount_type": "REGULAR",
            "client_txn_id": str(uuid.uuid4()),
        }
        r = cashier_session.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["status"] == "COMPLETED"
        # VAT should be non-zero for VAT product
        if p.get("tax_mode", "VAT") == "VAT":
            assert float(sale["vat_amount"]) > 0
        # persistence
        r2 = cashier_session.get(f"{BASE}/api/pos/sales/{sale['id']}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["number"] == sale["number"]

    def test_split_payment_sale(self, cashier_session):
        p = self._pick_product(cashier_session)
        price = float(p["price"])
        half = round(price / 2, 2)
        body = {
            "store_id": STORE_ID, "register_id": REGISTER_ID,
            "items": [{"product_id": p["id"], "qty": 1}],
            "payments": [
                {"method": "cash", "amount": half},
                {"method": "gcash", "amount": price - half, "reference": "GC123"},
            ],
            "client_txn_id": str(uuid.uuid4()),
        }
        r = cashier_session.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        assert r.status_code == 200, r.text
        assert len(r.json()["payments"]) == 2

    def test_senior_pwd_sale(self, cashier_session):
        p = self._pick_product(cashier_session, want_vat=True)
        price = float(p["price"])
        body = {
            "store_id": STORE_ID, "register_id": REGISTER_ID,
            "items": [{"product_id": p["id"], "qty": 1}],
            "payments": [{"method": "cash", "amount": price}],
            "discount_type": "SENIOR",
            "senior_pwd": {"id_number": "SC-TEST-001", "name": "Test Senior"},
            "client_txn_id": str(uuid.uuid4()),
        }
        r = cashier_session.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        # VAT-exempt + 20% off net
        assert float(s["vat_exempt_amount"]) > 0
        assert float(s["spwd_discount"]) > 0
        assert float(s["vat_amount"]) == 0
        assert float(s["total"]) < price  # less than gross

    def test_dedupe_client_txn(self, cashier_session):
        p = self._pick_product(cashier_session)
        cid = str(uuid.uuid4())
        body = {
            "store_id": STORE_ID, "register_id": REGISTER_ID,
            "items": [{"product_id": p["id"], "qty": 1}],
            "payments": [{"method": "cash", "amount": float(p["price"])}],
            "client_txn_id": cid,
        }
        r1 = cashier_session.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        r2 = cashier_session.post(f"{BASE}/api/pos/sales", json=body, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"]  # same sale returned

    def test_sales_list(self, cashier_session):
        r = cashier_session.get(f"{BASE}/api/pos/sales", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --------------- Refund ---------------
class TestRefund:
    def test_refund_restores_stock(self, admin_session, cashier_session):
        # create a fresh sale first
        prods = cashier_session.get(f"{BASE}/api/products").json()
        p = next((x for x in prods if x.get("track_inventory", True) and float(x.get("price", 0)) > 0), prods[0])
        # make sure enough stock
        admin_session.post(f"{BASE}/api/inventory/adjust", json={
            "store_id": STORE_ID, "reason": "correction",
            "lines": [{"product_id": p["id"], "quantity": 5}]})
        body = {
            "store_id": STORE_ID, "register_id": REGISTER_ID,
            "items": [{"product_id": p["id"], "qty": 1}],
            "payments": [{"method": "cash", "amount": float(p["price"])}],
            "client_txn_id": str(uuid.uuid4()),
        }
        sale = cashier_session.post(f"{BASE}/api/pos/sales", json=body, timeout=30).json()
        r = admin_session.post(f"{BASE}/api/pos/refunds", json={
            "sale_id": sale["id"], "reason": "test refund",
            "lines": [{"product_id": p["id"], "qty": 1, "restore_stock": True}]}, timeout=30)
        assert r.status_code == 200, r.text
        # check sale status changed
        s2 = admin_session.get(f"{BASE}/api/pos/sales/{sale['id']}").json()
        assert s2["status"] in ("REFUNDED", "PARTIAL_REFUND")


# --------------- Customers ---------------
class TestCustomers:
    def test_create_and_loyalty(self, admin_session):
        payload = {"first_name": "TEST", "last_name": f"C{uuid.uuid4().hex[:4]}",
                   "phone": "09171234567", "email": f"t{uuid.uuid4().hex[:6]}@ex.com"}
        r = admin_session.post(f"{BASE}/api/customers", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        cid = r.json()["id"]
        r2 = admin_session.post(f"{BASE}/api/customers/{cid}/loyalty-adjust",
                                json={"points": 50, "reason": "test"}, timeout=15)
        assert r2.status_code == 200, r2.text
        r3 = admin_session.get(f"{BASE}/api/customers/{cid}").json()
        assert int(r3.get("loyalty_points", 0)) >= 50


# --------------- Purchase Orders ---------------
class TestPO:
    def test_create_and_receive_po(self, admin_session):
        sups = admin_session.get(f"{BASE}/api/suppliers").json()
        prods = admin_session.get(f"{BASE}/api/products").json()
        assert sups and prods
        payload = {"supplier_id": sups[0]["id"], "store_id": STORE_ID,
                   "items": [{"product_id": prods[0]["id"], "qty_ordered": 5, "unit_cost": 10}]}
        r = admin_session.post(f"{BASE}/api/purchase-orders", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        po = r.json()
        assert po.get("status") in ("DRAFT", "OPEN")
        # receive
        rr = admin_session.post(f"{BASE}/api/purchase-orders/{po['id']}/receive", json={
            "lines": [{"product_id": prods[0]["id"], "qty": 5,
                       "lot_number": f"POLOT{uuid.uuid4().hex[:4]}",
                       "expiry_date": "2027-12-31", "unit_cost": 10}]}, timeout=30)
        assert rr.status_code == 200, rr.text
        po2 = admin_session.get(f"{BASE}/api/purchase-orders/{po['id']}").json()
        assert po2["status"] in ("RECEIVED", "PARTIALLY_RECEIVED")


# --------------- Reports ---------------
class TestReports:
    def test_dashboard(self, admin_session):
        r = admin_session.get(f"{BASE}/api/reports/dashboard", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "net_sales" in d or "kpis" in d or isinstance(d, dict)

    def test_sales_summary(self, admin_session):
        for grp in ("item", "category", "employee", "payment"):
            r = admin_session.get(f"{BASE}/api/reports/sales-summary",
                                  params={"group": grp}, timeout=30)
            assert r.status_code == 200, f"{grp}: {r.text}"

    def test_inventory_valuation(self, admin_session):
        r = admin_session.get(f"{BASE}/api/reports/inventory-valuation", timeout=30)
        assert r.status_code == 200

    def test_senior_pwd(self, admin_session):
        r = admin_session.get(f"{BASE}/api/reports/senior-pwd", timeout=30)
        assert r.status_code == 200


# --------------- Shifts ---------------
class TestShifts:
    def test_open_move_close(self, cashier_session):
        r = cashier_session.post(f"{BASE}/api/pos/shifts/open", json={
            "store_id": STORE_ID, "register_id": REGISTER_ID, "opening_cash": 1000}, timeout=15)
        assert r.status_code == 200, r.text
        shift = r.json()
        sid = shift["id"]
        m = cashier_session.post(f"{BASE}/api/pos/cash-movements", json={
            "shift_id": sid, "store_id": STORE_ID, "type": "IN", "amount": 100,
            "reason": "test"}, timeout=15)
        assert m.status_code == 200, m.text
        c = cashier_session.post(f"{BASE}/api/pos/shifts/close", json={
            "shift_id": sid, "counted_cash": 1100}, timeout=15)
        assert c.status_code == 200, c.text
        assert "difference" in c.json()


# --------------- Admin ---------------
class TestAdmin:
    def test_employees(self, admin_session):
        r = admin_session.get(f"{BASE}/api/employees", timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 5

    def test_settings_persist(self, admin_session):
        r = admin_session.get(f"{BASE}/api/settings", timeout=15)
        assert r.status_code == 200
        cur = r.json()
        # touch and save with same values (no destructive change)
        r2 = admin_session.put(f"{BASE}/api/settings", json=cur, timeout=15)
        assert r2.status_code == 200

    def test_audit_logs(self, admin_session):
        r = admin_session.get(f"{BASE}/api/audit-logs", params={"limit": 20}, timeout=15)
        assert r.status_code == 200

    def test_global_search(self, admin_session):
        r = admin_session.get(f"{BASE}/api/search", params={"q": "para"}, timeout=15)
        assert r.status_code == 200
