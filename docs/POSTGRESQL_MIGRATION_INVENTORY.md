# PostgreSQL Migration Inventory

## Current Continuation Status (2026-11-11)

The current query inventory and payment/refund evidence are recorded in the root [POSTGRESQL_MIGRATION_INVENTORY.md](../POSTGRESQL_MIGRATION_INVENTORY.md), [POSTGRESQL_MIGRATION_PROGRESS.md](../POSTGRESQL_MIGRATION_PROGRESS.md), and [POSTGRESQL_PAYMENT_REFUND_MIGRATION_REPORT.md](../POSTGRESQL_PAYMENT_REFUND_MIGRATION_REPORT.md). The latest AST scan is 1074 call sites across 92 source files: 18 infrastructure calls, 18 application calls explicitly verified on isolated Neon, and 1038 application calls not certified. The isolated Neon `eventhub` test database has 51 application table names, 82 FKs, 151 indexes, and migrations 001–010. The latest authentication/customer-account integration passed 1/1; the focused customer/auth regression set passed 34/34. Earlier full-backend results in this file are historical and are not evidence of full PostgreSQL runtime parity. Production remains untouched.

The checkpoints below are historical evidence through 2026-11-09; their older query/test counts are not the current totals.

## Checkpoint

Latest Neon pool verification (2026-11-09): an earlier read-only 16-request probe failed during connection establishment with Neon pool maxima 4 and 8, while max 2 passed. The current repeatable `npm --workspace backend run test:neon-pool` uses the isolated `eventhub` PostgreSQL 18 database and runs 1/2/4/8/16 concurrent read-only queries three times on both pooled and direct endpoints with configured max 2: 93/93 queries passed per endpoint, with no waiting or checked-out clients left after each batch. Query p95 ranged about 312–325 ms; at concurrency 16, acquisition wait p95 averaged about 2.2 seconds and peak local queue length was 16. A separate pooled diagnostic run at max 2/4/8, concurrency 16, three repetitions each, also passed 48/48 per cap. This does not erase the earlier transient failures or prove production capacity; the Neon runtime cap remains 2. The standard backend suite passed 470 tests (457 pass, 0 fail, 13 skip) with a temporary local MariaDB connection; frontend tests passed 172/172 and the production build passed. Eleven opted-in live Neon integration tests and a Vite → Express → Neon health request passed. No production cutover was performed.

### Latest follow-up verification

- Admin settings increment: added a PostgreSQL-native router for `GET/PATCH /api/admin/settings`, `POST /api/admin/settings/reset`, and `PUT /api/admin/settings/:key`. Neon integration verified settings reads, configuration/currency response shape, PATCH and PUT persistence, audit writes, and restored the pre-test setting value. Unit tests cover validation, authorization, consequential-setting confirmation, reset behavior, and rollback on audit failure. Reset was not executed against Neon; that endpoint remains live-integration-unverified.
- All PostgreSQL test files were run sequentially after a parallel run caused two transient Neon failures: **62 passed, 0 failed, 0 skipped**. The previously contended booking and marketplace integration files also passed when rerun individually. The parallel failures were 500 responses during booking workflow and a pool acquisition timeout in marketplace; they did not reproduce sequentially.
- The frontend suite passed **172/172** and production build passed after this increment. A live Vite `:5173` → Express `:4000` → isolated Neon health request returned HTTP 200 with `db: true` and credentialed CORS enabled.
- The query audit was regenerated after adding the router: 85 source files, 939 call sites, 18 infrastructure calls, and 921 application calls. The scanner conservatively leaves PostgreSQL-native calls uncertified; the admin settings workflow has targeted test evidence but is not a full conversion of `admin.js`.
- The TLS configuration now changes `sslmode=require` to `sslmode=verify-full` only when `DB_SSL=true` or `NODE_ENV=production`; `rejectUnauthorized: true` remains enabled. The focused test covers this behavior and channel-binding preservation. PostgreSQL package versions inspected were `pg` 8.23.1 and `pg-connection-string` 2.14.1.
- After that change, all PostgreSQL-specific tests passed: **57 passed, 0 failed, 0 skipped**, including **11 live Neon integration cases** against the isolated `eventhub` database. A separate pooled/direct connection diagnostic verified PostgreSQL 18 on both endpoints. One `db:check:neon-test` invocation returned sanitized `DB_CONNECT_FAILED`; the immediate separate pooled/direct diagnostic and the integration tests passed. This intermittent check failure is retained as a transient observation, not hidden.
- The latest pool probe again passed **93/93 read-only queries per endpoint** at concurrency 1, 2, 4, 8, and 16, with three repetitions per level. Both endpoints drained to zero active clients and waiters. At concurrency 16, mean acquisition-wait p95 was about 2.20 seconds (pooled) and 2.20 seconds (direct); query-duration p95 was about 316 ms for each. This is a bounded test, not production-load certification.
- Payment-management unit/API regression tests passed **9/9**; this does not establish PostgreSQL payment compatibility.
- The latest standard backend run reported **476 total: 456 passed, 11 failed, 9 skipped**. The 11 failures were MySQL-backed vendor-public tests unable to connect to `127.0.0.1:3306`; MariaDB was stopped. No local database was started because the configured local database is named `event_platform`, not a clearly isolated test database. The earlier 470-test run with MariaDB available is historical evidence, not the current result.
- Frontend tests passed **172/172**, the production frontend build passed, and `git diff --check` passed (Git emitted only existing LF-to-CRLF working-copy warnings).
- MySQL remains the production default. No production records or settings were changed.

