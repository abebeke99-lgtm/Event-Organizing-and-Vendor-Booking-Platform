# PostgreSQL Migration Inventory

Updated: 2026-11-11. This inventory reports the current source scan and isolated Neon test database only; it is not production evidence.

## Query Call Sites

Regenerated with `npm --workspace backend run audit:postgres-queries`:

| Classification | Calls | Meaning |
|---|---:|---|
| PostgreSQL infrastructure-only | 18 | Pool, adapter, migration infrastructure; not application feature calls |
| PostgreSQL application routes added and live-tested in this continuation | Admin reports; admin reviews/complaints | All 12 report types and review/complaint workflows passed the isolated Neon integration |
| MySQL `.execute()` semantics | 644 | Requires conversion or explicit MySQL-only classification |
| Query calls with detected MySQL syntax | 5 | Requires conversion; markers include MySQL-only SQL constructs |
| Query calls without detected markers, not certified | 389 | Absence of a marker is not PostgreSQL certification |
| Application call sites verified on isolated Neon | 18 | Explicit source-location metadata backed by auth and customer-account integration |
| Total application calls not certified by the inventory | 1038 | Most application calls remain unverified |
| Total calls inventoried | 1074 | Scanned from 92 backend source JavaScript files |

The exact per-call inventory is [docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv](docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv). The payment call sites comprise 30 in `postgresPaymentManagement.js`, 13 in `postgresAdminPayments.js`, and 5 in `postgresBookings.js`; admin reports and review/complaint routes are also exercised by Neon integration tests. Eighteen individual call sites are explicitly recorded as Neon-verified: 12 authentication and six customer profile/password operations. Authentication was already PostgreSQL-native; this continuation added a PostgreSQL customer-account router without changing the legacy MySQL customer route. The authentication test also exercises wrapper-invoked availability, login, `/me`, role redirect, and logout queries, which are not separate `.query()`/`.execute()` member-call records in the scanner. All unlisted calls remain uncertified.

Each CSV row has a deterministic path/line/column/method ID and separate dialect, migration-stage, PostgreSQL test, Neon verification, and remaining-issue columns. The static AST pass is not semantic query inspection: 1,038 application calls are currently `Not inspected` at call-site level. Eighteen infrastructure calls are counted separately and are not included in the 1,056 application-call total.

See [POSTGRESQL_QUERY_CONVERSION_REPORT.md](./POSTGRESQL_QUERY_CONVERSION_REPORT.md) for the batch-level evidence and limits.

## Database Schema

The validated isolated Neon test database is PostgreSQL 18, database `eventhub`:

| Schema check | Observed |
|---|---:|
| Application table names in PostgreSQL manifest | 51 present |
| Public base tables | 52, including `schema_migrations` |
| Public foreign keys | 82 |
| Public indexes | 151 |
| Recorded migrations | 10 (`001` through `010`) |

Migration `009_payment_status_width.sql` is additive and widens `payments.status` to `VARCHAR(24)`. The schema counts do not constitute column/type/default/constraint/index/trigger parity with the 40 legacy MySQL migrations plus `backend/schema.sql`.

## Feature Classification

| Feature | Classification | Evidence / remaining work |
|---|---|---|
| Public vendor/category/service marketplace | Existing PostgreSQL implementation; live Neon integration verified for exercised endpoints | Vendor/category/service listing and detail, category images, packages, search/filters, pagination, availability, validation, and anonymous authorization were exercised using unique disposable fixtures |
| Payment provider webhook, payment success/failure | PostgreSQL converted; live Neon verified for tested branches | HMAC test harness, dedupe, rollback, persistence, and out-of-order rejection pass; real provider signature contract remains unverified |
| Customer payment list/detail | PostgreSQL converted; live Neon verified | Owner access succeeds; another customer receives 404 |
| Customer refund list/request | PostgreSQL converted; live Neon verified | Ownership, idempotency, amount reservations, audit/history, and concurrent reservation tested |
| Admin payment list/detail/export/report | PostgreSQL converted; live Neon verified for exercised filters | Permission gates, pagination, search/status/date filters, CSV/report responses tested |
| Admin refund list/detail/export/decision | PostgreSQL converted; live Neon verified for exercised paths | Read/export/refund permissions, approval, rejection, provider timeout/retry tested |
| Admin reports | PostgreSQL converted; live Neon verified for all 12 report types | Filtered listing, summary/chart payloads, CSV export and audit logging exercised |
| Admin reviews/complaints | PostgreSQL converted; live Neon verified for listing, moderation, assignment/status update, history, notifications, and attachments | Live update exposed and fixed invalid `FOR UPDATE` behavior on nullable joins |
| Authentication | PostgreSQL-native route; 12 inventory call sites explicitly Neon-verified | Registration, notifications/history, duplicate/error paths, customer/vendor login, sessions/logout, `/me`, redirect, vendor profile upsert, and transaction rollback exercised |
| Customer account profile/password | PostgreSQL route added; 6 inventory call sites explicitly Neon-verified | Profile read/update, validation, password verification/change, other-session invalidation, audit writes, and subsequent login behavior exercised |
| MySQL payment/refund route set | MySQL-only legacy path retained | MySQL fake-executor unit suite is 9/9; no MySQL database connection was used for that unit run |
| Full application query inventory | Not complete | 1038 application calls remain uncertified; audit modules and feature routes incrementally |
| Production schema/data migration | Not started | No production credentials, authorization, backup, or recovery point available |

