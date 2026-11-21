# PostgreSQL Runtime Compatibility Final Audit

Date: 2026-11-19

## Overall status

**PARTIAL / FAIL for complete PostgreSQL-only compatibility; PASS for current runtime call-path separation**

The audit inspected the complete 1,220 non-exempt application findings represented as 566 `NEEDS_FIX` and 654 `UNVERIFIED` rows. It did not run migrations, alter records, or remove compatibility code.

No active PostgreSQL-named route or PostgreSQL-native helper was found to contain a clear MySQL-only marker in its executable PostgreSQL branch. The remaining findings are primarily legacy-only branches, conservative static classifications, or PostgreSQL-native call sites that lack isolated-Neon evidence.

## Audit totals

| Inventory status | Total | Production-reachable/classified active | Legacy/inactive | Infrastructure/shared |
|---|---:|---:|---:|---:|
| NEEDS_FIX | 566 | 26 shared/dialect-branch candidates | 540 legacy-file matches | 0 |
| UNVERIFIED | 654 | 536 PostgreSQL-prefixed call sites | 78 legacy-file matches | 40 infrastructure/shared |
| CERTIFIED | 17 | 17 separately evidenced | 0 | 0 |
| EXEMPT | 18 | 0 | 0 | 18 |
| Total | 1,255 | 579 | 618 | 58 |

Note: “shared/dialect-branch candidates” are not certified fixes. They contain branches for both dialects or shared middleware/helper logic. Their PostgreSQL branch must be proven independently.

## Active PostgreSQL runtime reachability

The production mount is controlled by `isLegacyCompatibilityAdapter`. In the normal PostgreSQL adapter path:

- PostgreSQL routes are mounted.
- Legacy `admin.js`, `platform.js`, `vendor.js`, `customer.js`, `organizer.js`, and `auth.js` route branches are not mounted.
- PostgreSQL-native routes cover auth, OAuth, public events, marketplace, bookings, vendor, customer account, organizer planning, profile photos, and Admin modules.

The active PostgreSQL route mount is implemented in `backend/src/app.js`.

## NEEDS_FIX findings

### Legacy findings

540 `NEEDS_FIX` rows match legacy route or utility files that are not mounted when `database.dialect === 'postgres'`.

Examples include:

- `backend/src/routes/admin.js`
- `backend/src/routes/platform.js`
- `backend/src/routes/vendor.js`
- `backend/src/routes/customer.js`
- `backend/src/routes/organizer.js`
- `backend/src/routes/auth.js`
- Legacy payment/report/notification routes

These findings must remain classified as legacy until runtime reachability is removed or proven for a separate compatibility mode.

### Shared/dialect-branch findings

26 `NEEDS_FIX` rows occur in shared middleware/helpers:

- `bookingAvailability.js`: 7
- `adminProvisioning.js`: 4
- `requireAdmin.js`: 3
- `security.js`: 3
- `marketplace.js`: 3
- `notificationService.js`: 2
- `requirePlatformUser.js`: 1
- `rbac.js`: 1
- `aiChatContext.js`: 1
- `adminEvents.js`: 1

The shared findings do not indicate a confirmed active PostgreSQL incompatibility:

- `bookingAvailability.js` has explicit PostgreSQL positional `$n` branches.
- `adminProvisioning.js` has explicit PostgreSQL `query`/transaction branches.
- `adminEvents.js` has a native PostgreSQL branch.
- `requireAdmin.js` and `requirePlatformUser.js` use PostgreSQL `$n` branches and legacy fallback branches.
- `security.js`, `notificationService.js`, `marketplace.js`, and `aiChatContext.js` contain legacy compatibility code; active PostgreSQL routes use PostgreSQL-native implementations or do not call these legacy functions.

No `NEEDS_FIX` row was changed to fixed because no MySQL-only SQL was confirmed in an active PostgreSQL-named route or active PostgreSQL branch.

## UNVERIFIED findings

### PostgreSQL-named call sites

536 `UNVERIFIED` rows are in PostgreSQL-named routes or PostgreSQL-native files. They are production-mounted candidates but lack call-site-specific evidence sufficient to be certified.

Main areas:

- PostgreSQL Admin routes
- PostgreSQL auth/OAuth
- PostgreSQL bookings and vendor workflows
- PostgreSQL marketplace and organizer planning
- PostgreSQL customer account/profile
- PostgreSQL notifications/payments/reports
- PostgreSQL middleware and adapter helpers

