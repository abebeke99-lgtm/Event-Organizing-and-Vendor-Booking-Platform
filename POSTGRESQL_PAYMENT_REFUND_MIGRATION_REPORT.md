# PostgreSQL Payment and Refund Migration Report

Updated: 2026-11-11  
Database scope: verified isolated Neon PostgreSQL test project/database `eventhub` only. No production Neon, Render, or Netlify settings were accessed or changed.

## Result

PostgreSQL mode now provides customer payment listing/detail, customer refund listing/request creation, administrator payment/refund listing/detail/export/report/decisions, and signed provider webhook processing. SQL uses PostgreSQL placeholders and the existing shared `pg` transaction adapter. Payment/refund state, histories, and audit records are written transactionally. Payment/refund database access is owner- or permission-scoped.

Migration `009_payment_status_width.sql` widens `payments.status` to `VARCHAR(24)` because the valid state `partially_refunded` does not fit the previous width of 16. It was applied additively to the isolated test database only; no table was dropped or recreated.

## Endpoints

Customer routes mounted in PostgreSQL mode:

- `GET /api/customer/payments`
- `GET /api/customer/payments/:id`
- `GET /api/customer/refunds`
- `POST /api/customer/payments/:id/refunds`

Administrator routes mounted after `requireAdmin`:

- `GET /api/admin/payments` with pagination, search, status, and UTC date filters
- `GET /api/admin/payments/:id`
- `GET /api/admin/payments/export`
- `GET /api/admin/payments/report`
- `GET /api/admin/refunds` with pagination, search, status, and UTC date filters
- `GET /api/admin/refunds/:id`
- `GET /api/admin/refunds/export`
- `PATCH /api/admin/refunds/:id/decision`

Provider route:

- `POST /api/payments/webhook`; it retains raw-body provider verification and dispatches to the PostgreSQL implementation only when the app dialect is PostgreSQL. MySQL continues to use the existing MySQL processor.

Customer reads and refund creation are scoped to the authenticated event owner. Tests verify a second customer receives `404` for another customer's payment/refund and an ordinary customer receives `403` from administrator payment routes. Administrator read/export/decision permissions remain `payments.view`, `payments.export`, `reports.view`, and `payments.refund`.

## Transaction and Provider Behavior

- Refund requests lock the payment row before calculating reserved pending/processing/succeeded refunds. A live concurrent test submits two requests that together exceed the remaining balance; exactly one succeeds and the other receives a `409`.
- Idempotency uses unique refund keys and `ON CONFLICT` event insertion; replayed provider event IDs do not repeat state changes.
- Provider payment/refund events, status transitions, payment history, and refund history share a PostgreSQL transaction. Invalid event data rolls back the provider-event row.
- An out-of-order failure cannot reverse a confirmed payment.
- Refund approval changes the request to `processing` before calling the provider. Provider timeout leaves it `processing`; an explicit later retry can finish it. A refund is not marked succeeded without a successful provider result and reference.
- The integration provider implements a test-only HMAC verifier with a random test secret. This verifies the route's signed-raw-body contract, not any real provider's production signature format or credentials.
- Monetary values are validated and compared in integer cents; PostgreSQL `NUMERIC` values are normalized for the existing JSON contract.

## Test Evidence

| Check | Result |
|---|---|
| Neon test identity | PostgreSQL 18, database `eventhub`; pooled and direct test endpoints passed |
| Test schema | 51 application table names, 82 foreign keys, 151 indexes, 52 public base tables including migration history |
| Applied migrations | `001_initial_schema.sql` through `009_payment_status_width.sql` |
| Latest payment/refund Neon integration | 1 passed, 0 failed, 0 skipped |
| PostgreSQL migration unit tests, latest run | 9 passed, 0 failed, 0 skipped |
| Existing MySQL payment unit suite | 9 passed, 0 failed; tests use injected fake executors and a non-connecting dummy pool configuration, so this is not database-backed MySQL compatibility evidence |
| Full backend suite under PostgreSQL runtime settings | 446 total: 252 passed, 184 failed, 10 skipped. Legacy MySQL route/configuration tests remain incompatible with PostgreSQL mode; this is a failing regression gate, not a pass |
| Frontend tests | 172 passed, 0 failed, 0 skipped |
| Vite production build | Passed with compile-only `https://api.example.invalid/api`; this is not a production API configuration |
| Query inventory | 987 call sites; 18 infrastructure calls; 969 application calls not certified |

Neon pooler acquisition timed out intermittently during this work; final isolated Neon schema checks and live payment integration did pass after retries. Expected unauthorized/invalid-signature/provider-timeout responses are logged as sanitized generic PostgreSQL request failures by the existing error middleware.

## Files Created

- `backend/postgres/migrations/009_payment_status_width.sql`
- `backend/src/lib/auditSanitizer.js`
- `backend/src/lib/postgresPaymentManagement.js`
- `backend/src/routes/postgresAdminPayments.js`
- `backend/test/postgresPaymentIntegration.test.js`
- `POSTGRESQL_PAYMENT_REFUND_MIGRATION_REPORT.md`
- `POSTGRESQL_MIGRATION_INVENTORY.md`
- `POSTGRESQL_MIGRATION_PROGRESS.md`

## Files Modified

- `backend/package.json`
- `backend/scripts/check-neon-test-db.js`
- `backend/scripts/migrate-neon-test.js`
- `backend/src/app.js`
- `backend/src/lib/security.js`
- `backend/src/routes/paymentWebhook.js`
- `backend/src/routes/postgresBookings.js`
- `backend/test/postgresMigrations.test.js`
- `docs/POSTGRESQL_MIGRATION_INVENTORY.md`
- `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`
- `POSTGRESQL_QUERY_CONVERSION_PROGRESS.md`
- `POSTGRESQL_APPLICATION_COMPATIBILITY_REPORT.md`
- `POSTGRESQL_DEPLOYMENT_CONFIGURATION_REPORT.md`

`backend/scripts/migrate.js` and earlier edits in `backend/test/postgresMigrations.test.js` were already present in the worktree before this continuation; they were preserved.

## Remaining Risks and Work

- The MySQL implementations remain in `paymentManagement.js`, `adminPayments.js`, `customer.js`, and `paymentWebhook.js`'s legacy dispatch. They were not removed to preserve MySQL behavior during migration.
- No real payment provider, production signing secret, provider reconciliation service, or live payment credentials were available. Provider retry behavior was tested with an isolated fake adapter over real Neon persistence.
- The full backend suite is not green under PostgreSQL configuration. Many legacy modules are still unconverted and fail when their MySQL-shaped tests run against PostgreSQL mode.
- Duplicate-key refund-request race recovery is implemented but not deterministically forced by the live test; provider-pending reconciliation and simultaneous administrator approvals still need dedicated cases.
- No production migration, data copy, backup, deployment change, or production verification was performed.