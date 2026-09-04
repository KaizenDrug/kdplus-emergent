from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import re

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