## Neon pool diagnosis and operating settings

- The recorded timeout occurs while opening/acquiring PostgreSQL clients, before a query result is returned; the surfaced cause was `Connection terminated unexpectedly`. It is therefore a transport/pooler connection-startup failure, not a PostgreSQL syntax or application-query failure. A later repeated run at max 4/8 did not reproduce it, so the precise Neon-side trigger is intermittent and cannot be established from client evidence alone.
- The production request path obtains one module-scoped shared runtime pool. Pool construction is synchronous and the getter returns the same instance; source review found no per-request pool creation. `createPostgresDatabase()` intentionally creates separate runtime and direct pools only for migrations and isolated integration tests.
- Runtime Neon pool max remains 2; other managed PostgreSQL remains 8; migration/direct pools remain 2. The pool uses verified TLS, 15-second runtime acquisition timeout, 10-second idle timeout, and TCP keepalive. The installed `pg-pool` does not support `maxLifetimeSeconds`, so no unsupported lifetime option is configured.
- Acquisition retry is limited to one additional attempt after 250 ms and only for transient connection-establishment failures. SQL statements and transactions are never retried; connection-limit errors are not retried. Broken clients are destroyed on transport errors or failed rollback. Pool shutdown is idempotent and rejects new acquisitions, and non-secret pool counts are available through `getStats()`.
- With max 2, the measured queue reaches 16 at application concurrency 16 and acquisition wait p95 is about 2.2 seconds. This cap passed the tested workload without leaks, but it serializes work in waves and is not evidence of production-load readiness or total Neon connection budget: each application process/replica owns its own pool.
- Frontend configuration already resolves development API calls to `http://127.0.0.1:4000/api`, Vite proxies `/api` to that origin, and Axios includes credentials. A live local Vite (5173) → Express (4000) → Neon `GET /api/health` returned `db: true` with credentialed CORS. This verifies connectivity, not all frontend role journeys. To run the application against Neon locally, set backend `DB_DIALECT=postgres`, `DATABASE_URL` to a pooled Neon URL and keep `DB_SSL=true`; use `DIRECT_URL` only for migrations. `.env.neon-test` remains isolated test configuration. MySQL remains the default.

## Current incremental migration checklist

