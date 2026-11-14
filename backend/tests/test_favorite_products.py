"""The favorites query must use only net units sold at the selected store."""
from favorite_products import favorites_pipeline


def test_favorites_pipeline_is_scoped_and_excludes_cancelled_sales():
    pipeline = favorites_pipeline("org_kdplus", "store_main", "2026-10-15T00:00:00+00:00", 40)
    assert pipeline[0]["$match"] == {
        "org_id": "org_kdplus",
        "store_id": "store_main",
        "created_at": {"$gte": "2026-10-15T00:00:00+00:00"},
        "status": {"$in": ["COMPLETED", "PARTIAL_REFUND", "REFUNDED"]},
    }
    assert "CANCELLED" not in pipeline[0]["$match"]["status"]["$in"]
    assert pipeline[-1] == {"$limit": 40}


def test_favorites_pipeline_subtracts_refunded_quantity_and_ranks_units():
    pipeline = favorites_pipeline("org_kdplus", "store_main", "2026-10-15T00:00:00+00:00")
    project = pipeline[2]["$project"]
    assert project["product_id"] == "$items.product_id"
    assert project["net_qty"] == {"$max": [
        0,
        {"$subtract": [
            {"$ifNull": ["$items.qty", 0]},
            {"$ifNull": ["$items.refunded_qty", 0]},
        ]},
    ]}
    assert pipeline[3]["$match"]["net_qty"] == {"$gt": 0}
    assert pipeline[4]["$group"] == {"_id": "$product_id", "qty_sold": {"$sum": "$net_qty"}}
    assert pipeline[5]["$sort"] == {"qty_sold": -1, "_id": 1}