These rows are not classified as fixed. Passing generic unit/integration coverage does not promote individual call sites to `CERTIFIED`.

### Legacy and infrastructure findings

- 78 `UNVERIFIED` rows are in legacy-file matches.
- 6 are PostgreSQL infrastructure adapters/migrations.
- 34 are shared/test/helper candidates.

## Binding, transaction, and SQL review

### Parameter binding

PASS: The PostgreSQL adapter passes native positional parameter arrays to `pg.query` and does not rewrite JSON existence operators or `?` characters.

PASS: PostgreSQL-named route modules use `$1`, `$2`, and other positional placeholders.

WARNING: Legacy modules contain question-mark compatibility placeholders. They are not mounted in the normal PostgreSQL runtime.

### Transactions

PASS: The PostgreSQL adapter supports `BEGIN`, `COMMIT`, `ROLLBACK`, nested savepoints, and broken-client release.

WARNING: Shared legacy transaction helpers remain separate and are not certified for every branch.

### Joins and pagination

PASS: PostgreSQL route modules use explicit joins and `LIMIT`/`OFFSET` with positional values in mounted flows.

NOT CERTIFIED: 536 PostgreSQL-named `UNVERIFIED` call sites need call-site-specific tests before promotion.

### Dates and aggregation

PASS: Active PostgreSQL modules use PostgreSQL casts, `NOW()`, `INTERVAL '...'`, `COUNT(*) FILTER`, and typed date parameters.

WARNING: Legacy `publicEventSql.js` and legacy platform routes retain MySQL-style interval/date functions, but these are not mounted in normal PostgreSQL runtime.

### Conflict handling

PASS: PostgreSQL-native routes use `ON CONFLICT` where reviewed.

## Fixed findings

**Fixed findings: 0**

No production-reachable MySQL-only SQL was confirmed in a PostgreSQL-named route or PostgreSQL-native executable branch. Therefore no SQL finding is marked fixed by this audit. This avoids falsely converting or promoting legacy code without evidence.

One earlier startup issue was already fixed separately: missing/placeholder AI configuration no longer blocks core backend startup.

## Test evidence

### Complete test suite

- Root `npm test`
- Backend: 568 passed, 0 failed
- Frontend: 235 passed, 0 failed

### Focused PostgreSQL suite

- 24 tests executed
- 20 passed
- 4 Neon opt-in tests skipped because `RUN_NEON_INTEGRATION` was not enabled
- 0 failures

Covered:

- PostgreSQL adapter binding and transaction behavior
- PostgreSQL marketplace/vendor/organizer routes
- PostgreSQL admin and overview route behavior
- PostgreSQL auth/booking integration test registration

Neon live test groups for admin, auth, booking, and vendor remain skipped unless separately authorized and configured with the isolated test environment.

### Database check

PASS: Neon PostgreSQL runtime connection and `SELECT 1`.

PASS: 59 application tables detected.

### Production build

PASS: Vite production build completed successfully.

## Updated inventory counts

The static inventory remains:

- 17 `CERTIFIED`
- 566 `NEEDS_FIX`
- 654 `UNVERIFIED`
- 18 `EXEMPT`
- 1,255 total

After this audit:

- 566 `NEEDS_FIX`: 540 legacy matches, 26 shared/dialect candidates, 0 confirmed active PostgreSQL fixes
- 654 `UNVERIFIED`: 536 PostgreSQL-prefixed candidates, 78 legacy matches, 40 shared/infrastructure candidates
- Fixed by this audit: 0

## Remaining blockers

1. 536 PostgreSQL-prefixed call sites require call-site-specific Neon test evidence.
2. 566 `NEEDS_FIX` findings remain unresolved; 540 are legacy-file matches and 26 are shared/dialect candidates.
3. Live isolated-Neon integration tests were skipped by the normal suite.
4. 021 and 022 remain unapplied and pending.
5. Live Render database/auth/browser verification remains unavailable.
6. No production record or migration was changed.

## Final status

| Check | Status |
|---|---|
| Complete inventory audited | PASS |
| Reachability classification | PASS |
| Active PostgreSQL marker scan | PASS |
| Confirmed active SQL fixes | PASS (0 found; no unsafe conversion) |
| Complete PostgreSQL-only compatibility | FAIL |
| Full Neon call-site certification | NOT VERIFIED |
| Backend tests | PASS |
| Frontend tests | PASS |
| Production build | PASS |
| Database connectivity | PASS |
