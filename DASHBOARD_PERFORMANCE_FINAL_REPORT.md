# Dashboard Performance Report

## Current isolated-Neon measurements

`backend/test/postgresBookingsIntegration.test.js` runs 20 repeated samples per role. Each sample starts the listed endpoints concurrently and records the slowest response as the bundle duration. Percentiles use linear interpolation over 20 samples. The complete opt-in backend run passed 590/590 tests and included this workflow.

| Bundle | Endpoints included | Samples | p50 | p95 | p99 |
|---|---|---:|---:|---:|---:|
| Organizer | Overview, own events, bookings | 20 | 680 ms | 950 ms | 3,035 ms |
| Customer | Overview, vendors, services, bookings, events, messages, notifications | 20 | 2,688 ms | 2,693 ms | 2,696 ms |
| Vendor | Overview, booking requests, services, notifications | 20 | 1,078 ms | 1,234 ms | 3,294 ms |

These are API-bundle measurements against the isolated Neon test database, not production or full-browser timings. The organizer vendors request is not included in the measured bundle.

## Before/after comparison

The earlier 20-sample API bundle measurements predate the current run. The latest values below are from the current full opt-in run:

| Bundle | Earlier p50/p95/p99 | Latest p50/p95/p99 |
|---|---:|---:|
| Organizer | 812 / 1,405 / 3,127 ms | 680 / 950 / 3,035 ms |
| Customer | 2,704 / 2,721 / 2,748 ms | 2,688 / 2,693 / 2,696 ms |
| Vendor | 1,089 / 1,900 / 3,248 ms | 1,078 / 1,234 / 3,294 ms |

This is not a controlled UI A/B test: the API harness launches each role's endpoints concurrently in both runs. It cannot measure the organizer UI's former sequential request waterfall, and the percentile differences do not establish that the UI change improved database or endpoint latency. A browser network trace before and after the UI change was not captured.

## Findings and changes

- Customer overview begins its summary and six independent secondary requests concurrently. Existing in-flight deduplication, abort handling, stale-response protection, and partial-loading behavior were retained.
- Organizer dashboard requests now start concurrently; overview remains critical, secondary failures remain partial, and request deduplication remains in place. Focused frontend regression tests and the full frontend suite passed.
- The PostgreSQL customer and organizer overview handlers use aggregate queries; this does not establish that all other endpoints are free of N+1 queries or prove query-plan efficiency.
- The organizer UI concurrency change is covered by request-level tests. No post-change full-browser benchmark was run.

## Isolated query-plan probe

The current customer and organizer aggregate SQL was executed with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against the isolated PostgreSQL 18 database using sentinel account ID `0` (no account data was read or changed):

| Query | Planning time | Execution time | Shared buffer hits / reads |
|---|---:|---:|---:|
| Customer overview | 36.819 ms | 3.540 ms | 7 / 4 |
| Organizer overview | 4.890 ms | 1.214 ms | 8 / 1 |

These are single probes against the small isolated test dataset, not representative load benchmarks. They do not prove production query efficiency or explain latency across the other concurrently requested endpoints. No index or SQL changes were made from this evidence.

## Decision and follow-up

The 2-second target is not met for customer p50/p95, and organizer/vendor p99 exceed 2 seconds. Inspect per-endpoint timings, repeat query plans with representative isolated-test data, and capture browser network timings before changing SQL, indexes, or pool sizes. Keep database execution timings separate from end-to-end UI timings; do not extrapolate these isolated measurements to production.