- [x] Inspect repository/workspace structure, root/backend/frontend package manifests, backend source module grouping, PostgreSQL migration files, deployment documentation, current dirty worktree, and the existing migration inventory. The separate `personalportofolio/` subproject is present; its relation to the EventHub migration is not established, so it has not been changed.
- [x] Run the PostgreSQL query inventory audit and record the per-status counts below. The scanner is a call-site inventory only; it is not proof that SQL is PostgreSQL-compatible or tested.
- [x] Trace runtime pool construction, client release, retries, transaction rollback, and shutdown; verify the production getter reuses one pool.
- [x] Add and execute repeated read-only pooled/direct Neon concurrency checks at 1/2/4/8/16 application concurrency and verify that clients drain after each batch.
- [x] Verify the local Vite `/api` proxy, Express health endpoint, Neon query result, and credentialed CORS together.
- [x] Migrate and live-test the PostgreSQL admin user CRUD/status/role-assignment slice.
- [x] Migrate and live-test the PostgreSQL admin role list/assigned-users/status/permission-management slice, including policy rejection and assigned-role safeguards.
- [x] Add and live-test PostgreSQL admin audit-log options, filtered listing, pagination, CSV export, sensitive-detail redaction, and non-admin denial.
- [x] Add and live-test the PostgreSQL admin report summary endpoint, preserving the legacy response shape and verifying report permission denial.
- [x] Add and live-test the PostgreSQL admin dashboard overview with PostgreSQL date filters, conditional aggregates, serialized same-connection reads, and non-admin denial.
- [x] Add a PostgreSQL-native admin system-settings router with GET/PATCH/reset/single-setting PUT, transactional audit writes, consequential-change checks, configuration metadata, and cache updates; Neon-tested GET/PATCH/PUT and unit-tested reset/rollback.
- [ ] Inspect and convert the remaining `admin.js` route groups: user activity/password-reset/email-change, vendor verification, events, bookings, detailed reports, and security/system controls. The PostgreSQL settings router is separate; the MySQL production route remains unchanged.
- [x] Add and live-test PostgreSQL read APIs for the homepage hero slide list/image and database-backed homepage statistics after browser inspection found the frontend requests were returning 404.
- [ ] Convert and live-test the remaining `platform.js`, legacy `vendor.js`, `customer.js`, and `organizer.js` queries one workflow slice at a time.
- [ ] Audit every other database-using module, including notification, reporting, payment, AI, middleware, startup, seed, and operational-script paths; classify each call as migrated/native, requiring conversion/review, or blocked.
- [ ] Complete schema/type/index/constraint parity, historical migration conversion, backup/restore rehearsal, and production environment/deployment review.
- [ ] Run comprehensive live Neon role workflows, concurrent-request/data-isolation checks, complete frontend-to-API workflows, browser E2E for all four roles, and the final full-suite/query audit. No Playwright/Puppeteer dependency is installed; the existing `qa-e2e-check.js` is a MySQL-specific API/database script, not a browser E2E suite, and was not run against PostgreSQL.
- [ ] Keep MySQL as the production default until all parity criteria are verified and the user explicitly approves cutover.

