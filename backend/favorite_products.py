"""MongoDB aggregation for store-scoped, net-quantity POS best sellers.

Refund and void flows update sales.items[].refunded_qty in-place. This allows
the ranking to count remaining sold units without double-counting refund rows.
"""

def favorites_pipeline(org_id, store_id, since_iso, limit=60):
    return [
        {"$match": {
            "org_id": org_id,
            "store_id": store_id,
            "created_at": {"$gte": since_iso},
            "status": {"$in": ["COMPLETED", "PARTIAL_REFUND", "REFUNDED"]},
        }},
        {"$unwind": "$items"},
        {"$project": {
            "product_id": "$items.product_id",
            "net_qty": {"$max": [
                0,
                {"$subtract": [
                    {"$ifNull": ["$items.qty", 0]},
                    {"$ifNull": ["$items.refunded_qty", 0]},
                ]},
            ]},
        }},
        {"$match": {"product_id": {"$type": "string", "$ne": ""}, "net_qty": {"$gt": 0}}},
        {"$group": {"_id": "$product_id", "qty_sold": {"$sum": "$net_qty"}}},
        {"$sort": {"qty_sold": -1, "_id": 1}},
        {"$limit": limit},
    ]
