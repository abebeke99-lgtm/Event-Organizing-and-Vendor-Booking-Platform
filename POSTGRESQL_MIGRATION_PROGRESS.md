# PostgreSQL Migration Progress

Updated: 2026-11-11. Work is incremental; the overall PostgreSQL migration is incomplete. Production was not accessed.

## Post-Runtime Validation (Node 20.x)

The post-runtime configuration and test validation used Node `v20.20.2`. Environment files were not displayed. Backend environment loading precedes startup validation; database pools initialize lazily, and explicit PostgreSQL mode selects the PostgreSQL driver without falling back to MySQL. Missing production database configuration fails with a configuration error. The MySQL development path selected `mysql2`, but its guarded loopback connection could not be established (`ECONNREFUSED` at `127.0.0.1:3306`).

| Validation | Result |
|---|---|
| `npm ci` | Passed under Node 20.20.2; 320 packages installed, 323 audited, 0 reported vulnerabilities |
| `npm test` backend | 460 passed, 0 failed, 11 skipped; skipped cases are opt-in Neon integration tests |
| Opt-in Neon integration rerun | 33 passed, 0 failed, 0 skipped across the guarded PostgreSQL integration files, using only the isolated `eventhub` test database |
| Frontend tests | 172 passed, 0 failed |
| Frontend production build | Passed with compile-only `https://api.example.invalid/api`; the production API URL remains unset and is required at deployment/build time |
| Production access | None; no production database connection or migration was attempted |

This validates the MySQL and PostgreSQL configuration paths independently, not full PostgreSQL feature parity. The current inventory has 1,074 call sites: 18 infrastructure calls, 18 application call sites verified on isolated Neon, and 1,038 application calls not certified. A historical full-PostgreSQL-mode diagnostic had 184 failures; those legacy-path incompatibilities remain unresolved.

## PostgreSQL Tooling Follow-up

- Fixed `db:init` so explicit PostgreSQL mode runs the forward-only PostgreSQL migrations rather than sending MySQL `schema.sql` and `seed.sql` to PostgreSQL. The MySQL development branch remains unchanged.
- Fixed `db:check` to validate PostgreSQL configuration and the PostgreSQL runtime connection when PostgreSQL is selected; it no longer attempts MySQL in that mode.
- Changed `db.js` to load `mysql2` only for MySQL mode. The PostgreSQL mode no longer imports the MySQL driver.
- These changes passed the full backend `npm test` suite on Node `v20.20.2`: 462 passed, 0 failed, 12 skipped. The focused PostgreSQL configuration/migration tests passed 29/29. The 12 skips are opt-in Neon integration tests; the previously recorded isolated Neon integration run remains separate evidence.
- PostgreSQL `db:init` applies schema migrations only; it does not import the MySQL seed file. Production data transfer and any required operational/default records still need an explicit, reviewed migration/data plan.

## Completed In This Continuation

- Verified the Neon target before testing: isolated database `eventhub`, PostgreSQL 18, pooled and direct connections.
- Added PostgreSQL-native administrator report listing/export routes for all 12 report types and mounted them in PostgreSQL mode. Preserved validated filters, role/financial permission checks, pagination, timezone-aware ranges, CSV safety, and export audit records.
- Added PostgreSQL-native administrator reviews/complaints routes for list/detail, review moderation, complaint assignment/status transitions, history/audit, notifications, and protected attachment upload/download.
- Expanded the isolated Neon admin integration test to execute every report type and the review/complaint workflows. Neon exposed a PostgreSQL `FOR UPDATE` error on a nullable join; the complaint update now locks only the complaint row with `FOR UPDATE OF c`.
- Updated Amharic translations for the PostgreSQL payment messages caught by the static localization test.
- Extended the PostgreSQL customer APIs with owner-scoped payment detail and verified customer/other-customer authorization against Neon.
- Added administrator refund detail with the existing `payments.view` permission.
- Expanded provider webhook integration to exercise valid HMAC, missing/invalid signature, duplicate events, payment success/failure, refund success/failure, and out-of-order payment events through HTTP.
- Added concurrent refund reservation coverage; exactly one of two over-reserving requests is accepted. Added provider timeout/retry coverage and confirmed a timeout leaves a refund processing rather than succeeded.
- Replaced the vendor-public tests' default MySQL app/global-pool setup and MySQL fixture SQL with a guarded Neon integration using unique, FK-safe fixtures. The 12 live assertions cover public vendors, categories/images, services/packages, filters, availability, validation, and anonymous authorization.
- Tightened test cleanup to exact random fixture identifiers, removed redundant pre-cleanup, and made resource cleanup resilient if Neon cleanup itself fails.
- Preserved MySQL implementations and deployment configuration.
- Normalized PostgreSQL dialect selection across startup, the runtime pool, and app routing; invalid dialect values now fail closed instead of silently constructing a MySQL pool.
- Regenerated `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`.
- Added isolated Neon API integration coverage for PostgreSQL authentication: registration/rollback, customer and vendor login, sessions, notifications/history, `/me`, role redirect, logout, and vendor profile upsert. Added explicit source-location certification metadata for 12 inventory call sites; no authentication SQL source conversion was needed.
- Added PostgreSQL customer profile read/update and password-change routes, including transactional auditing and invalidation of other user sessions. Isolated Neon integration verifies the six query call sites, wrong-password behavior, profile validation, and successful login only with the changed password. Legacy MySQL customer routes remain unchanged.

