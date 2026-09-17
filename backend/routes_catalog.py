from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import re
import csv
import io

from core import (db, ORG_ID, uid, now_iso, m, D, get_current_principal, require_perm, audit)

router = APIRouter(prefix="/api", tags=["catalog"])


# ---------------- Categories ----------------
class CategoryIn(BaseModel):
    name: str
    shelf_code: Optional[str] = ""
    display_order: int = 0
    active: bool = True

@router.get("/categories")
async def list_categories(principal=Depends(get_current_principal)):
    return await db.categories.find({"org_id": ORG_ID}, {"_id": 0}).sort("display_order", 1).to_list(500)

@router.post("/categories")
async def create_category(body: CategoryIn, principal=Depends(require_perm("*"))):
    doc = {"id": uid(), "org_id": ORG_ID, **body.model_dump(), "created_at": now_iso()}
    await db.categories.insert_one(doc)
    await audit(principal, "category.created", "category", doc["id"], after=body.model_dump())
    doc.pop("_id", None)
    return doc

@router.put("/categories/{cid}")
async def update_category(cid: str, body: CategoryIn, principal=Depends(require_perm("*"))):
    await db.categories.update_one({"id": cid, "org_id": ORG_ID}, {"$set": body.model_dump()})
    await audit(principal, "category.updated", "category", cid, after=body.model_dump())
    return await db.categories.find_one({"id": cid}, {"_id": 0})

