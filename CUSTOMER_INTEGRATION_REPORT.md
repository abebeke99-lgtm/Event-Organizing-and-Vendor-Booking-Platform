# Customer Integration Report

## Evidence

The isolated-Neon booking/dashboard integration passed for the customer flow. It exercised the concurrent `overview`, `vendors`, `services`, `bookings`, `events`, `messages`, and `notifications` request bundle for 20 samples; each request returned HTTP 200.

The current full-suite measurement recorded bundle latency of p50 **2,688 ms**, p95 **2,693 ms**, p99 **2,696 ms**. The measurement is the slowest response in each concurrent API bundle, not a browser-render or production measurement.

The full opt-in backend run passed customer booking/payment/refund reads, quotation decision, rescheduling, messaging, notifications, reviews, complaints, and ownership checks. Expected unauthorized, missing-resource, and conflict responses are asserted by the integration. Test fixtures are isolated and cleaned up by the test. The complete opt-in suite passed 589/589 tests.

The frontend dashboard already starts the overview and six independent requests concurrently and retains deduplication, cancellation, stale-response protection, and partial-loading behavior. Its focused regressions and full frontend test suite passed.

## Blockers and limits

- Customer p50 and p95 exceed the 2-second target.
- The test bundle is API-only and the overview request is one of several independent endpoints; it does not identify which endpoint dominates each sample.
- No production data, production load, query-plan analysis, or full-browser performance run was used.
- This integration does not certify every customer query or all authorization combinations.

## Verification sources

- `backend/test/postgresBookingsIntegration.test.js` (customer bundle and workflows)
- `backend/src/routes/postgresBookings.js` (PostgreSQL customer overview route)
- `frontend` dashboard regression tests (request concurrency and stale-response handling)
- [`DASHBOARD_PERFORMANCE_FINAL_REPORT.md`](./DASHBOARD_PERFORMANCE_FINAL_REPORT.md)
