# PostgreSQL Marketplace Pagination

## Change

`GET /api/platform/vendors` no longer loads every public vendor and all related marketplace records before slicing a page. PostgreSQL now performs the public eligibility check, filter application, count, stable sorting, page clamp, and `LIMIT`/`OFFSET`. Only the page's vendor services, packages, service availability, and vendor media are hydrated afterward.

The endpoint retains its existing `data` and `pagination` response shape and supports its search, category, location, featured, rating, price, availability/date, sort, page, and limit filters. Values use PostgreSQL parameters; sort clauses are selected from a fixed allowlist. Publicly eligible vendors remain verified and attached to active users.

## Verification

- Unit API tests assert database-level filtering/pagination SQL, bind values, response metadata, invalid-filter handling, and empty results.
- Isolated Neon marketplace integration passed all 18 tests on a clean rerun, including vendor search, category slug, featured/popular sorting, availability, service/package hydration, and media workflows.
- The first integration attempt had four category-related failures; a subsequent run with no code change passed all 18. Treat the first result as transient/non-deterministic and investigate if reproduced.
- One traced first-page request took 3.52 seconds; a warm availability-filtered request took 1.36 seconds on the small test dataset. See [DASHBOARD_PERFORMANCE_REPORT.md](../testing/DASHBOARD_PERFORMANCE_REPORT.md).

## Limits

This is not a production-scale load test. The query computes filtered totals and ranking values over all matching candidates before returning a page; verify execution plans and timing with representative data before claiming large-catalog scalability. `/api/platform/services` and vendor detail still use the full marketplace loader and are outside this pagination change.
