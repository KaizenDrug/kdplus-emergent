# KDPLUS Pharmacy — POS & Business Management System (PRD)

## Original Problem Statement
Production-ready cloud POS + Business Management System for KDPLUS Pharmacy (Philippines, PHP ₱, Asia/Manila). Comparable to Loyverse + premium modules, original UI/code. Full pharmacy controls (lots, expiry, FEFO, Senior/PWD, VAT), inventory ledger, multi-store, RBAC, reporting, offline-safe sales.

## User Choices (v1)
- Slice: POS Register + Checkout + Products + Inventory ledger + Dashboard
- Auth: JWT email/password (admin) + PIN (cashier)
- Pharmacy: lot/batch + expiry + FEFO AND Senior/PWD + VAT
- Full demo seed; blue-green healthcare theme

## Architecture
- **Frontend**: React (CRA/craco), Tailwind, shadcn/ui, recharts, sonner, react-router. `@/` alias → src.
- **Backend**: FastAPI modular routers (core, auth, catalog, inventory, pos, purchasing, customers, reports, admin) + inventory_lib + seed. All routes under `/api`.
- **DB**: MongoDB (motor). UUID string ids, `_id` excluded from responses. Money via Python `Decimal` (helper `m()`), stored as 2dp floats.
- **Auth**: bcrypt hashing, JWT httpOnly cookies (access 12h / refresh 7d), login lockout, forgot/reset via managed email. Single org multi-tenant scaffolding (`org_kdplus`).
- **Inventory engine**: immutable `inventory_movements` ledger; `inventory_levels` per store/product; `inventory_lots` (batch+expiry); FEFO allocation on sale; weighted-average cost on receiving.

## User Personas
- Owner/Admin/Manager — full back office + POS
- Pharmacist — POS, inventory, prescriptions, reports
- Cashier — POS + customers (PIN login)
- Inventory staff — inventory + reports

## Core Requirements (static)
Decimal-safe money · immutable inventory ledger · atomic sale (sale+items+payments+lot alloc+stock+ledger+loyalty+audit) · Senior/PWD VAT-exempt+20% configurable · offline dedupe (client_txn_id) · RBAC server-side · audit logs.

## Implemented (2026-06-04) — verified 100% by testing agent
- Auth: email/pw login, PIN login, me/logout/refresh, forgot/reset, lockout
- POS register: product tiles/search/barcode, cart, checkout, split payments, Senior/PWD + VAT, order discount, receipt (print), online/offline indicator, FEFO
- Products CRUD + margins + price history + bulk price
- Inventory: levels, lots, expiry monitor (buckets), goods receiving (avg cost), adjustments, ledger
- Purchase Orders: create/status/receive (lot+expiry)
- Suppliers CRUD · Customers CRUD + loyalty ledger + history
- Sales history + refunds (partial/full, stock restore)
- Shifts & cash management (open/move/close + reconciliation)
- Employees + roles · Settings (business/tax/senior-pwd/loyalty/negative-stock)
- Reports: dashboard KPIs+charts, sales-summary (item/category/employee/payment/store), inventory valuation, Senior/PWD, CSV export
- Audit log · Global search (Ctrl+K) · Full KDPLUS demo seed (~46 products, 8 cats, 5 suppliers, 20 customers, 5 employees, lots w/ expiry, ~70 sales)

## Backlog (not yet built)
- P1: Stock transfers between stores; inventory counts; composite/production; barcode label printing; box-to-piece conversion UI; product image upload
- P1: Manager override PIN dialog for restricted actions; custom roles editor; permission matrix UI
- P2: True offline (service worker + IndexedDB queue + sync); customer & kitchen display; prescriptions UI; CSV import wizard; webhooks/API keys; smart reorder suggestions; time clock UI
- P2: Accounting exports pack; multi-store consolidated drill-down; price rounding rules calculator

## Next Tasks
1. Stock transfers + inventory counts (advanced inventory)
2. Manager override PIN workflow for restricted POS actions
3. Offline PWA (service worker + IndexedDB sync)
4. CSV product import wizard + barcode label printing

