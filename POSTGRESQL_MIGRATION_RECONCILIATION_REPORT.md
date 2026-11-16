# PostgreSQL Migration Reconciliation Report

## Status

**PARTIAL.** This report concerns only the isolated Neon test database `eventhub` on PostgreSQL 18.7. Production schema, migration ledger, and data were not accessed.

## Migration 011: service navigation categories

- The migration record was absent before the review; migration 002 (which adds the required `service_menu_order` and `service_menu_name` columns) and migration 012 were already recorded.
- A rollback-only execution of the complete migration SQL against the isolated test data increased `service_categories` from 16 to 29 rows.
- The preview inserted 13 canonical categories and updated existing `Catering` and `Photography` mappings.
- It also cleared the existing custom service-menu values on one unmatched custom category. That behavior is explicit in the migration's `UPDATE ... SET service_menu_order = NULL, service_menu_name = NULL`.
- The dry-run transaction was rolled back and a before/after comparison confirmed the 16-row category snapshot was unchanged.

**Decision:** Do not apply 011 to this shared test database or production yet. The custom mapping must be backed up and its desired post-migration behavior decided first. The SQL is repeatable but is not data-reversible on its own.

## Migration 013: public service category seed

- The migration record was absent.
- A rollback-only run of 011 followed by 013 produced the same 29-row category state as 011 alone in this test snapshot; 013 added no further rows or changes here.
- The transaction was rolled back; no category data or ledger entries were changed by the preview.
- The migration is data-changing even though it uses `ON CONFLICT`; it inserts missing public categories and updates selected menu mappings.

**Decision:** Keep unapplied until 011's custom mapping effect is resolved and the combined ordered result is approved on a disposable clone. 013 depends on the category columns introduced in 002; migration 012 is already present and does not replace either seed migration.

## Migration 016: OAuth registration roles

- Before the review, the migration record and `oauth_login_states.registration_role` column were both absent.
- `015_microsoft_admin_oauth.sql` allowed `google`, `facebook`, `apple`, and `microsoft`; the active OAuth routes support only Google and Microsoft and read/write `registration_role`.
- The complete migration SQL first succeeded in a rollback-only transaction.
- It was then applied with `runPostgresMigrations` using an allowlist containing only `016_public_oauth_registration_roles.sql`, after verifying the isolated target was Neon PostgreSQL 18.7 `eventhub`.
- Post-apply verification found the new nullable column, the three expected provider/role constraints, and the migration ledger record. The constraints are `NOT VALID`, as specified by the migration. No rows were deleted or updated.
- The isolated-Neon OAuth start/callback integration passed after application. It inserts and consumes a real OAuth state row and verifies the registration column is readable.

**Decision:** Reconciled on the isolated test database only. No production migration was run.

## Current isolated test ledger

Recorded migrations now include 001–010, 012, 014–017. Records 011 and 013 remain absent. The test database still has all 53 expected application tables, 58 public tables, 87 foreign keys, and 169 indexes. Those aggregate counts do not prove full schema parity.

The guarded setup script `backend/scripts/migrate-neon-test.js` currently allowlists only migrations 001–010. It therefore does not reproduce this later schema from a clean test database. The allowlist was not expanded: 011/013 need data reconciliation, and a complete non-contiguous migration order must be validated before changing test setup.

## Safe reconciliation plan for 011 and 013

1. In an authorized production review, capture a consistent backup of `service_categories` including IDs, names, active state, menu order/name, and dependent references. Do not edit `schema_migrations` directly.
2. On a disposable clone, run a read-only preflight that identifies every category each migration will insert, update, or clear; explicitly review custom menu mappings.
3. If preserving custom mappings is required, design and test a reversible preservation/restore migration before applying the historical seed migrations. Do not silently change the historical migration file.
4. Apply migrations 011 and 013 in sequence through the transactional PostgreSQL migration runner only after the preview matches the approved result. Verify category/menu counts, relationships, and application reads afterward.
5. Apply to production only with separate explicit authorization; let the migration runner record successful execution. Never fabricate ledger rows.

