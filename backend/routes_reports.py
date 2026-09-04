from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import datetime, timedelta
from collections import defaultdict

from core import db, ORG_ID, m, D, MANILA, get_current_principal

router = APIRouter(prefix="/api/reports", tags=["reports"])


def parse_range(period, start, end):
    now = datetime.now(MANILA)
    if start and end:
        return start, end + "T23:59:59"
    today = now.strftime("%Y-%m-%d")
    if period == "today":
        return today, today + "T23:59:59"
    if period == "yesterday":
        y = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        return y, y + "T23:59:59"
    if period == "7d":
        return (now - timedelta(days=7)).strftime("%Y-%m-%d"), today + "T23:59:59"
    if period == "30d":
        return (now - timedelta(days=30)).strftime("%Y-%m-%d"), today + "T23:59:59"
    if period == "month":
        return now.strftime("%Y-%m-01"), today + "T23:59:59"
    return (now - timedelta(days=30)).strftime("%Y-%m-%d"), today + "T23:59:59"


async def fetch_sales(period, start, end, store_id=None):
    s, e = parse_range(period, start, end)
    q = {"org_id": ORG_ID, "created_at": {"$gte": s, "$lte": e}}
    if store_id:
        q["store_id"] = store_id
    return await db.sales.find(q, {"_id": 0}).to_list(50000)


@router.get("/dashboard")
async def dashboard(period: str = "today", store_id: Optional[str] = None,
                    start: Optional[str] = None, end: Optional[str] = None,
                    principal=Depends(get_current_principal)):
    sales = await fetch_sales(period, start, end, store_id)
    gross = sum(D(s["subtotal"]) for s in sales)
    net = sum(D(s["total"]) for s in sales)
    cogs = sum(D(s["cost_total"]) for s in sales)
    profit = sum(D(s["gross_profit"]) for s in sales)
    txns = len(sales)
    items_sold = sum(D(i["qty"]) for s in sales for i in s["items"])
    discounts = sum(D(s["discount_total"]) for s in sales)
    vat = sum(D(s["vat_amount"]) for s in sales)

    # payment mix
    pay = defaultdict(lambda: D(0))
    for s in sales:
        for p in s.get("payments", []):
            pay[p["method"]] += D(p["amount"])

    # trend (by day)
    trend = defaultdict(lambda: {"sales": D(0), "profit": D(0)})
    for s in sales:
        day = s["created_at"][:10]
        trend[day]["sales"] += D(s["total"])
        trend[day]["profit"] += D(s["gross_profit"])
    trend_rows = [{"date": k, "sales": m(v["sales"]), "profit": m(v["profit"])} for k, v in sorted(trend.items())]

    # hourly
    hourly = defaultdict(lambda: D(0))
    for s in sales:
        try:
            h = datetime.fromisoformat(s["created_at"]).astimezone(MANILA).hour
            hourly[h] += D(s["total"])
        except Exception:
            pass
    hourly_rows = [{"hour": f"{h:02d}:00", "sales": m(hourly.get(h, 0))} for h in range(6, 22)]

    # category mix + top products
    cat = defaultdict(lambda: D(0))
    prod = defaultdict(lambda: {"qty": D(0), "sales": D(0), "name": ""})
    pmap = {p["id"]: p for p in await db.products.find({"org_id": ORG_ID}, {"_id": 0}).to_list(5000)}
    catmap = {c["id"]: c["name"] for c in await db.categories.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)}
    for s in sales:
        for i in s["items"]:
            p = pmap.get(i["product_id"], {})
            cname = catmap.get(p.get("category_id"), "Uncategorized")
            cat[cname] += D(i["line_net"])
            prod[i["product_id"]]["qty"] += D(i["qty"])
            prod[i["product_id"]]["sales"] += D(i["line_net"])
            prod[i["product_id"]]["name"] = i["name"]
    cat_rows = [{"name": k, "value": m(v)} for k, v in sorted(cat.items(), key=lambda x: -x[1])]
    top = sorted(prod.values(), key=lambda x: -x["sales"])[:10]
    top_rows = [{"name": t["name"], "qty": m(t["qty"]), "sales": m(t["sales"])} for t in top]

    # inventory alerts
    levels = await db.inventory_levels.find({"org_id": ORG_ID}, {"_id": 0}).to_list(20000)
    lmap = defaultdict(float)
    for l in levels:
        lmap[l["product_id"]] += float(l["quantity"])
    low = out = 0
    for p in pmap.values():
        if not p.get("active", True) or not p.get("track_inventory", True):
            continue
        q = lmap.get(p["id"], 0)
        if q <= 0:
            out += 1
        elif q <= float(p.get("reorder_level", 0)):
            low += 1

    # expiring lots within 90 days
    today = datetime.now(MANILA).date()
    lots = await db.inventory_lots.find({"org_id": ORG_ID, "status": "ACTIVE", "quantity": {"$gt": 0},
                                         "expiry_date": {"$ne": None}}, {"_id": 0}).to_list(10000)
    expiring = expired = 0
    for l in lots:
        try:
            d = (datetime.strptime(l["expiry_date"], "%Y-%m-%d").date() - today).days
        except Exception:
            continue
        if d < 0:
            expired += 1
        elif d <= 90:
            expiring += 1

    return {
        "kpi": {"gross_sales": m(gross), "net_sales": m(net), "transactions": txns,
                "avg_sale": m(net / D(txns) if txns else 0), "items_sold": m(items_sold),
                "cogs": m(cogs), "gross_profit": m(profit),
                "gross_margin": m(profit / net * 100 if net > 0 else 0),
                "discounts": m(discounts), "vat": m(vat),
                "low_stock": low, "out_stock": out, "expiring": expiring, "expired": expired},
        "payment_mix": [{"name": k, "value": m(v)} for k, v in pay.items()],
        "trend": trend_rows, "hourly": hourly_rows, "category_mix": cat_rows,
        "top_products": top_rows,
        "recent": sorted(sales, key=lambda s: s["created_at"], reverse=True)[:8],
    }