# [2026-06] Admin-only Reset Test Database
- Settings -> "Danger Zone" tab (visible only to Owner/Admin email accounts).
- Backend POST /api/admin/reset-database: Super Admin only (kind=user, role owner/admin); staff PIN logins get 403. Requires confirm phrase "RESET DATABASE" (400 if wrong) + admin password (401 if wrong).
- Wipes all transactional/master collections and reseeds full KDPLUS demo dataset via seed._seed_master_and_txn(). Preserves users (Super Admin) and settings (business/tax/lookup).
- seed.py refactored: seed_all -> _seed_settings + _seed_master_and_txn; reset_database() reuses the latter.
- Verified: curl (403/401/400/200, reseeded, settings preserved) + frontend screenshot (button gated on phrase+password).

# [2026-06] Reset Database — Clean/Empty mode added
- POST /api/admin/reset-database now takes mode: "demo" (full KDPLUS demo reseed) | "clean" (empty production start). Owner/Admin user only + password + "RESET DATABASE" phrase; invalid mode -> 400.
- clean mode: wipes all RESET_COLLECTIONS incl counters; deletes all users except primary Owner (ADMIN_EMAIL); ensures Owner via seed_admin; preserves/creates settings; recreates default stores+registers. No products/sales/customers/suppliers/employees.
- seed.py: extracted _seed_stores_registers(); reset_database(mode) branches clean vs demo.
- Frontend Danger Zone (Settings) has a mode radio (demo/clean); button label adapts.
- Verified on PREVIEW DB: clean -> products/sales/POs/customers/suppliers/categories/employees=0, users=1, stores=2, registers=3, counters=0, dashboard totals 0, login works, new product+sale works (SALE-...-00001), then restored demo (44 products).
- NOTE: workspace MONGO_URL=localhost test_database (PREVIEW ONLY). Production reset must be run from the DEPLOYED app Settings->Danger Zone (uses prod MONGO_URL). Agent cannot touch production DB from workspace.

# [2026-06] Reset UX: backup, recap, audit + deploy fix
- GET /api/admin/backup (Owner/Admin only, 403 otherwise): exports all wiped collections + users + settings as JSON, strips password_hash/pin_hash. Frontend Danger Zone "Download backup" button saves kdplus-backup-*.json.
- reset_database(mode) now returns per-collection delete counts; endpoint returns {deleted, deleted_total}. Danger Zone shows a post-reset recap card (total + breakdown + Reload).
- Audit: database.reset entry records by/role/mode/deleted_total; already visible in Audit Log page.
- Deploy fix: removed no-op TTL index db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0) in server.py (expires_at is ISO string; expiry enforced at query time). deployment_agent re-check: PASS (destructive_db_startup_confirmed=false).
- Verified on PREVIEW: backup counts (products44/sales70/users1, no hash leak), cashier backup=403, demo reset deleted_total=368 with breakdown, audit entry present. UI screenshot shows backup btn + demo/clean radios.

# [2026-06] Purchase Order editing + enhanced receiving (cost variance, partial/cancelled)
- routes_purchasing.py fully rewritten. New per-line fields: ordered_unit_cost (frozen once sent), qty_cancelled, computed qty_outstanding (=ordered-received-cancelled). unit_cost kept as alias for backward compat. _norm_item backfills legacy POs on read.
- Endpoints: PUT /purchase-orders/{id} (edit DRAFT only, 400 otherwise); POST /{id}/cancel-remaining (CLOSED_PARTIAL if any received else CANCELLED; NO stock change); GET /{id}/receipts; enhanced POST /{id}/receive.
- receive_po: validates ALL lines up-front (outstanding cap + variance-threshold reason gate) THEN applies (safeguard vs partial writes). Per line: creates lot at ACTUAL cost (never rewrites existing lots), recomputes product weighted average_cost + latest_cost, records PURCHASE_RECEIPT movement at actual cost, inserts immutable po_receipts doc, audits po.received + po.cost_variance. Status via _compute_status.
- New collection po_receipts: id, receipt_group_id, receipt_no(GRN), po_id, po_number, po_line_id, product_id/name, supplier_id, store_id, qty_received, ordered_unit_cost, actual_unit_cost, variance_amount, variance_percent, variance_reason, variance_note, lot_id, lot_number, expiry_date, received_at, received_by(+name).
- Settings: purchasing.cost_variance_threshold_pct default 5 (seed + SettingsIn). routes_reports.py: GET /reports/cost-variance (supplier/product summary, total_cost_difference=variance*qty).
- Frontend PurchaseOrders.jsx rewritten: POForm(create/edit), POView(detail: Ordered/Received/Cancelled/Outstanding/PO Cost + Receipt History + actions), ReceivePanel(live variance, on-hand/avg/latest + est preview, reason dropdown when >threshold, Other->note), printPO (original ordered costs, safe DOM). Friendly status labels incl CLOSED_PARTIAL="Closed – Partially Received".
- Verified: curl (avg 5.60/latest 6.00/on-hand 50, LOT-A@5 preserved/LOT-B@6, 400 over-outstanding, 400 variance-no-reason, PARTIALLY->cancel->CLOSED_PARTIAL stock unchanged, draft edit, RECEIVED-edit 400, cost-variance report). testing_agent iteration_7: 15/15 UI checks pass, 0 bugs.

