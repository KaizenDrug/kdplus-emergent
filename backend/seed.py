import os
import random
from datetime import datetime, timezone, timedelta

from core import db, ORG_ID, uid, now_iso, m, D, hash_secret, verify_secret

random.seed(42)

CATEGORIES = [
    ("A1", "Antibiotics / Antimicrobials"), ("A2", "Cardiovascular"),
    ("A3", "Diabetes & Endocrine"), ("A4", "Neurology / CNS"),
    ("A5", "Hormones / Steroids"), ("A6", "Urinary / Renal"),
    ("B1", "Gastrointestinal"), ("B2", "Cough / Cold / Respiratory"),
    ("B3", "Allergy / Antihistamines"), ("C1", "Dermatology"),
    ("D1", "Pain & Fever"), ("E1", "Vitamins & Supplements"),
    ("E3", "Baby / Pediatric Care"), ("F1", "Medical Supplies / First Aid"),
    ("F2", "Antiseptics / Disinfectants"), ("G1", "General Medicines / Miscellaneous"),
]

# name, generic, brand, cat_code, form, strength, price, cost, rx, tax_mode
PRODUCTS = [
    ("Amoxicillin 500mg Capsule", "Amoxicillin", "Amoxil", "A1", "Capsule", "500mg", 12.50, 7.20, "RX", "VAT"),
    ("Co-Amoxiclav 625mg Tablet", "Amoxicillin+Clavulanic", "Augmentin", "A1", "Tablet", "625mg", 48.00, 31.00, "RX", "VAT"),
    ("Azithromycin 500mg Tablet", "Azithromycin", "Zithromax", "A1", "Tablet", "500mg", 78.00, 52.00, "RX", "VAT"),
    ("Cefuroxime 500mg Tablet", "Cefuroxime", "Zinnat", "A1", "Tablet", "500mg", 62.00, 41.00, "RX", "VAT"),
    ("Ciprofloxacin 500mg Tablet", "Ciprofloxacin", "Ciprobay", "A1", "Tablet", "500mg", 22.00, 13.00, "RX", "VAT"),
    ("Losartan 50mg Tablet", "Losartan", "Cozaar", "A2", "Tablet", "50mg", 9.50, 5.10, "RX", "VAT"),
    ("Amlodipine 5mg Tablet", "Amlodipine", "Norvasc", "A2", "Tablet", "5mg", 8.00, 4.20, "RX", "VAT"),
    ("Atorvastatin 20mg Tablet", "Atorvastatin", "Lipitor", "A2", "Tablet", "20mg", 24.00, 14.00, "RX", "VAT"),
    ("Metoprolol 50mg Tablet", "Metoprolol", "Neobloc", "A2", "Tablet", "50mg", 11.00, 6.30, "RX", "VAT"),
    ("Clopidogrel 75mg Tablet", "Clopidogrel", "Plavix", "A2", "Tablet", "75mg", 39.00, 25.00, "RX", "VAT"),
    ("Metformin 500mg Tablet", "Metformin", "Glucophage", "A3", "Tablet", "500mg", 6.50, 3.10, "RX", "VAT"),
    ("Gliclazide 60mg Tablet", "Gliclazide", "Diamicron", "A3", "Tablet", "60mg", 21.00, 13.00, "RX", "VAT"),
    ("Insulin Glargine Pen", "Insulin Glargine", "Lantus", "A3", "Injection", "100IU/ml", 1250.00, 940.00, "RX", "VAT"),
    ("Gabapentin 300mg Capsule", "Gabapentin", "Neurontin", "A4", "Capsule", "300mg", 28.00, 17.00, "RX", "VAT"),
    ("Citicoline 500mg Tablet", "Citicoline", "Zynapse", "A4", "Tablet", "500mg", 33.00, 21.00, "RX", "VAT"),
    ("Prednisone 20mg Tablet", "Prednisone", "Pred", "A5", "Tablet", "20mg", 7.50, 3.90, "RX", "VAT"),
    ("Omeprazole 20mg Capsule", "Omeprazole", "Losec", "B1", "Capsule", "20mg", 14.00, 7.80, "OTC", "VAT"),
    ("Loperamide 2mg Capsule", "Loperamide", "Imodium", "B1", "Capsule", "2mg", 8.50, 4.20, "OTC", "VAT"),
    ("Domperidone 10mg Tablet", "Domperidone", "Motilium", "B1", "Tablet", "10mg", 12.00, 6.50, "OTC", "VAT"),
    ("Antacid Suspension 120ml", "Aluminum+Magnesium", "Kremil-S", "B1", "Suspension", "120ml", 96.00, 62.00, "OTC", "VAT"),
    ("Salbutamol Inhaler", "Salbutamol", "Ventolin", "B2", "Inhaler", "100mcg", 385.00, 270.00, "OTC", "VAT"),
    ("Carbocisteine 500mg Capsule", "Carbocisteine", "Solmux", "B2", "Capsule", "500mg", 11.00, 6.00, "OTC", "VAT"),
    ("Phenylephrine+Paracetamol", "Phenylephrine+Paracetamol", "Neozep", "B2", "Tablet", "-", 6.00, 3.20, "OTC", "VAT"),
    ("Cetirizine 10mg Tablet", "Cetirizine", "Virlix", "B3", "Tablet", "10mg", 9.00, 4.50, "OTC", "VAT"),
    ("Loratadine 10mg Tablet", "Loratadine", "Claritin", "B3", "Tablet", "10mg", 15.00, 8.20, "OTC", "VAT"),
    ("Hydrocortisone Cream 1%", "Hydrocortisone", "Skincort", "C1", "Cream", "1% 10g", 78.00, 49.00, "OTC", "VAT"),
    ("Clotrimazole Cream 1%", "Clotrimazole", "Canesten", "C1", "Cream", "1% 10g", 120.00, 78.00, "OTC", "VAT"),
    ("Paracetamol 500mg Tablet", "Paracetamol", "Biogesic", "D1", "Tablet", "500mg", 4.50, 2.10, "OTC", "VAT"),
    ("Mefenamic Acid 500mg Capsule", "Mefenamic Acid", "Dolfenal", "D1", "Capsule", "500mg", 9.00, 4.80, "OTC", "VAT"),
    ("Ibuprofen 400mg Tablet", "Ibuprofen", "Advil", "D1", "Tablet", "400mg", 8.00, 4.10, "OTC", "VAT"),
    ("Paracetamol Syrup 120ml", "Paracetamol", "Calpol", "D1", "Syrup", "250mg/5ml", 89.00, 57.00, "OTC", "VAT"),
    ("Ascorbic Acid 500mg Tablet", "Ascorbic Acid", "Poten-Cee", "E1", "Tablet", "500mg", 7.50, 3.90, "OTC", "VAT"),
    ("Multivitamins Tablet", "Multivitamins", "Enervon", "E1", "Tablet", "-", 8.50, 4.30, "OTC", "VAT"),
    ("Ferrous Sulfate+Folic Acid", "Ferrous+Folic", "Ferlin", "E1", "Capsule", "-", 6.50, 3.20, "OTC", "VAT"),
    ("Vitamin D3 1000IU Softgel", "Cholecalciferol", "D-Cee", "E1", "Softgel", "1000IU", 12.00, 6.50, "OTC", "VAT"),
    ("Zinc Syrup 60ml", "Zinc", "Zinctopic", "E3", "Syrup", "60ml", 110.00, 72.00, "OTC", "VAT"),
    ("Oral Rehydration Salts", "ORS", "Hydrite", "E3", "Sachet", "-", 12.00, 6.50, "OTC", "ZERO"),
    ("Digital Thermometer", "-", "Omron", "F1", "Device", "-", 250.00, 160.00, "OTC", "VAT"),
    ("Adhesive Bandage Box", "-", "Band-Aid", "F1", "Box", "100s", 145.00, 95.00, "OTC", "VAT"),
    ("Surgical Face Mask 50s", "-", "MedGuard", "F1", "Box", "50s", 120.00, 70.00, "OTC", "VAT"),
    ("Alcohol 70% 500ml", "Isopropyl Alcohol", "Green Cross", "F2", "Solution", "500ml", 78.00, 48.00, "OTC", "VAT"),
    ("Povidone Iodine 60ml", "Povidone Iodine", "Betadine", "F2", "Solution", "60ml", 95.00, 61.00, "OTC", "VAT"),
    ("Hydrogen Peroxide 120ml", "Hydrogen Peroxide", "Agua Oxinada", "F2", "Solution", "120ml", 35.00, 19.00, "OTC", "VAT"),
    ("Cotton Balls 100s", "-", "Cleene", "G1", "Pack", "100s", 45.00, 26.00, "OTC", "VAT"),
]

