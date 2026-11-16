# Database Migration Report

## Status: Partial; production execution not authorized

Production database access and migrations were not performed. The isolated Neon `eventhub` ledger was queried read-only and does not record migrations 011 or 013.

### Migrations 011 and 013

- Migration 011 now snapshots each affected category's original `service_menu_order`, `service_menu_name`, and `is_active` before remapping or clearing those fields. The snapshot table is `service_category_navigation_backup`.
- The manual SQL in [011_restore_service_category_navigation.sql](./backend/postgres/rollback/011_restore_service_category_navigation.sql) restores those saved fields. It intentionally does not delete seeded categories or alter foreign-key relationships.
- The focused Neon test applied 011 twice, then 013, against temporary tables in a transaction and rolled it back. It checked the curated category result and restored a custom mapping from the snapshot. No permanent test-database records or migration ledger entries were changed.
- A database that already ran the original 011 will not rerun an edited migration with the same name. The new snapshot cannot recover data already cleared by an earlier execution; an external backup or authoritative source is required.
- Permanent execution remains pending a target-specific preflight, backup review, and explicit authorization. Do not use the test-database ledger as evidence of production migration state.

See [POSTGRESQL_MIGRATION_RECONCILIATION_REPORT.md](./POSTGRESQL_MIGRATION_RECONCILIATION_REPORT.md) for prior schema and migration evidence.
