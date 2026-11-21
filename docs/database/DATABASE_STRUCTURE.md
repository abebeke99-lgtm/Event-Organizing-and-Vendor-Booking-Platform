# EventHub Database Structure

## Runtime database

EventHub uses Neon PostgreSQL. Runtime PostgreSQL selection is controlled by `DB_DIALECT=postgres`, pooled `DATABASE_URL`, and direct `DIRECT_URL` settings. Existing production records and migrations are preserved.

## Database locations

- `backend/src/postgresDb.js`: PostgreSQL database implementation.
- `backend/src/postgresPool.js`: pooled database connection.
- `backend/src/lib/postgresSchema.js`: schema helpers.
- `backend/src/lib/postgresMigrate.js`: migration runner.
- `backend/postgres/migrations/`: 22 ordered SQL migrations.
- `backend/postgres/rollback/`: targeted rollback SQL.
- `backend/scripts/migrate.js`: production migration command.
- `backend/scripts/check-db.js`: read-only database health check.

## Domain coverage

The migrations cover authentication, roles and permissions, users, vendors, services, categories, events, bookings, quotations, payments, refunds, reviews, complaints, notifications, audit logs, social auth, password reset, dashboard indexes, and social/profile fields.

## Safety

No migration or seed file was deleted. No database mutation or record deletion was performed during reorganization. Database connectivity remains governed by existing Neon environment configuration and must be validated with `npm run db:check`.

Final cleanup verification: 22 migrations, 1 rollback script, and 59 application tables were confirmed. No database object or record was removed.
