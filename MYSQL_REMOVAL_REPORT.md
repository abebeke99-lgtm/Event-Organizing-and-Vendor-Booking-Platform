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
| Neon test schema | 53/53 expected application tables; 58 public tables, 87 foreign keys, 169 indexes |
| Backend test suite | 536 passed, 0 failed, 26 skipped (562 total) |
| Frontend tests | 214 passed, 0 failed |
| Frontend production build | Passed |
| PostgreSQL marketplace integration | Clean rerun passed all 18 tests; a preceding run had transient category-test failures |
| Neon booking/dashboard integration | Passed; latest single-run organizer/customer/vendor bundles 4.12 s / 2.68 s / 0.81 s |
| Production DB / deployment / GitHub | Not accessed; deployment and synchronization remain pending |

Migration `017_password_reset_otp_sessions.sql` was applied only to the isolated Neon test database after prior explicit approval. It was not applied to production. No database reset or data deletion was performed.

The ignored local `backend/.env` retains empty/unusable PostgreSQL URL configuration and obsolete variable names. It was left unchanged to preserve local configuration; only variable names were inspected. The isolated test environment is separate. No credentials were printed or copied into frontend files.

## Remaining compatibility work

The latest static inventory covers 1,247 backend database call sites across 102 JavaScript source files: 18 infrastructure calls, 45 application call sites with isolated-Neon evidence, and 1,184 application call sites not certified. See `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`. Passing tests and inventory totals do not establish full PostgreSQL parity.

Legacy/shared code still contains MySQL-specific SQL constructs (including `GROUP_CONCAT`, `DATE_ADD`, `DATE_FORMAT`, `CURDATE`, and `ON DUPLICATE KEY UPDATE`) and `?` placeholders. These must be resolved or proven unreachable before claiming a complete PostgreSQL-only application. PostgreSQL-specific route files are used by the production PostgreSQL app path, but the remaining shared and legacy modules have not all been proven unreachable. No blind SQL replacement was made.

## Marketplace pagination update

`GET /api/platform/vendors` now filters, counts, sorts, and paginates verified active vendors in PostgreSQL before loading nested data. It hydrates services, packages, availability, and media only for the selected vendor page. Filters and stable ordering are parameterized/allowlisted, and response fields and pagination shape are retained. The isolated-Neon marketplace integration passed after the change.

On the isolated Neon test dataset, an instrumented first vendor-list request took 3.52 seconds and a warm availability-filtered request took 1.36 seconds. These are sample timings, not a production load benchmark; database query calls were about 0.26-0.28 seconds each, and a pooled-connection wait briefly reached about 2.1 seconds. The latest booking integration measured the actual four-request vendor overview bundle at 0.81 seconds; 13 additional vendor page checks were separate coverage, not an overview timing. Organizer and customer bundles measured 4.12 and 2.68 seconds in that run. None of these are p95 measurements.

## Outstanding limits

- The 1,184 uncertified application call sites remain an explicit PostgreSQL compatibility gap.
- A prior dashboard bookings timing exceeded the 15-second target (about 18.2 seconds); the latest Neon booking/dashboard integration passed under the existing 15-second bound, but the earlier outlier has not been explained with repeated measurements. Organizer/customer samples also exceeded the 2-second target.
- Production schema, Netlify, Render, CORS allowlists, and live deployment health were not inspected.
- External SMTP delivery and production authentication flows were not certified in this run.
- One Neon schema-check attempt failed transiently with `DB_CONNECT_FAILED`; an immediate isolated retry passed pooled/direct connection and schema checks.
- Netlify/Render deployment and GitHub synchronization remain pending; no deployment or push was attempted.
