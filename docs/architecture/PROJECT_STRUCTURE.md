# EventHub Project Structure

This document describes the repository as it exists after the reorganization and verification pass.

```text
Event-Organizing-and-Vendor-Booking-Platform/
├── frontend/
│   ├── public/
│   │   ├── assets/logo.svg
│   │   ├── im1/
│   │   ├── _redirects
│   │   ├── eventhub-header-mockup.html
│   │   ├── eventhub-logo.png
│   │   ├── eventhub-symbol.png
│   │   └── images*.jfif
│   ├── src/
│   │   ├── api/
│   │   │   ├── apiUrl.js
│   │   │   └── axios.js
│   │   ├── assets/auth-bg.jpg
│   │   ├── components/
│   │   │   ├── common/
│   │   │   ├── AuthCard.jsx
│   │   │   ├── AuthLayout.jsx
│   │   │   ├── Logo.js
│   │   │   └── SplashScreen.jsx
│   │   ├── dashboards/
│   │   │   ├── admin/index.jsx
│   │   │   ├── organizer/index.jsx
│   │   │   ├── vendor/index.jsx
│   │   │   └── customer/index.jsx
│   │   ├── i18n/
│   │   │   ├── jsx-dev-runtime.js
│   │   │   ├── jsx-runtime.js
│   │   │   └── modules/
│   │   ├── pages/
│   │   │   └── index.jsx
│   │   ├── utils/
│   │   │   ├── demoAuth.js
│   │   │   └── demoProfileStorage.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── public navigation, marketplace, event, dashboard, and auth modules
│   │   └── CSS and localization modules
│   ├── test/
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── src/
│   │   ├── lib/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── app.js
│   │   ├── db.js
│   │   ├── postgresDb.js
│   │   ├── postgresPool.js
│   │   └── server.js
│   ├── postgres/
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.sql through 022_add_user_indexes.sql
│   │   └── rollback/
│   │       └── 011_restore_service_category_navigation.sql
│   ├── scripts/
│   ├── test/
│   │   └── helpers/
│   ├── package-lock.json
│   ├── .env.example
│   └── package.json
├── docs/
│   ├── api/API_STRUCTURE.md
│   ├── architecture/PROJECT_STRUCTURE.md
│   ├── database/DATABASE_STRUCTURE.md
│   ├── deployment/DEPLOYMENT.md
│   └── reports/
│       ├── cleanup/
│       ├── database/
│       ├── deployment/
│       ├── integration/
│       ├── postgresql/
│       ├── security/
│       └── testing/
├── scripts/
│   ├── check-deploy.ps1
│   └── request-neon-test-branch.ps1
├── .github/
│   └── workflows/
│       ├── frontend-test.yml
│       ├── backend-test.yml
│       └── deployment.yml
├── .vscode/
├── render.yaml
├── netlify.toml
├── package.json
├── package-lock.json
├── README.md
└── .env.example
```

## Verification findings

- Root-level documentation is limited to the project README; API, database, architecture, deployment, and verification documents live under `docs/`.
- The root npm workspace lockfile and the backend package lockfile are both retained; the frontend uses the root workspace lockfile.
- The repository does not use empty `frontend/src/services`, `hooks`, `context`, `store`, `routes`, `constants`, `locales`, or `types` directories. Existing implementations are present in `App.jsx`, `src/api`, `src/utils`, `src/i18n`, and colocated feature modules.
- The backend does not use separate `controllers`, `models`, or `repositories` directories. The implemented Express architecture uses `src/routes`, `src/lib`, `src/middleware`, `src/services`, and PostgreSQL adapters.
- Empty `backend/postgres/schema`, `seeds`, `queries`, `indexes`, `functions`, and `scripts` directories were not created because no implementation files exist for them.
- The frontend public folder is flat plus `assets/` and `im1/`; no unused empty image/icon/logo directories were created.
- Four role dashboard barrels are implemented in `src/dashboards/{admin,organizer,vendor,customer}`.
- There are 22 PostgreSQL migrations and one targeted rollback script.
- Useful historical reports are categorized under `docs/reports/{database,postgresql,deployment,security,testing,integration}/`.
- Generated raw output logs and production build output are not kept in source directories.
- Backend tests are intentionally organized in a flat `backend/test/` suite with integration coverage by filename.

See [API_STRUCTURE.md](../api/API_STRUCTURE.md), [DATABASE_STRUCTURE.md](../database/DATABASE_STRUCTURE.md), and the [cleanup report](../reports/cleanup/PROJECT_STRUCTURE_CLEANUP_REPORT.md) for additional detail.