- Branch: `neon-migration`
- Neon test project: `eventhub-postgresql-test`
- Project ID: `flat-union-05736478`
- Default branch: `production`
- Region: AWS US East 2 (Ohio)
- PostgreSQL version shown by Neon: 18
- Neon project plan: Free
- Neon test database: `eventhub` exists on the isolated `production` branch. The current local pooled and direct URLs were used without displaying or logging their values.
- Neon test migrations: `001_initial_schema.sql` through `007_case_insensitive_user_email.sql` are recorded on `eventhub`. Migration `006` adds the customer role; `007` adds a case-insensitive unique email index after verifying there were no case-folded duplicates. The migration runner verified PostgreSQL 18.6, pooled connectivity, `SELECT 1`, all 51 application tables, 82 foreign keys, and 151 indexes.
- Neon test loader: resolves `backend/.env.neon-test` from the module location, validates non-empty pooled/direct Neon PostgreSQL URLs, `sslmode=require`, paired endpoint host, and the expected `eventhub` database. It preserves optional channel binding and does not print values.
- PostgreSQL groundwork: test-only Neon environment loading and the direct-URL migration runner remain available. A `DB_DIALECT=postgres` runtime pool accepts credentialed PostgreSQL `DATABASE_URL` values from managed providers; Neon URLs retain pooled/direct endpoint checks. TLS certificate verification is enabled by default and can only be disabled outside production. MySQL remains the default until application feature parity is complete. Neon pooled runtime clients are capped at two; generic managed PostgreSQL runtime pools remain at eight and migration pools remain at two. Runtime connections use TCP keepalive, a 15-second acquisition timeout, a 10-second idle timeout, and at most one 250 ms retry for transient connection-establishment failures only. SQL execution is never retried; adapter queries release every acquired client and discard broken connections.
- Neon cold-start UX: initial auth probes retry 503 responses with bounded backoff and retain the session hint when the database remains unavailable.
- PostgreSQL schema: the additive migrations now represent all 51 application table names found across the MySQL schema and migration set. They add missing columns to shared tables, relationships, indexes, checks, binary/JSON fields, and update timestamps without dropping data.
- PostgreSQL application scope limit: PostgreSQL mode mounts auth, homepage hero slides/statistics, public event/marketplace discovery, bookings and quotations, vendor dashboard, organizer budget/expense/vendor-task workflows, and PostgreSQL-native admin user/role/audit-log/report-summary/settings slices. Admin settings endpoints now include `GET/PATCH /api/admin/settings`, `POST /api/admin/settings/reset`, and `PUT /api/admin/settings/:key`; live Neon covers GET/PATCH/PUT and the unit suite covers reset, validation, authorization, confirmation, and rollback. Other admin routes—including user activity/password-reset/email-change, vendor verification, events, bookings, detailed reports, payments, notifications, and system controls—remain unmounted in PostgreSQL mode; other legacy route modules are likewise not routed to MySQL code under PostgreSQL. MySQL remains the default runtime.
- PostgreSQL dashboard overview: `GET /api/admin/dashboard/overview` is mounted in PostgreSQL mode, validates the same date range and returns the same dashboard metrics, trends, and recent-record collections. The shared dashboard query helper uses typed PostgreSQL date parameters, `COUNT(*) FILTER` conditional aggregates, `TO_CHAR` date grouping, and serialized reads within one adapter transaction to avoid issuing overlapping queries on a single `pg` transaction client. Neon response and non-admin authorization checks passed; detailed admin reports, payments, notifications, and system controls remain outstanding.
- Query inventory: `npm --workspace backend run audit:postgres-queries` parses backend source call expressions and writes `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`. Latest scan: 84 JavaScript source files and 933 query/execute call sites: 18 PostgreSQL infrastructure calls and 915 application call sites not certified by the static scanner. The application-call categories are 644 calls needing MySQL execute/result semantics, 5 with MySQL-specific SQL, and 266 requiring inspection. This conservative static status does not distinguish all individually live-tested PostgreSQL calls. The PostgreSQL-native `postgresAdmin.js` contains 47 call sites, `postgresAdminAuditLogs.js` contains six, and `postgresHomepage.js` contains three; live tests exercise selected user/role, audit-log, report-summary, dashboard-overview, and homepage paths, but do not certify every call site or branch. `dashboardFilters.js` contains separate MySQL and PostgreSQL query execution call sites. The legacy MySQL `admin.js` still contains 174 calls and remains unconverted for PostgreSQL. Other large legacy targets include `platform.js` (104), `vendor.js` (73), `customer.js` (62), and `organizer.js` (46). MySQL-specific markers overlap with the scanner status categories.
- Neon auth test timeout investigation: the former integration test started two local servers and awaited their `listening` events sequentially, allowing the second event to fire before its listener was registered. The integration now starts one server and directly exercises the role middleware. Three consecutive live Neon auth runs passed in 14.7–15.7 seconds each after one earlier registration request timed out at its 15-second fetch deadline.
- Neon connectivity investigation: DNS resolution (IPv4), TCP/5432, and TLS certificate verification previously succeeded for pooled and direct endpoints. One earlier sequential live auth request failed after about 18 seconds; the cause remains unproven. After the retry change, pooled/direct checks and migration verification passed, three sequential live auth runs passed, and two concurrent pooled/direct checks also passed. The PostgreSQL adapter retries only connection acquisition; query/transaction statements are never replayed. Bounded retries and these successful probes do not establish the root cause of the intermittent failure.
- Neon runtime pool follow-up: the original failure at Neon maxima eight/four was an intermittent connection-establishment timeout. The later repeated diagnostic passed at max 2, 4, and 8 (each 48/48 read-only queries over three 16-request batches); the committed repeatable probe keeps the configured runtime cap at 2 and exercises application concurrency 1/2/4/8/16 against both pooled and direct isolated endpoints. The failures were not reproducible in the latest run. This supports a transport/pooler startup diagnosis but does not prove a Neon-side root trigger, other processes' connection use, or production workload capacity.
- Pool lifecycle follow-up: the runtime getter is a synchronous singleton and the production API path reuses its one pool. Query and transaction clients are released in `finally`; previously, connection-level query errors and rollback failures could release a broken/uncertain client as healthy. The adapter now passes such failures to `pg` so the client is discarded. Acquisition retries were reduced from up to four attempts with 500/1000/2000 ms delays to one 250 ms retry; capacity errors are not retried. Shutdown is idempotent and exposes local pool counters without logging connection strings.
- Latest suite evidence: local MySQL connection and `SELECT 1` passed; the standard backend suite completed with 470 tests, 457 passed, 0 failed, and 13 skipped. The skips include missing local vendor-public fixtures and opt-in Neon cases. Separately, six opted-in Neon integration files completed with 11 passed, 0 failed, 0 skipped. The frontend suite passed 172/172, production build passed, and the live proxied health request reached Neon. The Neon test driver continues to warn that current `sslmode=require` maps to `verify-full` in `pg` 8 and semantics may change in pg 9; TLS verification remains enabled. None of these runs certifies unconverted PostgreSQL application routes.
- Connectivity diagnosis: one migration command applied `007` successfully but intermittently failed during the four concurrent post-migration catalog checks. The checks and pooled/direct identity checks now run sequentially and the full migration command passes. This reduces simultaneous connection acquisition but does not prove the underlying transient failure is resolved.
- PostgreSQL organizer planning slice: organizer-owned event budget/category and expense CRUD plus vendor coordination task CRUD are mounted behind organizer-role middleware. Task creation, notification, notification history, and audit history share one transaction. Focused mock-database HTTP tests cover ownership, validation, duplicate categories, budget calculations, relation checks, CRUD, and notification/audit writes. An opt-in Neon integration test now exercises the budget and expense calculations, category/expense/task CRUD, event ownership, and persisted task notification/audit records against PostgreSQL; it passed.
- Vendor overview pool timeout investigation: the overview issued eight independent queries concurrently with `Promise.all`, causing a burst of PostgreSQL pool client acquisitions for one request (in addition to authentication, settings, and vendor-profile reads). Replaced the fan-out with one parameterized PostgreSQL aggregate query using scalar subqueries and SQL aggregates; response fields and decimal/count conversions are preserved. No retry behavior was added. The full live Neon vendor dashboard query/ownership/mutation integration then passed in isolation (about 80 seconds). A single live runtime query also succeeded and reported no waiting pool clients after completion; the prior transient timeout is consistent with connection-acquisition contention, though its exact server-side cause cannot be proven from client logs alone.
- PostgreSQL admin user-management slice: an opt-in live Neon HTTP integration passed admin authentication, non-admin denial, user create/list/detail/profile update, role change, session revocation, suspension, and persisted audit-log checks. This verifies the exercised admin workflows against the isolated Neon database, not all admin route/query branches or the remaining 174 legacy `admin.js` calls.
- PostgreSQL/backend test status (latest run 2026-11-09): the 11 vendor-public failures were reproduced with MySQL stopped and all reported `ECONNREFUSED 127.0.0.1:3306`. Starting the existing XAMPP MariaDB instance restored the default-dialect test dependency; a configured-database check confirmed `event_platform`. The complete standard backend suite then reported 465 tests (452 passed, 0 failed, 13 skipped). The vendor-public API file passed 9 tests; four data-dependent checks skipped because this local database has no verified public vendor, matching category, category image, or published service. The 9 opt-in Neon cases skipped in the standard run, then all 9 cases in the dedicated Neon integration files passed serially against the isolated Neon test database (0 failed, 0 skipped). A combined backend run with Neon integrations enabled reported 3 database-operation test failures in booking, homepage, and auth, but these were not reproducible in isolated serial reruns: the affected integration groups passed 6/6, and the vendor integration passed 3/3. Full-suite Neon stability is therefore not verified. Frontend tests passed 172/172; the production build passed with `VITE_API_URL=https://api.example.invalid/api`. No browser-based full-role E2E has been verified.
- Existing worktree edits preserved: `frontend/src/api/apiUrl.js` and `frontend/test/apiUrl.test.js`.

