"""Regression tests for complete product CSV import and export."""
import csv
import io
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "kdplus_test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import core  # noqa: E402
import inventory_lib  # noqa: E402
import routes_catalog  # noqa: E402


MANAGER = {"id": "manager", "name": "Manager", "permissions": ["*"]}


@pytest_asyncio.fixture
async def catalog_db(monkeypatch):
    database = AsyncMongoMockClient()["kdplus_test"]
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(routes_catalog, "db", database)
    monkeypatch.setattr(inventory_lib, "db", database)
    await database.categories.insert_one({"id": "cat1", "org_id": core.ORG_ID, "name": "Antibiotics"})
    await database.suppliers.insert_one({"id": "sup1", "org_id": core.ORG_ID, "company": "Test Supplier"})
    return database


FULL_CSV = (
    "name,generic_name,brand,description,category,subcategory,manufacturer,supplier,preferred_supplier,"
    "sku,barcode,image_url,uom,purchase_uom,conversion_factor,strength,dosage_form,pack_size,"
    "rx_classification,drug_classification,therapeutic_category,storage,refrigerated,controlled,"
    "fda_reg_no,acquisition_cost,average_cost,latest_cost,price,wholesale_price,discount_eligible,"
    "stock,reorder_level,reorder_qty,max_stock,track_inventory,track_lots,track_expiry,tax_mode,"
    "vat_inclusive,shelf_code,active,batch,expiry\n"
    "Amoxicillin 500mg,Amoxicillin,TestBrand,Antibiotic,Antibiotics,Penicillins,Test Maker,"
    "Test Supplier,Test Supplier,AMOX-500,480000000001,,capsule,box,100,500mg,Capsule,100 capsules,"
    "RX,Prescription Drug,Antibacterial,Store below 30C,false,false,FDA-123,4.25,4.50,4.75,8.00,"
    "7.50,true,25,10,50,200,true,true,true,EXEMPT,true,A1,true,LOT-A,2028-12-31\n"
)


@pytest.mark.asyncio
async def test_complete_template_and_round_trip(catalog_db):
    template = await routes_catalog.import_template(principal=MANAGER)
    header = next(csv.reader(io.StringIO(template["template"])))
    for field in routes_catalog.IMPORT_FIELDS:
        assert field in header

    validation = await routes_catalog.import_validate(
        routes_catalog.ImportIn(csv=FULL_CSV), principal=MANAGER,
    )
    assert validation["summary"] == {"new": 1, "duplicate": 0, "error": 0, "total": 1}

    result = await routes_catalog.import_commit(
        routes_catalog.ImportIn(csv=FULL_CSV, store_id="store_main"), principal=MANAGER,
    )
    assert result == {"created": 1, "updated": 0, "skipped": 0, "errors": 0}

    product = await catalog_db.products.find_one({"sku": "AMOX-500"}, {"_id": 0})
    assert product["strength"] == "500mg"
    assert product["dosage_form"] == "Capsule"
    assert product["rx_classification"] == "RX"
    assert product["tax_mode"] == "EXEMPT"
    assert product["reorder_level"] == 10
    assert product["reorder_qty"] == 50
    assert product["track_inventory"] is True
    assert product["track_lots"] is True
    assert product["track_expiry"] is True
    assert product["discount_eligible"] is True

    level = await catalog_db.inventory_levels.find_one({"product_id": product["id"]})
    assert level["quantity"] == 25

    exported = await routes_catalog.export_products(principal=MANAGER)
    exported_row = next(csv.DictReader(io.StringIO(exported["csv"])))
    assert exported["count"] == 1
    assert exported_row["strength"] == "500mg"
    assert exported_row["rx_classification"] == "RX"
    assert exported_row["track_lots"] == "true"
    assert exported_row["stock"] == "25.0"


@pytest.mark.asyncio
async def test_legacy_cost_header_remains_supported(catalog_db):
    rows = routes_catalog.parse_import_csv("name,cost,price\nLegacy Product,3.50,5.00\n")
    preview, summary = await routes_catalog._validate_rows(rows)
    assert summary["new"] == 1
    assert preview[0]["acquisition_cost"] == 3.5
    assert preview[0]["average_cost"] == 3.5


@pytest.mark.asyncio
async def test_import_can_overwrite_duplicate_product_without_changing_stock(catalog_db):
    await routes_catalog.import_commit(
        routes_catalog.ImportIn(csv=FULL_CSV, store_id="store_main"), principal=MANAGER,
    )
    changed = FULL_CSV.replace("8.00,7.50,true,25", "9.25,8.50,true,999")

    result = await routes_catalog.import_commit(
        routes_catalog.ImportIn(csv=changed, overwrite_duplicates=True, store_id="store_main"),
        principal=MANAGER,
    )

    assert result == {"created": 0, "updated": 1, "skipped": 0, "errors": 0}
    assert await catalog_db.products.count_documents({"sku": "AMOX-500"}) == 1
    product = await catalog_db.products.find_one({"sku": "AMOX-500"}, {"_id": 0})
    assert product["price"] == 9.25
    level = await catalog_db.inventory_levels.find_one({"product_id": product["id"]})
    assert level["quantity"] == 25


@pytest.mark.asyncio
async def test_new_product_gets_automatic_unique_sku(catalog_db):
    payload = routes_catalog.ProductIn(name="Automatic SKU Product", price=10)
    created = await routes_catalog.create_product(payload, principal=MANAGER)

    assert created["sku"].startswith("SKU-")
    assert await catalog_db.products.count_documents({"sku": created["sku"]}) == 1

    with pytest.raises(routes_catalog.HTTPException, match="SKU already exists"):
        await routes_catalog.create_product(
            routes_catalog.ProductIn(name="Duplicate SKU", sku=created["sku"], price=10),
            principal=MANAGER,
        )


def test_product_search_splits_abbreviated_words_into_terms():
    clauses = routes_catalog.product_search_clauses("ab bin")

    assert len(clauses) == 2
    assert clauses[0]["$or"][0]["name"]["$regex"] == "ab"
    assert clauses[1]["$or"][0]["name"]["$regex"] == "bin"


@pytest.mark.asyncio
async def test_ab_bin_finds_abdominal_binder(catalog_db):
    await catalog_db.products.insert_one({
        "id": "binder", "org_id": core.ORG_ID, "name": "Abdominal Binder",
        "generic_name": "", "brand": "", "sku": "MED-001", "barcode": "",
    })

    results = await routes_catalog.list_products(q="ab bin", principal=MANAGER)

    assert [product["id"] for product in results] == ["binder"]