SUPPLIERS = [
    ("Zuellig Pharma Corp.", "Maria Santos", "Metro Manila", "02-8888-1000", "sales@zuellig.ph", "000-111-222"),
    ("MedExpress Distribution", "Juan Dela Cruz", "Quezon City", "02-8777-2000", "orders@medexpress.ph", "111-222-333"),
    ("Metro Drug Inc.", "Ana Reyes", "Makati City", "02-8666-3000", "info@metrodrug.ph", "222-333-444"),
    ("Pharma Nutria Supply", "Peter Lim", "Pasig City", "02-8555-4000", "contact@pharmanutria.ph", "333-444-555"),
    ("Wellness General Trading", "Grace Tan", "Mandaluyong", "02-8444-5000", "hello@wellnessgt.ph", "444-555-666"),
]

EMPLOYEES = [
    ("Owner Admin", "owner", "1234"),
    ("Rosa Mendoza", "manager", "2222"),
    ("Liza Cruz", "pharmacist", "3333"),
    ("Mark Villanueva", "cashier", "4444"),
    ("Joy Ramos", "inventory", "5555"),
]

FIRST = ["Jose", "Maria", "Antonio", "Rosa", "Pedro", "Carmen", "Ramon", "Luz", "Nestor", "Elena",
         "Ben", "Grace", "Vic", "Nena", "Ric", "Cora", "Ding", "Baby", "Tito", "Aling"]
