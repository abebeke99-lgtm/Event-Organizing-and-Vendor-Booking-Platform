# MySQL and XAMPP Removal Status

## Result

**Runtime driver removal is complete; repository-wide PostgreSQL compatibility is not.** MySQL driver dependencies and retired MySQL database artifacts were removed in earlier work. This audit found no `mysql`, `mysql2`, or `mariadb` references in the root/backend package manifests or lockfiles searched. The source still contains MySQL-specific branches and SQL, so a repository-wide “removed” claim would be inaccurate.

## Remaining source references

A targeted scan of `backend/src` found 73 matches in 21 files for MySQL-specific SQL or dialect markers. Examples include `GROUP_CONCAT`, `DATE_ADD`, `DATE_FORMAT`, `CURDATE`, `ON DUPLICATE KEY UPDATE`, `LAST_INSERT_ID`, and `?` placeholders. They occur in legacy/shared modules, including middleware and older route/database modules. Their complete reachability has not been established. Do not treat this report as proof that all active paths are PostgreSQL-compatible.

The PostgreSQL-specific route modules are used by the PostgreSQL app path. One unsafe shared-path fallback in admin authorization was removed and covered by `backend/test/postgresAdminMiddleware.test.js`.

## Final status checklist

| Requirement | Status |
|---|---|
| XAMPP/phpMyAdmin/3306 references in searched runtime source and deployment/environment config | None found |
| MySQL/MariaDB driver dependencies in searched manifests and lockfiles | None found |
| MySQL SQL/dialect references in backend source | Remaining; 73 matches across 21 files |
| Neon PostgreSQL runtime connection | Verified previously on isolated test DB; production remains unverified |
| Frontend build/tests; backend tests | Passed |
| Netlify/Render deployment and GitHub synchronization | Pending; not accessed |

## Checks

| Check | Result |
|---|---|
| MySQL driver dependencies in root/backend manifests and lockfiles | No matches found |
| Legacy MySQL SQL in backend source | Remaining; see `docs/POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv` |
| Isolated Neon connection/schema | Previously verified; production not inspected |
| Backend tests | 536 passed, 0 failed, 26 skipped |
| Frontend tests/build | 214 passed; production build passed |
| Database reset or production migration | None |
| Production deployment or GitHub push | None |

Old migration/schema/seed artifacts and XAMPP-oriented database scripts were retired earlier. Historical migration documentation may still mention MySQL/XAMPP as context. The separate `personalportofolio/` directory was not changed.

## Required follow-up

Classify every remaining SQL path as active PostgreSQL, converted-but-uncertified, or unreachable and remove obsolete branches only after proving they are not used. Do not perform production schema changes or data migrations without explicit authorization.
