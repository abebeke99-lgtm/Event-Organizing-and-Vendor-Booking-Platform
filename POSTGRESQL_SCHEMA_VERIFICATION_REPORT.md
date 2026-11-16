# PostgreSQL Schema Verification Report

## Result

**Isolated Neon test database verified; production schema not inspected.** Migration 016 was reviewed, dry-run in a transaction and rolled back, then applied through the PostgreSQL migration runner to the isolated test database only. The latest schema check itself was read-only.

| Check | Current result |
|---|---|
| Pooled runtime connection | Passed; PostgreSQL 18.7 |
| Direct migration connection | Passed; PostgreSQL 18.7 |
| Expected application tables | 53/53 present |
| Public tables | 58 |
| Foreign keys | 87 |
| Indexes | 169 |
| Applied migration records | 001-010, 012, 014-017 |
| Migration files without applied records | 011, 013 |

The check was run with `node backend/scripts/check-neon-test-db.js`. Both pooled runtime and direct migration connection checks passed on PostgreSQL 18.7. The check uses the isolated test configuration and reports no connection URLs or credentials.

## Limits

- Production schema and data were not accessed.
- This verifies object presence and database identity, not every column definition, constraint action, data-quality condition, or application query.
- Migration numbering gaps remain; this report does not imply every migration file has been applied.
- Migrations 011 and 013 remain unapplied because a rollback-only preview showed that 011 clears custom menu mappings on one existing category. See [POSTGRESQL_MIGRATION_RECONCILIATION_REPORT.md](./POSTGRESQL_MIGRATION_RECONCILIATION_REPORT.md) for the recorded preview and safe reconciliation plan.
- Migration 016 is recorded in the isolated test database. This does not establish that it is applied in production.
- The checker verifies expected table presence and aggregate foreign-key/index counts; it does not compare every column, constraint definition, index definition, or migration checksum.
- The test database's currently recorded schema is not proof of production parity.

## Next checks

Keep schema checks read-only by default. Run additive migrations only in the isolated test database first, verify constraints and rollback behavior, then obtain separate authorization for any production change.