@router.get("/sales-summary")
async def sales_summary(period: str = "30d", store_id: Optional[str] = None,
                        start: Optional[str] = None, end: Optional[str] = None, group: str = "item",
                        principal=Depends(get_current_principal)):
    sales = await fetch_sales(period, start, end, store_id)
    pmap = {p["id"]: p for p in await db.products.find({"org_id": ORG_ID}, {"_id": 0}).to_list(5000)}
    catmap = {c["id"]: c["name"] for c in await db.categories.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)}
    agg = defaultdict(lambda: {"qty": D(0), "gross": D(0), "net": D(0), "cogs": D(0)})

    def keyfn(s, i):
        if group == "item":
            return i["name"]
        if group == "category":
            return catmap.get(pmap.get(i["product_id"], {}).get("category_id"), "Uncategorized")
        if group == "employee":
            return s.get("cashier_name", "?")
        if group == "payment":
            return None
        if group == "store":
            return s.get("store_id")
        return i["name"]

    if group == "payment":
        pay = defaultdict(lambda: {"qty": D(0), "gross": D(0), "net": D(0), "cogs": D(0)})
        for s in sales:
            for p in s.get("payments", []):
                pay[p["method"]]["net"] += D(p["amount"])
                pay[p["method"]]["qty"] += D(1)
        rows = [{"key": k, "qty": m(v["qty"]), "net": m(v["net"]), "gross": m(v["net"]),
                 "cogs": 0, "profit": m(v["net"]), "margin": 0} for k, v in pay.items()]
        return sorted(rows, key=lambda r: -r["net"])

    for s in sales:
        for i in s["items"]:
            k = keyfn(s, i)
            agg[k]["qty"] += D(i["qty"])
            agg[k]["gross"] += D(i["line_gross"])
            agg[k]["net"] += D(i["line_net"])
            agg[k]["cogs"] += D(i["line_cost"])
    rows = []
    for k, v in agg.items():
        profit = v["net"] - v["cogs"]
        rows.append({"key": k, "qty": m(v["qty"]), "gross": m(v["gross"]), "net": m(v["net"]),
                     "cogs": m(v["cogs"]), "profit": m(profit),
                     "margin": m(profit / v["net"] * 100 if v["net"] > 0 else 0)})
    return sorted(rows, key=lambda r: -r["net"])


@router.get("/inventory-valuation")
async def inventory_valuation(store_id: Optional[str] = None, principal=Depends(get_current_principal)):
    products = await db.products.find({"org_id": ORG_ID, "active": True}, {"_id": 0}).to_list(5000)
    catmap = {c["id"]: c["name"] for c in await db.categories.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)}
    lq = {"org_id": ORG_ID}
    if store_id:
        lq["store_id"] = store_id
    levels = await db.inventory_levels.find(lq, {"_id": 0}).to_list(20000)
    lmap = defaultdict(float)
    for l in levels:
        lmap[l["product_id"]] += float(l["quantity"])
    rows = []
    total_val = D(0)
    for p in products:
        qty = lmap.get(p["id"], 0)
        val = D(qty) * D(p.get("average_cost", 0))
        total_val += val
        if qty <= 0:
            continue
        rows.append({"product_id": p["id"], "name": p["name"], "sku": p.get("sku"),
                     "category": catmap.get(p.get("category_id"), "Uncategorized"),
                     "quantity": m(qty), "average_cost": p.get("average_cost", 0),
                     "value": m(val), "price": p.get("price", 0),
                     "retail_value": m(D(qty) * D(p.get("price", 0)))})
    rows.sort(key=lambda r: -r["value"])
    return {"total_value": m(total_val), "rows": rows}


