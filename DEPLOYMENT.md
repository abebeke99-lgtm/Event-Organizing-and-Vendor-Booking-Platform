# Production deployment

## 1. Provision MySQL

Create a managed MySQL database with a database and application user. Configure the provider's network access so Render can connect, and enable TLS. Render cannot reach a MySQL instance running only on your XAMPP machine.

Use the provider's MySQL URL as `DATABASE_URL`, or record the separate host, port, database name, user, and password. A custom CA is optional: if `DB_SSL=true` and no CA is supplied, Node verifies the server with the system CA store. If your provider gives you a CA, set `DB_SSL_CA` to its PEM contents (escaped `\n` is accepted) or set `DB_SSL_CA_BASE64`.

## 2. Initialize the database and seed accounts

Create a private `backend/.env` from `backend/.env.example` and fill in the cloud database connection settings. Do not commit `.env` or paste credentials into source control. From the repository root, run:

```powershell
npm run db:init
```

This runs the existing idempotent migrations, applies `backend/schema.sql`, and applies `backend/seed.sql` to the already-created database; it does not try to create a database on the provider.

Set four unique passwords in the current PowerShell session, then create the four demo accounts:

```powershell
$secure = Read-Host 'Admin demo password' -AsSecureString
$env:SEED_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$secure = Read-Host 'Organizer demo password' -AsSecureString
$env:SEED_ORGANIZER_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$secure = Read-Host 'Vendor demo password' -AsSecureString
$env:SEED_VENDOR_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$secure = Read-Host 'Customer demo password' -AsSecureString
$env:SEED_CUSTOMER_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
npm run seed:users
```

Each password must be 12-72 UTF-8 bytes. The seed script stores bcrypt hashes and does not print passwords. The demo emails are `admin@eventflow.test`, `organizer@eventflow.test`, `vendor@eventflow.test`, and `customer@eventflow.test`.

## 3. Configure and deploy the Render backend

Set these Render environment variables:

- `NODE_ENV=production`
- `PORT` (normally supplied by Render)
- Either `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`
- `DB_SSL=true`; optionally set `DB_SSL_CA` or `DB_SSL_CA_BASE64`
- `WEB_ORIGIN=https://infobekele.netlify.app` (comma-separate additional exact origins if needed)
- `COOKIE_SECURE=true`
- `COOKIE_SAME_SITE=none`
- `OPENAI_API_KEY` if the AI chat should be enabled

The backend listens on Render's `PORT` and `0.0.0.0`. Database outages do not prevent the HTTP server from starting; `/api/health` reports the connection state. Deploy the `main` branch after setting the variables.

## 4. Configure and deploy Netlify

Set the Netlify environment variables:

- `VITE_API_URL=https://event-organizing-and-vendor-booking.onrender.com/api`
- `VITE_DEMO_AUTH=false`

Redeploy the frontend after changing these values so Vite includes the API URL in the build. `frontend/public/_redirects` provides the React Router fallback for refreshed routes.

## 5. Verify the deployment

```powershell
curl.exe -i https://event-organizing-and-vendor-booking.onrender.com/api/health
curl.exe -i https://event-organizing-and-vendor-booking.onrender.com/api/ai/health
```

The first endpoint returns `{ "ok": true, "db": true }` when MySQL is reachable. The AI endpoint reports its own readiness and requires the provider key. Then verify in a browser:

- Sign in as each of the four seeded roles.
- Confirm login and `/api/platform/me` or `/api/auth/me` work from the Netlify origin.
- Confirm no CORS or unexpected 401 errors appear in the browser console.
- Confirm the AI widget reports Online when its provider key is configured.

The application uses database-backed random session tokens; it does not currently consume a JWT or session-signing secret. `SESSION_SECRET` in the example file is reserved for a future integration and is not required by this release.