No production database was accessed, and no production data was changed.

## Current database architecture

The backend uses direct `mysql2/promise` access rather than an ORM:

- `backend/src/db.js` creates a MySQL pool and exposes query, transaction, and database verification helpers.
- `backend/src/lib/databaseConfig.js` accepts MySQL URLs or `DB_*` fields, configures MySQL TLS, and validates MySQL settings.
- `backend/src/lib/migrate.js` records and applies raw SQL migration files using `?` placeholders and MySQL DDL.
- Route, middleware, and library code imports the shared pool and issues SQL directly; database behavior is not isolated behind repositories/models.
- Both the root `package.json` and `backend/package.json` declare `mysql2`.
- The existing deployment configuration and environment examples still describe MySQL connection settings.

Consequently, changing the driver or URL alone is not safe. A consistent PostgreSQL architecture requires converting the schema and every query/transaction, updating scripts and error handling, then validating the resulting behavior against an isolated PostgreSQL project. The `pg` module is an opt-in runtime path used by the PostgreSQL auth, marketplace, event, vendor, and selected booking slices; it is not feature parity for the application. Prisma has not been introduced; replacing hundreds of direct SQL call sites with Prisma models without preserving their behavior would be a separate and substantial rewrite.

## SQL migration inventory

The scan found 40 SQL migration files under `backend/migrations/`, plus `backend/schema.sql` and `backend/seed.sql`. Migration names are sorted lexicographically by the current migrator. The existing sequence includes duplicate numeric prefixes (`002_*` and `025_*`), so ordering and historical compatibility need explicit review before any migration is applied to PostgreSQL.

