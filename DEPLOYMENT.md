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
- Social sign-in is optional. Configure a provider only after creating its app/service in that provider's developer console. Each callback must exactly match the HTTPS API callback registered with the provider:
  - Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` (`https://<api-host>/api/platform/oauth/google/callback`)
  - Facebook: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_CALLBACK_URL` (`https://<api-host>/api/platform/oauth/facebook/callback`), and `FACEBOOK_GRAPH_API_VERSION` (a currently supported version such as `v22.0`)
  - Apple: `APPLE_SERVICE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, and `APPLE_CALLBACK_URL` (`https://<api-host>/api/platform/oauth/apple/callback`). Store the complete private key only in Render's secret environment settings; newlines may be entered as `\n`.
  - Add callback URLs to the provider console, enable the matching sign-in product/scopes, and set the service's associated domain where the provider requires it. Configure `FRONTEND_URL` to the frontend origin. `GET /api/platform/oauth/providers` reports each provider as `configured` or `not_configured`; this validates local configuration, not a completed provider authentication. The application does not expose credentials to the browser.
  - OAuth starts at `GET /api/platform/oauth/:provider/start`. Google uses OIDC state, nonce, and PKCE; Facebook validates its access token server-side; Apple uses a form-post callback and server-side identity-token validation. Production Apple callbacks require the secure cross-site cookie settings listed above.
  - Provider identity is verified server-side. Linking requires an existing platform session; matching email alone never merges accounts. New provider signups create customer accounts only and respect `public_registration_enabled`. Administrator authentication remains separate. Users can connect a second provider before disconnecting an existing one; the last connected provider cannot be removed.
  - Instagram Login is not offered as a general consumer sign-in option: Meta's official Instagram Login API is for professional accounts, not ordinary consumer authentication.
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
- `VITE_CONTACT_PHONE`

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
