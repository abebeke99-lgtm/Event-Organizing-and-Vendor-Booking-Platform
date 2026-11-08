# PostgreSQL Migration Inventory

## Checkpoint

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
- PostgreSQL groundwork: test-only environment loading and the direct-URL migration runner remain available. A `DB_DIALECT=postgres` runtime pool now uses the pooled `DATABASE_URL`; MySQL remains the default. Pool connection acquisition has at most four attempts with 500/1000/2000 ms backoff for transient connection-establishment failures only. SQL execution is never retried; every adapter query releases its acquired client.
- Neon cold-start UX: initial auth probes retry 503 responses with bounded backoff and retain the session hint when the database remains unavailable.
- PostgreSQL schema: the additive migrations now represent all 51 application table names found across the MySQL schema and migration set. They add missing columns to shared tables, relationships, indexes, checks, binary/JSON fields, and update timestamps without dropping data.
- PostgreSQL application scope limit: the PostgreSQL auth, public-event, and marketplace slices remain mounted. A new PostgreSQL booking router now mounts booking creation/list/status, customer booking detail/rescheduling, vendor booking/quotation views, vendor availability CRUD, quotation request/respond/decision, and organizer quotation routes. `bookingAvailability.js` now keeps its MySQL behavior and uses parameterized PostgreSQL SQL through the adapter when selected. The live Neon workflow test verifies booking and quotation persistence, status history, notification/history writes, availability reservation/release, duplicate rejection, concurrent acceptance conflict prevention, and role-based access. Other route modules remain unmounted in PostgreSQL mode rather than receiving fake or MySQL-backed responses. MySQL remains the default runtime.
- Query inventory: `npm --workspace backend run audit:postgres-queries` parses backend source call expressions and writes `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`. Latest scan: 80 JavaScript source files, 862 query/execute call sites, 18 PostgreSQL infrastructure calls, and 844 application call sites still uncertified. The scanner does not certify PostgreSQL call sites from route wiring or live-test evidence; full parity is not established.
- Neon auth test timeout investigation: the former integration test started two local servers and awaited their `listening` events sequentially, allowing the second event to fire before its listener was registered. The integration now starts one server and directly exercises the role middleware. Three consecutive live Neon auth runs passed in 14.7–15.7 seconds each after one earlier registration request timed out at its 15-second fetch deadline.
- Neon connectivity investigation: DNS resolution (IPv4), TCP/5432, and TLS certificate verification previously succeeded for pooled and direct endpoints. One earlier sequential live auth request failed after about 18 seconds; the cause remains unproven. After the retry change, pooled/direct checks and migration verification passed, three sequential live auth runs passed, and two concurrent pooled/direct checks also passed. The PostgreSQL adapter retries only connection acquisition; query/transaction statements are never replayed. Bounded retries and these successful probes do not establish the root cause of the intermittent failure.
- Connectivity diagnosis: one migration command applied `007` successfully but intermittently failed during the four concurrent post-migration catalog checks. The checks and pooled/direct identity checks now run sequentially and the full migration command passes. This reduces simultaneous connection acquisition but does not prove the underlying transient failure is resolved.
- PostgreSQL tests: latest backend suite passed 443 tests (9 skipped, 0 failed); frontend suite passed 169 tests (0 failed). The frontend production build passed with a non-routable build-only `VITE_API_URL`. The four booking availability helper tests passed, and the live Neon booking/quotation integration passed on rerun; one preceding run returned HTTP 500 while loading customer bookings, with no underlying cause established. A separate browser-based workflow was not completed because the authenticated UI encountered unmounted workspace endpoints. Live Neon auth, public event/marketplace listing, and populated marketplace detail integrations passed; the earlier CRUD/RBAC rollback integration also passed after migration `007`. Intermittent connectivity remains a reliability caveat.
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

Consequently, changing the driver or URL alone is not safe. A consistent PostgreSQL architecture requires converting the schema and every query/transaction, updating scripts and error handling, then validating the resulting behavior against the isolated Neon project. The `pg` module is an opt-in runtime path currently used by the PostgreSQL auth slice; it is not feature parity for the application. Prisma has not been introduced; replacing hundreds of direct SQL call sites with Prisma models without preserving their behavior would be a separate and substantial rewrite.

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

The latest AST inventory scans 80 backend source JavaScript files and records 862 `.execute()`/`.query()` call sites: 18 PostgreSQL infrastructure calls and 844 application calls not converted or certified. The scanner does not certify a call site merely because its SQL appears PostgreSQL-compatible or it has filename-matched test coverage. Database access spans authentication, customer/organizer/vendor/admin workflows, payment management, notifications, reporting, AI chat, and public discovery.

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