# [2026-09] Cashier shift + discount/refund completion
- Cashier-only POS now opens with an in-register shift workflow. Cashiers can enter opening cash, see the active shift, close and reconcile it, and cannot charge a ticket without a shift. Sales carry the active `shift_id`; queued offline sales must sync before shift close.
- Product master now includes `discount_eligible` (legacy default true). Senior/PWD checkout shows a per-item eligibility checklist; VAT exemption and the 20% discount apply only to selected eligible items, while ineligible items retain normal tax treatment. ID number and cardholder name are required.
- Checkout API now rejects empty/invalid sales, non-positive payments/quantities, unauthorized price overrides, insufficient tender, invalid discounts, missing/closed/mismatched shifts, and disabled statutory discounts.
- Refunds now record the refund payment method, restore the original sold lot(s), support non-restock returns, proportionally respect order-level discounts, retain VAT/cost reversal data, and display refund history in the sale detail.
- The refund dialog now calculates and prominently displays the live amount to return to the customer using the backend's discounted line-allocation formula.
- Shift reconciliation excludes cash change, subtracts cash refunds only, scopes refunds to the originating shift, and treats petty cash as cash out. Invalid cash movements and duplicate shift closes are rejected.
- Dashboard KPIs/trends/payment mix/category/product figures now deduct refunds and restored cost instead of reporting refunded revenue as earned sales.
- Offline queue failures are retained with an error instead of silently deleting rejected sales.
- Verification: focused async backend suite 5/5 passed; optimized React production build completed successfully.

# [2026-09] Receipt, refund, cancellation, and local-auth completion
- Every new sale item now receives a stable `sale_line_id`; legacy receipts are normalized on read without resetting or migrating the database. Refunds target the exact sale line, so repeated products and batch allocations remain unambiguous.
- Senior/PWD checkout supports an eligible quantity within a multi-quantity line. Only that quantity receives VAT exemption and the statutory discount; the remaining quantity keeps normal VAT treatment.
- Refunds calculate from the historical amount actually paid, including ticket-level and Senior/PWD discounts. Partial/full refunds show the exact customer refund before confirmation, restore original lots when restocked, retain non-restock returns, and record method, VAT, cost, reason, and history.
- Refund submissions use `client_txn_id` idempotency and optimistic receipt versioning. Duplicate submissions return the original refund; stale or excessive returns fail with a conflict instead of over-refunding or restoring inventory twice.
- Cashiers can open a dedicated searchable/paginated “My Receipts” screen from POS, reprint and refund only their own receipts. Back-office users retain Sales & Refunds access according to permissions.
- Full receipt cancellation is restricted to manager-level wildcard permission, only applies to untouched completed receipts, records a `VOID`, and restores inventory. Cancelled receipts cannot be refunded again.
- Local HTTP authentication cookies now work in Safari when `FRONTEND_URL` explicitly points to localhost; non-local/default deployments retain secure cross-site cookie settings.
- Verification: focused async backend suite 10/10 passed; Python compilation and diff checks passed; optimized React production build completed successfully. Broader live-API suites require a running seeded backend.
- After a successful POS shift close, the reconciliation and sales summary remains visible with a print option. Selecting “Done” clears the cached active shift, logs out the current cashier, and returns to login.
- Reorder Suggestions keeps the system-calculated quantity visible but allows the user to edit the actual order quantity before creating a draft PO. Estimated line and total costs update immediately, and a quantity of zero excludes the item.
