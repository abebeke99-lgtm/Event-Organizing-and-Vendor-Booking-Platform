# PostgreSQL Query Verification Matrix

## Current inventory totals

The regenerated inventory scans 102 backend source JavaScript files and records 1,255 query/execute call sites:

| Classification | Call sites |
|---|---:|
| CERTIFIED by a current isolated-Neon test | 17 |
| NEEDS_FIX: MySQL syntax or `?` compatibility binding detected | 566 |
| UNVERIFIED: insufficient current evidence | 654 |
| EXEMPT: PostgreSQL infrastructure, not an application query | 18 |

The complete matrix is [`docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv`](./POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv). Each row records source path/line, function, SQL operation, parameter-binding method, transaction and pagination context, joins, PostgreSQL compatibility, error handling, test evidence, and certification status. Static guesses are explicitly marked unverified; candidate tests are not evidence.

## Current isolated-Neon evidence

The shared-avatar PostgreSQL integration passed against the isolated Neon test database. It covers the shared `/api/users/me/avatar` route's parameterized upload, authenticated read, deletion, missing-photo response, unauthorized request, and isolation from another account. The inventory certifies those three query call sites plus ten public/admin contact query sites directly exercised by the isolated-Neon contact integrations. Two aggregate dashboard query call sites are also certified from the isolated-Neon booking/dashboard integration, which exercises the customer and organizer overview endpoints with persisted test records. The administrator contact workflow covers filtered/paginated reads, status/reply and read-state updates, archival/deletion audit writes, and transactional behavior. The latest administrator integration also exercises combined search, status, role, and date filters for both count and paginated user-list queries; those two call sites are newly `CERTIFIED`. The PostgreSQL adapter no longer rewrites `?` characters, and its regression test confirms the JSON existence operator `?` is preserved alongside `$1` binding. The platform/admin photo route remains separate.

The Neon core CRUD/relationship and populated-marketplace integration tests were rerun and passed. These broad integrations do not certify every marketplace call site; only the 15 explicit call sites currently listed as `CERTIFIED` have call-site-specific evidence. A stale fixed schema-count assertion was removed; expected table presence is still checked against the application table list.

## Status definitions and caveats

- `CERTIFIED` means this pass ran a call-site-specific isolated-Neon integration test.
- `NEEDS_FIX` means incompatible MySQL syntax or the question-mark compatibility binding path was found; reachability still needs review.
- `UNVERIFIED` means evidence is insufficient. PostgreSQL-looking syntax alone is not certification.
- `EXEMPT` is reserved for adapter, connection, migration, and schema infrastructure rather than application queries.
- Static analysis does not prove complete SQL semantics, dynamic SQL, transaction behavior, runtime reachability, or all authorization paths. The matrix conservatively marks those aspects for review.

## Remaining work

Inspect and resolve the 566 `NEEDS_FIX` rows, establish reachability for shared and legacy route branches, then run isolated-Neon tests to certify each application call site. The latest inventory update changed two rows from `UNVERIFIED` to `CERTIFIED`; no `NEEDS_FIX` row was resolved in this batch. Do not count skipped tests, unit-only tests, or historical run output as current evidence.