LAST = ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Flores", "Ramos",
        "Aquino", "Villanueva", "Castillo", "Navarro", "Salazar", "Delos Reyes", "Panganiban", "Gonzales", "Lim", "Tan"]


async def seed_admin():
    email = os.environ["ADMIN_EMAIL"].lower()
    pw = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({"id": uid(), "org_id": ORG_ID, "email": email,
            "password_hash": hash_secret(pw), "name": "KDPLUS Owner", "role": "owner",
            "token_version": 0, "created_at": now_iso()})
    elif not verify_secret(pw, existing.get("password_hash", "")):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_secret(pw)}})


async def seed_all():
    await seed_admin()
    if await db.settings.find_one({"org_id": ORG_ID}):
        return  # already seeded
    await _seed_settings()
    await _seed_master_and_txn()


async def _seed_settings():
    await db.settings.insert_one({
        "org_id": ORG_ID, "currency": "PHP", "timezone": "Asia/Manila",
        "business": {"name": "KDPLUS Pharmacy", "address": "123 Rizal Ave, Manila",
                     "phone": "02-8123-4567", "tin": "123-456-789-000", "logo_url": "",
                     "receipt_header": "KDPLUS Pharmacy", "receipt_footer": "Get well soon! Thank you for your purchase.",
                     "return_policy": "Returns accepted within 7 days with receipt. No returns on opened medicines."},
        "tax": {"vat_rate": 12, "pricing_mode": "inclusive"},
        "senior_pwd": {"enabled": True, "discount_pct": 20, "vat_exempt": True},
        "loyalty": {"enabled": True, "peso_per_point": 100, "points_per": 1},
        "negative_stock_policy": "WARN",
        "expiry_thresholds": [30, 60, 90, 180],
        "payment_methods": ["Cash", "GCash", "Maya", "Credit Card", "Debit Card", "Bank Transfer"],
        "adjustment_reasons": ["damaged", "expired", "lost", "theft", "breakage", "recalled",
                               "supplier return", "correction", "promotional use", "internal use", "other"],
        "shelf_locations": [{"code": c, "name": n} for c, n in CATEGORIES],
    })


