# EventHub Dashboard and Marketplace Performance Evidence

## Findings

The dashboard bookings endpoint previously exceeded its 15-second integration target (about 18.2 seconds). After the vendor-list query was paginated in PostgreSQL, the full isolated-Neon bookings/dashboard integration passed without changing the dashboard timeout.

The public vendor directory previously loaded the entire marketplace before filtering and pagination. It now applies filters, count, sort, and page bounds in PostgreSQL, and hydrates related services, packages, availability, and media for only the returned vendor page. See [MARKETPLACE_PAGINATION_REPORT.md](./MARKETPLACE_PAGINATION_REPORT.md).

## Isolated-Neon timing sample

With the existing `NEON_MARKETPLACE_TRACE=true` harness and a small isolated test dataset:

| Request | Observed time |
|---|---:|
| First vendor-list request | 3.52 s |
| Warm availability-filtered vendor-list request | 1.36 s |
| Vendor detail request | 1.90 s |
| Individual instrumented database calls | About 0.26-0.28 s |
| Peak pooled acquisition wait during pool expansion | About 2.1 s |

In the latest bookings integration, the organizer bundle completed in 4.12 seconds, the customer bundle in 2.68 seconds, and the actual four-request vendor overview bundle in 0.81 seconds. Thirteen additional vendor page endpoints returned successfully in a separate coverage batch; that batch is not an overview timing. The integration passed its existing 15-second assertion. These are single-run samples, not p95 or production-load evidence. The 2-second dashboard goal is therefore not established and was exceeded by the organizer and customer samples.

## Interpretation and follow-up

The latest run is within the integration test's 15-second ceiling, but the organizer/customer samples do not meet the 2-second goal and the prior 18.2-second outlier remains unexplained. Validate network and pool behavior with repeated measurements before changing pool limits. Use read-only `EXPLAIN`/`EXPLAIN ANALYZE` only on the isolated test database. Do not add schema indexes or alter dashboard thresholds without measured evidence and authorization.