Migration files:

```text
001_initial_schema.sql
002_about_us_content.sql
002_rbac_security.sql
003_contact_messages.sql
004_event_package_requests.sql
005_dashboard_records.sql
006_event_discovery_tickets.sql
007_contact_inquiry_types.sql
008_password_reset_tokens.sql
009_system_settings_controls.sql
010_profile_photos.sql
011_password_reset_otps.sql
012_role_permission_capabilities.sql
013_vendor_verification.sql
014_service_category_management.sql
015_event_administration.sql
016_booking_management.sql
017_payment_refund_management.sql
018_reviews_complaints_management.sql
019_reports_analytics.sql
020_admin_notifications.sql
021_notification_history_backfill.sql
022_audit_log_management.sql
023_system_settings_module.sql
024_organizer_planning_tools.sql
025_event_categories.sql
025_vendor_dashboard_tools.sql
026_customer_service_favorites.sql
027_service_request_details.sql
028_user_language_preference.sql
029_admin_email_change_otps.sql
030_hero_slides.sql
031_currency_defaults.sql
032_service_navigation_categories.sql
033_event_featured_discovery.sql
034_vendor_featured_discovery.sql
035_contact_message_tracking.sql
036_public_contact_details.sql
037_vendor_availability_search_index.sql
038_ai_chat.sql
```

The migration set contains MySQL DDL and data operations, including `AUTO_INCREMENT`, `UNSIGNED` integer declarations, `ENGINE=InnoDB`, enum declarations, binary large-object types, `ON UPDATE CURRENT_TIMESTAMP`, and `ON DUPLICATE KEY UPDATE`. These need deliberate PostgreSQL equivalents and behavior checks; a text substitution is insufficient. The SQL files include core identity and RBAC, profiles and media, events, services and categories, booking history, payments/refunds, reviews/complaints, notifications, reports, audit logs, organizer/vendor tools, and AI chat records.

## Active application query incompatibilities found

The backend source scan found MySQL-specific query behavior in these areas:

| Area | Files | Observed incompatibilities |
|---|---|---|
| Database helper and migrations | `backend/src/db.js`, `backend/src/lib/migrate.js` | `SELECT DATABASE()`, `?` placeholders, MySQL pool result tuples, and migration-table DDL using `ENGINE=InnoDB`. |
| Authentication and account management | `backend/src/routes/auth.js`, `backend/src/routes/admin.js` | `ON DUPLICATE KEY UPDATE`, `VALUES(column)`, `NOW()`, `GROUP_CONCAT`, and MySQL placeholder syntax. |
| Admin reports and authorization | `backend/src/routes/adminReports.js`, `backend/src/middleware/requireAdmin.js`, `backend/src/middleware/requirePlatformUser.js` | `GROUP_CONCAT(... ORDER BY ... SEPARATOR ...)` aggregations and MySQL result handling. |
| Event date filters | `backend/src/lib/eventCatalog.js` | `CURDATE()`, `DATE_ADD`, `DATE_SUB`, `WEEKDAY`, `LAST_DAY`, and MySQL interval syntax. |
| Date grouping and formatting | `backend/src/lib/dashboardFilters.js`, `backend/src/routes/vendor.js`, `backend/src/routes/platform.js` | `DATE_FORMAT` in projections and grouping. |
| Vendor availability and marketplace | `backend/src/routes/vendor.js`, `backend/src/routes/platform.js`, `backend/src/lib/marketplace.js` | `CURDATE()` and MySQL upsert behavior (`ON DUPLICATE KEY UPDATE`). |
| Notification idempotency | `backend/src/lib/notificationService.js` | `ON DUPLICATE KEY UPDATE` and `LAST_INSERT_ID(id)` to return an existing row ID. |