## Remaining MySQL-Specific or Uncertified Areas

The repository still contains MySQL-style `?` placeholders/`execute()` result handling, `GROUP_CONCAT`, `DATE_FORMAT`, `CURDATE`, `DATE_ADD`/`DATE_SUB`, MySQL interval syntax, `ON DUPLICATE KEY UPDATE`, `LAST_INSERT_ID`, `SELECT DATABASE()`, and MySQL DDL (`AUTO_INCREMENT`, `UNSIGNED`, `ENUM`, `ENGINE=InnoDB`, and `ON UPDATE CURRENT_TIMESTAMP`). Large unconverted route modules include administration, platform/event management, vendor, customer, organizer, reports, notifications, and system controls. See [docs/POSTGRESQL_MIGRATION_INVENTORY.md](docs/POSTGRESQL_MIGRATION_INVENTORY.md) for historical incremental evidence and caveats.

## Test Results

- PostgreSQL migration unit tests: 9 passed, 0 failed, 0 skipped. Latest expanded live Neon payment integration: 1 passed, 0 failed, 0 skipped.
- Latest payment/refund live Neon integration: 1 passed, 0 failed, 0 skipped.
- Public marketplace Neon integration: 12 passed, 0 failed; guarded `.env.neon-test` only, no local MySQL server.
- MySQL payment-management unit tests: 9 passed, 0 failed; these use test doubles and do not certify a MySQL database.
- Latest complete backend suite: 490 passed, 0 failed, 0 skipped with serial test-file execution and Neon integrations enabled. Legacy-mode unit tests used `DB_DIALECT=mysql` with non-connecting local placeholders; the live Neon suites use the guarded isolated `eventhub` test database. No production database was accessed.
- Authentication Neon integration: 1 passed, 0 failed, 0 skipped; the isolated test covers the PostgreSQL auth API and a forced foreign-key failure to verify transactional rollback.
- Customer/auth focused regression tests: 34 passed, 0 failed; latest Neon authentication plus customer-account integration: 1 passed, 0 failed, 0 skipped.
- Earlier full backend diagnostic forced globally into PostgreSQL mode: 446 total, 252 passed, 184 failed, 10 skipped. This remains evidence that legacy tests/routes are not ready for a PostgreSQL-only runtime; it is distinct from the latest passing mixed test suite.
- Frontend tests: 172 passed, 0 failed.
- Vite production build: passed with a compile-only API URL placeholder.

### Cleanup continuation rerun

The earlier cleanup rerun used Node 24.15.0 (the project declares Node 20.x) and the guarded Neon test configuration loaded in-process without displaying its values. Its 444-test totals are superseded by the 490-test run above:

- Backend suite, Neon integration disabled: 444 total, 251 passed, 183 failed, 10 skipped.
- Backend suite, isolated Neon integration enabled: 444 total, 259 passed, 185 failed, 0 skipped.
- Frontend tests: 172 passed, 0 failed.
- Production build: passed with compile-only `VITE_API_URL=https://api.example.invalid/api`.

These historical results are recorded separately from the latest suite because the runtime/test environment differed. Neither the latest passing suite nor the earlier isolated Neon integration run certifies every application query or establishes PostgreSQL-only runtime parity.