@router.delete("/categories/{cid}")
async def delete_category(cid: str, principal=Depends(require_perm("*"))):
    cat = await db.categories.find_one({"id": cid, "org_id": ORG_ID}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    in_use = await db.products.count_documents({"org_id": ORG_ID, "category_id": cid})
    if in_use:
        raise HTTPException(status_code=400,
                            detail=f"Cannot delete — {in_use} product(s) use this category. Reassign them first.")
    await db.categories.delete_one({"id": cid, "org_id": ORG_ID})
    await audit(principal, "category.deleted", "category", cid, before={"name": cat.get("name")})
    return {"ok": True}


# ---------------- Suppliers ----------------
class SupplierIn(BaseModel):
    company: str
    contact_person: Optional[str] = ""
    address: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    tin: Optional[str] = ""
    payment_terms: Optional[str] = ""
    notes: Optional[str] = ""
    active: bool = True

@router.get("/suppliers")
async def list_suppliers(principal=Depends(get_current_principal)):
    return await db.suppliers.find({"org_id": ORG_ID}, {"_id": 0}).sort("company", 1).to_list(500)

@router.post("/suppliers")
async def create_supplier(body: SupplierIn, principal=Depends(require_perm("*"))):
    doc = {"id": uid(), "org_id": ORG_ID, **body.model_dump(), "created_at": now_iso()}
    await db.suppliers.insert_one(doc)
    await audit(principal, "supplier.created", "supplier", doc["id"], after=body.model_dump())
    doc.pop("_id", None)
    return doc

@router.put("/suppliers/{sid}")
async def update_supplier(sid: str, body: SupplierIn, principal=Depends(require_perm("*"))):
    await db.suppliers.update_one({"id": sid, "org_id": ORG_ID}, {"$set": body.model_dump()})
    await audit(principal, "supplier.updated", "supplier", sid, after=body.model_dump())
    return await db.suppliers.find_one({"id": sid}, {"_id": 0})


# ---------------- Products ----------------
class ProductIn(BaseModel):
    name: str
    generic_name: Optional[str] = ""
    brand: Optional[str] = ""
    description: Optional[str] = ""
    category_id: Optional[str] = None
    subcategory: Optional[str] = ""
    manufacturer: Optional[str] = ""
    supplier_id: Optional[str] = None
    sku: Optional[str] = ""
    barcode: Optional[str] = ""
    image_url: Optional[str] = ""
    uom: str = "piece"
    purchase_uom: Optional[str] = "box"
    conversion_factor: float = 1
    # pharmacy
    strength: Optional[str] = ""
    dosage_form: Optional[str] = ""
    pack_size: Optional[str] = ""
    rx_classification: str = "OTC"       # OTC / RX
    drug_classification: Optional[str] = ""
    therapeutic_category: Optional[str] = ""
    storage: Optional[str] = ""
    refrigerated: bool = False
    controlled: bool = False
    fda_reg_no: Optional[str] = ""
    # pricing
    acquisition_cost: float = 0
    average_cost: float = 0
    latest_cost: float = 0
    price: float = 0
    wholesale_price: float = 0
    # Whether this product is normally eligible for statutory/customer discounts.
    # Cashiers may still confirm eligibility per sale; legacy products default to eligible.
    discount_eligible: bool = True
    # inventory
    track_inventory: bool = True
    reorder_level: float = 10
    reorder_qty: float = 50
    max_stock: float = 0
    preferred_supplier_id: Optional[str] = None
    track_lots: bool = True
    track_expiry: bool = True
    # tax / shelf
    tax_mode: str = "VAT"                 # VAT / EXEMPT / ZERO
    vat_inclusive: bool = True
    shelf_code: Optional[str] = ""
    active: bool = True


def compute_margins(p: dict) -> dict:
    cost = D(p.get("average_cost") or p.get("acquisition_cost") or 0)
    price = D(p.get("price") or 0)
    if cost > 0:
        p["markup_pct"] = m((price - cost) / cost * 100)
    else:
        p["markup_pct"] = 0
    if price > 0:
        p["margin_pct"] = m((price - cost) / price * 100)
    else:
        p["margin_pct"] = 0
    return p


@router.get("/products")
async def list_products(principal=Depends(get_current_principal),
                        q: Optional[str] = None, category_id: Optional[str] = None,
                        active: Optional[bool] = None, limit: int = 500):
    query = {"org_id": ORG_ID}
    if category_id:
        query["category_id"] = category_id
    if active is not None:
        query["active"] = active
    if q:
        rx = re.escape(q)
        query["$or"] = [
            {"name": {"$regex": rx, "$options": "i"}},
            {"generic_name": {"$regex": rx, "$options": "i"}},
            {"brand": {"$regex": rx, "$options": "i"}},
            {"sku": {"$regex": rx, "$options": "i"}},
            {"barcode": {"$regex": rx, "$options": "i"}},
            {"manufacturer": {"$regex": rx, "$options": "i"}},
        ]
    return await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(limit)


@router.get("/products/{pid}")
async def get_product(pid: str, principal=Depends(get_current_principal)):
    p = await db.products.find_one({"id": pid, "org_id": ORG_ID}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return p


@router.post("/products")
async def create_product(body: ProductIn, principal=Depends(require_perm("*"))):
    data = body.model_dump()
    if not data.get("average_cost"):
        data["average_cost"] = data.get("acquisition_cost", 0)
    data = compute_margins(data)
    doc = {"id": uid(), "org_id": ORG_ID, **data, "created_at": now_iso(), "updated_at": now_iso()}
    await db.products.insert_one(doc)
    await audit(principal, "item.created", "product", doc["id"], after={"name": data["name"], "price": data["price"]})
    doc.pop("_id", None)
    return doc


@router.put("/products/{pid}")
async def update_product(pid: str, body: ProductIn, principal=Depends(require_perm("*"))):
    old = await db.products.find_one({"id": pid, "org_id": ORG_ID}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Product not found")
    data = compute_margins(body.model_dump())
    data["updated_at"] = now_iso()
    if D(old.get("price")) != D(data.get("price")):
        await db.price_history.insert_one({
            "id": uid(), "org_id": ORG_ID, "product_id": pid, "old_price": old.get("price"),
            "new_price": data["price"], "change_pct": m(((D(data["price"]) - D(old.get("price"))) / D(old.get("price") or 1)) * 100),
            "user_id": principal.get("id"), "user_name": principal.get("name"), "created_at": now_iso()})
    await db.products.update_one({"id": pid}, {"$set": data})
    await audit(principal, "item.updated", "product", pid, before={"price": old.get("price")}, after={"price": data.get("price")})
    return await db.products.find_one({"id": pid}, {"_id": 0})


class BulkPriceIn(BaseModel):
    product_ids: List[str]
    percent: float

@router.post("/products/bulk-price")
async def bulk_price(body: BulkPriceIn, principal=Depends(require_perm("*"))):
    factor = D(1) + D(body.percent) / D(100)
    updated = 0
    for pid in body.product_ids:
        p = await db.products.find_one({"id": pid, "org_id": ORG_ID})
        if not p:
            continue
        new_price = m(D(p.get("price", 0)) * factor)
        await db.products.update_one({"id": pid}, {"$set": {"price": new_price, "updated_at": now_iso()}})
        updated += 1
    await audit(principal, "item.bulk_price", "product", after={"count": updated, "percent": body.percent})
    return {"updated": updated}


@router.get("/price-history/{pid}")
async def price_history(pid: str, principal=Depends(get_current_principal)):
    return await db.price_history.find({"product_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(100)


# ---------------- CSV Product Import ----------------
IMPORT_FIELDS = (
    "name", "generic_name", "brand", "description", "category", "subcategory",
    "manufacturer", "supplier", "preferred_supplier", "sku", "barcode", "image_url",
    "uom", "purchase_uom", "conversion_factor", "strength", "dosage_form", "pack_size",
    "rx_classification", "drug_classification", "therapeutic_category", "storage",
    "refrigerated", "controlled", "fda_reg_no", "acquisition_cost", "average_cost",
    "latest_cost", "price", "wholesale_price", "discount_eligible", "stock",
    "reorder_level", "reorder_qty", "max_stock", "track_inventory", "track_lots",
    "track_expiry", "tax_mode", "vat_inclusive", "shelf_code", "active", "batch", "expiry",
)


def _csv_text(rows):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=IMPORT_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


IMPORT_TEMPLATE = _csv_text([{
    "name": "Paracetamol 500mg Tablet", "generic_name": "Paracetamol", "brand": "Biogesic",
    "description": "Analgesic and antipyretic", "category": "Pain & Fever",
    "manufacturer": "Unilab", "supplier": "Zuellig Pharma Corp.",
    "preferred_supplier": "Zuellig Pharma Corp.", "sku": "SKU12345", "barcode": "4801234567890",
    "uom": "piece", "purchase_uom": "box", "conversion_factor": 100, "strength": "500mg",
    "dosage_form": "Tablet", "pack_size": "100 tablets", "rx_classification": "OTC",
    "therapeutic_category": "Pain & Fever", "storage": "Store below 30°C", "refrigerated": "false",
    "controlled": "false", "acquisition_cost": "2.10", "average_cost": "2.10",
    "latest_cost": "2.10", "price": "4.50", "wholesale_price": "0",
    "discount_eligible": "true", "stock": 100, "reorder_level": 20, "reorder_qty": 100,
    "max_stock": 500, "track_inventory": "true", "track_lots": "true", "track_expiry": "true",
    "tax_mode": "VAT", "vat_inclusive": "true", "shelf_code": "D1", "active": "true",
    "batch": "LOT-0001", "expiry": "2027-06-30",
}])


def _norm_key(k):
    return (k or "").strip().lower().replace(" ", "_")

ALIASES = {
    "generic": "generic_name", "reorder_point": "reorder_level", "reorder": "reorder_level",
    "lot": "batch", "lot_number": "batch", "expiry_date": "expiry", "selling_price": "price",
    "cost": "acquisition_cost", "cost_price": "acquisition_cost", "rx_class": "rx_classification",
    "category_name": "category", "supplier_name": "supplier",
}

TRUE_VALUES = {"true", "yes", "y", "1", "on"}
FALSE_VALUES = {"false", "no", "n", "0", "off"}

def parse_import_csv(text: str):
    text = (text or "").lstrip("\ufeff")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for raw in reader:
        row = {}
        for k, v in raw.items():
            key = _norm_key(k)
            key = ALIASES.get(key, key)
            row[key] = (v or "").strip() if not isinstance(v, list) else ""
        if any(row.values()):
            rows.append(row)
    return rows


async def _lookup_maps():
    cats = await db.categories.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)
    sups = await db.suppliers.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)
    cat_by_name = {c["name"].lower(): c["id"] for c in cats}
    sup_by_name = {s["company"].lower(): s["id"] for s in sups}
    return cat_by_name, sup_by_name


async def _validate_rows(rows):
    cat_by_name, sup_by_name = await _lookup_maps()
    existing = await db.products.find({"org_id": ORG_ID},
                                      {"_id": 0, "name": 1, "sku": 1, "barcode": 1}).to_list(5000)
    by_sku = {p["sku"].lower(): p for p in existing if p.get("sku")}
    by_bc = {p["barcode"]: p for p in existing if p.get("barcode")}
    by_name = {p["name"].lower(): p for p in existing if p.get("name")}
    out = []
    counts = {"new": 0, "duplicate": 0, "error": 0}
    seen = set()
    for r in rows:
        messages = []
        name = r.get("name", "").strip()
        if not name:
            messages.append("Missing product name")
        def num(field, default=0.0):
            v = r.get(field, "").replace(",", "").strip()
            if v == "":
                return default, True
            try:
                return float(v), True
            except ValueError:
                messages.append(f"Invalid {field}: '{v}'")
                return default, False
        def boolean(field, default):
            value = r.get(field, "").strip().lower()
            if value == "":
                return default
            if value in TRUE_VALUES:
                return True
            if value in FALSE_VALUES:
                return False
            messages.append(f"Invalid {field}: '{r.get(field)}' (use true/false)")
            return default

        acquisition_cost, _ = num("acquisition_cost")
        average_cost, _ = num("average_cost", acquisition_cost)
        latest_cost, _ = num("latest_cost", acquisition_cost)
        price, _ = num("price")
        wholesale_price, _ = num("wholesale_price")
        stock, _ = num("stock")
        reorder, _ = num("reorder_level")
        reorder_qty, _ = num("reorder_qty", 50)
        max_stock, _ = num("max_stock")
        conversion_factor, _ = num("conversion_factor", 1)
        if conversion_factor <= 0:
            messages.append("Invalid conversion_factor: must be greater than 0")

        rx_classification = (r.get("rx_classification", "") or "OTC").upper()
        if rx_classification not in {"OTC", "RX"}:
            messages.append("Invalid rx_classification: use OTC or RX")
        tax_mode = (r.get("tax_mode", "") or "VAT").upper()
        if tax_mode not in {"VAT", "EXEMPT", "ZERO"}:
            messages.append("Invalid tax_mode: use VAT, EXEMPT or ZERO")

        bools = {field: boolean(field, default) for field, default in {
            "refrigerated": False, "controlled": False, "discount_eligible": True,
            "track_inventory": True, "track_lots": True, "track_expiry": True,
            "vat_inclusive": True, "active": True,
        }.items()}
        cat_name = r.get("category", "").strip()
        cat_id = cat_by_name.get(cat_name.lower()) if cat_name else None
        if cat_name and not cat_id:
            messages.append(f"Category '{cat_name}' not found (left blank)")
        sup_name = r.get("supplier", "").strip()
        sup_id = sup_by_name.get(sup_name.lower()) if sup_name else None
        if sup_name and not sup_id:
            messages.append(f"Supplier '{sup_name}' not found (left blank)")
        pref_name = r.get("preferred_supplier", "").strip() or sup_name
        pref_id = sup_by_name.get(pref_name.lower()) if pref_name else None
        if pref_name and not pref_id and pref_name != sup_name:
            messages.append(f"Preferred supplier '{pref_name}' not found (left blank)")

        dup = False
        sku = r.get("sku", "").strip()
        bc = r.get("barcode", "").strip()
        if (sku and sku.lower() in by_sku) or (bc and bc in by_bc) or (name.lower() in by_name):
            dup = True
        # duplicate within the file itself
        dedupe_key = (sku.lower() or bc or name.lower())
        if dedupe_key in seen:
            dup = True
            messages.append("Duplicate row within file")
        seen.add(dedupe_key)

        status = "error" if any("Missing" in msg or "Invalid" in msg for msg in messages) else ("duplicate" if dup else "new")
        counts[status] += 1
        out.append({
            "name": name, "generic_name": r.get("generic_name", ""), "brand": r.get("brand", ""),
            "description": r.get("description", ""), "category": cat_name, "category_id": cat_id,
            "subcategory": r.get("subcategory", ""), "manufacturer": r.get("manufacturer", ""),
            "supplier": sup_name, "supplier_id": sup_id, "preferred_supplier": pref_name,
            "preferred_supplier_id": pref_id, "sku": sku, "barcode": bc, "image_url": r.get("image_url", ""),
            "uom": r.get("uom", "") or "piece", "purchase_uom": r.get("purchase_uom", "") or "box",
            "conversion_factor": conversion_factor, "strength": r.get("strength", ""),
            "dosage_form": r.get("dosage_form", ""), "pack_size": r.get("pack_size", ""),
            "rx_classification": rx_classification, "drug_classification": r.get("drug_classification", ""),
            "therapeutic_category": r.get("therapeutic_category", ""), "storage": r.get("storage", ""),
            "fda_reg_no": r.get("fda_reg_no", ""), **bools, "acquisition_cost": acquisition_cost,
            "average_cost": average_cost, "latest_cost": latest_cost, "price": price,
            "wholesale_price": wholesale_price, "stock": stock, "reorder_level": reorder,
            "reorder_qty": reorder_qty, "max_stock": max_stock, "tax_mode": tax_mode,
            "shelf_code": r.get("shelf_code", ""), "batch": r.get("batch", ""),
            "expiry": r.get("expiry", ""), "status": status, "messages": messages,
        })
    counts["total"] = len(out)
    return out, counts


class ImportIn(BaseModel):
    csv: str
    skip_duplicates: bool = True
    overwrite_duplicates: bool = False
    store_id: str = "store_main"

@router.get("/products/import/template")
async def import_template(principal=Depends(get_current_principal)):
    return {"template": IMPORT_TEMPLATE}


@router.get("/products/export/csv")
async def export_products(principal=Depends(require_perm("*"))):
    products = await db.products.find({"org_id": ORG_ID}, {"_id": 0}).sort("name", 1).to_list(10000)
    categories = await db.categories.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)
    suppliers = await db.suppliers.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)
    levels = await db.inventory_levels.find({"org_id": ORG_ID}, {"_id": 0}).to_list(50000)
    cat_names = {c["id"]: c["name"] for c in categories}
    sup_names = {s["id"]: s["company"] for s in suppliers}
    stock_by_product = {}
    for level in levels:
        pid = level.get("product_id")
        stock_by_product[pid] = stock_by_product.get(pid, D(0)) + D(level.get("quantity", 0))

    rows = []
    for p in products:
        rows.append({
            "name": p.get("name", ""), "generic_name": p.get("generic_name", ""),
            "brand": p.get("brand", ""), "description": p.get("description", ""),
            "category": cat_names.get(p.get("category_id"), ""), "subcategory": p.get("subcategory", ""),
            "manufacturer": p.get("manufacturer", ""), "supplier": sup_names.get(p.get("supplier_id"), ""),
            "preferred_supplier": sup_names.get(p.get("preferred_supplier_id"), ""),
            "sku": p.get("sku", ""), "barcode": p.get("barcode", ""), "image_url": p.get("image_url", ""),
            "uom": p.get("uom", "piece"), "purchase_uom": p.get("purchase_uom", "box"),
            "conversion_factor": p.get("conversion_factor", 1), "strength": p.get("strength", ""),
            "dosage_form": p.get("dosage_form", ""), "pack_size": p.get("pack_size", ""),
            "rx_classification": p.get("rx_classification", "OTC"),
            "drug_classification": p.get("drug_classification", ""),
            "therapeutic_category": p.get("therapeutic_category", ""), "storage": p.get("storage", ""),
            "refrigerated": str(p.get("refrigerated", False)).lower(),
            "controlled": str(p.get("controlled", False)).lower(), "fda_reg_no": p.get("fda_reg_no", ""),
            "acquisition_cost": p.get("acquisition_cost", 0), "average_cost": p.get("average_cost", 0),
            "latest_cost": p.get("latest_cost", 0), "price": p.get("price", 0),
            "wholesale_price": p.get("wholesale_price", 0),
            "discount_eligible": str(p.get("discount_eligible", True)).lower(),
            "stock": m(stock_by_product.get(p.get("id"), 0)), "reorder_level": p.get("reorder_level", 0),
            "reorder_qty": p.get("reorder_qty", 0), "max_stock": p.get("max_stock", 0),
            "track_inventory": str(p.get("track_inventory", True)).lower(),
            "track_lots": str(p.get("track_lots", True)).lower(),
            "track_expiry": str(p.get("track_expiry", True)).lower(), "tax_mode": p.get("tax_mode", "VAT"),
            "vat_inclusive": str(p.get("vat_inclusive", True)).lower(), "shelf_code": p.get("shelf_code", ""),
            "active": str(p.get("active", True)).lower(), "batch": "", "expiry": "",
        })
    return {"filename": "kdplus-products.csv", "csv": _csv_text(rows), "count": len(rows)}

@router.post("/products/import/validate")
async def import_validate(body: ImportIn, principal=Depends(require_perm("*"))):
    rows = parse_import_csv(body.csv)
    if not rows:
        raise HTTPException(status_code=400, detail="No data rows found. Check the CSV header and format.")
    preview, counts = await _validate_rows(rows)
    return {"rows": preview, "summary": counts}

@router.post("/products/import/commit")
async def import_commit(body: ImportIn, principal=Depends(require_perm("*"))):
    from inventory_lib import record_movement
    rows = parse_import_csv(body.csv)
    if not rows:
        raise HTTPException(status_code=400, detail="No data rows found.")
    # When overwrite is selected, the last occurrence of the same item in the
    # uploaded file wins.  This prevents a repeated row from producing two
    # updates (or a newly-created duplicate).
    if body.overwrite_duplicates:
        latest = {}
        for row in rows:
            key = ((row.get("sku") or "").strip().lower()
                   or (row.get("barcode") or "").strip()
                   or (row.get("name") or "").strip().lower())
            latest[key] = row
        rows = list(latest.values())

    preview, _ = await _validate_rows(rows)
    created = updated = skipped = errors = 0
    for r in preview:
        if r["status"] == "error":
            errors += 1
            continue
        if r["status"] == "duplicate" and not body.overwrite_duplicates and body.skip_duplicates:
            skipped += 1
            continue
        data = {
            "id": uid(), "org_id": ORG_ID, "name": r["name"], "generic_name": r["generic_name"],
            "brand": r["brand"], "description": r["description"], "category_id": r["category_id"],
            "subcategory": r["subcategory"], "manufacturer": r["manufacturer"],
            "supplier_id": r["supplier_id"], "sku": r["sku"], "barcode": r["barcode"],
            "image_url": r["image_url"], "uom": r["uom"], "purchase_uom": r["purchase_uom"],
            "conversion_factor": r["conversion_factor"], "strength": r["strength"],
            "dosage_form": r["dosage_form"], "pack_size": r["pack_size"],
            "rx_classification": r["rx_classification"], "drug_classification": r["drug_classification"],
            "therapeutic_category": r["therapeutic_category"], "storage": r["storage"],
            "refrigerated": r["refrigerated"], "controlled": r["controlled"],
            "fda_reg_no": r["fda_reg_no"], "acquisition_cost": r["acquisition_cost"],
            "average_cost": r["average_cost"], "latest_cost": r["latest_cost"], "price": r["price"],
            "wholesale_price": r["wholesale_price"], "discount_eligible": r["discount_eligible"],
            "track_inventory": r["track_inventory"], "reorder_level": r["reorder_level"],
            "reorder_qty": r["reorder_qty"], "max_stock": r["max_stock"],
            "preferred_supplier_id": r["preferred_supplier_id"], "track_lots": r["track_lots"],
            "track_expiry": r["track_expiry"], "tax_mode": r["tax_mode"],
            "vat_inclusive": r["vat_inclusive"], "shelf_code": r["shelf_code"], "active": r["active"],
            "updated_at": now_iso(),
        }
        data = compute_margins(data)

        if r["status"] == "duplicate" and body.overwrite_duplicates:
            clauses = []
            if r["sku"]:
                clauses.append({"sku": {"$regex": f"^{re.escape(r['sku'])}$", "$options": "i"}})
            if r["barcode"]:
                clauses.append({"barcode": r["barcode"]})
            clauses.append({"name": {"$regex": f"^{re.escape(r['name'])}$", "$options": "i"}})
            existing = await db.products.find_one({"org_id": ORG_ID, "$or": clauses}, {"_id": 0})
            if existing:
                # Product fields are overwritten, while stock remains controlled
                # by inventory movements/counts to preserve the audit trail.
                data.pop("id", None)
                data.pop("org_id", None)
                await db.products.update_one({"id": existing["id"], "org_id": ORG_ID}, {"$set": data})
                await audit(principal, "item.import_updated", "product", existing["id"],
                            before=existing, after=data)
                updated += 1
                continue

        data["created_at"] = now_iso()
        await db.products.insert_one(dict(data))
        if r["stock"] and r["stock"] > 0 and r["track_inventory"]:
            lot_id = None
            if r["track_lots"] or r["track_expiry"]:
                lot_id = uid()
                await db.inventory_lots.insert_one({"id": lot_id, "org_id": ORG_ID, "store_id": body.store_id,
                    "product_id": data["id"], "lot_number": r["batch"] or "IMPORT",
                    "expiry_date": r["expiry"] or None, "quantity": m(r["stock"]),
                    "unit_cost": m(r["acquisition_cost"]), "supplier_id": r["supplier_id"],
                    "status": "ACTIVE", "received_date": now_iso(), "created_at": now_iso()})
            await record_movement(body.store_id, data["id"], "INITIAL_BALANCE", r["stock"],
                                  unit_cost=r["acquisition_cost"], lot_id=lot_id,
                                  reference="CSV_IMPORT", principal=principal)
        created += 1
    await audit(principal, "data.import", "product",
                after={"created": created, "updated": updated, "skipped": skipped, "errors": errors})
    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors}
