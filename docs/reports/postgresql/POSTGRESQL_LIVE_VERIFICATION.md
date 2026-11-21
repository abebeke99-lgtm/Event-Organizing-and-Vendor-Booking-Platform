# PostgreSQL Live Verification

## Read-only live check

Command: `npm --workspace backend run db:check`

Result:

- Neon PostgreSQL runtime connection: PASS.
- `SELECT 1`: PASS.
- Application schema: PASS.
- Current schema table count: 59.

No production records were modified.

## SSL and pooling configuration

The repository PostgreSQL configuration requires:

- A Neon pooled `DATABASE_URL` for runtime.
- A matching Neon direct `DIRECT_URL` for migrations.
- Neon `.neon.tech` hostnames.
- `sslmode=require` or `sslmode=verify-full`.
- Certificate verification in production.
- A runtime pool configured with application name `eventhub-api` and bounded connection limits.

## Not independently verified

This workspace check confirmed runtime connectivity and table count but did not expose or modify credentials. The following live metadata require additional read-only administrative access:

- Migration history contents.
- Foreign-key relationship inventory.
- Index inventory.
- Database role and grant inventory.
- Pool utilization and Neon connection metrics.
- Row-level persistence checks.

No reset, drop, truncate, recreate, migration, or data mutation was performed.
