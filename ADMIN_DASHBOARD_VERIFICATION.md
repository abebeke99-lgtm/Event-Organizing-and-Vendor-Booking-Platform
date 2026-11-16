# Admin Integration Report

## Current isolated-Neon evidence

The full opt-in backend run passed the following isolated-Neon admin integration cases:

- `backend/test/adminProvisioningNeon.test.js` — single-admin provisioning, duplicate protection, and concurrent race handling.
- `backend/test/postgresAdminAuditLogsIntegration.test.js` — filters, pagination, export, and authorization.
- `backend/test/postgresAdminBookings.test.js` — list/detail/export, transitions, rescheduling, availability, and authorization.
- `backend/test/postgresAdminCatalogIntegration.test.js` — private verification access and category management.
- `backend/test/postgresAdminEventsIntegration.test.js` — event create/list/update/status, overlap rollback, and authorization.
- `backend/test/postgresAdminIntegration.test.js` — users, roles, report summaries, and authorization; current focused integration also applies search, status, role, and date filters together to the user count and paginated query.
- `backend/test/postgresAdminProfileIntegration.test.js` — profile update, password rotation, and email-change verification.
- `backend/test/postgresAdminSettingsIntegration.test.js` — isolated setting persistence and restoration.

These are live isolated-Neon tests; no production administrator accounts or data were accessed. The current full opt-in backend suite passed 590/590 tests. The default backend suite passed 541 tests, failed 0, and skipped 28 opt-in Neon tests gated by `RUN_NEON_INTEGRATION=true`.

## Limits

These tests do not certify every admin page, mutation, permission combination, SQL query, or provider integration. The query inventory remains the source of truth for uncertified call sites. An earlier query-plan measurement is not included as current evidence because it was not rerun in this pass.

See [`POSTGRESQL_QUERY_VERIFICATION_MATRIX.md`](./POSTGRESQL_QUERY_VERIFICATION_MATRIX.md) and [`REMAINING_BLOCKERS_REPORT.md`](./REMAINING_BLOCKERS_REPORT.md).