async def _seed_master_and_txn():
    store = {"id": "store_main", "org_id": ORG_ID, "name": "KDPLUS Main Branch",
             "address": "123 Rizal Ave, Manila", "phone": "02-8123-4567", "tin": "123-456-789-000",
             "active": True, "created_at": now_iso()}
    store2 = {"id": "store_annex", "org_id": ORG_ID, "name": "KDPLUS Annex",
              "address": "45 Mabini St, Manila", "phone": "02-8123-9999", "tin": "123-456-789-001",
              "active": True, "created_at": now_iso()}
    await db.stores.insert_many([store, store2])
    await db.registers.insert_many([
        {"id": "reg_1", "org_id": ORG_ID, "store_id": "store_main", "name": "Register 1", "active": True},
        {"id": "reg_2", "org_id": ORG_ID, "store_id": "store_main", "name": "Register 2", "active": True},
        {"id": "reg_3", "org_id": ORG_ID, "store_id": "store_annex", "name": "Annex Register", "active": True},
    ])

    # employees
    emps = []
    for name, role, pin in EMPLOYEES:
        emps.append({"id": uid(), "org_id": ORG_ID, "name": name, "role": role, "email": "",
                     "pin_hash": hash_secret(pin), "store_ids": ["store_main", "store_annex"],
                     "active": True, "token_version": 0, "created_at": now_iso()})
    await db.employees.insert_many(emps)

    # suppliers
    sup_docs = []
    for comp, contact, addr, phone, email, tin in SUPPLIERS:
        sup_docs.append({"id": uid(), "org_id": ORG_ID, "company": comp, "contact_person": contact,
                         "address": addr, "phone": phone, "email": email, "tin": tin,
                         "payment_terms": "30 days", "notes": "", "active": True, "created_at": now_iso()})
    await db.suppliers.insert_many(sup_docs)
    sup_ids = [s["id"] for s in sup_docs]

    # categories
    cat_map = {}
    cat_docs = []
    for i, (code, name) in enumerate(CATEGORIES):
        cid = uid()
        cat_map[code] = cid
        cat_docs.append({"id": cid, "org_id": ORG_ID, "name": name, "shelf_code": code,
                         "display_order": i, "active": True, "created_at": now_iso()})
    await db.categories.insert_many(cat_docs)

    # products + inventory + lots
    prod_docs = []
    lot_docs = []
    level_docs = []
    move_docs = []
    today = datetime.now(timezone.utc).date()
    for name, generic, brand, cat_code, form, strength, price, cost, rx, tax_mode in PRODUCTS:
        pid = uid()
        sup = random.choice(sup_ids)
        markup = round((price - cost) / cost * 100, 2) if cost else 0
        margin = round((price - cost) / price * 100, 2) if price else 0
        prod_docs.append({
            "id": pid, "org_id": ORG_ID, "name": name, "generic_name": generic, "brand": brand,
            "description": f"{generic} {strength}", "category_id": cat_map[cat_code], "subcategory": "",
            "manufacturer": brand, "supplier_id": sup, "sku": f"SKU{random.randint(10000,99999)}",
            "barcode": str(random.randint(4800000000000, 4809999999999)), "image_url": "",
            "uom": "piece", "purchase_uom": "box", "conversion_factor": 100,
            "strength": strength, "dosage_form": form, "pack_size": "100s",
            "rx_classification": rx, "drug_classification": "", "therapeutic_category": "",
            "storage": "Store below 30°C", "refrigerated": "Insulin" in generic, "controlled": False,
            "fda_reg_no": "", "acquisition_cost": cost, "average_cost": cost, "latest_cost": cost,
            "price": price, "wholesale_price": round(price * 0.9, 2), "markup_pct": markup, "margin_pct": margin,
            "track_inventory": True, "reorder_level": 20, "reorder_qty": 100, "max_stock": 500,
            "preferred_supplier_id": sup, "track_lots": True, "track_expiry": True,
            "tax_mode": tax_mode, "vat_inclusive": True, "shelf_code": cat_code, "active": True,
            "created_at": now_iso(), "updated_at": now_iso()})

        # lots: 1-2 per product with varied expiry (some near, some expired)
        n_lots = random.choice([1, 1, 2])
        total_qty = 0
        for li in range(n_lots):
            roll = random.random()
            if roll < 0.10:
                exp = today - timedelta(days=random.randint(5, 60))     # expired
            elif roll < 0.25:
                exp = today + timedelta(days=random.randint(10, 85))    # expiring soon
            else:
                exp = today + timedelta(days=random.randint(200, 700))  # healthy
            qty = random.choice([30, 50, 80, 120, 200])
            total_qty += qty
            lot_id = uid()
            lot_docs.append({"id": lot_id, "org_id": ORG_ID, "store_id": "store_main", "product_id": pid,
                             "lot_number": f"LOT-{random.randint(1000,9999)}", "expiry_date": exp.strftime("%Y-%m-%d"),
                             "quantity": qty, "unit_cost": cost, "supplier_id": sup, "status": "ACTIVE",
                             "received_date": now_iso(), "created_at": now_iso()})
            move_docs.append({"id": uid(), "org_id": ORG_ID, "store_id": "store_main", "product_id": pid,
                              "lot_id": lot_id, "type": "INITIAL_BALANCE", "qty_before": 0, "qty_change": qty,
                              "qty_after": total_qty, "unit_cost": cost, "reference": "SEED", "ref_id": None,
                              "user_id": None, "user_name": "System", "note": "Initial stock", "created_at": now_iso()})
        level_docs.append({"id": uid(), "org_id": ORG_ID, "store_id": "store_main", "product_id": pid,
                           "quantity": total_qty, "updated_at": now_iso()})
        # smaller stock in annex
        annex_qty = random.choice([0, 10, 25, 40])
        level_docs.append({"id": uid(), "org_id": ORG_ID, "store_id": "store_annex", "product_id": pid,
                           "quantity": annex_qty, "updated_at": now_iso()})

    await db.products.insert_many(prod_docs)
    await db.inventory_lots.insert_many(lot_docs)
    await db.inventory_levels.insert_many(level_docs)
    await db.inventory_movements.insert_many(move_docs)

    # customers
    cust_docs = []
    for i in range(20):
        fn = random.choice(FIRST)
        ln = random.choice(LAST)
        spwd = "NONE"
        idn = ""
        if i < 4:
            spwd = "SENIOR"; idn = f"OSCA-{random.randint(10000,99999)}"
        elif i < 6:
            spwd = "PWD"; idn = f"PWD-{random.randint(10000,99999)}"
        cust_docs.append({"id": uid(), "org_id": ORG_ID, "first_name": fn, "last_name": ln,
                          "phone": f"09{random.randint(100000000,999999999)}", "email": "",
                          "address": "Manila", "birthday": None, "notes": "", "allergies": "",
                          "senior_pwd_type": spwd, "id_number": idn, "loyalty_points": random.randint(0, 200),
                          "lifetime_spend": 0, "visit_count": 0, "last_visit": None, "created_at": now_iso()})
    await db.customers.insert_many(cust_docs)

    # demo sales over last 30 days (reporting data)
    vat_rate = D("0.12")
    sale_docs = []
    for i in range(70):
        dt = datetime.now(timezone.utc) - timedelta(days=random.randint(0, 29),
                                                     hours=random.randint(8, 20), minutes=random.randint(0, 59))
        n_items = random.randint(1, 5)
        chosen = random.sample(prod_docs, n_items)
        items = []
        subtotal = D(0); vat_amt = D(0); cost_total = D(0)
        for p in chosen:
            qty = random.randint(1, 4)
            price = D(p["price"]); line = price * qty
            net = line / (D(1) + vat_rate) if p["tax_mode"] == "VAT" else line
            v = line - net if p["tax_mode"] == "VAT" else D(0)
            lc = D(p["average_cost"]) * qty
            subtotal += line; vat_amt += v; cost_total += lc
            items.append({"product_id": p["id"], "name": p["name"], "sku": p["sku"],
                          "generic_name": p["generic_name"], "qty": qty, "unit_price": m(price),
                          "line_discount": 0, "tax_mode": p["tax_mode"], "line_gross": m(line),
                          "line_net": m(line), "vat": m(v), "vat_exempt": 0, "spwd_discount": 0,
                          "unit_cost": p["average_cost"], "line_cost": m(lc),
                          "lot_allocations": [], "refunded_qty": 0, "track_lots": True, "track_inventory": True})
        total = subtotal
        method = random.choice(["Cash", "Cash", "GCash", "Maya", "Credit Card"])
        emp = random.choice(emps)
        cust = random.choice(cust_docs + [None, None, None])
        sale_docs.append({"id": uid(), "number": f"SALE-{dt.strftime('%Y%m%d')}-{i+1:05d}", "org_id": ORG_ID,
            "store_id": random.choice(["store_main", "store_main", "store_annex"]), "register_id": "reg_1",
            "shift_id": None, "cashier_id": emp["id"], "cashier_name": emp["name"],
            "customer_id": (cust["id"] if cust else None),
            "customer_name": (f"{cust['first_name']} {cust['last_name']}" if cust else None),
            "status": "COMPLETED", "items": items, "subtotal": m(subtotal), "order_discount": 0,
            "vat_amount": m(vat_amt), "vat_exempt_amount": 0, "spwd_discount": 0, "discount_type": "REGULAR",
            "senior_pwd": None, "discount_total": 0, "total": m(total), "cost_total": m(cost_total),
            "gross_profit": m(total - cost_total),
            "gross_margin": m((total - cost_total) / total * 100 if total > 0 else 0),
            "payments": [{"method": method, "amount": m(total), "reference": ""}],
            "amount_paid": m(total), "change": 0, "notes": "", "client_txn_id": None,
            "created_at": dt.isoformat()})
    await db.sales.insert_many(sale_docs)

    # a couple of purchase orders
    po_items = [{"product_id": prod_docs[0]["id"], "name": prod_docs[0]["name"], "qty_ordered": 500,
                 "qty_received": 0, "unit_cost": prod_docs[0]["average_cost"]},
                {"product_id": prod_docs[5]["id"], "name": prod_docs[5]["name"], "qty_ordered": 300,
                 "qty_received": 0, "unit_cost": prod_docs[5]["average_cost"]}]
    sub = sum(D(x["qty_ordered"]) * D(x["unit_cost"]) for x in po_items)
    await db.purchase_orders.insert_one({"id": uid(), "number": "PO-SEED-00001", "org_id": ORG_ID,
        "supplier_id": sup_ids[0], "store_id": "store_main", "order_date": now_iso(),
        "expected_date": (today + timedelta(days=7)).strftime("%Y-%m-%d"), "items": po_items,
        "discount": 0, "tax": 0, "shipping": 0, "additional_costs": 0, "subtotal": m(sub),
        "total": m(sub), "status": "SENT", "notes": "Monthly restock", "created_at": now_iso()})

    # notifications for near-expiry
    await db.notifications.insert_one({"id": uid(), "org_id": ORG_ID, "kind": "expiry",
        "title": "Medicines expiring soon", "message": "Several batches expire within 90 days. Review the Expiry Monitor.",
        "severity": "warning", "store_id": "store_main", "ref": None, "read": False, "created_at": now_iso()})


# Collections wiped on a test-database reset. Preserves `users` (Super Admin) and
# `settings` (business/tax config); everything else is cleared and reseeded.
RESET_COLLECTIONS = [
    "products", "categories", "customers", "suppliers", "purchase_orders", "sales",
    "shifts", "inventory_lots", "inventory_levels", "inventory_movements",
    "stock_transfers", "inventory_counts", "prescriptions", "notifications",
    "audit_logs", "counters", "cash_movements", "login_attempts",
    "loyalty_transactions", "price_history", "refunds", "senior_pwd_transactions",
    "password_reset_requests", "password_reset_tokens", "employees", "stores", "registers",
]


async def reset_database():
    """Wipe all transactional & master test data (preserving the Super Admin account
    and business/tax settings) and reseed the default KDPLUS demo dataset."""
    random.seed(42)
    for c in RESET_COLLECTIONS:
        await db[c].delete_many({})
    await _seed_master_and_txn()
