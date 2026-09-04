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
