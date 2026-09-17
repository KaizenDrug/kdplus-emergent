import os
import hashlib
import secrets
import logging
from html import escape
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, Request, Response, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, EmailStr

from core import (db, ORG_ID, uid, now_iso, hash_secret, verify_secret,
                  create_access_token, create_refresh_token, set_auth_cookies,
                  get_current_principal, jwt_secret, JWT_ALG, auth_cookie_options)
import jwt as pyjwt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_BASE_URL = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip().rstrip("/") or "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME") or "KDPLUS Pharmacy"

MAX_ATTEMPTS = 5
LOCKOUT_MIN = 15


# ---------- Schemas ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class PinLoginIn(BaseModel):
    pin: str

class ForgotIn(BaseModel):
    email: EmailStr

class ResetIn(BaseModel):
    token: str
    password: str


def public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u.get("email"), "name": u.get("name"),
            "role": u.get("role"), "kind": "user", "org_id": u.get("org_id", ORG_ID),
            "permissions": ["*"] if u.get("role") in ("owner", "admin", "manager") else []}


async def send_password_reset_email(to_email: str, token: str) -> bool:
    base = os.environ.get("FRONTEND_URL", "").rstrip("/")
    link = f"{base}/reset-password?token={token}"
    if not EMAIL_KEY or EMAIL_KEY.startswith("{") or not base.startswith("https://"):
        if urlparse(base).hostname in ("localhost", "127.0.0.1", "::1"):
            logger.warning("Email not configured; password reset link: %s", link)
        else:
            logger.error("Password reset email not configured (EMERGENT_EMAIL_KEY / FRONTEND_URL)")
        return False
    brand = escape(EMAIL_FROM_NAME)
    html = (
        f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif">'
        f'<p>We received a request to reset your {brand} password.</p>'
        f'<p><a href="{escape(link)}">Reset your password</a></p>'
        f'<p>This link expires in 1 hour and can be used once. If you did not request it, ignore this email.</p>'
        f'<p style="font-size:12px;color:#888">Sent by {brand}. We never ask for your password by email.</p>'
        f'</td></tr></table>'
    )
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                headers={"X-Email-Key": EMAIL_KEY},
                                json={"to": [to_email], "subject": f"Reset your {EMAIL_FROM_NAME} password",
                                      "html": html, "from_name": EMAIL_FROM_NAME})
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Password reset email failed: {e}")
        return False


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower().strip()
    ip = request.client.host if request.client else "?"
    ident = f"{ip}:{email}"
    rec = await db.login_attempts.find_one({"identifier": ident})
    if rec and rec.get("count", 0) >= MAX_ATTEMPTS:
        locked_until = rec.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_secret(body.password, user.get("password_hash", "")):
        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$inc": {"count": 1}, "$set": {"email": email,
             "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MIN)).isoformat()}},
            upsert=True)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_attempts.delete_many({"identifier": ident})
    ver = user.get("token_version", 0)
    set_auth_cookies(response, create_access_token(user["id"], "user", ver), create_refresh_token(user["id"], "user", ver))
    return public_user(user)


@router.post("/pin-login")
async def pin_login(body: PinLoginIn, response: Response):
    pin = body.pin.strip()
    emps = await db.employees.find({"org_id": ORG_ID, "active": True}).to_list(500)
    for e in emps:
        if e.get("pin_hash") and verify_secret(pin, e["pin_hash"]):
            ver = e.get("token_version", 0)
            set_auth_cookies(response, create_access_token(e["id"], "employee", ver), create_refresh_token(e["id"], "employee", ver))
            from core import ROLE_PERMISSIONS
            return {"id": e["id"], "name": e["name"], "role": e["role"], "kind": "employee",
                    "org_id": ORG_ID, "store_ids": e.get("store_ids", []),
                    "permissions": ROLE_PERMISSIONS.get(e["role"], [])}
    raise HTTPException(status_code=401, detail="Invalid PIN")


@router.post("/logout")
async def logout(response: Response):
    opts = auth_cookie_options()
    response.delete_cookie("access_token", path="/", **opts)
    response.delete_cookie("refresh_token", path="/", **opts)
    return {"message": "Logged out"}


@router.get("/me")
async def me(principal: dict = Depends(get_current_principal)):
    return principal


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = pyjwt.decode(token, jwt_secret(), algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    kind = payload.get("kind", "user")
    coll = db.users if kind == "user" else db.employees
    ent = await coll.find_one({"id": payload["sub"]})
    if not ent or payload.get("ver", 0) != ent.get("token_version", 0):
        raise HTTPException(status_code=401, detail="Session expired")
    ver = ent.get("token_version", 0)
    set_auth_cookies(response, create_access_token(ent["id"], kind, ver), create_refresh_token(ent["id"], kind, ver))
    return {"message": "refreshed"}


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn, background_tasks: BackgroundTasks):
    email = body.email.lower().strip()
    generic = {"message": "If that email is registered, a reset link has been sent."}
    await db.password_reset_requests.insert_one({"email": email, "created_at": now_iso()})
    recent = await db.password_reset_requests.count_documents(
        {"email": email, "created_at": {"$gt": (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()}})
    if recent > 5:
        return generic
    user = await db.users.find_one({"email": email})
    if not user:
        return generic
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "token_hash": hashlib.sha256(token.encode()).hexdigest(), "user_id": user["id"], "email": email,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), "used": False})
    background_tasks.add_task(send_password_reset_email, user["email"], token)
    return generic


@router.post("/reset-password")
async def reset_password(body: ResetIn):
    h = hashlib.sha256(body.token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    doc = await db.password_reset_tokens.find_one_and_update(
        {"token_hash": h, "used": False, "expires_at": {"$gt": now}}, {"$set": {"used": True}})
    if not doc:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")
    await db.users.update_one({"id": doc["user_id"]},
                              {"$set": {"password_hash": hash_secret(body.password)}, "$inc": {"token_version": 1}})
    await db.password_reset_tokens.delete_many({"user_id": doc["user_id"], "used": False})
    await db.login_attempts.delete_many({"email": doc["email"]})
    return {"message": "Password updated. You can now sign in."}
