# PostgreSQL Query Inventory Report

## Status: Not complete

The generated call-site inventory contains 1,255 query/execute sites across 102 backend JavaScript source files:

| Classification | Count |
|---|---:|
| `CERTIFIED` by isolated-Neon call-site evidence | 17 |
| `NEEDS_FIX` compatibility marker detected | 566 |
| `UNVERIFIED` insufficient execution evidence | 654 |
| `EXEMPT` database infrastructure | 18 |

The detailed source path, function, line, SQL classification, binding details, and evidence fields are in [POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv](./POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv).

`NEEDS_FIX` and `UNVERIFIED` rows remain unresolved. Static markers do not by themselves establish whether a call site is reachable, and PostgreSQL-looking SQL is not proof of correct semantics. No row was promoted based on this migration test: the 011/013 test exercises temporary migration fixtures, not application query call sites. Do not certify a query without a successful, relevant isolated-Neon test.

The inventory and evidence do not establish that all active API paths are PostgreSQL-compatible. A route-by-route reachability review and call-site-specific execution tests remain required.
