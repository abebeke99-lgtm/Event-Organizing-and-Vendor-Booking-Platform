# PostgreSQL Application Compatibility Report

Updated: 2026-11-12
Scope: Current source and isolated Neon payment/refund verification. This is not a full-application certification.

## Summary

The application remains mixed-dialect. PostgreSQL mode uses a shared `pg` runtime pool and native route implementations for selected features; legacy MySQL modules and `mysql2` remain in source and runtime configuration. The root and backend package manifests, server default, and deployment documentation still permit or default to MySQL. Do not remove MySQL dependencies or make a production cutover on the evidence in this report.

The regenerated AST inventory has 1,116 call sites across 93 backend source JavaScript files: 18 infrastructure calls and 1,098 application calls. Of the application calls, 426 have callsite-specific Neon evidence and 672 remain uncertified (628 `.execute()` and 44 `.query()`); 569 uncertified calls have detected MySQL-specific markers and 103 do not. Marker absence is not proof of PostgreSQL compatibility.

## Verified Against Isolated Neon

The isolated Neon `eventhub` test database is PostgreSQL 18. Read-only schema checks find all 51 application table names, 82 foreign keys, and 151 indexes (52 public base tables including the migration history table). These are test database counts, not production counts or complete schema parity evidence.

Live PostgreSQL integration coverage now exercises:

- Provider payment success and failure, plus webhook replay deduplication.
- Provider refund success and failure, including partial refund state restoration.
- Customer payment/refund listing and refund request creation through authenticated HTTP routes.
- Refund idempotency, amount reservations, approval/provider finalization, and rejection.
- Administrator payment/refund listing, detail, report, CSV exports, pagination, status/search/UTC date filters, and decisions.
- Atomic rollback for mismatched provider data, persisted payment/refund history and audit rows, unauthenticated admin denial, and FK rejection.

The live test proves only the branches it executed. It verifies duplicate-key race recovery and failed-refund recounting, but does not certify a provider `pending` reconciliation result, every filter boundary, all payment/refund response edge cases, or production payment-provider behavior.

## Known PostgreSQL Coverage Gaps

PostgreSQL mode still does not provide complete application parity. The current inventory records 672 application calls without callsite-specific Neon certification. Certified calls cover selected authentication, booking/availability, vendor, admin, payment/refund, marketplace/event, AI-chat, notification, and settings workflows; remaining calls include unconverted MySQL feature paths, untested alternate branches, seed and operational scripts, and workflows not yet mapped to real Neon evidence. The route and query inventory must continue to be reconciled endpoint by endpoint.

No comprehensive semantic comparison has been completed for every PostgreSQL table/column/type/default/check/unique/index/trigger/FK against `backend/schema.sql` plus the 40 legacy MySQL migration files. Standalone names requested for event media, schedules, attendees, addresses, invoices, and other domain concepts must be reconciled with existing columns/JSON/tables before adding schema. Do not create duplicates based only on naming.

## MySQL-Specific Runtime/SQL Findings

Legacy source and schema still include MySQL-oriented behavior such as `?` placeholders, mysql2 tuple/`execute()` result handling, `ON DUPLICATE KEY UPDATE`, `LAST_INSERT_ID`, `GROUP_CONCAT`, MySQL date functions/interval syntax, `SELECT DATABASE()`, `AUTO_INCREMENT`, unsigned integer types, MySQL enums, InnoDB DDL, and `ON UPDATE CURRENT_TIMESTAMP`. PostgreSQL equivalents need explicit behavioral review and tests; string replacement alone is insufficient.

The payment/refund PostgreSQL implementation is separate from the legacy MySQL service. The old code remains available only through the legacy module path; its removal depends on finishing all dependent features and selecting one application data-access path.

## Test Status

- PostgreSQL migration unit tests, latest run: 9 passed, 0 failed, 0 skipped. Latest expanded live Neon payment integration: 1 passed, 0 failed, 0 skipped; the same-key race exercised unique-conflict recovery and the failed-refund recount.
- Existing MySQL payment unit tests: 9 passed, 0 failed with a non-connecting dummy pool configuration.
- Frontend tests: 172 passed, 0 failed. Production Vite build passed with a compile-only non-routable HTTPS `VITE_API_URL` placeholder; this does not verify a production API origin.
- Live Neon database evidence is limited to the test project/database. Neon pooled connection acquisition has intermittent timeouts; one retry was required during this work. The exact SQL export query was separately confirmed directly on the isolated database, while the HTTP export issue was traced to Zod schema refinement/omit behavior and fixed.
- Full backend suite under isolated Neon PostgreSQL runtime settings: 446 total, 252 passed, 184 failed, 10 skipped. Failures are concentrated in legacy MySQL route/configuration assumptions and database fixture mismatches; full PostgreSQL application compatibility is not established. Complete role-based browser journeys, backup/restore rehearsal, and production deployment were not run.

## Certification Rule

The generated CSV continues to mark application calls as not certified unless explicitly recognized as infrastructure. Live test evidence should be associated with individual query call sites in later audit tooling, and only after verifying the exact SQL branches, parameters, result conversions, transaction/failure semantics, constraints, and persisted outcomes. A matching test filename is not certification.