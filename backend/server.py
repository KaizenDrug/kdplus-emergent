from dotenv import load_dotenv
from pathlib import Path
import os
load_dotenv(Path(__file__).parent / ".env")

import logging
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import db, client
import routes_auth, routes_catalog, routes_inventory, routes_pos
import routes_purchasing, routes_customers, routes_reports, routes_admin, routes_stock
from seed import seed_all

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="KDPLUS Pharmacy POS")


@app.get("/api/")
async def root():
    return {"message": "KDPLUS Pharmacy POS API", "status": "ok"}


for r in (routes_auth.router, routes_catalog.router, routes_inventory.router, routes_pos.router,
          routes_purchasing.router, routes_customers.router, routes_reports.router, routes_admin.router,
          routes_stock.router):
    app.include_router(r)

frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
origins = list({frontend_url, "http://localhost:3000"})
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.employees.create_index("id")
    await db.products.create_index([("org_id", 1), ("name", 1)])
    await db.products.create_index("barcode")
    await db.products.create_index("sku")
    await db.inventory_levels.create_index([("org_id", 1), ("store_id", 1), ("product_id", 1)], unique=True)
    await db.inventory_lots.create_index([("org_id", 1), ("store_id", 1), ("product_id", 1), ("status", 1)])
    await db.inventory_movements.create_index([("org_id", 1), ("product_id", 1), ("created_at", -1)])
    await db.sales.create_index([("org_id", 1), ("created_at", -1)])
    await db.sales.create_index([("org_id", 1), ("client_txn_id", 1)], unique=True,
                                partialFilterExpression={"client_txn_id": {"$type": "string"}})
    await db.sales.create_index("number")
    await db.refunds.create_index([("org_id", 1), ("client_txn_id", 1)], unique=True,
                                  partialFilterExpression={"client_txn_id": {"$type": "string"}})
    await db.login_attempts.create_index("identifier")
    await db.login_attempts.create_index("email")
    await db.password_reset_tokens.create_index("token_hash", unique=True)
    await db.password_reset_requests.create_index("email")
    try:
        await seed_all()
        logger.info("Seed complete")
    except Exception as e:
        logger.error(f"Seed error: {e}")


@app.on_event("shutdown")
async def shutdown():
    client.close()
