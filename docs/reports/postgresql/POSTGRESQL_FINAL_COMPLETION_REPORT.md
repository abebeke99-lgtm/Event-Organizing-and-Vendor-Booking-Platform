# EventHub PostgreSQL Migration Completion Report

> **Status notice (2026-11-19):** Historical report. PostgreSQL runtime is active, 59 tables and 20/22 migration records are verified, but 566 NEEDS_FIX and 654 UNVERIFIED query rows remain unresolved. This report must not be read as evidence of complete PostgreSQL-only compatibility.

## Result

**PARTIAL — migration completion criteria are not met.** PostgreSQL 18 is the only configured runtime and selected isolated-Neon schema, API, and workflow checks pass. Most application query call sites remain uncertified, SQL compatibility paths remain, dashboard latency exceeds target percentiles, and production/provider verification was not performed.

## Current evidence

| Check | Current result |
|---|---|
| Isolated Neon pooled/direct connection and schema check | Passed; PostgreSQL 18; 53/53 expected tables, 58 public tables, 87 foreign keys, 169 indexes |
| Static inventory | 1,255 query/execute sites in 102 backend JS files: 17 `CERTIFIED`, 566 `NEEDS_FIX`, 654 `UNVERIFIED`, 18 `EXEMPT` |
| Migration history | Isolated test DB records 001-010, 012, 014-017; 011 and 013 remain unapplied. Corrected 011/013 ran against temporary Neon fixtures in a rolled-back transaction, including custom-mapping restoration. |
| Avatar shared route | Focused tests and exact shared-route Neon integration passed; uses PostgreSQL positional bindings |
| OAuth registration state | Migration 016 applied to isolated Neon only; OAuth unit/integration tests passed 11/11 |
| Marketplace/core integration | Core CRUD/relationships and populated marketplace detail Neon tests passed |
| Booking/dashboard Neon integration | Passed in the full opt-in run; booking, quotation, availability, ownership, payments/refunds, messaging, notifications, reviews, complaints exercised |
| Latest dashboard API percentiles (20 samples) | Organizer 743/1,435/3,144 ms; customer 2,668/3,469/4,027 ms; vendor 1,083/1,230/3,307 ms (p50/p95/p99); customer target and organizer/vendor p99 targets missed |
| Isolated aggregate-query plans | Customer 3.540 ms execution; organizer 1.214 ms execution using sentinel ID `0`; not representative of production or full dashboard latency |
| Frontend | 218 tests passed; production build passed after organizer concurrency change |
| Demo/mock production path | `DEMO_AUTH_ENABLED` is `false`; built output contains no demo credential or demo-storage markers checked in this pass |
| Default backend suite | 541 passed, 0 failed, 28 skipped; the skipped Neon integration tests require `RUN_NEON_INTEGRATION=true` |
| Latest full opt-in backend attempt | 583 tests: 581 passed, 2 failed, 0 skipped; failures were in admin invitation and authentication integrations |
| Production DB, deployment, GitHub push | Not accessed or performed |

## Inventory movement in this batch

| Classification | Baseline | Current | Change |
|---|---:|---:|---:|
| CERTIFIED | 15 | 17 | +2 |
| NEEDS_FIX | 566 | 566 | 0 resolved |
| UNVERIFIED | 656 | 654 | -2 |
| EXEMPT | 18 | 18 | 0 |

The two newly certified entries are the administrator user-list count and paginated fetch queries, exercised against Neon with combined filters. This batch did not reduce the 566 static `NEEDS_FIX` entries.

Percentiles are isolated-test API bundles, not browser or production measurements. The latest full opt-in attempt failed two assertions: the admin user creation integration received 400 instead of 201, and authentication integration received 500 instead of 200. This does not invalidate the earlier recorded 590-test run, but that historical result was not reproduced in this workspace state. The bounded connection retry does not replay SQL queries. The separate read-only Neon schema check was not rerun in this pass.

## Implemented and verified areas

- Shared user-avatar upload, read, and delete use native PostgreSQL positional parameters and were exercised through the authenticated route against isolated Neon.
- PostgreSQL administrator contact routes were mounted for the real PostgreSQL adapter; filtered reads, updates, audit writes, authorization, and transaction rollback have isolated-Neon coverage. The user-list route now builds native positional filters for status/date values; an isolated-Neon request covers combined search, status, role, and date filters for its count and page queries.
- The customer overview query and organizer overview query now have explicit inventory evidence from the isolated-Neon dashboard integration.
- Customer dashboard requests remain concurrent with deduplication and stale-response protection; organizer UI requests now start concurrently while retaining overview-critical and partial-loading behavior.
- Administrator user-list status/date filters now use direct PostgreSQL `$n` parameters, and the PostgreSQL adapter no longer rewrites `?` characters.
- `postgresRetry.js` recognizes the node-postgres pool acquisition timeout message with one bounded retry; query mutations are not retried.

The regenerated [`POSTGRESQL_QUERY_VERIFICATION_MATRIX.md`](./POSTGRESQL_QUERY_VERIFICATION_MATRIX.md) and CSV inventory contain per-call-site detail. The other current reports include schema verification, MySQL removal, dashboards, security, deployment readiness, and remaining blockers.

## Remaining blockers

1. Resolve the 566 `NEEDS_FIX` call sites and establish whether affected callers are active runtime paths before removing remaining compatibility conversion.
2. Inspect and verify the 654 `UNVERIFIED` call sites with isolated-Neon evidence.
3. Investigate customer p50/p95 and organizer/vendor p99 values above 2 seconds using per-endpoint timings and query plans.
4. Review the corrected 011/013 snapshot and restore behavior against the target database backup, then approve and apply only through a separately authorized migration. Verify full column/constraint/index parity; the current checker only verifies table presence and aggregate FK/index counts.
5. Verify provider-side production configuration, schema parity, and live health only in an authorized environment.
6. Complete route-level security review and integration coverage beyond the selected flows.

No production data was modified. No production migration, deployment, commit, or push was performed in this pass.
