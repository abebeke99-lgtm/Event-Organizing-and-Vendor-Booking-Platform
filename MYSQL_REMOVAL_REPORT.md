# MySQL Removal Report

Audit date: 2026-11-11  
Status: Inventory and limited cleanup; PostgreSQL-only migration is incomplete. No MySQL dependency or implementation has been removed.

## Safety and Worktree Baseline

- Branch at this task's start: `neon-migration`; the initial working tree was clean. An earlier audit recorded a different dirty-tree snapshot; those earlier changes were not present at this task's start.
- No unrelated user changes were overwritten. The generated `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv` was not modified during this cleanup.
- No production credentials were read or used, and no production connection was attempted.
- `backend/.env.neon-test` exists, is Git-ignored, and is not tracked. Its contents were not displayed. Its loader validates pooled and direct Neon URLs against database `eventhub` before connecting.
- `npm --workspace backend run db:check:neon-test` previously passed using read-only identity/catalog queries: PostgreSQL 18, both pooled and direct endpoints, 51 application tables, 82 foreign keys, and 151 indexes. The cleanup continuation's guarded migration check returned up to date through migration 010. No production DDL or data mutation was run.
- The legacy `qa-e2e-check.js` was not run. It connects directly to local `event_platform`, creates user/event/service/booking records, and updates vendor verification.

## Findings by Classification

### KEEP

- PostgreSQL/Neon configuration, adapters, migrations, route implementations, and their tests.
- Existing application routes, frontend workspaces, role-based dashboards, bilingual UI, responsive styles, assets, and historical MySQL migration/schema files until their PostgreSQL replacements are complete and verified.
- `mysql2` for now: `backend/src/db.js`, the legacy feature routes and migration code still depend on it.
- The tagged `backend/seed.sql` for now: `backend/scripts/db-init.js` actively reads it, and its PostgreSQL replacement is not yet wired to an initializer.

### REMOVE

- `backend/testlog.txt`: unreferenced generated test output.
- `tylingCLS`: unreferenced saved diff artifact with an invalid filename; the corresponding application source remains in place.

### REFACTOR

- Remove the active MySQL dialect/default only after migrating and testing the remaining feature routes and scripts.
- Convert or certify the 1038 remaining uncertified application query call sites and establish semantic schema parity before removing the legacy schema or migration history.
- Reconcile deployment settings and user-facing documentation with the actual production database only after PostgreSQL cutover is approved.

### REVIEW

- Root-level dependency entries beyond workspace requirements; no full dependency-usage proof was completed, so none were removed.
- `.snapshots/`, the separate ignored `personalportofolio/` directory, local environment files, and older migration/test artifacts; preserve pending ownership and runtime-use decisions.
- Existing audit/progress documents that describe earlier test runs; retain as historical evidence and distinguish from new local results.

### Confirmed Active PostgreSQL Gaps

- PostgreSQL mode now mounts PostgreSQL-native admin reports and reviews/complaints routes. Other workflows remain incomplete and several still depend on legacy routes or lack PostgreSQL equivalents.
- The current source inventory identifies 644 `.execute()` call sites requiring result/parameter-semantics conversion and 1038 application calls not certified for PostgreSQL.
- `backend/schema.sql`, 40 files under `backend/migrations/`, `backend/seed.sql`, MySQL-specific environment configuration, `render.yaml`, and deployment documentation remain active or needed for the current legacy runtime.

## Cleanup-Run Validation

- Latest complete backend test run: 490 passed, 0 failed, 0 skipped. It used Node 24.15.0 (the project declares Node 20.x), serial test-file execution, and enabled the guarded Neon integrations. Existing legacy-mode tests used `DB_DIALECT=mysql` with non-connecting local placeholders; the replaced vendor-public tests exercised the isolated Neon test database.
- The previous 11 vendor-public failures caused by unavailable local MySQL are resolved by replacing those tests' MySQL pool/fixture setup with real Neon integration coverage. The complete run does not establish PostgreSQL-only runtime parity: the earlier global-PostgreSQL diagnostic still reported 184 failures in legacy paths.
- Earlier 444-test reruns had 183 or 185 failures depending on Neon integration configuration. They predate and are superseded by the current 489-test run; no tests were deleted or skipped to obtain the current result.
- Frontend tests: 172 passed, 0 failed.
- Production build: passed with compile-only `VITE_API_URL=https://api.example.invalid/api`; this is not a deployment URL.
- The live test run used the guarded Neon test configuration targeting the isolated `eventhub` test database. No production database connection or migration was attempted.
- The initial plain backend test invocation lacked `DATABASE_URL` and failed during PostgreSQL pool initialization; the reported 444-test run used the ignored test-environment configuration in memory without displaying its values.