@router.get("/reorder-suggestions")
async def reorder_suggestions(days_window: int = 30, lead_time_days: int = 7,
                              supplier_id: Optional[str] = None, store_id: Optional[str] = None,
                              principal=Depends(get_current_principal)):
    from math import ceil
    start = (datetime.now(MANILA) - timedelta(days=days_window)).strftime("%Y-%m-%d")
    sq = {"org_id": ORG_ID, "created_at": {"$gte": start}}
    if store_id:
        sq["store_id"] = store_id
    sales = await db.sales.find(sq, {"_id": 0, "items": 1}).to_list(50000)
    sold = defaultdict(lambda: D(0))
    for s in sales:
        for i in s["items"]:
            net_qty = D(i["qty"]) - D(i.get("refunded_qty", 0))
            sold[i["product_id"]] += net_qty

    # incoming from open POs
    open_pos = await db.purchase_orders.find(
        {"org_id": ORG_ID, "status": {"$in": ["DRAFT", "SENT", "PARTIALLY_RECEIVED"]}}, {"_id": 0}).to_list(2000)
    incoming = defaultdict(lambda: D(0))
    for po in open_pos:
        for it in po["items"]:
            incoming[it["product_id"]] += D(it["qty_ordered"]) - D(it.get("qty_received", 0))

    # current stock (company-wide or per store)
    lq = {"org_id": ORG_ID}
    if store_id:
        lq["store_id"] = store_id
    levels = await db.inventory_levels.find(lq, {"_id": 0}).to_list(20000)
    stock = defaultdict(float)
    for l in levels:
        stock[l["product_id"]] += float(l["quantity"])

    products = await db.products.find({"org_id": ORG_ID, "active": True, "track_inventory": True}, {"_id": 0}).to_list(5000)
    sup_map = {s["id"]: s["company"] for s in await db.suppliers.find({"org_id": ORG_ID}, {"_id": 0}).to_list(500)}
    rows = []
    for p in products:
        sid = p.get("preferred_supplier_id") or p.get("supplier_id")
        if supplier_id and sid != supplier_id:
            continue
        cur = D(stock.get(p["id"], 0))
        inc = incoming.get(p["id"], D(0))
        avg_daily = sold.get(p["id"], D(0)) / D(days_window)
        safety = D(p.get("reorder_level", 0))
        expected_demand = avg_daily * D(lead_time_days)
        suggested = expected_demand + safety - cur - inc
        needs = suggested > 0 or cur <= D(p.get("reorder_level", 0))
        if not needs:
            continue
        if suggested > 0:
            qty = ceil(float(suggested))
        else:
            # low stock but demand-neutral — suggest a standard reorder pack
            qty = int(p.get("reorder_qty", 0) or 0)
        days_of_stock = float(cur / avg_daily) if avg_daily > 0 else None
        rows.append({"product_id": p["id"], "name": p["name"], "sku": p.get("sku"),
                     "supplier_id": sid, "supplier_name": sup_map.get(sid, "— No supplier —"),
                     "current_stock": m(cur), "incoming": m(inc), "reorder_level": p.get("reorder_level", 0),
                     "avg_daily_sales": round(float(avg_daily), 2),
                     "days_of_stock": (round(days_of_stock, 1) if days_of_stock is not None else None),
                     "suggested_qty": qty, "unit_cost": p.get("average_cost", 0),
                     "est_cost": m(D(qty) * D(p.get("average_cost", 0)))})
    rows.sort(key=lambda r: (r["supplier_name"], -(r["suggested_qty"] or 0)))
    return {"rows": rows, "params": {"days_window": days_window, "lead_time_days": lead_time_days}}


@router.get("/senior-pwd")
async def senior_pwd_report(period: str = "30d", start: Optional[str] = None, end: Optional[str] = None,
                            principal=Depends(get_current_principal)):
    s, e = parse_range(period, start, end)
    rows = await db.senior_pwd_transactions.find(
        {"org_id": ORG_ID, "created_at": {"$gte": s, "$lte": e}}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    total_disc = m(sum(D(r["discount"]) for r in rows))
    total_exempt = m(sum(D(r["vat_exempt"]) for r in rows))
    return {"rows": rows, "total_discount": total_disc, "total_vat_exempt": total_exempt, "count": len(rows)}
