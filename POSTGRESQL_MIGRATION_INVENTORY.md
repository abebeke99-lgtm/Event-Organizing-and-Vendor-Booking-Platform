# PostgreSQL Migration Inventory

Updated: 2026-11-11. This inventory reports the current source scan and isolated Neon test database only; it is not production evidence.

## Query Call Sites

Regenerated with `npm --workspace backend run audit:postgres-queries`:

| Classification | Calls | Meaning |
|---|---:|---|
| PostgreSQL infrastructure-only | 18 | Pool, adapter, migration infrastructure; not application feature calls |
| PostgreSQL application calls live-tested in the new payment slice | 48 introduced across the payment service/admin/customer routes | Main exercised paths have Neon evidence; not every branch is individually certified |
| MySQL `.execute()` semantics | 644 | Requires conversion or explicit MySQL-only classification |
| Query calls with detected MySQL syntax | 5 | Requires conversion; markers include MySQL-only SQL constructs |
| Query calls without detected markers | 320 | Still uncertified; absence of a marker is not PostgreSQL certification |
| Total application calls not certified by the inventory | 969 | Static scanner does not mark calls certified based on a test filename |
| Total calls inventoried | 987 | Scanned from 88 backend source JavaScript files |

The exact per-call inventory is [docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv](docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv). The 48 newly added payment call sites comprise 30 in `postgresPaymentManagement.js`, 13 in `postgresAdminPayments.js`, and 5 in `postgresBookings.js`. The live Neon test exercises the principal routes and transactional branches, but the scanner remains conservative and leaves them uncertified pending call-site-specific certification metadata.

## Database Schema

The validated isolated Neon test database is PostgreSQL 18, database `eventhub`:

| Schema check | Observed |
|---|---:|
| Application table names in PostgreSQL manifest | 51 present |
| Public base tables | 52, including `schema_migrations` |
| Public foreign keys | 82 |
| Public indexes | 151 |
| Recorded migrations | 9 (`001` through `009`) |

Migration `009_payment_status_width.sql` is additive and widens `payments.status` to `VARCHAR(24)`. The schema counts do not constitute column/type/default/constraint/index/trigger parity with the 40 legacy MySQL migrations plus `backend/schema.sql`.

## Feature Classification

| Feature | Classification | Evidence / remaining work |
|---|---|---|
| Payment provider webhook, payment success/failure | PostgreSQL converted; live Neon verified for tested branches | HMAC test harness, dedupe, rollback, persistence, and out-of-order rejection pass; real provider signature contract remains unverified |
| Customer payment list/detail | PostgreSQL converted; live Neon verified | Owner access succeeds; another customer receives 404 |
| Customer refund list/request | PostgreSQL converted; live Neon verified | Ownership, idempotency, amount reservations, audit/history, and concurrent reservation tested |
| Admin payment list/detail/export/report | PostgreSQL converted; live Neon verified for exercised filters | Permission gates, pagination, search/status/date filters, CSV/report responses tested |
| Admin refund list/detail/export/decision | PostgreSQL converted; live Neon verified for exercised paths | Read/export/refund permissions, approval, rejection, provider timeout/retry tested |
| MySQL payment/refund route set | MySQL-only legacy path retained | MySQL fake-executor unit suite is 9/9; no MySQL database connection was used for that unit run |
| Full application query inventory | Not complete | 969 application calls remain uncertified; audit modules and feature routes incrementally |
| Production schema/data migration | Not started | No production credentials, authorization, backup, or recovery point available |

## Remaining MySQL-Specific or Uncertified Areas

The repository still contains MySQL-style `?` placeholders/`execute()` result handling, `GROUP_CONCAT`, `DATE_FORMAT`, `CURDATE`, `DATE_ADD`/`DATE_SUB`, MySQL interval syntax, `ON DUPLICATE KEY UPDATE`, `LAST_INSERT_ID`, `SELECT DATABASE()`, and MySQL DDL (`AUTO_INCREMENT`, `UNSIGNED`, `ENUM`, `ENGINE=InnoDB`, and `ON UPDATE CURRENT_TIMESTAMP`). Large unconverted route modules include administration, platform/event management, vendor, customer, organizer, reports, notifications, and system controls. See [docs/POSTGRESQL_MIGRATION_INVENTORY.md](docs/POSTGRESQL_MIGRATION_INVENTORY.md) for historical incremental evidence and caveats.

## Test Results

- PostgreSQL migration unit tests: 9 passed, 0 failed, 0 skipped. Latest expanded live Neon payment integration: 1 passed, 0 failed, 0 skipped.
- Latest payment/refund live Neon integration: 1 passed, 0 failed, 0 skipped.
- MySQL payment-management unit tests: 9 passed, 0 failed; these use test doubles and do not certify a MySQL database.
- Full backend suite with PostgreSQL runtime settings: 446 total, 252 passed, 184 failed, 10 skipped. It is not green; legacy MySQL test/config paths remain.
- Frontend tests: 172 passed, 0 failed.
- Vite production build: passed with a compile-only API URL placeholder.