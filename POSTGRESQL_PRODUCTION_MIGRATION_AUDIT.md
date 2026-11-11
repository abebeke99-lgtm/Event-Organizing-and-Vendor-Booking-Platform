# EventHub PostgreSQL Production Migration Audit

Audit date: 2026-11-11  
Scope: Phase 1 repository/runtime audit and read-only checks against the isolated Neon test database.  
Status: Production cutover is blocked. No production Neon credentials, production authorization, or verified production recovery point were available. The isolated test database was not treated as production.

## Executive Summary

The repository is a mixed-dialect application, not yet a PostgreSQL-only production system. MySQL remains the default in application startup, the deployment blueprint, and deployment documentation. PostgreSQL mode mounts a separate but incomplete set of routes; many existing product features are not available in that mode. Direct SQL is used throughout the backend rather than a shared ORM or repository layer.

The regenerated source inventory reports 939 `.query()` / `.execute()` call sites in 85 JavaScript files under `backend/src`: 18 PostgreSQL infrastructure calls and 921 application calls that are not certified by the scanner. Of the 921 application calls, 644 use the MySQL-oriented `execute()` API, 5 `query()` sites contain detected MySQL-specific SQL, and 272 `query()` sites need manual SQL, parameter, result-shape, and behavior review. These are inventory categories, not a count of individually proven incompatible queries.

Read-only checks confirmed the isolated Neon test database is PostgreSQL 18 and contains all 51 application table names declared by the PostgreSQL schema inventory, 82 foreign keys, and 151 indexes. This verifies the test schema's current counts only; it does not establish parity with the legacy schema or production.

## Database Architecture

- `backend/src/db.js` selects PostgreSQL only when `DB_DIALECT=postgres`; the legacy path imports `mysql2/promise` and creates a MySQL pool. Missing dialect configuration is treated as MySQL by `backend/src/lib/startupConfig.js`, `backend/src/app.js`, and `backend/src/server.js`.
- PostgreSQL connectivity uses `pg`, `backend/src/postgresPool.js`, `backend/src/lib/postgresAdapter.js`, and `backend/src/lib/postgresConfig.js`. Runtime Neon connections require a pooled endpoint; migration connections use a direct endpoint. TLS certificate verification is enabled for production and for the Neon test setup.
- Backend SQL is issued directly from route, middleware, and library modules. No Sequelize layer or centralized model/repository boundary was found in the inspected backend source.
- The local development launcher now loads only `backend/.env.neon-test` through the isolated-test validator and forces the PostgreSQL dialect. It does not configure production credentials.
- The local `backend/.env` summary at audit time had `DB_DIALECT=postgres`, `DB_SSL=true`, and `NODE_ENV=development`, but empty `DATABASE_URL` and `DIRECT_URL`. Both `.env` files are ignored by Git. The development launcher obtains its test URLs from the separate `.env.neon-test` file.
- No scheduled jobs, worker queues, or background-job framework were found under `backend/src`; the only matching timer is the bounded delay used by PostgreSQL connection retry logic.

## PostgreSQL Test Database Evidence

The command `npm --workspace backend run db:check:neon-test` completed successfully on 2026-11-11. The checker loads only `backend/.env.neon-test`, validates the isolated `eventhub` target, and runs read-only identity/catalog queries.

| Check | Result |
|---|---:|
| Runtime and migration endpoints | Both connected |
| Server | PostgreSQL 18 |
| Database | `eventhub` (isolated test database) |
| Expected application tables | 51 present; 0 missing |
| Public base tables | 52, including the migration-history table |
| Public foreign keys | 82 |
| Public indexes | 151 |
| Recorded PostgreSQL migrations | 8, from `001_initial_schema.sql` through `008_vendor_dashboard_permissions.sql` |

These counts do not compare every PostgreSQL column, nullability rule, default, unique constraint, index definition, trigger, or foreign key with the MySQL schema. Missing parity counts are therefore **not established**. No production database identity, data, schema, or connectivity was inspected.

## Schema Inventory

The PostgreSQL application table manifest contains these 51 names:

```text
users, roles, permissions, user_roles, role_permissions, admin_sessions,
user_sessions, password_reset_tokens, password_reset_otp_challenges,
admin_email_change_otp_challenges, service_categories, vendor_profiles,
vendor_verification_history, vendor_verification_documents, services,
service_packages, vendor_media, vendor_availability, favorites,
customer_service_favorites, events, event_history, event_package_requests,
event_budget_categories, event_expenses, event_vendor_tasks, event_ticket_types,
event_ticket_bookings, bookings, booking_history, quotations, messages, payments,
payment_provider_events, refund_requests, payment_history, reviews, review_history,
complaints, complaint_history, complaint_attachments, notifications,
notification_history, contact_messages, hero_slides, ai_conversations, ai_messages,
module_locks, site_content, system_settings, audit_logs
```

The manifest includes identity/RBAC/session data, vendors and services, events, bookings and quotations, payments/refunds, reviews/complaints, notifications, contact, homepage content, settings, and audit history. Some requested concepts appear to be represented by existing tables or columns rather than same-named tables: for example, customer identity is stored in `users`, public homepage statistics are computed, and event image/location/schedule data may be represented in event columns or JSON. The schema must be compared semantically before adding any of the requested names as new tables.

Items requiring that schema/feature comparison include dedicated email-verification and login-attempt records; event image, schedule, attendee, and location records; booking and quotation line items; invoices; customer addresses; platform announcements; and notification preferences. Their absence as standalone names in the 51-table manifest is not by itself proof that a feature is missing or that a duplicate table should be created. Visitors are anonymous users of public endpoints, not a persisted database role/table in this manifest.

The legacy MySQL schema is spread across `backend/schema.sql`, `backend/seed.sql`, and 40 files under `backend/migrations/`. The PostgreSQL migration directory contains 8 migrations. The legacy migration sequence has duplicate numeric prefixes (`002_*` and `025_*`) and lexicographic ordering must be treated carefully. PostgreSQL migration 007 performs a case-insensitive email uniqueness change and must retain its duplicate-data guard. Production migration ordering and data compatibility have not been evaluated against a production catalog.

## Query Conversion Inventory

Regenerated using `npm --workspace backend run audit`:

| Inventory measure | Count |
|---|---:|
| Backend source JavaScript files scanned | 85 |
| `.query()` / `.execute()` call sites | 939 |
| PostgreSQL infrastructure call sites | 18 |
| Application call sites not certified | 921 |
| Application `.execute()` sites requiring MySQL result/parameter semantics review | 644 |
| Application `.query()` sites with detected MySQL-specific syntax | 5 |
| Application `.query()` sites not otherwise certified | 272 |
| Call sites with one or more detected MySQL markers | 586 |

The generated detail is in [docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv](docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv). The scanner parses JavaScript call expressions under `backend/src`; it does not prove SQL compatibility and does not scan operational scripts, tests, migration SQL, frontend code, dynamically constructed SQL behavior, or every database integration. A full query-by-query audit is still required. The marker total overlaps the invocation-method categories.

Observed incompatibility families include `?` placeholders and MySQL result handling; `ON DUPLICATE KEY UPDATE`, `VALUES(column)`, and `LAST_INSERT_ID`; `GROUP_CONCAT`; `DATE_FORMAT`, `CURDATE`, `DATE_ADD`, `DATE_SUB`, `WEEKDAY`, and `LAST_DAY`; MySQL interval syntax; `SELECT DATABASE()`; and MySQL-specific migration DDL such as `AUTO_INCREMENT`, `UNSIGNED`, `ENUM`, `ENGINE=InnoDB`, and `ON UPDATE CURRENT_TIMESTAMP`. Static text replacement would not preserve behavior for these cases.

High-volume legacy query modules include `admin.js`, `platform.js`, `vendor.js`, `customer.js`, and `organizer.js`. Other database-dependent libraries include payment/refund management, availability/booking coordination, marketplace, notifications, audit/session handling, reports, system settings, and AI context. The detailed CSV identifies each scanned source call site; representative hotspot counts and remaining feature work are summarized in `docs/POSTGRESQL_MIGRATION_INVENTORY.md`.

## Backend Feature Coverage