The latest regenerated AST inventory scans 85 backend source JavaScript files and records 939 `.execute()`/`.query()` call sites: 18 PostgreSQL infrastructure calls and 921 application calls. Of the application calls, 644 use `.execute()` and 277 use `.query()`; 586 have one or more MySQL-specific syntax markers. The marker count overlaps the invocation-method counts. The scanner conservatively does not certify PostgreSQL-native calls; targeted test evidence is documented separately and in the call-site test-coverage column. In the manually verified admin-settings rows, five call sites have Neon-backed verification and one reset upsert is only unit-tested; the other 915 application call sites remain uncertified in the CSV. No call is considered migrated solely because it has no MySQL marker. PostgreSQL-native admin user/role/audit-log/report-summary/dashboard-overview/settings and homepage routes contain 62 inventoried call sites; not every call site or endpoint has live verification (admin settings reset, in particular, is unit-tested but not live-tested). Database access spans authentication, customer/organizer/vendor/admin workflows, payment management, notifications, reporting, AI chat, and public discovery.

The regenerated inventory classifies calls by source file, enclosing function, source line, invocation method, static syntax markers, and test filename. It does not derive complete URL templates for dynamic Express routes; the following is a route-module breakdown, not a claim that every URL handler in a module has been individually reviewed:

| Route module | Calls | `.execute()` | `.query()` | MySQL syntax markers |
|---|---:|---:|---:|---:|
| `admin.js` | 174 | 168 | 6 | 146 |
| `platform.js` | 104 | 90 | 14 | 93 |
| `vendor.js` | 73 | 72 | 0 | 71 |
| `postgresVendor.js` | 66 | 0 | 66 | 0 |
| `customer.js` | 62 | 62 | 0 | 60 |
| `postgresAdmin.js` | 47 | 0 | 47 | 0 |
| `organizer.js` | 46 | 46 | 0 | 45 |
| `postgresBookings.js` | 40 | 0 | 40 | 0 |
| `adminReviewsComplaints.js` | 23 | 23 | 0 | 18 |
| `adminNotifications.js` | 22 | 22 | 0 | 20 |
| `auth.js` | 21 | 21 | 0 | 21 |
| `postgresAdminSettings.js` | 6 | 0 | 6 | 0 |
| Other route modules | 140 | 76 | 64 | 53 |
| **Route modules total** | **824** | **580** | **244** | **527** |

The remaining 97 application calls are in database, middleware, startup, and library modules. The legacy `admin.js` still has 174 SQL call sites, 146 with MySQL-specific markers; the new settings router does not convert other admin route groups. High-risk non-route modules include `paymentManagement.js` (29 calls, 28 syntax markers), `bookingAvailability.js` (14 calls, 7 markers), and `marketplace.js` (9 calls, 3 markers). Payment/refund workflows remain MySQL-only; the current payment tests exercise mocked/unit behavior, not PostgreSQL.

## Runtime scripts and tests in scope

Backend operational scripts found:

```text
bootstrap-admin.js
check-db.js
check-smtp.js
db-init.js
seed-test-user.js
seed-users.js
seed-vendor-menu.js
test-db.js
```

Current verification (2026-11-09): the 11 vendor-public failures were reproduced while `127.0.0.1:3306` refused connections; starting the existing XAMPP MariaDB server resolved the connection failures. The focused vendor-public file then reported 13 tests (9 passed, 0 failed, 4 skipped for missing public vendor/category/image/service fixtures). The full standard backend suite (Neon opt-in off) reported 465 tests (452 passed, 0 failed, 13 skipped); the remaining skips are those four data-dependent vendor checks plus nine opt-in Neon cases. Dedicated live Neon integration files were rerun serially and reported 9 passed, 0 failed, 0 skipped against the isolated Neon test database. One combined full backend run with `RUN_NEON_INTEGRATION=true` reported three failures in Neon booking/homepage/auth requests, but follow-up serial reruns passed those integration groups (6/6) and vendor integration (3/3); the failure was not reproduced in those targeted reruns, and full-suite Neon reliability is still unverified. Dashboard unit tests passed 7/7. Frontend tests passed 172/172, and the production build passed with `VITE_API_URL=https://api.example.invalid/api`. Full PostgreSQL application parity, browser E2E journeys, and PostgreSQL deployment/backup readiness remain unverified; MySQL remains the production default.

