# MySQL Removal Report

> **Status notice (2026-11-19):** Historical report. PostgreSQL is the configured runtime, but 566 NEEDS_FIX and 654 UNVERIFIED query inventory rows remain. Full PostgreSQL-only application compatibility is not declared.

## Result

**PARTIAL.** PostgreSQL is the only configured database runtime, and no MySQL, MariaDB, or SQLite driver dependency/import was found in the root/backend/frontend manifests, root lockfile, or backend source imports. However, the application query inventory still contains question-mark compatibility bindings and MySQL SQL markers. Do not claim complete MySQL-dialect removal.

## Current evidence

| Check | Result |
|---|---|
| Runtime dialect configuration | Defaults to PostgreSQL and rejects other dialect values in `backend/src/lib/startupConfig.js` |
| Runtime driver | `pg` is instantiated by `backend/src/postgresDb.js` |
| MySQL/MariaDB/SQLite dependency or import scan | No matches in selected manifests, root lockfile, or `backend/src` imports |
| Backend JavaScript source files scanned | 102 |
| Selected SQL-marker scan | 73 matches across 21 source files |
| Query inventory rows marked `NEEDS_FIX` | 566; static markers still require runtime reachability review |
| Other inventory statuses | 17 `CERTIFIED`, 654 `UNVERIFIED`, 18 `EXEMPT` |
| Live Neon verification | Shared avatar and public/admin contact routes passed; this does not certify the other query paths |

The current source-text scan checks `ON DUPLICATE KEY UPDATE`, `VALUES(column)`, `GROUP_CONCAT`, `DATE_FORMAT`, `DATE_ADD`, `DATE_SUB`, `CURDATE()`, `LAST_INSERT_ID`, `IFNULL()`, and interval expressions. It returns 73 matches across 21 files; some are PostgreSQL-valid interval expressions, startup rejection code, or inactive compatibility branches, so this is a triage count, not a count of active MySQL execution paths. The regenerated per-query inventory records source path, line, operation, binding, transaction/pagination/join context, error handling, candidate tests, and evidence status.

## Runtime and compatibility findings

- `backend/src/lib/startupConfig.js` rejects `DB_DIALECT=mysql` and non-PostgreSQL values.
- `backend/src/lib/postgresAdapter.js` no longer rewrites SQL; it passes PostgreSQL text and `$n` parameters through to node-postgres unchanged.
- `backend/src/db.js` still contains legacy adapter fallback and `$n`-to-`?` placeholder rewriting for legacy execute adapters; those branches have not been proven unreachable in every call path.
- Shared routes and conditional legacy route modules remain to be classified by runtime reachability. Compatibility code was not removed globally because every caller has not been proven independent of it.
- The shared avatar route has been converted to PostgreSQL `$n` bindings and is covered by current Neon integration.
- PostgreSQL public/admin contact workflows now use a dedicated query-based administrator router; the isolated-Neon contact integration verifies persisted reads, writes, authorization, and audit transactions.

## Remaining work

Resolve each `NEEDS_FIX` inventory row. First distinguish reachable production code from inactive compatibility routes; then convert reachable SQL to PostgreSQL-native syntax and remove a compatibility branch only after its full call graph has no remaining dependency. Keep historical MySQL/XAMPP mentions only where they are clearly documentation, not executable configuration.
