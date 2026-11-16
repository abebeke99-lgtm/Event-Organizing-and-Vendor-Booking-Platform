# EventHub MySQL Removal and Neon PostgreSQL Verification

## Status

EventHub runtime and deployment configuration use Node.js, Express, React, Vite, and PostgreSQL. MySQL driver dependencies and the retired MySQL schema, migrations, seeds, and local database scripts were removed in earlier migration work. This is not a claim that every legacy SQL path has been converted or that production deployment has been verified.

The separate `personalportofolio/` application was not changed. No production database, deployment, or GitHub push was accessed or performed.

## Verification results

| Area | Result |
|---|---|
| MySQL/MariaDB runtime dependencies | `mysql2` removed from root/backend manifests and lockfiles |
| Legacy database files/scripts | Retired MySQL schema, migration runner, seed scripts, and XAMPP-oriented checks removed |
| PostgreSQL runtime | Neon pooled `DATABASE_URL`; direct `DIRECT_URL` for migration/check workflows; SSL and bounded pooling configured |
| Neon test connection | Pooled and direct connections passed; `SELECT 1` passed |
| Neon test schema | 53/53 expected application tables; 58 public tables, 87 foreign keys, 169 indexes; migration 016 recorded on isolated test DB only |
| Default backend test suite | 541 passed, 0 failed, 28 opt-in Neon integration tests skipped |
| Latest full opt-in backend attempt | 583 tests: 581 passed, 2 failed, 0 skipped; earlier 590/590 result is historical and was not reproduced |
| Frontend tests | 218 passed, 0 failed |
| Frontend production build | Passed |
| PostgreSQL marketplace and booking/dashboard integrations | Passed in the 590-test opt-in Neon suite |
| Latest dashboard bundle p50/p95/p99 (ms) | Organizer 743/1,435/3,144; customer 2,668/3,469/4,027; vendor 1,083/1,230/3,307 |
| Production DB / deployment / GitHub | Not accessed; deployment and synchronization remain pending |

Migration `016_public_oauth_registration_roles.sql` was applied only to the isolated Neon test database after a transaction rollback dry-run and post-apply checks. It was not applied to production. Migrations 011 and 013 remain unapplied; the updated 011 now snapshots affected custom mappings and has a tested manual restore query against temporary Neon fixtures. Neither migration was permanently run during this pass. See [POSTGRESQL_MIGRATION_RECONCILIATION_REPORT.md](./POSTGRESQL_MIGRATION_RECONCILIATION_REPORT.md). No database reset or data deletion was performed.

The ignored local `backend/.env` retains empty/unusable PostgreSQL URL configuration and obsolete variable names. It was left unchanged to preserve local configuration; only variable names were inspected. The isolated test environment is separate. No credentials were printed or copied into frontend files.

## Remaining compatibility work

The current static inventory covers 1,255 backend database call sites across 102 JavaScript source files: 17 `CERTIFIED`, 566 `NEEDS_FIX`, 654 `UNVERIFIED`, and 18 `EXEMPT`. See `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`. Passing tests and inventory totals do not establish full PostgreSQL parity.

The PostgreSQL adapter no longer rewrites `?` characters; a regression test verifies PostgreSQL's JSON existence operator passes through unchanged. Legacy/shared code still contains SQL markers such as `GROUP_CONCAT`, `DATE_ADD`, `DATE_FORMAT`, `CURDATE`, and `ON DUPLICATE KEY UPDATE` and compatibility placeholder branches. The current targeted scan reports 73 matches across 21 backend source files; these include inactive/unclassified branches and are not all confirmed active MySQL execution paths. They must be resolved or proven unreachable before claiming a complete PostgreSQL-only application. No blind SQL replacement was made.

## Marketplace pagination update

`GET /api/platform/vendors` now filters, counts, sorts, and paginates verified active vendors in PostgreSQL before loading nested data. It hydrates services, packages, availability, and media only for the selected vendor page. Filters and stable ordering are parameterized/allowlisted, and response fields and pagination shape are retained. The isolated-Neon marketplace integration passed after the change.

An earlier isolated-Neon vendor-list trace recorded a 3.52-second first request and a 1.36-second warm availability-filtered request; these are historical single samples, not current dashboard percentiles or production timings. The current 20-sample dashboard results are listed above and in `DASHBOARD_PERFORMANCE_FINAL_REPORT.md`.

## Outstanding limits

- The 566 `NEEDS_FIX` and 654 `UNVERIFIED` application call sites remain an explicit PostgreSQL compatibility gap.
- Customer p50/p95 and organizer/vendor p99 exceed the 2-second dashboard target; no production load or query-plan analysis was performed.
- Production schema, Netlify, Render, CORS allowlists, and live deployment health were not inspected.
- External SMTP delivery and production authentication flows were not certified in this run.
- One Neon schema-check attempt failed transiently with `DB_CONNECT_FAILED`; an immediate isolated retry passed pooled/direct connection and schema checks.
- Netlify/Render deployment and GitHub synchronization remain pending; no deployment or push was attempted.