In PostgreSQL mode, `backend/src/app.js` mounts PostgreSQL implementations for auth/session, homepage hero slides/statistics, public marketplace and event discovery, selected bookings/quotations, vendor dashboard, organizer planning, profile photos, and selected administrator user/role, audit-log, report/dashboard, and settings operations.

The PostgreSQL router set is not feature parity. The existing inventory identifies unconverted or unmounted areas including administrator event/booking/vendor-verification/security controls, detailed reports, payment/refund and payment-webhook workflows, notifications, contact and general content management, legacy vendor/customer/organizer operations, service/package administration, favorites, and AI chat. Route-by-route request/response parity and frontend role journeys have not been completed. An endpoint absent from PostgreSQL mode may return 404 rather than being safely delegated; no MySQL fallback should be added to PostgreSQL mode.

The PostgreSQL schema contains payment and notification tables, but table presence does not mean the corresponding application workflows are implemented or verified on PostgreSQL. Payment provider integration and production payment data have not been tested or migrated.

## Frontend and Deployment

- The React + Vite frontend is preserved. `frontend/src/api/apiUrl.js` requires an explicit HTTPS, non-loopback `VITE_API_URL` in production and rejects URL credentials/query/fragment. The Axios client enables credentials and has bounded request timeouts/error handling.
- Vite proxies `/api` to the configured API origin in development. `frontend/.env.development` points to the local API; no production Netlify API origin was verified during this audit.
- `render.yaml` and `DEPLOYMENT.md` still configure/document MySQL. They do not set `DB_DIALECT=postgres` or `DIRECT_URL`; the blueprint still lists MySQL `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` variables. This must not be changed to production PostgreSQL until an authorized production project, branch, pooled URL, direct URL, and recovery plan are confirmed.
- The shared browser page is a Neon console login screen. No authenticated production Neon, Render, or Netlify environment was available to verify service settings, deployments, CORS origins, cookies, or deployed health.

## Tests and Checks Run For This Audit

- `npm --workspace backend run audit`: passed; regenerated the 939-call-site inventory.
- `npm --workspace backend run db:check:neon-test`: passed; verified both isolated Neon connections and actual test catalog counts above.
- The previous focused PostgreSQL configuration suite passed 17/17 tests during the preceding local-development fix. That result is test-suite evidence, not a complete migration test.
- No full backend suite, full Neon application integration suite, frontend suite, production build, browser role journey, backup/restore rehearsal, or production deployment verification was run as part of this Phase 1 audit. Historical results in the older inventory document are not current verification for this audit date.

## Data Migration, Integrity, and Recovery Risks

- No production database URL, production project/branch identity, or explicit production access authorization was provided. The authenticated console is not available in the shared browser page.
- No production data was queried or changed. No test data was copied.
- Production emptiness, schema, identity, existing IDs/unique values, duplicate conflicts, backup/recovery point, and restore procedure remain unknown. No production migration plan can be safely approved without those facts.
- No `DROP`, `TRUNCATE`, reset, schema migration, seed, or data copy was run against a production database.
- Foreign-key and index totals are known only for the isolated test database. Table/column semantics, delete behavior, timestamp/timezone behavior, constraints, and index coverage still need comparison against every legacy DDL migration and actual application query.

## Phase 1 Conclusion and Gate

This document records the current architecture and a reproducible repository/test-database inventory. It does **not** certify that every application query has been manually audited, that the application is fully PostgreSQL-converted, or that PostgreSQL is production-ready. No production migration should proceed from the test credentials or from the current Render MySQL configuration.

Before production work can safely continue, configure the authorized production pooled `DATABASE_URL`, direct `DIRECT_URL`, `DB_DIALECT=postgres`, and `DB_SSL=true` in the secure Render environment; verify they target the same approved production Neon project/branch/database; and establish an approved backup or recovery point. Do not send database secrets in chat. After that gate, production identity and schema checks must remain read-only until a migration/data plan is reviewed and explicitly approved.

## Worktree Notes

The existing local migration inventory and query inventory were preserved and refreshed where required. Pre-existing worktree changes in `backend/test/postgresMigrations.test.js` and the untracked `backend/scripts/migrate.js` were inspected but not overwritten. The standard migrator file currently supports a PostgreSQL option but defaults to MySQL; it still requires review and tests before production use.