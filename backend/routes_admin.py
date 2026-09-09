from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import re

from core import (db, ORG_ID, uid, now_iso, hash_secret, verify_secret, get_current_principal,
                  require_perm, audit, ROLE_PERMISSIONS)
from seed import reset_database

router = APIRouter(prefix="/api", tags=["admin"])


# ---------------- Danger Zone: reset test database ----------------
class ResetDbIn(BaseModel):
    confirm: str
    password: str

@router.post("/admin/reset-database")
async def reset_test_database(body: ResetDbIn, principal=Depends(get_current_principal)):
    # Super Admin only: email/password Owner or Admin accounts. Staff PIN logins blocked.
    if principal.get("kind") != "user" or principal.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can reset the database")
    if body.confirm.strip() != "RESET DATABASE":
        raise HTTPException(status_code=400, detail="Confirmation phrase does not match. Type RESET DATABASE exactly.")
    user = await db.users.find_one({"id": principal["id"]})
    if not user or not verify_secret(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect password")
    await reset_database()
    await audit(principal, "database.reset", "system", ORG_ID,
                after={"by": principal.get("email"), "role": principal.get("role")})
    return {"ok": True, "message": "Test database reset and reseeded with default demo data."}


# ---------------- Employees ----------------
class EmployeeIn(BaseModel):
    name: str
    role: str = "cashier"
    email: Optional[str] = ""
    pin: Optional[str] = None
    store_ids: List[str] = []
    active: bool = True

@router.get("/employees")
async def list_employees(principal=Depends(require_perm("*"))):
    emps = await db.employees.find({"org_id": ORG_ID}, {"_id": 0, "pin_hash": 0}).to_list(500)
    return emps

@router.get("/employees/pin-list")
async def pin_list(principal=None):
    # public list for the PIN login screen (names + roles only, no PINs)
    emps = await db.employees.find({"org_id": ORG_ID, "active": True}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
    return emps

@router.post("/employees")
async def create_employee(body: EmployeeIn, principal=Depends(require_perm("*"))):
    doc = {"id": uid(), "org_id": ORG_ID, "name": body.name, "role": body.role,
           "email": body.email, "store_ids": body.store_ids, "active": body.active,
           "token_version": 0, "created_at": now_iso()}
    if body.pin:
        doc["pin_hash"] = hash_secret(body.pin)
    await db.employees.insert_one(doc)
    await audit(principal, "employee.created", "employee", doc["id"], after={"name": body.name, "role": body.role})
    return {"id": doc["id"], "name": body.name, "role": body.role, "active": body.active, "store_ids": body.store_ids}

@router.put("/employees/{eid}")
async def update_employee(eid: str, body: EmployeeIn, principal=Depends(require_perm("*"))):
    upd = {"name": body.name, "role": body.role, "email": body.email,
           "store_ids": body.store_ids, "active": body.active}
    if body.pin:
        upd["pin_hash"] = hash_secret(body.pin)
    await db.employees.update_one({"id": eid, "org_id": ORG_ID}, {"$set": upd})
    await audit(principal, "employee.updated", "employee", eid, after={"role": body.role})
    return {"id": eid, **{k: v for k, v in upd.items() if k != "pin_hash"}}

@router.get("/roles")
async def roles(principal=Depends(get_current_principal)):
    return [{"role": k, "permissions": v} for k, v in ROLE_PERMISSIONS.items()]


# ---------------- Settings ----------------
@router.get("/settings")
async def get_settings(principal=Depends(get_current_principal)):
    s = await db.settings.find_one({"org_id": ORG_ID}, {"_id": 0})
    return s or {}

class SettingsIn(BaseModel):
    business: Optional[dict] = None
    tax: Optional[dict] = None
    senior_pwd: Optional[dict] = None
    loyalty: Optional[dict] = None
    negative_stock_policy: Optional[str] = None
    expiry_thresholds: Optional[list] = None
    shelf_locations: Optional[list] = None
    payment_methods: Optional[list] = None
    adjustment_reasons: Optional[list] = None

@router.put("/settings")
async def update_settings(body: SettingsIn, principal=Depends(require_perm("*"))):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.settings.update_one({"org_id": ORG_ID}, {"$set": upd}, upsert=True)
    await audit(principal, "settings.updated", "settings", ORG_ID, after=list(upd.keys()))
    return await db.settings.find_one({"org_id": ORG_ID}, {"_id": 0})


# ---------------- Audit logs & notifications ----------------
@router.get("/audit-logs")
async def audit_logs(limit: int = 200, event: Optional[str] = None, principal=Depends(require_perm("*"))):
    q = {"org_id": ORG_ID}
    if event:
        q["event"] = event
    return await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)

@router.get("/notifications")
async def notifications(principal=Depends(get_current_principal)):
    return await db.notifications.find({"org_id": ORG_ID}, {"_id": 0}).sort("created_at", -1).to_list(100)

@router.post("/notifications/{nid}/read")
async def read_notification(nid: str, principal=Depends(get_current_principal)):
    await db.notifications.update_one({"id": nid, "org_id": ORG_ID}, {"$set": {"read": True}})
    return {"ok": True}


# ---------------- Prescriptions ----------------
class PrescriptionIn(BaseModel):
    reference: str
    customer_id: Optional[str] = None
    patient_name: Optional[str] = ""
    prescriber: Optional[str] = ""
    product_id: Optional[str] = None
    product_name: Optional[str] = ""
    qty_prescribed: float = 0
    qty_dispensed: float = 0
    status: str = "COMPLETED"
    notes: Optional[str] = ""

@router.get("/prescriptions")
async def list_prescriptions(principal=Depends(require_perm("pharmacy.prescription"))):
    return await db.prescriptions.find({"org_id": ORG_ID}, {"_id": 0}).sort("created_at", -1).to_list(500)

@router.post("/prescriptions")
async def create_prescription(body: PrescriptionIn, principal=Depends(require_perm("pharmacy.prescription"))):
    doc = {"id": uid(), "org_id": ORG_ID, **body.model_dump(),
           "pharmacist": principal.get("name"), "created_at": now_iso()}
    await db.prescriptions.insert_one(doc)
    await audit(principal, "prescription.created", "prescription", doc["id"], after={"reference": body.reference})
    doc.pop("_id", None)
    return doc


# ---------------- Global search ----------------
@router.get("/search")
async def global_search(q: str, principal=Depends(get_current_principal)):
    rx = re.escape(q)
    r = {"$regex": rx, "$options": "i"}
    products = await db.products.find({"org_id": ORG_ID, "$or": [
        {"name": r}, {"sku": r}, {"barcode": r}, {"generic_name": r}]}, {"_id": 0}).limit(6).to_list(6)
    customers = await db.customers.find({"org_id": ORG_ID, "$or": [
        {"first_name": r}, {"last_name": r}, {"phone": r}]}, {"_id": 0}).limit(6).to_list(6)
    sales = await db.sales.find({"org_id": ORG_ID, "number": r}, {"_id": 0}).limit(6).to_list(6)
    suppliers = await db.suppliers.find({"org_id": ORG_ID, "company": r}, {"_id": 0}).limit(6).to_list(6)
    return {"products": products, "customers": customers, "sales": sales, "suppliers": suppliers}
