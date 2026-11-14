# Production deployment

The production stack is a Render Node/Express API, the existing Netlify React/Vite site, and Neon PostgreSQL. The backend rejects MySQL and non-Neon PostgreSQL runtime endpoints. Do not run migrations, seeds, or other data-changing commands as part of deployment unless the migration has been reviewed and the configured target is verified.

## 1. Deploy the Render API

In Render, create or update a Blueprint from this repository's `main` branch. `render.yaml` pins the service to this repository, uses the repository root, installs the npm workspaces with `npm ci`, starts the backend with `npm run start`, and uses `/api/health` as its health-check path. Confirm the service URL assigned by Render; the Blueprint's service name is `event-organizing-and-vendor-booking`.

Set these **required** Render environment variables:

- `NODE_ENV=production`
- `WEB_ORIGIN=https://infobekele.netlify.app` (comma-separate additional exact HTTPS frontend origins if needed; do not use `*`)
- `COOKIE_SECURE=true`
- `COOKIE_SAME_SITE=none`
- `DB_DIALECT=postgres`
- `DB_SSL=true`
- `DATABASE_URL`: Neon PostgreSQL pooled connection URL with TLS enabled

Render supplies `PORT`; Express listens on that port and `0.0.0.0`. Put all database credentials in Render's environment settings, not in Git or chat. `DIRECT_URL` is only needed when running reviewed PostgreSQL migrations manually; it must target the same Neon project using the direct endpoint.

In the Render Dashboard, open the service's **Environment** page. Confirm the fixed production settings above are present (they are supplied by the Blueprint). Set the pooled Neon `DATABASE_URL` secret. Add `DIRECT_URL` only if a reviewed migration will be run manually. Add `DB_SSL_CA` or `DB_SSL_CA_BASE64` only if required; certificate verification remains enabled. Save changes and deploy. Never paste credentials into chat or source files.

These settings are **optional**:

- `DB_SSL_CA` or `DB_SSL_CA_BASE64`: provider CA certificate when it is not trusted by Node's system CA store. Certificate verification remains enabled.
- `FRONTEND_URL`: public frontend URL used in email links. Set to `https://infobekele.netlify.app`.
- Google and Microsoft sign-in are optional. Configure these server-only variables after creating an OAuth/OIDC app in each provider console:
  - Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
  - Microsoft Entra ID: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_CALLBACK_URL`
  - Local callback URLs must be exactly `http://127.0.0.1:4000/api/platform/oauth/google/callback` and `http://127.0.0.1:4000/api/platform/oauth/microsoft/callback`. Register those exact URIs in Google Cloud Console and Azure Portal; `localhost` is not interchangeable with `127.0.0.1`.
  - Production callback URLs must be `https://<api-host>/api/platform/oauth/google/callback` and `https://<api-host>/api/platform/oauth/microsoft/callback`, with `<api-host>` replaced by the deployed API host. The values in the provider consoles and backend environment must match exactly.
  - Google Cloud Console: add the Google URI to the OAuth client’s authorized redirect URIs. Azure Portal: add the Microsoft URI as a **Web** platform redirect URI and use a single-tenant app matching `MICROSOFT_TENANT_ID`.
  - Both providers use OIDC state, nonce, and PKCE, and credentials remain on the backend. `GET /api/platform/oauth/providers` reports configuration status; this does not prove a complete provider flow. Provider registration uses the selected Customer, Event Organizer, or Vendor role, respects `public_registration_enabled`, and cannot assign Administrator. Existing matching accounts must confirm their password before provider linking. Password sessions last 8 hours, or 30 days when Remember me is selected.
  - Instagram is not offered as a general consumer authentication provider.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`: configure only when password-reset email is required. Keep credentials private.
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_CHAT_MODELS`: configure only when enabling the AI assistant. `OPENAI_API_KEY` is a backend secret.
- `PAYMENT_PROVIDER_ADAPTER`: optional server-side payment adapter module; do not set it unless a real provider adapter is configured.
- `PLATFORM_STATUS` and `MAINTENANCE_MODE`: optional platform status overrides; leave unset for the normal open state.

Do not configure `SESSION_SECRET`: database-backed random session tokens are used; the variable is reserved for a future integration. Do not configure bootstrap or seed passwords for a normal deployment. Do not create demo or fake administrator accounts. No database initialization, migration, seed, reset, or schema operation is needed for the already initialized production database.

`RENDER_GIT_COMMIT` is supplied by Render. `GIT_COMMIT` is an optional fallback for other hosts. `API_PORT` and `VITE_API_PROXY_TARGET` are local Vite development settings, while `TEST_USER_EMAIL`, `TEST_USER_NAME`, `TEST_USER_ROLE`, and `TEST_USER_PASSWORD` are local-only test-user inputs; do not set these on production services.

## 2. Configure and deploy the Netlify frontend

Use the repository root as the base directory, `npm ci && npm run build` as the build command, and `frontend/dist` as the publish directory. The SPA fallback is `frontend/public/_redirects`.

Set these **required** Netlify build environment variables:

- `VITE_API_URL`: the actual Render service HTTPS URL ending in `/api`, for example `https://<your-render-service>.onrender.com/api`. Replace the example with the URL shown in the Render dashboard. The frontend accepts either the API origin or an origin ending in `/api` and appends exactly one `/api`.
- `VITE_DEMO_AUTH=false`: production uses real API authentication; demo authentication is development-only.

Set `VITE_API_URL` in the Netlify Dashboard to the HTTPS URL confirmed in the Render Dashboard, ending in `/api`. No unverified Render hostname is baked into the repository. Redeploy after setting or changing it; a Vite build embeds this public URL.

These **optional** public build-time variables only affect contact/profile links:

- `VITE_TELEGRAM_URL`
- `VITE_YOUTUBE_URL`
- `VITE_FACEBOOK_URL`
- `VITE_LINKEDIN_URL`

Do not put database credentials, API keys, passwords, or other secrets in any `VITE_*` setting.

## 3. Verify the deployment

The health endpoint responds with HTTP 200 and `{ "ok": true, "db": true }` when the API can query Neon PostgreSQL. It responds with HTTP 503 and `{ "ok": false, "db": false, "reason": "..." }` when PostgreSQL is unavailable; `reason` is a safe diagnostic code and Render logs contain sanitized connection details. The Render health check must pass before the service is considered ready.

Run the read-only local deployment checks from PowerShell after confirming the service URL in the Render Dashboard. The Render URL is deliberately required rather than assuming that a hostname belongs to this project:

```powershell
.\scripts\check-deploy.ps1 -RenderUrl "https://<confirmed-render-service>.onrender.com"
# Optionally pass -NetlifyUrl "https://your-site.netlify.app" if the site origin differs.
```

`npm run db:check` performs read-only PostgreSQL identity and `SELECT 1` queries; it does not change data, but requires the real Neon environment and must only be run where those credentials are already configured. The deployment script checks the Render service routes, database health, frontend CORS, Netlify routes, and deployed Render commit. Also verify browser login/registration against real accounts without creating test or fake users.

`GET /api/health` confirms API/database connectivity; `GET /api/version` reports the deployed commit. Password-reset email requires the optional SMTP settings. AI endpoints require the optional OpenAI key. Payment processing requires a real provider adapter; ordinary payment records are not a payment gateway integration.