## Current Evidence

| Validation | Result |
|---|---|
| Isolated Neon identity/schema | PostgreSQL 18 `eventhub`; 51 app tables, 82 FKs, 151 indexes; migrations 001–010 |
| Neon runtime/direct connectivity | Read-only check passed for both endpoints with certificate-verified TLS, DNS resolution, `SELECT 1`, expected database identity, and successful pool shutdown |
| Database driver installation | `pg@8.23.1` and `mysql2@3.24.6` are installed |
| Focused database configuration, adapter, retry, and startup tests | 75 passed, 0 failed |
| Focused customer/auth regression tests | 34 passed, 0 failed |
| Latest auth/customer-account Neon integration | 1 passed, 0 failed, 0 skipped |
| Neon pooled/direct concurrency and cleanup | 186 queries passed; each pool capped at 2 clients with 0 active and 0 waiting clients after each run |
| Local MySQL connection | Not available: the guarded loopback-only `SELECT 1` check returned `ECONNREFUSED`; MySQL configuration/TLS unit tests pass |
| PostgreSQL migrations + live payment suite | 10 passed, 0 failed, 0 skipped |
| Latest expanded live payment/refund integration | 1 passed, 0 failed, 0 skipped |
| Isolated Neon admin integration, including reports and review/complaint operations | 8 passed, 0 failed, 0 skipped |
| Public marketplace Neon integration | 12 passed, 0 failed; no local MySQL server used |
| Focused report/review regression tests | 15 passed, 0 failed |
| Historical complete backend test suite, serial, Neon integrations enabled | 490 passed, 0 failed, 0 skipped; Node 24.15.0, `DB_DIALECT=mysql` for existing legacy-mode tests; Neon integrations used only the guarded `eventhub` test database |
| Existing MySQL payment unit tests | 9 passed, 0 failed; fake-executor unit coverage only |
| Backend suite forced globally into PostgreSQL mode | Earlier diagnostic: 446 total, 252 passed, 184 failed, 10 skipped; legacy tests/routes remain incompatible with global PostgreSQL mode |
| Frontend tests | 172 passed, 0 failed |
| Production Vite build | Passed with compile-only `https://api.example.invalid/api`; not a real deployment URL |
| Query inventory | 1074 total calls, 18 infrastructure, 18 auth/customer-account call sites verified on isolated Neon, 1038 application calls not certified |

The prior 11 vendor-public failures were caused by tests using the default MySQL pool and fixtures; those tests now pass against Neon without a local MySQL server. The 490-test suite used `DB_DIALECT=mysql` for legacy-mode tests and explicitly enabled the guarded Neon integrations; it is not proof that the full application can run in PostgreSQL-only mode. Node 20 validation is summarized above. The earlier global-PostgreSQL diagnostic still shows 184 failures in legacy paths and remains migration work.

## Still Outstanding

- Convert and live-test all other application feature groups, especially administrator/event/vendor/customer/organizer operations, messaging, and remaining settings/security/payment-adjacent routes.
- Reconcile all 51 PostgreSQL tables semantically with the legacy schema and all 40 MySQL migrations; table/FK/index counts alone are insufficient.
- Continue certifying individual query call sites only after behavior-specific PostgreSQL tests; only 18 PostgreSQL authentication/customer-account call sites are explicitly certified in the inventory so far.
- Investigate and resolve the 184 failures from the earlier global-PostgreSQL diagnostic; retain the exact test environment when comparing runs.
- Replace MySQL runtime defaults/deployment variables only after full feature parity and regression evidence. `render.yaml` and `DEPLOYMENT.md` remain MySQL-oriented.
- Keep the `mysql2` dependency and MySQL implementations until PostgreSQL parity is verified; the local MySQL service was unavailable during this validation.
- Supply and validate the deployment's real production API URL; `frontend/.env.production` intentionally has no loopback or placeholder value.
- Production credential authorization, identity check, recovery point, migration/data plan, deployment verification, and traffic cutover remain blocked and untouched.

## Changed Files In Scope

New in this continuation: `backend/src/routes/postgresAdminReports.js`, `backend/src/routes/postgresAdminReviewsComplaints.js`, and `backend/test/postgresAdminReports.test.js`.

Modified in this continuation: `backend/src/app.js`, `backend/src/lib/reportAnalytics.js`, `backend/src/lib/localization.js`, `backend/test/postgresAdminIntegration.test.js`, `backend/test/vendorPublicApi.test.js`, and `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`.

## Earlier Cleanup Continuation Test Runs

These earlier local reruns used Node 24.15.0 (the project declares Node 20.x). Their 444-test totals predate the current 490-test run above.

| Validation | Result |
|---|---|
| Backend suite, Neon integration disabled | 444 total: 251 passed, 183 failed, 10 skipped |
| Backend suite, isolated Neon integration enabled | 444 total: 259 passed, 185 failed, 0 skipped |
| Frontend tests | 172 passed, 0 failed |
| Production Vite build | Passed with compile-only `https://api.example.invalid/api`; not a deployment URL |

Those earlier runs predate the vendor-public test migration and are retained as historical evidence. The latest complete backend run is recorded above; it did not delete or skip tests to obtain a passing result. All live integration tests targeted only the guarded `eventhub` Neon test database; production was not accessed.

The cleanup continuation also ran `npm --workspace backend run migrate:neon-test`; the guarded check reported the isolated database was up to date through migration 010. No production migration was run.