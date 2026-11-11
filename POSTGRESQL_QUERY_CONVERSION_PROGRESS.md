# PostgreSQL Query Conversion Progress

Updated: 2026-11-11  
Database used: isolated Neon test database `eventhub` only. Production was not accessed.

## Current Inventory

`npm --workspace backend run audit` regenerated [docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv](docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv):

| Measure | Current | Phase 1 baseline |
|---|---:|---:|
| Backend JavaScript source files scanned | 91 | 85 |
| Database `.query()` / `.execute()` call sites | 1068 | 939 |
| PostgreSQL infrastructure calls | 18 | 18 |
| Application call sites verified on isolated Neon | 12 | 0 |
| Application calls not certified | 1038 | 921 |

The inventory records explicit Neon verification metadata only for call sites with behavior-specific integration evidence. It does not certify a call based on filename or SQL-marker absence. The payment slice added 48 PostgreSQL query call sites, and the admin report/review slice has live Neon evidence for all 12 report types and the review/complaint workflows. This phase added explicit certification for 12 authentication query/adapter call sites; the authentication route was already PostgreSQL-native, so no application SQL conversion was needed. Unique-key race recovery and provider `pending` reconciliation remain unverified.

## PostgreSQL Tooling Follow-up

The PostgreSQL `db:init` path now runs the forward-only PostgreSQL migrations and avoids MySQL `schema.sql`/`seed.sql`; `db:check` validates PostgreSQL configuration and runtime connectivity without trying MySQL. The shared `db.js` module now dynamically loads `mysql2` only when the selected dialect is MySQL. The full backend `npm test` suite passed on Node `v20.20.2` (462 passed, 0 failed, 12 skipped); focused PostgreSQL config/migration tests passed 29/29. The skipped tests are opt-in Neon integrations, for which the separately recorded guarded Neon run remains the evidence. PostgreSQL initialization does not transfer legacy seed or production data.

## Phase 1 Slice: Authentication

| Original file/function and location | Query behavior | Test file | Isolated Neon result | Limitations |
|---|---|---|---|---|
| `backend/src/routes/postgresAuth.js` `query` adapter (line 39) | Shared parameterized PostgreSQL query dispatch | `backend/test/postgresAuthIntegration.test.js` | Passed | Adapter dispatch is exercised through tested routes; this is not coverage of other application adapters |
| `backend/src/routes/postgresAuth.js` `writeAudit` (line 50) | JSONB audit insert | `backend/test/postgresAuthIntegration.test.js` | Passed | Tested registration and login audit records |
| `backend/src/routes/postgresAuth.js` `createSession` (line 60) | Session insert | `backend/test/postgresAuthIntegration.test.js` | Passed | Tested session creation and subsequent deletion |
| `backend/src/routes/postgresAuth.js` `createRegistrationNotifications` (lines 71, 78, 86, 102) | Registration setting/admin lookups, notification `ON CONFLICT`, notification history insert | `backend/test/postgresAuthIntegration.test.js` | Passed | Tested with an isolated admin fixture; other notification workflows are outside this slice |
| `backend/src/routes/postgresAuth.js` registration handler (lines 170, 180, 187) | Customer role lookup, user `INSERT ... RETURNING`, role link insert | `backend/test/postgresAuthIntegration.test.js` | Passed | Also verifies duplicate/invalid-role errors and FK-triggered transaction rollback |
| `backend/src/routes/postgresAuth.js` login handler (lines 270, 273) | Login timestamp update and vendor-profile `ON CONFLICT` insert | `backend/test/postgresAuthIntegration.test.js` | Passed | Tests customer/vendor login; concurrent vendor-profile races are not separately tested |

The test also exercises availability, session lookup, `/me`, role redirect, user/admin logout, and invalid credentials. These calls use the route's `query(database, ...)` wrapper and are not separate `.query()`/`.execute()` member-call records in the static inventory. The inventory's 12 certified records are the explicit call sites listed above; no other auth source or other feature group is certified by this phase.

## Post-Runtime Validation (Node 20.x)

Validation ran on Node `v20.20.2`. `npm ci` passed (320 packages installed, 323 audited, 0 reported vulnerabilities). The backend portion of `npm test` reported 460 passed, 0 failed, and 11 skipped opt-in Neon cases; a separate guarded Neon integration rerun passed 33/33 tests against the isolated `eventhub` test database. Frontend tests passed 172/172, and the production build passed with a compile-only `https://api.example.invalid/api` value. No production endpoint or database was accessed.

The regenerated inventory contains 1,068 total calls (18 infrastructure, 12 application call sites verified on isolated Neon, and 1,038 application calls not certified). Neon integration coverage demonstrates only the tested workflows and does not certify every query call site. The PostgreSQL configuration explicitly selects `pg` and does not fall back to MySQL; MySQL development selects `mysql2`, but the local loopback database was unavailable (`ECONNREFUSED`). The `mysql2` dependency remains intentionally installed pending parity. Production `VITE_API_URL` remains unset and must be configured for a deployment build.