## Required PostgreSQL conversion and verification

1. Define one PostgreSQL data-access approach and keep it consistent. A PostgreSQL-native adapter exposes pg `query` results and nested transactions via savepoints and is used by the PostgreSQL auth, marketplace, event, vendor, booking, and organizer-planning slices. Legacy MySQL routes remain separate until converted.
2. Convert all tables, indexes, constraints, enums/lookups, timestamp update behavior, binary columns, and migration data operations to explicit PostgreSQL migrations.
3. Convert every `?` placeholder and MySQL result shape; address PostgreSQL `RETURNING`, unique/FK error codes, transaction lifecycle, decimal serialization, and pooled/direct connection use.
4. Rework the date and aggregation queries using PostgreSQL expressions with tests for date boundaries, timezone behavior, ordering, and null handling.
5. Rework idempotent upserts with `ON CONFLICT` and return rows explicitly rather than relying on `LAST_INSERT_ID`.
6. Make `backend/.env.neon-test` available locally with pooled `DATABASE_URL` and direct `DIRECT_URL`; keep values out of chat, logs, frontend variables, and source control. The repository's `.env.*` ignore rule currently excludes the file.
7. Verify PostgreSQL connectivity and schema creation only against `eventhub-postgresql-test`; test FKs, CRUD, rollback/commit, authentication, permissions, booking, quotation, payment test mode, and notifications. Live route evidence currently covers auth/session and role guards, public discovery, selected booking/quotation/availability, vendor dashboard, organizer planning, and the admin user/role slices. Payment-provider test mode, remaining routes, and the complete frontend journeys are not verified.
8. Re-run backend/frontend suites and the production build. Do not remove MySQL dependencies until all active references are converted and verified.
9. Keep production data migration blocked until an authorized source export and reconciliation are available. Do not switch production traffic without explicit approval.

## Current status

The isolated Neon `eventhub` database has all 51 application table names represented and migration history records migrations `001`–`007`. The latest successful migration run confirmed 82 foreign keys and 151 public indexes. Live integration tests verify core CRUD/relationships and rollback, authentication/session role checks, selected public discovery and booking/quotation/availability workflows, vendor dashboard ownership/mutations, organizer planning, and administrator user/role operations. They do not exercise all 51 tables or the full application route set.

| Legacy feature/table group | PostgreSQL schema | PostgreSQL application queries |
|---|---|---|
| Users, roles, permissions, admin/user sessions, password reset and email-change OTP | Represented in `001`–`003` | Registration/login/session authentication and role guards have live Neon evidence; admin user CRUD/status/role assignment and role list/membership/status/permission routes have live slice coverage; user activity, password reset, and email-change OTP are not converted |
| Service categories, vendor profiles, verification documents/history, services, packages, media, availability, favorites | Represented in `001`–`003` | Public marketplace discovery/details and vendor availability CRUD have live Neon evidence; verification management, services/packages management, favorites, and timezone-specific calendar behavior remain incomplete |
| Events, event history/package requests/tickets/budget/expenses/vendor tasks, bookings/history, quotations, messages | Represented in `001`–`003` | Public event catalog, selected booking/quotation workflows, and organizer budget/expense/task routes have live Neon route evidence; populated UI E2E, remaining event mutations, ticket workflows, and messaging remain incomplete |
| Payments, provider events, refunds/history, reviews/history, complaints/history/attachments | Represented in `001`–`003` | Not converted; provider/webhook behavior not verified |
| Notifications/history, contacts, hero slides, AI conversations/messages, module locks, site content, system settings, audit logs | Represented in `001`–`003` | Not converted |

This schema result is not complete column/index parity certification. The legacy schema is spread across `backend/schema.sql` and 40 incremental MySQL migrations; type, nullability, unique/index, and foreign-key equivalence still needs exhaustive catalog comparison. No parity percentage is claimed. The MySQL runtime remains the default. The `DB_DIALECT=postgres` path is not a complete application runtime: the latest AST inventory lists 915 application call sites not certified by the scanner, including unconverted legacy modules. Live-tested PostgreSQL routes do not establish parity for the remaining admin and business workflows, seed conversion, full historical migration conversion, browser E2E, backup/restore rehearsal, or production switch. No production data was migrated and no deployment or traffic change was made.
