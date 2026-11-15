# PostgreSQL Query Verification Matrix

## Inventory totals

The generated call-site inventory scans backend source JavaScript and records 1,247 query/execute call sites in 102 source files:

| Classification | Call sites |
|---|---:|
| PostgreSQL infrastructure (not application certification) | 18 |
| Application call sites with isolated-Neon test evidence | 45 |
| Application call sites not certified | 1,184 |

The complete per-call-site matrix, including source coordinates, static syntax markers, linked tests, and remaining issue, is `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`. The inventory is a verification tracker, not proof that all call sites were inspected semantically. The latest full backend run was 536 passed, 0 failed, and 26 skipped; a separate isolated-Neon booking/dashboard integration passed.

## Newly verified marketplace path

The isolated-Neon marketplace integration exercises the vendor-list query and its related category resolution and page-only service, package, media, and availability hydration. The inventory records those seven call sites as verified by `backend/test/vendorPublicApi.test.js`. The clean rerun passed all 18 tests.

`backend/test/postgresMarketplace.test.js` also checks generated parameterized SQL, category/search/location/price/availability filters, stable ordering, database `LIMIT`/`OFFSET`, and pagination response metadata. Unit coverage does not itself certify the production SQL; the Neon integration provides that execution evidence.

## Classification caveats

- “Verified” applies only to the behavior exercised by its linked isolated-Neon test. It does not certify every possible input, transaction path, result shape, or neighboring query.
- “Not certified” means the SQL and runtime behavior have not been established by call-site-specific isolated-Neon evidence. It must not be interpreted as a known failure or as a PostgreSQL-compatible query.
- Some backend call sites are in shared, conditional, or legacy route code. Reachability is not a substitute for conversion or test evidence.
- The static scanner detects selected MySQL-specific syntax but cannot prove SQL correctness, parameter type inference, runtime branch coverage, or the absence of dynamically assembled queries.
- MySQL markers including `GROUP_CONCAT`, `DATE_ADD`, and `ON DUPLICATE KEY UPDATE` remain in unconverted or uncertified code paths.

## Next certification work

Prioritize active authentication/authorization, user/role/permission, event, vendor/service, booking, payment/refund, and admin workflows. For each query, record the exact Neon integration test and input/output conditions. Do not mark skipped or unit-only tests as live Neon verification.
