"""SKU previews, expiry alerts and audited lot corrections."""
import asyncio
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from mongomock_motor import AsyncMongoMockClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
os.environ.setdefault('DB_NAME', 'kdplus_test')
os.environ.setdefault('JWT_SECRET', 'test')
import core
import inventory_lib
import routes_catalog as catalog
import routes_inventory as inventory
import routes_reports as reports

@pytest.fixture
def database(monkeypatch):
    db = AsyncMongoMockClient()['test']
    for module in (core, inventory_lib, catalog, inventory, reports):
        monkeypatch.setattr(module, 'db', db)
    return db

@pytest.mark.asyncio
async def test_sku_preview_ignores_old_counter_and_reserves_on_save(database):
    await database.products.insert_many([
        {'id': 'p1', 'org_id': core.ORG_ID, 'sku': 'SKU11045', 'active': True},
        {'id': 'p2', 'org_id': core.ORG_ID, 'sku': 'SKU12000', 'active': False}])
    await database.counters.insert_one({'_id': 'product-sku', 'seq': 13000})
    assert await catalog.next_product_sku(False) == 'SKU11046'
    assert await catalog.next_product_sku(False) == 'SKU11046'
    numbers = await asyncio.gather(*(catalog.next_product_sku() for _ in range(4)))
    assert len(set(numbers)) == 4
    assert sorted(numbers) == ['SKU11046', 'SKU11047', 'SKU11048', 'SKU11049']

@pytest.mark.asyncio
async def test_sku_preview_avoids_inactive_collision(database):
    await database.products.insert_many([
        {'id': 'p1', 'org_id': core.ORG_ID, 'sku': 'SKU10000', 'active': True},
        {'id': 'p2', 'org_id': core.ORG_ID, 'sku': 'SKU10001', 'active': False}])
    assert await catalog.next_product_sku(False) == 'SKU10002'

async def seed_lots(db):
    today = datetime.now(core.MANILA).date()
    for i, active, level, days, quantity in [
        ('soon', True, 5, 90, 5), ('expired', True, 2, -1, 2),
        ('archived', False, 9, -1, 9), ('zero', True, 0, -1, 5),
        ('empty-lot', True, 5, -1, 0), ('future', True, 4, 365, 4)]:
        await db.products.insert_one({'id': i, 'org_id': core.ORG_ID, 'name': i, 'active': active})
        await db.inventory_levels.insert_one({'id': i, 'org_id': core.ORG_ID, 'product_id': i, 'store_id': 'store_main', 'quantity': level})
        await db.inventory_lots.insert_one({'id': i, 'org_id': core.ORG_ID, 'product_id': i,
            'store_id': 'store_main', 'quantity': quantity, 'status': 'ACTIVE', 'lot_number': i,
            'expiry_date': (today + timedelta(days=days)).isoformat(), 'unit_cost': 10})

@pytest.mark.asyncio
async def test_expiry_and_dashboard_ignore_inactive_or_zero_stock(database):
    await seed_lots(database)
    result = await inventory.expiry_report('store_main', {})
    assert {l['id'] for l in result['lots']} == {'soon', 'expired'}
    all_lots = await inventory.list_lots(None, 'store_main', 'ACTIVE', {})
    assert {l['id'] for l in all_lots} == {'soon', 'expired', 'future'}
    d = await reports.dashboard(principal={})
    assert d['kpi']['expiring'] == 1
    assert d['kpi']['expired'] == 1

@pytest.mark.asyncio
async def test_admin_lot_edit_updates_level_movement_and_audit(database):
    await seed_lots(database)
    body = inventory.LotEditIn(lot_number='NEW-BATCH', expiry_date='2029-03-31', quantity=8)
    with pytest.raises(HTTPException) as exc:
        await inventory.edit_lot('soon', body, {'role': 'cashier'})
    assert exc.value.status_code == 403
    await inventory.edit_lot('soon', body, {'role': 'admin', 'id': 'admin', 'name': 'Admin'})
    assert await inventory_lib.get_level('store_main', 'soon') == 8
    lot = await database.inventory_lots.find_one({'id': 'soon'})
    assert lot['expiry_date'] == '2029-03-31' and lot['lot_number'] == 'NEW-BATCH'
    movement = await database.inventory_movements.find_one({'product_id': 'soon'})
    assert movement['qty_change'] == 3 and movement['qty_after'] == 8
    event = await database.audit_logs.find_one({'event': 'inventory.lot.updated'})
    assert event['before']['quantity'] == 5 and event['after']['quantity'] == 8
    # Editing metadata alone must not add another stock movement.
    await inventory.edit_lot('soon', body, {'role': 'owner'})
    assert await database.inventory_movements.count_documents({}) == 1

@pytest.mark.asyncio
async def test_invalid_lot_inputs_do_not_change_inventory(database):
    await seed_lots(database)
    with pytest.raises(ValidationError):
        inventory.LotEditIn(lot_number='x', quantity=1.5)
    with pytest.raises(HTTPException) as exc:
        await inventory.edit_lot('soon', inventory.LotEditIn(lot_number='x', expiry_date='2029-02-31', quantity=8), {'role': 'owner'})
    assert exc.value.status_code == 422
    assert await inventory_lib.get_level('store_main', 'soon') == 5

@pytest.mark.asyncio
async def test_two_new_forms_save_with_unique_current_skus(database):
    await database.products.insert_one({'id': 'p1', 'name': 'Existing', 'org_id': core.ORG_ID, 'sku': 'SKU11045', 'active': True})
    preview = await catalog.next_product_sku(False)
    first = await catalog.create_product(catalog.ProductIn(name='First New Item', sku=preview, auto_sku=True), {'role': 'owner'})
    second = await catalog.create_product(catalog.ProductIn(name='Second New Item', sku=preview, auto_sku=True), {'role': 'owner'})
    assert first['sku'] == 'SKU11046'
    assert second['sku'] == 'SKU11047'
    assert 'auto_sku' not in first