Current verification: backend tests passed (452 total: 443 passed, 9 skipped, 0 failed); frontend tests passed (169/169); the production frontend build passed with `VITE_API_URL=https://build-only.invalid/api`. Neon pooled and direct connectivity passed; the migration runner confirmed all 7 migrations, 51 application tables, 82 foreign keys, and 151 public indexes. The live Neon auth integration passed three consecutive runs, following one earlier request-timeout failure. The live Neon CRUD/RBAC integration passed and rolled its fixtures back.

## Required PostgreSQL conversion and verification

1. Define one PostgreSQL data-access approach and keep it consistent. A PostgreSQL-native adapter now exposes pg `query` results and nested transactions via savepoints; it is not wired into legacy route query sites yet. Preserve the existing direct-query behavior unless a full ORM conversion can be done without losing business functionality.
2. Convert all tables, indexes, constraints, enums/lookups, timestamp update behavior, binary columns, and migration data operations to explicit PostgreSQL migrations.
3. Convert every `?` placeholder and MySQL result shape; address PostgreSQL `RETURNING`, unique/FK error codes, transaction lifecycle, decimal serialization, and pooled/direct connection use.
4. Rework the date and aggregation queries using PostgreSQL expressions with tests for date boundaries, timezone behavior, ordering, and null handling.
5. Rework idempotent upserts with `ON CONFLICT` and return rows explicitly rather than relying on `LAST_INSERT_ID`.
6. Make `backend/.env.neon-test` available locally with pooled `DATABASE_URL` and direct `DIRECT_URL`; keep values out of chat, logs, frontend variables, and source control. The repository's `.env.*` ignore rule currently excludes the file.
7. Verify PostgreSQL connectivity and schema creation only against `eventhub-postgresql-test`; test FKs, CRUD, rollback/commit, authentication, permissions, booking, quotation, payment test mode, and notifications. The current live integration test exercises basic CRUD/relationships, but does not yet verify application authentication, business workflows, payment-provider test mode, or route behavior.
8. Re-run backend/frontend suites and the production build. Do not remove MySQL dependencies until all active references are converted and verified.
9. Keep production data migration blocked until an authorized source export and reconciliation are available. Do not switch production traffic without explicit approval.

## Current status

The isolated Neon `eventhub` database has all 51 application table names represented and migration history records migrations `001`–`007`. The latest successful migration run confirmed 82 foreign keys and 151 public indexes. The live integration test verifies core users/RBAC/vendor/event/booking/payment/review/complaint/notification/session CRUD and relationships inside a rolled-back transaction and checks the lower(email) unique index. It does not exercise all 51 tables or the application route set.

| Legacy feature/table group | PostgreSQL schema | PostgreSQL application queries |
|---|---|---|
| Users, roles, permissions, admin/user sessions, password reset and email-change OTP | Represented in `001`–`003` | Registration/login/session authentication and role guards have live Neon evidence; role/user administration, password reset, and email-change OTP are not converted |
| Service categories, vendor profiles, verification documents/history, services, packages, media, availability, favorites | Represented in `001`–`003` | Public marketplace discovery/details and vendor availability CRUD have live Neon evidence; verification management, services/packages management, favorites, and timezone-specific calendar behavior remain incomplete |
| Events, event history/package requests/tickets/budget/expenses/vendor tasks, bookings/history, quotations, messages | Represented in `001`–`003` | Public event catalog and selected booking/quotation workflows have live Neon route evidence; populated UI E2E, event details/mutations, ticket workflows, organizer budgeting/tasks, and messaging remain incomplete |
| Payments, provider events, refunds/history, reviews/history, complaints/history/attachments | Represented in `001`–`003` | Not converted; provider/webhook behavior not verified |
| Notifications/history, contacts, hero slides, AI conversations/messages, module locks, site content, system settings, audit logs | Represented in `001`–`003` | Not converted |

This schema result is not complete column/index parity certification. The legacy schema is spread across `backend/schema.sql` and 40 incremental MySQL migrations; type, nullability, unique/index, and foreign-key equivalence still needs exhaustive catalog comparison. No parity percentage is claimed. The MySQL runtime remains the default. The `DB_DIALECT=postgres` path is not a complete application runtime: the latest AST inventory lists 844 application calls not certified by that scanner. The new PostgreSQL booking slice has route-level live Neon evidence, but browser E2E and every individual SQL callsite are not certified; many original MySQL application call sites and required modules remain incomplete. Live-tested PostgreSQL auth, marketplace, events, and selected booking/quotation routes do not establish parity for role/permission administration, other business workflows, seed conversion, full historical migration conversion, or production switch. No production data was migrated and no deployment or traffic change was made.
