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
IMPORT_TEMPLATE = ("name,generic_name,brand,sku,barcode,category,cost,price,stock,reorder_level,supplier,batch,expiry\n"
                   "Paracetamol 500mg Tablet,Paracetamol,Biogesic,SKU12345,4801234567890,Pain & Fever,2.10,4.50,100,20,Zuellig Pharma Corp.,LOT-0001,2027-06-30\n")


def _norm_key(k):
    return (k or "").strip().lower().replace(" ", "_")

ALIASES = {
    "generic": "generic_name", "reorder_point": "reorder_level", "reorder": "reorder_level",
    "lot": "batch", "expiry_date": "expiry", "selling_price": "price", "cost_price": "cost",
}

def parse_import_csv(text: str):
    text = (text or "").lstrip("\ufeff")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for raw in reader:
        row = {}
        for k, v in raw.items():
            key = _norm_key(k)
            key = ALIASES.get(key, key)
            row[key] = (v or "").strip()
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
        def num(field):
            v = r.get(field, "").replace(",", "").strip()
            if v == "":
                return 0.0, True
            try:
                return float(v), True
            except ValueError:
                messages.append(f"Invalid {field}: '{v}'")
                return 0.0, False
        cost, _ = num("cost")
        price, _ = num("price")
        stock, _ = num("stock")
        reorder, _ = num("reorder_level")
        cat_name = r.get("category", "").strip()
        cat_id = cat_by_name.get(cat_name.lower()) if cat_name else None
        if cat_name and not cat_id:
            messages.append(f"Category '{cat_name}' not found (left blank)")
        sup_name = r.get("supplier", "").strip()
        sup_id = sup_by_name.get(sup_name.lower()) if sup_name else None
        if sup_name and not sup_id:
            messages.append(f"Supplier '{sup_name}' not found (left blank)")

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
        out.append({"name": name, "generic_name": r.get("generic_name", ""), "brand": r.get("brand", ""),
                    "sku": sku, "barcode": bc, "category": cat_name, "category_id": cat_id,
                    "supplier": sup_name, "supplier_id": sup_id, "cost": cost, "price": price,
                    "stock": stock, "reorder_level": reorder, "batch": r.get("batch", ""),
                    "expiry": r.get("expiry", ""), "status": status, "messages": messages})
    counts["total"] = len(out)
    return out, counts


class ImportIn(BaseModel):
    csv: str
    skip_duplicates: bool = True
    store_id: str = "store_main"

@router.get("/products/import/template")
async def import_template(principal=Depends(get_current_principal)):
    return {"template": IMPORT_TEMPLATE}

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
    preview, _ = await _validate_rows(rows)
    created = skipped = errors = 0
    for r in preview:
        if r["status"] == "error":
            errors += 1
            continue
        if r["status"] == "duplicate" and body.skip_duplicates:
            skipped += 1
            continue
        data = {
            "id": uid(), "org_id": ORG_ID, "name": r["name"], "generic_name": r["generic_name"],
            "brand": r["brand"], "description": "", "category_id": r["category_id"], "subcategory": "",
            "manufacturer": r["brand"], "supplier_id": r["supplier_id"], "sku": r["sku"], "barcode": r["barcode"],
            "image_url": "", "uom": "piece", "purchase_uom": "box", "conversion_factor": 1,
            "strength": "", "dosage_form": "", "pack_size": "", "rx_classification": "OTC",
            "drug_classification": "", "therapeutic_category": "", "storage": "", "refrigerated": False,
            "controlled": False, "fda_reg_no": "", "acquisition_cost": r["cost"], "average_cost": r["cost"],
            "latest_cost": r["cost"], "price": r["price"], "wholesale_price": 0,
            "track_inventory": True, "reorder_level": r["reorder_level"], "reorder_qty": 50, "max_stock": 0,
            "preferred_supplier_id": r["supplier_id"], "track_lots": True, "track_expiry": True,
            "tax_mode": "VAT", "vat_inclusive": True, "shelf_code": "", "active": True,
            "created_at": now_iso(), "updated_at": now_iso(),
        }
        data = compute_margins(data)
        await db.products.insert_one(dict(data))
        if r["stock"] and r["stock"] > 0:
            lot_id = uid()
            await db.inventory_lots.insert_one({"id": lot_id, "org_id": ORG_ID, "store_id": body.store_id,
                "product_id": data["id"], "lot_number": r["batch"] or "IMPORT",
                "expiry_date": r["expiry"] or None, "quantity": m(r["stock"]), "unit_cost": m(r["cost"]),
                "supplier_id": r["supplier_id"], "status": "ACTIVE", "received_date": now_iso(), "created_at": now_iso()})
            await record_movement(body.store_id, data["id"], "INITIAL_BALANCE", r["stock"],
                                  unit_cost=r["cost"], lot_id=lot_id, reference="CSV_IMPORT", principal=principal)
        created += 1
    await audit(principal, "data.import", "product", after={"created": created, "skipped": skipped, "errors": errors})
    return {"created": created, "skipped": skipped, "errors": errors}
