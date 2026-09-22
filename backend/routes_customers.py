from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import re

from core import (db, ORG_ID, uid, now_iso, m, D, get_current_principal, require_perm, audit)

router = APIRouter(prefix="/api", tags=["customers"])


class CustomerIn(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    birthday: Optional[str] = None
    notes: Optional[str] = ""
    allergies: Optional[str] = ""
    senior_pwd_type: str = "NONE"       # NONE / SENIOR / PWD
    id_number: Optional[str] = ""


@router.get("/customers")
async def list_customers(q: Optional[str] = None, principal=Depends(get_current_principal)):
    query = {"org_id": ORG_ID}
    if q:
        terms = [term for term in re.split(r"\s+", q.strip()) if term]
        query["$and"] = [
            {"$or": [{field: {"$regex": re.escape(term), "$options": "i"}}
                     for field in ("first_name", "last_name", "phone", "email")]}
            for term in terms
        ]
    return await db.customers.find(query, {"_id": 0}).sort("first_name", 1).to_list(1000)


@router.get("/customers/{cid}")
async def get_customer(cid: str, principal=Depends(get_current_principal)):
    c = await db.customers.find_one({"id": cid, "org_id": ORG_ID}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    sales = await db.sales.find({"org_id": ORG_ID, "customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(100)
    loyalty = await db.loyalty_transactions.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(100)
    c["sales"] = sales
    c["loyalty_transactions"] = loyalty
    return c


@router.post("/customers")
async def create_customer(body: CustomerIn, principal=Depends(require_perm("customers.manage"))):
    doc = {"id": uid(), "org_id": ORG_ID, **body.model_dump(),
           "loyalty_points": 0, "lifetime_spend": 0, "visit_count": 0,
           "last_visit": None, "created_at": now_iso()}
    await db.customers.insert_one(doc)
    await audit(principal, "customer.created", "customer", doc["id"], after={"name": body.first_name})
    doc.pop("_id", None)
    return doc


@router.put("/customers/{cid}")
async def update_customer(cid: str, body: CustomerIn, principal=Depends(require_perm("customers.manage"))):
    await db.customers.update_one({"id": cid, "org_id": ORG_ID}, {"$set": body.model_dump()})
    await audit(principal, "customer.updated", "customer", cid, after=body.model_dump())
    return await db.customers.find_one({"id": cid}, {"_id": 0})


class LoyaltyAdjustIn(BaseModel):
    points: int
    note: str = ""

@router.post("/customers/{cid}/loyalty-adjust")
async def loyalty_adjust(cid: str, body: LoyaltyAdjustIn, principal=Depends(require_perm("customers.manage"))):
    await db.customers.update_one({"id": cid, "org_id": ORG_ID}, {"$inc": {"loyalty_points": body.points}})
    await db.loyalty_transactions.insert_one({"id": uid(), "org_id": ORG_ID, "customer_id": cid,
        "type": "ADJUST", "points": body.points, "note": body.note, "created_at": now_iso()})
    await audit(principal, "loyalty.adjust", "customer", cid, after={"points": body.points})
    return await db.customers.find_one({"id": cid}, {"_id": 0})
