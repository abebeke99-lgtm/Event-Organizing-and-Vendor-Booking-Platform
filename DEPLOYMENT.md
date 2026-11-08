# Production deployment

The production stack is a Render Node/Express API, the existing Netlify React/Vite site, and the already initialized managed MySQL database. The API cannot connect to MySQL running only on an XAMPP machine. Do not run `db:init`, migrations, seeds, or other data-changing commands as part of deployment.

## 1. Deploy the Render API

In Render, create or update a Blueprint from this repository's `main` branch. `render.yaml` pins the service to this repository, uses the repository root, installs the npm workspaces with `npm ci`, starts the backend with `npm run start`, and uses `/api/health` as its health-check path. Confirm the service URL assigned by Render; the Blueprint's service name is `event-organizing-and-vendor-booking`.

Set these **required** Render environment variables:

- `NODE_ENV=production`
- `WEB_ORIGIN=https://infobekele.netlify.app` (comma-separate additional exact HTTPS frontend origins if needed; do not use `*`)
- `COOKIE_SECURE=true`
- `COOKIE_SAME_SITE=none`
- `DB_SSL=true`
- One database credential option:
  - `DATABASE_URL`: the managed MySQL connection URL; or
  - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`

Render supplies `PORT`; Express listens on that port and `0.0.0.0`. Put all database credentials in Render's environment settings, not in Git or chat.

These settings are **optional**:

- `DB_SSL_CA` or `DB_SSL_CA_BASE64`: provider CA certificate when it is not trusted by Node's system CA store. Certificate verification remains enabled.
- `FRONTEND_URL`: public frontend URL used in email links. Set to `https://infobekele.netlify.app`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`: configure only when password-reset email is required. Keep credentials private.
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_CHAT_MODELS`: configure only when enabling the AI assistant. `OPENAI_API_KEY` is a backend secret.
- `PAYMENT_PROVIDER_ADAPTER`: optional server-side payment adapter module; do not set it unless a real provider adapter is configured.
- `PLATFORM_STATUS` and `MAINTENANCE_MODE`: optional platform status overrides; leave unset for the normal open state.

Do not configure `SESSION_SECRET`: database-backed random session tokens are used; the variable is reserved for a future integration. Do not configure `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_NAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `SEED_ADMIN_PASSWORD`, `SEED_ORGANIZER_PASSWORD`, `SEED_VENDOR_PASSWORD`, or `SEED_CUSTOMER_PASSWORD` for a normal deployment. Do not create demo or fake administrator accounts. No database initialization, migration, seed, reset, or schema operation is needed for the already initialized production database.

`RENDER_GIT_COMMIT` is supplied by Render. `GIT_COMMIT` is an optional fallback for other hosts. `API_PORT` and `VITE_API_PROXY_TARGET` are local Vite development settings, while `TEST_USER_EMAIL`, `TEST_USER_NAME`, `TEST_USER_ROLE`, and `TEST_USER_PASSWORD` are local-only test-user inputs; do not set these on production services.

## 2. Configure and deploy the Netlify frontend

Use the repository root as the base directory, `npm ci && npm run build` as the build command, and `frontend/dist` as the publish directory. The SPA fallback is `frontend/public/_redirects`.

Set these **required** Netlify build environment variables:

- `VITE_API_URL`: the actual Render service HTTPS URL ending in `/api`, for example `https://<your-render-service>.onrender.com/api`. Replace the example with the URL shown in the Render dashboard. The frontend accepts either the API origin or an origin ending in `/api` and appends exactly one `/api`.
- `VITE_DEMO_AUTH=false`: production uses real API authentication; demo authentication is development-only.

The checked-in `netlify.toml` uses the Blueprint's expected Render hostname. If Render assigns a different service URL, update `VITE_API_URL` in Netlify and rebuild/redeploy the site; a Vite build embeds this public URL.

These **optional** public build-time variables only affect contact/profile links:

- `VITE_TELEGRAM_URL`
- `VITE_YOUTUBE_URL`
- `VITE_FACEBOOK_URL`
- `VITE_LINKEDIN_URL`
- `VITE_CONTACT_PHONE`

Do not put database credentials, API keys, passwords, or other secrets in any `VITE_*` setting.

## 3. Verify the deployment

The health endpoint responds with HTTP 200 and `{ "ok": true, "db": true }` when the API can query MySQL. If it responds with `db: false`, its `reason` field is a safe diagnostic code and the Render logs contain sanitized connection details. A successful HTTP status by itself does not prove the database is connected.

Run the read-only local deployment checks from PowerShell after the Render URL and Netlify site are updated. Pass `-RenderUrl` and `-NetlifyUrl` if either host differs from the defaults:

```powershell
npm run db:check
.\scripts\check-deploy.ps1
# .\scripts\check-deploy.ps1 -RenderUrl "https://your-service.onrender.com" -NetlifyUrl "https://your-site.netlify.app"
```

`npm run db:check` performs only `SELECT 1` and `SELECT DATABASE()`; it does not change data. The deployment script checks the Render service routes, database health, frontend CORS, Netlify routes, and deployed Render commit. Also verify browser login/registration against real accounts without creating test or fake users.

`GET /api/health` confirms API/database connectivity; `GET /api/version` reports the deployed commit. Password-reset email requires the optional SMTP settings. AI endpoints require the optional OpenAI key. Payment processing requires a real provider adapter; ordinary payment records are not a payment gateway integration.
