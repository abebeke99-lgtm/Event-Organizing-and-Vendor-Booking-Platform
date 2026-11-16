# EventHub PostgreSQL Migration Completion Report

## Result

**PARTIAL — migration completion criteria are not met.** PostgreSQL 18 is the only configured runtime and selected isolated-Neon schema, API, and workflow checks pass. Most application query call sites remain uncertified, SQL compatibility paths remain, dashboard latency exceeds target percentiles, and production/provider verification was not performed.

## Current evidence

| Check | Current result |
|---|---|
| Isolated Neon pooled/direct connection and schema check | Passed; PostgreSQL 18; 53/53 expected tables, 58 public tables, 87 foreign keys, 169 indexes |
| Static inventory | 1,255 query/execute sites in 102 backend JS files: 17 `CERTIFIED`, 566 `NEEDS_FIX`, 654 `UNVERIFIED`, 18 `EXEMPT` |
| Migration history | Isolated test DB records 001-010, 012, 014-017; 011 and 013 remain unapplied |
| Avatar shared route | Focused tests and exact shared-route Neon integration passed; uses PostgreSQL positional bindings |
| OAuth registration state | Migration 016 applied to isolated Neon only; OAuth unit/integration tests passed 11/11 |
| Marketplace/core integration | Core CRUD/relationships and populated marketplace detail Neon tests passed |
| Booking/dashboard Neon integration | Passed in the full opt-in run; booking, quotation, availability, ownership, payments/refunds, messaging, notifications, reviews, complaints exercised |
| Dashboard API percentiles (20 samples) | Organizer 680/950/3,035 ms; customer 2,688/2,693/2,696 ms; vendor 1,078/1,234/3,294 ms (p50/p95/p99) |
| Isolated aggregate-query plans | Customer 3.540 ms execution; organizer 1.214 ms execution using sentinel ID `0`; not representative of production or full dashboard latency |
| Frontend | 218 tests passed; production build passed after organizer concurrency change |
| Demo/mock production path | `DEMO_AUTH_ENABLED` is `false`; built output contains no demo credential or demo-storage markers checked in this pass |
| Default backend suite | 541 passed, 0 failed, 27 skipped; the skipped Neon integration tests require `RUN_NEON_INTEGRATION=true` |
| Full opt-in backend suite | 589 passed, 0 failed, 0 skipped, including isolated-Neon integration tests |
| Production DB, deployment, GitHub push | Not accessed or performed |

## Inventory movement in this batch

| Classification | Baseline | Current | Change |
|---|---:|---:|---:|
| CERTIFIED | 15 | 17 | +2 |
| NEEDS_FIX | 566 | 566 | 0 resolved |
| UNVERIFIED | 656 | 654 | -2 |
| EXEMPT | 18 | 18 | 0 |

The two newly certified entries are the administrator user-list count and paginated fetch queries, exercised against Neon with combined filters. This batch did not reduce the 566 static `NEEDS_FIX` entries.

Percentiles are isolated-test API bundles, not browser or production measurements. The full opt-in suite passed after adding bounded retry classification for node-postgres pool acquisition timeouts; failed SQL queries are still never replayed. The separate read-only Neon schema check also passed.

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
4. Reconcile migrations 011/013 without losing the custom category mapping, and verify full column/constraint/index parity; the current checker only verifies table presence and aggregate FK/index counts.
5. Verify provider-side production configuration, schema parity, and live health only in an authorized environment.
6. Complete route-level security review and integration coverage beyond the selected flows.

No production data was modified. No production migration, deployment, commit, or push was performed in this pass.
