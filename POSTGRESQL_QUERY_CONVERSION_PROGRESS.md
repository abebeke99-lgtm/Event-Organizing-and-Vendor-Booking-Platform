# PostgreSQL Query Conversion Progress

Updated: 2026-11-11  
Database used: isolated Neon test database `eventhub` only. Production was not accessed.

## Current Inventory

`npm --workspace backend run audit` regenerated [docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv](docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv):

| Measure | Current | Phase 1 baseline |
|---|---:|---:|
| Backend JavaScript source files scanned | 88 | 85 |
| Database `.query()` / `.execute()` call sites | 987 | 939 |
| PostgreSQL infrastructure calls | 18 | 18 |
| Application calls not certified by the static scanner | 969 | 921 |

The scanner is deliberately conservative. It inventories call sites and SQL markers; it does not certify PostgreSQL compatibility from a filename or nearby test. In this payment slice, 48 PostgreSQL query call sites were added across the PostgreSQL payment service, administrator router, and customer booking router. Their exercised paths have live Neon integration evidence, but the inventory still does not label those calls certified; unique-key race recovery and provider `pending` reconciliation remain unverified.

## Completed Slice: Payments and Refunds

| Activity | Result |
|---|---|
| Calls inspected | Existing MySQL payment/refund service, webhook, customer payment/refund endpoints, admin payment/refund routes, PostgreSQL payment/refund schema, permissions, and migration runner |
| PostgreSQL calls added | 48 call sites: 30 in `postgresPaymentManagement.js`, 13 in `postgresAdminPayments.js`, and 5 customer payment/refund queries in `postgresBookings.js` |
| Calls tested | Live Neon test exercises signed HTTP payment/refund webhooks, invalid/missing signatures, replay and out-of-order behavior, refund request/idempotency and concurrent reservations, provider timeout/retry, customer ownership/detail/list APIs, administrator list/detail/export/report/decision APIs, history/audit persistence, rollback, and FK rejection |
| Calls certified | No call sites are marked certified in the static inventory. The live test proves the paths it executes, not every branch or every application call in these files |
| Schema change | Additive migration `009_payment_status_width.sql` widens `payments.status` from `VARCHAR(16)` to `VARCHAR(24)` so `partially_refunded` fits; no table was dropped or recreated |
| Migration result | `009` applied to isolated Neon; 51 application tables remain present, 82 FKs, and 151 indexes |
| Integration result | `postgresPaymentIntegration.test.js`: 1 live test passed; migration + payment focused run: 10 passed, 0 failed |

The PostgreSQL webhook endpoint now dispatches to the PostgreSQL transaction implementation when the app dialect is PostgreSQL. Customer payment/refund endpoints and administrator payment/refund endpoints are mounted in PostgreSQL mode. The administrator routes preserve existing permissions, paging/filter response shapes, CSV export behavior, and payment-provider reconciliation behavior for the tested cases.

## Remaining Work

The source inventory still has 969 application call sites not certified by its rules. Other major areas remain to inspect/convert/test: authentication/account changes, profile photos, event management, categories, vendor management, services/packages, marketplace, availability, bookings/quotations beyond existing PostgreSQL slices, reviews, notifications, messaging, remaining administrator modules, reports, audit logs, settings, seed and operational scripts, and legacy SQL migrations.

MySQL remains in the legacy runtime, SQL modules, standard schema/migration files, dependencies, and deployment documentation. Those paths cannot be removed until equivalent PostgreSQL behavior is implemented and tested. Render configuration was not changed. Production migration, backup/restore, data copy, and deployment verification remain blocked on authorized production configuration and recovery approval.

## Tests and Checks

- `npm --workspace backend run audit:postgres-queries`: passed; 987 call sites inventoried.
- `npm --workspace backend run migrate:neon-test`: applied additive migration 009; existing schema-integrity checks passed.
- `npm --workspace backend run db:check:neon-test`: passed on final retry; 51 application tables, 82 FKs, 151 indexes, and migrations 001–009 verified on isolated Neon. Earlier retries in this session hit documented transient Neon acquisition failures.
- Latest `RUN_NEON_INTEGRATION=true node --test backend/test/postgresPaymentIntegration.test.js`: 1 passed, 0 failed, 0 skipped. The prior combined migration + payment run passed 10/10; migration unit tests have not changed since that run.
- Existing `backend/test/paymentManagement.test.js`: 9 passed, 0 failed with non-connecting dummy pool configuration; fake-executor tests are MySQL unit regression evidence only.
- Full backend suite under isolated Neon PostgreSQL runtime settings: 446 total, 252 passed, 184 failed, 10 skipped. It is not green; legacy MySQL route/configuration tests remain incompatible.
- `npm --workspace frontend test`: 172 passed, 0 failed.
- `npm --workspace frontend run build`: passed using a compile-only `https://api.example.invalid/api` value because Vite correctly requires `VITE_API_URL` in production mode. This is not a deployed API URL and was not saved to configuration.
- `git diff --check`: passed; Git reported existing LF/CRLF working-copy warnings only.

## Files Changed In This Slice

- `backend/postgres/migrations/009_payment_status_width.sql`
- `backend/scripts/migrate-neon-test.js`
- `backend/src/lib/auditSanitizer.js`
- `backend/src/lib/postgresPaymentManagement.js`
- `backend/src/lib/security.js`
- `backend/src/routes/paymentWebhook.js`
- `backend/src/routes/postgresAdminPayments.js`
- `backend/src/routes/postgresBookings.js`
- `backend/src/app.js`
- `backend/test/postgresMigrations.test.js`
- `backend/test/postgresPaymentIntegration.test.js`
- `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`