## Latest PostgreSQL Route Continuation

- The authentication integration passed **1/1** against isolated Neon, covering registration and rollback, customer/vendor login, session creation and cleanup, notification/history writes, `/me`, role redirect, and logout. Twelve authentication inventory call sites are explicitly recorded as verified; the auth route was already PostgreSQL-native.
- The isolated Neon admin integration passed **8/8** and exercised all 12 admin report types plus review/complaint listing, moderation, assignment/status updates, history, notifications, and protected attachments.
- The public vendor/category/service marketplace integration passed **12/12** using unique, FK-safe fixtures in the isolated Neon database. It no longer requires a local MySQL server.
- Focused report/review regression tests passed **15/15**; static Amharic message coverage passed **6/6**.
- The refreshed query inventory contains **1068 calls across 91 files** (18 infrastructure, 12 authentication call sites verified on isolated Neon, 1038 application calls uncertified).
- The latest complete backend suite passed **490/490** with guarded Neon integrations enabled. A prior baseline's 11 local-MySQL-dependent vendor-public tests are now Neon integration tests. The suite retained `DB_DIALECT=mysql` for remaining legacy-mode tests; it is not PostgreSQL-only runtime acceptance.
- The earlier full-suite diagnostic with `DB_DIALECT=postgres` reported **446 total: 252 passed, 184 failed, 10 skipped**. Those legacy runtime/test failures remain a blocker to removing MySQL.
- The Neon integration run initially found a PostgreSQL nullable-join row-lock error in complaint updates. The route now uses `FOR UPDATE OF c`, and the rerun passed.

## Dependency Inventory

| Location | MySQL dependency/configuration | Status |
|---|---|---|
| Root `package.json` and `package-lock.json` | Direct `mysql2` dependency (`^3.24.6`) | Active EventHub workspace dependency; retain until all users are converted |
| `backend/package.json` and `backend/package-lock.json` | Direct `mysql2` dependency (`^3.12.0`); `pg` (`^8.23.1`) also present | Backend remains dual-database |
| `qa-e2e-check.js` | Direct `require('mysql2/promise')` and hard-coded local MySQL connection | Legacy test utility; unsafe for the Neon target and not run |
| `personalportofolio/package.json` and `personalportofolio/package-lock.json` | Direct `mysql2` dependency; Prisma datasource uses `provider = "mysql"` | Separate Nuxt app, outside root npm workspaces; repository-wide removal requires a separate conversion/removal decision |
| `personalportofolio/server/utils/db.ts` | Creates a MySQL pool | No current import/use was found in the portfolio source search; still an implementation that conflicts with repository-wide removal |

Installed workspace check (`npm ls mysql2 pg --depth=0`) found `mysql2` at the root and backend workspace, and `pg` in the backend. The portfolio app has its own package manifest and lockfile, so it is not represented by that workspace check.

## Runtime, Configuration, and Script References

EventHub still contains active database-mode switching in:

- `backend/src/db.js`: imports `mysql2/promise`, selects MySQL or PostgreSQL pool from `DB_DIALECT`, and exposes dialect-specific result handling and transactions.
- `backend/src/lib/databaseConfig.js` and `backend/src/lib/startupConfig.js`: parse MySQL URLs/credentials and default the dialect to MySQL.
- `backend/src/server.js` and `backend/src/app.js`: choose MySQL/PostgreSQL health responses, error formatting, and distinct route mounts.
- `backend/scripts/migrate.js`: dispatches between PostgreSQL and MySQL migrations; absence of `DB_DIALECT` selects MySQL.
- `backend/src/lib/migrate.js`: MySQL migration tracking and execution.
- `backend/scripts/check-db.js`, `backend/scripts/test-db.js`, and `backend/scripts/seed-vendor-menu.js`: retain MySQL-specific configuration, SQL, or result handling.
- `backend/scripts/db-init.js`: applies `backend/migrations`, `backend/schema.sql`, and `backend/seed.sql` through the selected legacy database layer. Do not run it during this migration; it is not a verified PostgreSQL-only initializer.

MySQL deployment/configuration references remain in `render.yaml`, `DEPLOYMENT.md`, `README.md`, `.env.example`, and `backend/.env.example`.

## Query and SQL Inventory

