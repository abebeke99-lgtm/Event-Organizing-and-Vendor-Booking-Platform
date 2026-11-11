# PostgreSQL Migration Progress

Updated: 2026-11-11. Work is incremental; the overall PostgreSQL migration is incomplete. Production was not accessed.

## Completed In This Continuation

- Verified the Neon target before testing: isolated database `eventhub`, PostgreSQL 18, pooled and direct connections.
- Extended the PostgreSQL customer APIs with owner-scoped payment detail and verified customer/other-customer authorization against Neon.
- Added administrator refund detail with the existing `payments.view` permission.
- Expanded provider webhook integration to exercise valid HMAC, missing/invalid signature, duplicate events, payment success/failure, refund success/failure, and out-of-order payment events through HTTP.
- Added concurrent refund reservation coverage; exactly one of two over-reserving requests is accepted. Added provider timeout/retry coverage and confirmed a timeout leaves a refund processing rather than succeeded.
- Tightened test cleanup to exact random fixture identifiers, removed redundant pre-cleanup, and made resource cleanup resilient if Neon cleanup itself fails.
- Preserved MySQL implementations and deployment configuration.
- Regenerated `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`.

## Current Evidence

| Validation | Result |
|---|---|
| Isolated Neon identity/schema | PostgreSQL 18 `eventhub`; 51 app tables, 82 FKs, 151 indexes; migrations 001–009 |
| PostgreSQL migrations + live payment suite | 10 passed, 0 failed, 0 skipped |
| Latest expanded live payment/refund integration | 1 passed, 0 failed, 0 skipped |
| Existing MySQL payment unit tests | 9 passed, 0 failed; fake-executor unit coverage only |
| Full backend suite under PostgreSQL settings | 446 total: 252 passed, 184 failed, 10 skipped; failure gate remains open |
| Frontend tests | 172 passed, 0 failed |
| Production Vite build | Passed with compile-only `https://api.example.invalid/api`; not a real deployment URL |
| Query inventory | 987 total calls, 18 infrastructure, 969 application calls not certified |

The full backend failures span legacy route/configuration tests that expect MySQL result shapes and MySQL `DATABASE_URL` validation, along with database-backed tests whose expected fixture state does not match the Neon test database. Do not treat this run as proof of full PostgreSQL compatibility or attribute every failure to the payment slice without individual investigation.

## Still Outstanding

- Convert and live-test all other application feature groups, especially administrator/event/vendor/customer/organizer operations, notifications, messaging, reviews/complaints, detailed reports, settings/security, and remaining payment-adjacent routes.
- Reconcile all 51 PostgreSQL tables semantically with the legacy schema and all 40 MySQL migrations; table/FK/index counts alone are insufficient.
- Certify individual query call sites only after behavior-specific PostgreSQL tests; the static inventory currently certifies none of the new application calls automatically.
- Investigate and resolve the 184 full-backend failures under PostgreSQL configuration; retain the exact test environment when comparing runs.
- Replace MySQL runtime defaults/deployment variables only after full feature parity and regression evidence. `render.yaml` and `DEPLOYMENT.md` remain MySQL-oriented.
- Production credential authorization, identity check, recovery point, migration/data plan, deployment verification, and traffic cutover remain blocked and untouched.

## Changed Files In Scope

New: `backend/src/routes/postgresAdminPayments.js`, `backend/src/lib/postgresPaymentManagement.js`, `backend/src/lib/auditSanitizer.js`, `backend/test/postgresPaymentIntegration.test.js`, `backend/postgres/migrations/009_payment_status_width.sql`, and this report set.

Modified: `backend/src/app.js`, `backend/src/lib/security.js`, `backend/src/routes/postgresBookings.js`, `backend/src/routes/paymentWebhook.js`, `backend/scripts/migrate-neon-test.js`, `backend/test/postgresMigrations.test.js`, and `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`. Earlier worktree edits to `backend/scripts/migrate.js`, `backend/scripts/dev-neon.js`, and `backend/package.json` were preserved.