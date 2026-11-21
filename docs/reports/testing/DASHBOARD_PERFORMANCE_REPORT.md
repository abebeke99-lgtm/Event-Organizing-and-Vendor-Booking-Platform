# EventHub Dashboard and Marketplace Performance Evidence

## Findings

The dashboard bookings endpoint previously exceeded its 15-second integration target (about 18.2 seconds). After the vendor-list query was paginated in PostgreSQL, the full isolated-Neon bookings/dashboard integration passed without changing the dashboard timeout.

The public vendor directory previously loaded the entire marketplace before filtering and pagination. It now applies filters, count, sort, and page bounds in PostgreSQL, and hydrates related services, packages, availability, and media for only the returned vendor page. See [MARKETPLACE_PAGINATION_REPORT.md](../integration/MARKETPLACE_PAGINATION_REPORT.md).

## Isolated-Neon timing sample

With the existing `NEON_MARKETPLACE_TRACE=true` harness and a small isolated test dataset:

| Request | Observed time |
|---|---:|
| First vendor-list request | 3.52 s |
| Warm availability-filtered vendor-list request | 1.36 s |
| Vendor detail request | 1.90 s |
| Individual instrumented database calls | About 0.26-0.28 s |
| Peak pooled acquisition wait during pool expansion | About 2.1 s |

The current full opt-in backend run recorded 20 isolated-Neon samples per dashboard bundle. The p50/p95/p99 values were organizer 680/950/3,035 ms, customer 2,688/2,693/2,696 ms, and vendor 1,078/1,234/3,294 ms. Each sample measures the slowest concurrent endpoint in its bundle; these are not browser or production measurements. Thirteen additional vendor page endpoints passed in a separate coverage batch, not included in the vendor overview timing. During the 13-endpoint vendor page burst, the pool reached 4 active, 0 idle, and 10 waiting clients.

## Interpretation and follow-up

The bundles passed their integration test's 15-second ceiling, but customer p50/p95 and organizer/vendor p99 exceed the 2-second goal. A read-only isolated-test `EXPLAIN (ANALYZE, BUFFERS)` probe measured customer and organizer aggregate SQL execution at 3.540 ms and 1.214 ms respectively, using a sentinel account ID and a small dataset. This does not explain the complete dashboard bundles or establish production performance. Validate per-endpoint timings, representative query plans, and browser network timings before changing SQL or pool limits.