The refreshed per-call inventory is `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`, generated by `backend/scripts/audit-postgres-query-inventory.js` from `backend/src`.

| AST inventory classification | Count |
|---|---:|
| Query/execute call sites across 91 backend source files | 1068 |
| PostgreSQL infrastructure calls | 18 |
| Application call sites verified on isolated Neon | 12 |
| Application calls not certified by the scanner | 1038 |
| Application `.execute()` calls requiring MySQL result/parameter semantics review | 644 |
| Application `.query()` calls | 406 |
| `.query()` calls with detected MySQL-specific SQL markers | 5 |
| `.query()` calls without detected markers and not certified | 389 |

The scanner does not treat the absence of a syntax marker or a neighboring test filename as certification. The 12 verified records are explicitly mapped to source locations and the isolated Neon authentication integration; all other call sites remain uncertified and require behavioral review of parameters, result handling, transactions, and failure paths.

A repository text scan (excluding real `.env*` files, dependencies, and generated build directories) found 572 explicit MySQL SQL/DDL marker occurrences across 70 files. Of these, 104 are in 20 `backend/src` JavaScript files:

- Libraries: `adminEvents.js`, `dashboardFilters.js`, `eventCatalog.js`, `marketplace.js`, `migrate.js`, `notificationService.js`, `paymentManagement.js`.
- Middleware: `requireAdmin.js`, `requirePlatformUser.js`.
- Routes: `admin.js`, `adminAuditLogs.js`, `adminNotifications.js`, `adminPayments.js`, `adminReports.js`, `adminReviewsComplaints.js`, `auth.js`, `customer.js`, `organizer.js`, `platform.js`, `vendor.js`.

Markers include `AUTO_INCREMENT`, `UNSIGNED`, `ENGINE=InnoDB`, `MEDIUMBLOB`, `INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`, `VALUES(column)`, `LAST_INSERT_ID`, `GROUP_CONCAT`, `DATE_FORMAT`, `CURDATE`, `DATE_ADD`/`DATE_SUB`, `LAST_DAY`, `WEEKDAY`, `IFNULL`, and `CONCAT_WS`. The broad marker count includes legacy migrations, reports, documentation, tests, and generated inventories; it is not a count of distinct incompatible application queries.

## Schema and Migration Inventory

- Legacy MySQL: 40 files under `backend/migrations/`, plus `backend/schema.sql` and `backend/seed.sql`. These files contain MySQL-specific DDL and data operations and have not been converted or removed.
- PostgreSQL: 10 files under `backend/postgres/migrations/`. They are recorded on the isolated Neon test database, but their existence does not establish semantic parity with the legacy 40-file history.
- The isolated database currently has 51 application tables. A complete table/column/type/default/constraint/index/trigger and behavior comparison against the legacy schema is outstanding.
- No production data was copied, altered, dropped, or reset. No production migration or cutover was attempted.

## PostgreSQL Feature and Route Gaps

PostgreSQL mode mounts selected implementations from `backend/src/app.js`: homepage, marketplace, booking workflows, vendor, organizer planning, profile photo, public events, authentication, admin core, admin payments/reports/reviews/complaints, audit logs, and settings. The added reports route has live coverage for all 12 report types. Reviews/complaints have live coverage for listing, moderation, assignment/status updates, history, notifications, and attachments. This is not the complete legacy route set.

Known incomplete areas include customer workspace APIs and operations (the current UI requests such as customer overview, notifications, favorites, messages, reviews, and profile are not all mounted in PostgreSQL mode), admin/user/vendor verification and content administration, about/contact/hero-slide management, complete vendor and organizer workflows, AI chat, and other shared services. The user's preceding browser log confirms multiple customer API paths return 404 on the current PostgreSQL server. No incomplete router should be mounted as a substitute for missing PostgreSQL behavior.

## Current Gate Status

- PostgreSQL-only architecture: **not achieved**; dual-dialect startup, pool, migrations, and route selection remain.
- Full feature parity: **not achieved**; several PostgreSQL implementations/routes are absent or partial.
- Migration parity and all-query certification: **not achieved**; 1038 application calls remain uncertified.
- Package removal: **not authorized by evidence yet**; direct MySQL dependents remain, so `mysql2` must stay for now.
- Live test evidence: isolated Neon admin integration now passes (8/8), including the newly mounted report/review/complaint routes. The broader backend suite is not green.
- PostgreSQL migration rehearsal, backup/restore, production cutover, and resolution of the latest 185 backend failures remain outstanding.
