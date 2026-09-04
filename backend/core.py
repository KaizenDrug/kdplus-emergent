import os
import uuid
import jwt
import bcrypt
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from fastapi import HTTPException, Request, Depends
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MANILA = ZoneInfo("Asia/Manila")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

ORG_ID = "org_kdplus"
JWT_ALG = "HS256"

# ---------------- Permissions ----------------
FULL = ["*"]
POS_PERMS = ["pos.sell", "pos.refund", "pos.view_receipts", "pos.open_drawer", "pos.discount"]
INV_PERMS = ["inventory.view", "inventory.adjust", "inventory.receive"]

ROLE_PERMISSIONS = {
    "owner": FULL,
    "admin": FULL,
    "manager": FULL,
    "pharmacist": POS_PERMS + INV_PERMS + ["pharmacy.prescription", "reports.view", "customers.manage"],
    "cashier": POS_PERMS + ["customers.manage"],
    "inventory": INV_PERMS + ["reports.view"],
}

# ---------------- Auth utils ----------------
def jwt_secret():
    return os.environ["JWT_SECRET"]

def hash_secret(p: str) -> str:
    return bcrypt.hashpw(p.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_secret(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False

def create_access_token(sub, kind, ver=0):
    payload = {"sub": sub, "kind": kind, "ver": ver, "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, jwt_secret(), algorithm=JWT_ALG)

def create_refresh_token(sub, kind, ver=0):
    payload = {"sub": sub, "kind": kind, "ver": ver, "type": "refresh",
               "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, jwt_secret(), algorithm=JWT_ALG)

def set_auth_cookies(response, access, refresh):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")

# ---------------- Money helpers (decimal-safe) ----------------
def D(x) -> Decimal:
    return Decimal(str(x if x is not None else 0))

def m(x) -> float:
    return float(D(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

# ---------------- Time / numbering ----------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def uid() -> str:
    return str(uuid.uuid4())

async def next_number(prefix: str) -> str:
    ymd = datetime.now(MANILA).strftime("%Y%m%d")
    key = f"{prefix}-{ymd}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return f"{prefix}-{ymd}-{doc['seq']:05d}"

# ---------------- Principal / auth dependency ----------------
async def get_current_principal(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        ah = request.headers.get("Authorization", "")
        if ah.startswith("Bearer "):
            token = ah[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    kind = payload.get("kind", "user")
    coll = db.users if kind == "user" else db.employees
    ent = await coll.find_one({"id": payload["sub"]}, {"_id": 0})
    if not ent:
        raise HTTPException(status_code=401, detail="Account not found")
    if payload.get("ver", 0) != ent.get("token_version", 0):
        raise HTTPException(status_code=401, detail="Session expired")
    ent.pop("password_hash", None)
    ent.pop("pin_hash", None)
    ent["kind"] = kind
    ent["permissions"] = ROLE_PERMISSIONS.get(ent.get("role", "cashier"), [])
    return ent

def require_perm(perm: str):
    async def dep(principal: dict = Depends(get_current_principal)):
        perms = principal.get("permissions", [])
        if "*" not in perms and perm not in perms:
            raise HTTPException(status_code=403, detail="You don't have permission for this action")
        return principal
    return dep

# ---------------- Audit ----------------
async def audit(principal, event, record_type, record_id=None, before=None, after=None, store_id=None):
    await db.audit_logs.insert_one({
        "id": uid(), "org_id": ORG_ID, "event": event, "record_type": record_type,
        "record_id": record_id, "before": before, "after": after,
        "user_id": (principal or {}).get("id"), "user_name": (principal or {}).get("name"),
        "store_id": store_id, "created_at": now_iso(),
    })

async def notify(kind, title, message, severity="info", store_id=None, ref=None):
    await db.notifications.insert_one({
        "id": uid(), "org_id": ORG_ID, "kind": kind, "title": title, "message": message,
        "severity": severity, "store_id": store_id, "ref": ref, "read": False, "created_at": now_iso(),
    })
