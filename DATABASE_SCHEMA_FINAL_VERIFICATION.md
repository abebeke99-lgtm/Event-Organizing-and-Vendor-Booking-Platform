# Database Schema Final Verification

## Scope and result

This evidence is for the isolated Neon test database only. The last successful read-only check reported PostgreSQL 18, working pooled and direct connections with SSL, and a successful `SELECT 1`. It found 53/53 expected application tables, 58 public tables, 87 foreign keys, and 169 indexes.

The original `DB_CONNECT_FAILED` report was a misleading classification: the database connections worked, but the schema was incomplete because `password_reset_otps` and `password_reset_sessions` were missing. The checker was corrected to report `DB_SCHEMA_INCOMPLETE`; migration 017 was subsequently applied to the isolated test database, and the 53/53 schema check passed. In the current pass, migration 016 was separately reviewed, dry-run, and applied to the isolated database only. A separate later Neon check had a transient connection failure followed by a successful retry; its provider-side cause was not established.

Migrations 016 and 017 are recorded in the isolated database. The latest read-only check did not run a migration, reset, truncate, or seed operation. Migrations 011 and 013 remain unapplied; the 011 rollback-only preview showed a custom category mapping would be cleared. Production schema and data were not accessed.

## Limits

- Object counts establish presence, not correctness of every column type, default, constraint, relationship, or data value.
- The applied migration history has numbering gaps; these counts do not certify every migration.
- The current query inventory has 566 `NEEDS_FIX` and 654 `UNVERIFIED` application call sites; 17 are certified and 18 infrastructure calls are exempt.
- The production Neon database was not checked.

Repeat the isolated read-only check before future integration batches. Production migration or schema work requires separate authorization.