## Completed Slice: Administrator Reports, Reviews, and Complaints

| Activity | Result |
|---|---|
| Routes added | `postgresAdminReports.js` exposes all 12 report types and CSV export; `postgresAdminReviewsComplaints.js` preserves listing, details, review moderation, complaint assignment/status updates, history, notifications, and protected attachments |
| Permissions and contracts | Existing report/review/complaint permissions, validated filter fields, pagination, report response shape, CSV headers, history/audit records, and attachment limits/signature checks retained |
| Neon test | `postgresAdminIntegration.test.js`: 8 passed, 0 failed, 0 skipped; exercises all report types and live review/complaint workflows |
| Regression tests | `postgresAdminReports.test.js`, `reportAnalytics.test.js`, and `adminReviewsComplaintsApi.test.js`: 15 passed, 0 failed |
| Issue found and fixed | Neon rejected a complaint update's unqualified `FOR UPDATE` over nullable outer joins (`0A000`); locking is now limited to `FOR UPDATE OF c` |
| Localization | Added Amharic translations for the previously uncovered PostgreSQL payment messages; static localization coverage passes |

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

The source inventory still has 1,038 application call sites not certified. Authentication coverage in this phase is limited to the explicit PostgreSQL-native route call sites above; account changes and all other major areas remain to inspect/convert/test, including profile photos, event management, categories, vendor management, services/packages, visitor workflows beyond the marketplace endpoints tested here, availability, bookings/quotations beyond existing PostgreSQL slices, notifications, messaging, remaining administrator modules, audit logs, settings, seed and operational scripts, and legacy SQL migrations.

MySQL remains in the legacy runtime, SQL modules, standard schema/migration files, dependencies, and deployment documentation. Those paths cannot be removed until equivalent PostgreSQL behavior is implemented and tested. Render configuration was not changed. Production migration, backup/restore, data copy, and deployment verification remain blocked on authorized production configuration and recovery approval.

## Tests and Checks

- `npm --workspace backend run audit:postgres-queries`: passed; 1068 call sites inventoried across 91 files (18 infrastructure, 12 application call sites verified on isolated Neon, 1038 application calls not certified).
- `RUN_NEON_INTEGRATION=true node --test backend/test/postgresAuthIntegration.test.js`: 1 passed, 0 failed, 0 skipped; exercises registration, notifications/history, duplicate and invalid credentials, customer/vendor login, session lookup/logout, `/me`, role redirect, vendor profile upsert, and transaction rollback on isolated Neon PostgreSQL 18 `eventhub`.
- `npm --workspace backend run migrate:neon-test`: latest guarded check reported the isolated Neon database was up to date through migration 010; schema-integrity checks passed.
- `npm --workspace backend run db:check:neon-test`: previously passed on final retry; 51 application tables, 82 FKs, and 151 indexes were verified on isolated Neon. The latest migration check confirms migrations 001–010. Earlier retries in the prior session hit documented transient Neon acquisition failures.
- Latest `RUN_NEON_INTEGRATION=true node --test backend/test/postgresPaymentIntegration.test.js`: 1 passed, 0 failed, 0 skipped. The prior combined migration + payment run passed 10/10; migration unit tests have not changed since that run.
- Latest `RUN_NEON_INTEGRATION=true node --test backend/test/postgresAdminIntegration.test.js`: 8 passed, 0 failed, 0 skipped, including all 12 admin report types and review/complaint listing, moderation, assignment, history, notifications, and attachment handling.
- Latest guarded Neon marketplace integration (`backend/test/vendorPublicApi.test.js`): 12 passed, 0 failed, including vendor/category/service listings and details, category images, packages, filtering, validation, and anonymous authorization. This replaced the old vendor-public test setup that required a local MySQL pool and MySQL fixture SQL.
- Focused report/review regression tests: 15 passed, 0 failed. Static Amharic message coverage: 6 passed, 0 failed.
- Existing `backend/test/paymentManagement.test.js`: 9 passed, 0 failed with non-connecting dummy pool configuration; fake-executor tests are MySQL unit regression evidence only.
- Historical full backend suite, serial, on Node 24.15.0 (project target: Node 20.x): 490 passed, 0 failed, 0 skipped, with guarded Neon integrations enabled. Existing legacy-mode tests used `DB_DIALECT=mysql` and non-connecting local placeholders; the replaced vendor-public tests used the isolated Neon test database. This run is not Node 20 evidence or proof of PostgreSQL-only parity.
- Historical full-suite diagnostic forced globally into PostgreSQL mode: 446 total, 252 passed, 184 failed, 10 skipped. These remaining failures show that the full runtime/test surface is not ready to switch globally to PostgreSQL.
- Earlier cleanup continuation reruns on Node 24.15.0: 444 total with 183 or 185 failures depending on Neon integration configuration. They predate the current 489-test run and are retained as historical evidence.
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