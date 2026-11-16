# Dashboard Performance Report

## Status: 2-second target not met

The latest isolated-Neon benchmark is the 20-sample dashboard bundle in `backend/test/postgresBookingsIntegration.test.js`. Each sample starts that role's listed API requests concurrently and records the slowest response as the bundle duration; the p50, p95, and p99 are across 20 bundle samples.

| Dashboard | p50 | p95 | p99 | Target |
|---|---:|---:|---:|---|
| Organizer | 743 ms | 1,435 ms | 3,144 ms | Not met at p99 |
| Customer | 2,668 ms | 3,469 ms | 4,027 ms | Not met |
| Vendor | 1,083 ms | 1,230 ms | 3,307 ms | Not met at p99 |

These are API-bundle measurements on the isolated test database, not production or full-browser timings. The organizer, customer, and vendor bundles include different numbers of concurrent requests. No SQL, index, or pool-size changes were made in this task, so no before/after improvement is claimed.

The dashboard benchmark itself passed in the latest opt-in run; the overall backend run had two failures in separate admin/auth integration tests.

Prior reports include different 20-sample results (organizer 680/950/3,035 ms, customer 2,688/2,693/2,696 ms, vendor 1,078/1,234/3,294 ms). The runs were not a controlled benchmark comparison. The customer aggregate query's prior single `EXPLAIN ANALYZE` execution time was 3.540 ms using a sentinel account ID on a small test database; this does not explain the bundle latency. The Neon runtime pool is capped at four connections, and prior vendor burst observations showed queued clients.

### Remaining work

- Record p50/p95/p99 per endpoint and collect representative query plans using populated isolated test fixtures.
- Measure with a controlled workload before changing query SQL or pool sizing.
- Repeat the same benchmark before and after any optimization, and include a browser/network trace if the target is end-to-end dashboard response time.
- Do not extrapolate isolated-test results to production.
