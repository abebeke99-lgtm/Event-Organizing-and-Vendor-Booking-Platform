# PostgreSQL Deployment Configuration Report

Updated: 2026-11-11  
Status: Production deployment is not configured or verified for PostgreSQL. No live Render, Netlify, or production Neon settings were accessed or changed.

## Current Repository Configuration

- `render.yaml` and `DEPLOYMENT.md` still document/configure MySQL. The Render blueprint has no `DB_DIALECT=postgres` or `DIRECT_URL`; it still lists `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`.
- Backend startup defaults to MySQL when `DB_DIALECT` is missing. PostgreSQL mode currently mounts a selected route set, not the complete application.
- The local backend `.env` had PostgreSQL selected and `DB_SSL=true`, but runtime `DATABASE_URL` and `DIRECT_URL` were empty. The local dev launcher uses the separate validated `.env.neon-test` file. Those isolated test credentials are not production credentials and must never be copied into Render.
- The frontend is React + Vite. Its production API URL validator requires an explicit HTTPS, non-loopback `VITE_API_URL`; the Axios client sends credentialed requests. No production Render origin or Netlify environment was verified.
- PostgreSQL pool configuration requires a Neon pooled `DATABASE_URL` at runtime and a direct `DIRECT_URL` for migration operations. TLS verification remains enabled for production.

## Required Before Production Preparation

An authorized owner must configure, through Render's secure environment settings, `DB_DIALECT=postgres`, `DATABASE_URL` for the approved Neon pooled endpoint, `DIRECT_URL` for the matching direct endpoint, and `DB_SSL=true`. Verify the URLs target the same approved production project, branch, and database without displaying the values. Set Netlify `VITE_API_URL` to the confirmed Render HTTPS API origin ending in `/api`; verify exact CORS `WEB_ORIGIN`, secure cookie settings, and deployed health only after access is authorized.

Before any production schema operation or data movement, verify the production database identity and existing data, compare its schema read-only, and establish an approved backup/recovery point. No migration or data import should be attempted until the additive migration plan, ID/unique conflicts, FK order, and explicit data scope are reviewed and approved. Do not use the isolated test database as the source for production data.

## Verification Performed

- Neon pooled and direct endpoints connected successfully only for the isolated test database.
- Test schema integrity after migration 009: 51 application table names, 82 foreign keys, and 151 indexes.
- Local PostgreSQL payment/refund routes were exercised through Express against isolated Neon.
- Frontend tests passed 172/172. The Vite production build passed with a compile-only `https://api.example.invalid/api` value; no production API URL was configured or verified.
- No production connection, production database identity, Render environment, Netlify environment, deployed API health, production CORS/cookies, production backup, or deployment commit was verified.

## Deployment Blockers

1. No authorized production Neon pooled/direct URLs or confirmed production identity were provided.
2. No production backup/recovery point or restore evidence is available.
3. Full PostgreSQL feature/query parity is incomplete; the current static inventory has 964 application calls not certified.
4. Render configuration still defaults to MySQL and is not ready to switch to PostgreSQL.
5. Full backend verification, browser role workflows, and actual deployed service verification remain outstanding.

No production credentials were invented, copied, or requested in chat. Do not change live deployment settings until the owner configures secrets securely and authorizes production read-only verification.