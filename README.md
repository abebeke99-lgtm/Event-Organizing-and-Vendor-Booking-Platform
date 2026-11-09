# Event Organizing and Vendor Booking Platform

This project delivers a full-stack event marketplace and booking platform for organizers, vendors, customers, and administrators. It follows the documented business requirements for event planning, vendor discovery, booking workflows, payments, reviews, and administrative oversight.

## 1. Project Summary

The Event Organizing and Vendor Booking Platform is a web-based solution that connects customers and event organizers to verified vendors for wedding, corporate, social, cultural, and private-event services. The platform centralizes event planning, vendor management, booking requests, availability checks, payment handling, communication, and analytics in one system.

## 2. Key User Roles

- Administrator: oversees users, vendor verification, payments, categories, reports, and audit logs.
- Event Organizer: creates events, manages budgets, reviews vendors, and coordinates bookings.
- Vendor: publishes services, manages availability, accepts or rejects requests, and handles service delivery.
- Customer: browses services, requests bookings, monitors payments, and leaves reviews.
- Visitor: can browse public listings but must sign in to book or manage private data.

## 3. Functional Scope

### Core capabilities

- User registration and secure role-based authentication
- Public vendor and service marketplace discovery
- Event creation and management for organizers
- Vendor profile creation and verification flow
- Service catalog management and publication controls
- Search, filtering, and comparison tools
- Booking requests with approval and status transitions
- Availability validation and double-booking prevention
- Payment transaction reporting, refund review, audit history, and provider-gated processing
- Review and rating management for completed bookings
- Notifications, messages, and administrative reporting
- Audit logging and protected access controls

## 4. Booking Workflow

The platform applies the required business states from the project brief:

- pending
- accepted
- awaiting_payment
- confirmed
- in_progress
- completed
- rejected
- cancelled
- expired

The booking logic is enforced in the backend with explicit transition checks so invalid moves are rejected.

## 5. Architecture

### Frontend

- React + Vite
- Role-based dashboards and marketplace pages
- Responsive layout for desktop and mobile

### Backend

- Node.js + Express
- REST endpoints for auth, marketplace, event, vendor, booking, and admin routes
- Role-aware access patterns and validation
- `GET /` reports API liveness; `GET /api/health` checks database readiness.

### Data layer

- MySQL is the configured database, accessed through `mysql2`.
- Admin and platform authentication, public marketplace listings, and customer/vendor dashboard reads are backed by MySQL. Event creation now stores organizer-owned draft events transactionally with an audit record. Some dashboard controls and payment-provider workflows remain incomplete; payment records do not represent a real payment integration.
- Configure either `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for MySQL. Production requires `DB_SSL=true`; certificate verification remains enabled, with an optional provider CA in `DB_SSL_CA` or `DB_SSL_CA_BASE64`.

## EventHub AI Assistant

The floating EventHub AI chat is available on public pages to visitors and signed-in users. Visitor-widget history is temporary and stored in the browser's current tab session. Signed-in customers, organizers, and vendors can also open **AI Assistant** from the account menu for persistent MySQL conversations scoped to their account; administrator conversation history is not enabled. The persistent chat streams responses through Server-Sent Events, while the public widget uses a bounded JSON response.

The assistant reads published public events, active services, verified vendors, and active service categories through the existing catalogue services. It only receives public listing data and role context: it cannot read private bookings, payment details, other users' accounts, or vendor-only records. Booking/payment status explanations come from the platform's existing workflow states; there is no separate FAQ database table. The assistant is read-only and cannot submit or change bookings, quotations, payments, refunds, or accounts. Both chat paths use server-side prompt-injection safeguards and disclose no provider credentials.

The public API endpoints include `GET /api/ai/health` (a lightweight provider/model check), `GET /api/ai/status` (provider configuration state only), and `POST /api/ai/chat` (visitor or authenticated chat, accepting up to 20 messages of 2,000 characters each, limited to 20 requests per minute per IP, and using a 30-second provider timeout). The older `POST /api/ai/assist` endpoint remains available. Existing authenticated conversation/history endpoints remain under `/api/ai/conversations`.

Configure these backend environment variables to enable AI responses:

- `OPENAI_API_KEY`: secret OpenAI API key, set only in the backend environment.
- `OPENAI_MODEL`: default model identifier (defaults to `gpt-4o-mini`).
- `OPENAI_CHAT_MODELS`: comma-separated server-approved model IDs exposed in the model selector (defaults to `gpt-4o-mini`).

Set the key only in the backend environment (for local development, `backend/.env`; in production, the backend hosting provider's secret settings), then restart/redeploy the API. Without `OPENAI_API_KEY`, `GET /api/ai/health` returns `{ "online": false }`, the widget reports the service offline, and response endpoints return HTTP 503; no mock answer is returned. Model access and pricing depend on the OpenAI account. If an existing database has not applied the pre-existing additive `backend/migrations/038_ai_chat.sql` migration, review it and back up the database before running `npm run migrate`; this chatbot enhancement adds no database tables or migrations.

AI chat also blocks common requests to disclose credentials, hidden instructions, private configuration, or other users' data before calling the provider. Credential-shaped values are redacted from chat input, stored titles/messages, model context, streamed output, and rendered message text; the model receives a fixed security policy that treats conversation content as untrusted. These checks are defense in depth and pattern-based, not a substitute for keeping secrets out of user messages or for access controls.

## Deployment checklist

### Render backend

- Blueprint: the existing GitHub repository's `main` branch, repository-root directory, Node 20 (`.node-version` and `engines.node`), build command `npm ci`, start command `npm run start`, health path `/api/health`.
- Required Render variables: `NODE_ENV=production`, `WEB_ORIGIN` (exact HTTPS frontend origin), `DB_SSL=true`, `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, and either `DATABASE_URL` or all five of `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Render supplies `PORT`; Express binds to `0.0.0.0`. Set secrets only in the Render Dashboard.
- Optional Render variables: `DB_SSL_CA` or `DB_SSL_CA_BASE64` only if a provider CA is needed; `FRONTEND_URL` for email links; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `SMTP_SECURE` for password-reset email; `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_CHAT_MODELS` for AI Assistant; `PAYMENT_PROVIDER_ADAPTER` only when a real payment adapter is configured; `PLATFORM_STATUS` and `MAINTENANCE_MODE` for explicit platform status overrides. Do not set `SESSION_SECRET`; it is reserved and unused. Do not create fake administrator accounts or run database initialization, migration, or seed commands against production.
- To enable AI, configure the secret `OPENAI_API_KEY` in Render's **Environment** settings, then save and redeploy. Verify provider access with `GET /api/ai/health` and configuration with `GET /api/ai/status`. TLS certificate verification remains enabled, with Node's system CA store or the optional provider CA.
- Hero slide files are stored under `backend/uploads/hero-slides`. Configure persistent shared storage for this directory in production (especially across deploys or multiple API instances); the database stores only generated filenames and the API serves the image bytes.
- `GET /` is a liveness response. `GET /api/health` runs `SELECT 1` and returns HTTP 200 with `db: true` when MySQL is available, or HTTP 503 with `db: false` and a safe `reason` code when it is unavailable. `GET /api/version` reports the commit from `RENDER_GIT_COMMIT` and the runtime environment.
- Run `npm run db:check` only in an environment configured with the real DB credentials and CA. It performs read-only checks and no schema/data changes.
- Confirm deploy version at `/api/version`. To rebuild without cached artifacts, use **Clear build cache & deploy** in Render.

### Netlify frontend

- Base directory: repository root; build command: `npm ci && npm run build`; publish directory: `frontend/dist`.
- Required: `VITE_API_URL` set in Netlify to the actual Render service HTTPS URL confirmed in the Render Dashboard, ending in `/api`, and `VITE_DEMO_AUTH=false`. These are public build-time settings, not secrets. No unverified Render hostname is baked into the repository. The client accepts either the API origin or its `/api` base path and sends credentialed requests.
- Set `VITE_TELEGRAM_URL`, `VITE_YOUTUBE_URL`, `VITE_FACEBOOK_URL`, and `VITE_LINKEDIN_URL` to confirmed official profile URLs in Netlify, Vercel, or your frontend host's build environment. These public values are compiled into the frontend build. Vite reads `.env` files only when it starts, so restart the local dev server after changing them and rebuild/redeploy after changing deployment settings. Do not enter credentials in profile URLs.
- Optionally set `VITE_CONTACT_PHONE` in the frontend build environment to show a `tel:` link in the public top bar; leave it empty to hide the phone. For local development, set these values in `frontend/.env.development`.
- The SPA fallback is defined once in `frontend/public/_redirects` and copied into `frontend/dist` by Vite.
- After configuration, use **Clear cache and deploy site** in Netlify. Check the deployed asset and verify `/`, `/register`, `/login`, and `/dashboard`.

Run `.\scripts\check-deploy.ps1 -RenderUrl "https://<confirmed-render-service>.onrender.com"` from PowerShell to check live endpoint status, MySQL readiness, credentialed CORS, and compare the Render commit against local `git rev-parse HEAD`. The Render URL is required so the script does not assume an unverified service hostname; optionally pass `-NetlifyUrl` if the frontend origin differs.

| Symptom | Likely cause | Dashboard action |
|---|---|---|
| Render root or `/api/version` returns 404, or health returns 503 | The hostname is not serving this repository's deployed Express service, or the service is unavailable | Confirm the Blueprint source is this repository on `main`, verify the service URL in Render, inspect the deploy logs, and update Netlify `VITE_API_URL` if the hostname changed |
| Render `/api/health` reports `"db": false` | Missing/invalid DB settings, denied access, network rules, or TLS/CA failure | Check the safe `reason` code and Render logs; correct the named DB settings and database network-access rules |
| Netlify SPA route returns 404 | Fallback file absent from deployed publish directory or wrong publish path | Confirm `frontend/dist`, verify `_redirects` there, then clear cache and deploy |
| Netlify bundle is stale | Wrong branch/repository, failed build, or old deploy still published | Verify deployed commit/build logs and run **Clear cache and deploy site** |

Do not initialize or migrate the production database as part of deployment without reviewing the SQL and verifying a backup.

## Find Vendors Dropdown Menu

The public **Find Vendors** menu provides a direct link to the complete vendor directory and a database-backed list of active vendor categories. Category entries include the number of public, verified, active vendors (including zero-count categories) and link to a slug-filtered directory. The menu supports keyboard navigation, outside-click and route-change closure, mobile navigation, loading/error states, and a short category cache that refreshes when the browser regains focus.

### Menu items and routes

- **Browse Vendors** → `/vendors`
- **Vendor category** → `/vendors?category=<slug>`; the directory selects the category and requests matching vendors from the backend.

### API endpoints

`GET /api/platform/categories` returns every active category alphabetically. Its `categories` field is the current shape; `data` is retained as a compatibility alias for existing consumers.

```sh
curl.exe "http://localhost:4000/api/platform/categories"
```

Example response:

```json
{
  "categories": [
    {
      "id": 3,
      "name": "Photography",
      "slug": "photography",
      "description": "",
      "icon": null,
      "image": null,
      "isActive": true,
      "displayOrder": 0,
      "vendor_count": 12,
      "vendorCount": 12,
      "serviceCount": 8
    }
  ],
  "data": [
    {
      "id": 3,
      "name": "Photography",
      "slug": "photography",
      "description": "",
      "icon": null,
      "image": null,
      "isActive": true,
      "displayOrder": 0,
      "vendor_count": 12,
      "vendorCount": 12,
      "serviceCount": 8
    }
  ]
}
```

`GET /api/platform/vendors` supports search, category slug, location, price, rating, availability, sorting, and pagination. For example:

```sh
curl.exe "http://localhost:4000/api/platform/vendors?category=photography&page=1&limit=12"
```

### Database and seed data

The public menu reuses existing tables; it does not add category or vendor tables.

- `service_categories`: `id`, `name`, `description`, `display_order`, `image`, `image_mime`, and `is_active`.
- `vendor_profiles`: `id`, `user_id`, `category_id`, `business_name`, and `verification_status`. The `category_id` foreign key connects a profile to `service_categories`.
- `users`: `id` and `status`; public vendor counts include only `active` users with `verified` profiles.
- `services`: active service records provide the existing service count shown to other marketplace consumers.

The idempotent development seed adds any missing defaults—Photography and Videography, Catering, Decoration and Flowers, Venues and Halls, Music and DJ, Sound and Lighting, Makeup and Beauty, Wedding Cars and Transport, Event Planners, Tents and Furniture Rental, Cake and Bakery, and Security Services—and two uniquely named active, verified sample vendor profiles per active default category. It preserves existing category IDs, vendor records, and relationships. Sample login emails use the reserved `example.invalid` domain; the seed is restricted to the configured local XAMPP `event_platform` development database. The database enum values are checked before inserts (`users.status = active`; `vendor_profiles.verification_status = verified`).

Run from the repository root in PowerShell:

```powershell
$env:NODE_ENV = 'development'
npm --prefix backend run seed:vendor-menu
```

### Frontend files

- `frontend/src/PublicNavigation.jsx` loads and caches public categories.
- `frontend/src/VendorsMenu.jsx` renders the accessible, responsive vendor menu.
- `frontend/src/publicNavigationUtils.js` builds category slugs, links, and counts.
- `frontend/src/App.jsx` reads the category slug and connects it to the real vendor directory API.

### Adding a category

Use the existing Administrator Category Management to create or update a `service_categories` record. Keep it active to show it in the public menu. Existing category IDs and vendor-profile relationships remain unchanged. The menu refreshes the category cache (30 seconds) when revisited or when the browser window regains focus.

### Testing checklist

- Confirm `GET /api/platform/categories` returns active categories sorted by name, including categories with `vendor_count: 0`.
- Confirm inactive categories are absent and an empty category table returns `{ "categories": [], "data": [] }`.
- Click Browse Vendors and every category link; verify the URL uses the category slug and the selected filter remains set after refresh.
- Verify search and other directory filters still use `/api/platform/vendors` and that no-match results show the directory empty state.
- Test keyboard Tab/Enter/Space/Arrow/Escape navigation, outside click, route change, and desktop/mobile layouts.
- Run `npm --prefix backend test`, `npm --prefix frontend test`, and `npm --prefix frontend run build`.

## 6. Business Rules and Security

The platform includes the requested features for:

- secure password handling and admin-only access controls
- server-side validation and request checks
- availability and booking conflict detection
- transaction-safe financial logic
- protected admin actions and audit logging
- read-only financial controls until a provider is configured

## 7. Modules Included in This Codebase

- Authentication module
- Platform and vendor marketplace module
- Event management module
- Booking and review workflow module
- Admin dashboard and reporting foundation
- Payment and refund management with verified provider callbacks, idempotent refund requests, and a pending integration state when no provider is configured
- Notification and audit trail support

## 8. Project Structure

- backend/ — Express API and database logic
- backend/src/routes — auth, admin, and platform routes
- backend/src/lib — reusable business rules and helpers
- frontend/src — React UI and dashboard
- README.md — project overview and local setup guide

## 9. Local Setup

1. Use Node.js 20 and install dependencies from the repository root with `npm install`.
2. API-backed authentication is the development default (`VITE_DEMO_AUTH=false`). To run the self-contained frontend demo, set `VITE_DEMO_AUTH=true` in `frontend/.env.development` or the frontend process environment. Demo registration and four predefined role logins need no API or database; the login page lists their mock credentials. Demo profiles and sample application records are stored in browser localStorage, while passwords and tokens are never stored there. Demo mode is limited to Vite development and is for UI testing only, not authorization or real data access.
3. Run `npm run dev` to start the frontend at `http://127.0.0.1:5173`. For API-backed authentication, keep `VITE_DEMO_AUTH=false`, configure `VITE_API_URL`, and start the backend with `backend/.env` configured for a provisioned MySQL database.
4. For a real backend, apply migrations with `npm run migrate` after configuring the database. Never enable demo authentication in production.

### Open the isolated Neon PostgreSQL database in VS Code

The workspace recommends SQLTools and its PostgreSQL driver. Install the recommended extensions when VS Code prompts, or install **SQLTools** and **SQLTools PostgreSQL/Cockroach Driver** from Extensions.

To connect to the isolated Neon test database:

1. Open `backend/.env.neon-test` locally. This ignored file contains the pooled `DATABASE_URL` and direct `DIRECT_URL`; never commit it or share its contents.
2. In VS Code, open the SQLTools sidebar and choose **Add New Connection** → **PostgreSQL**.
3. Use the pooled URL from `DATABASE_URL` for browsing and queries. Keep `DIRECT_URL` for the migration tooling. Enter the URL directly in the connection form; if the extension instead asks for separate fields, copy the host, database, and username locally from that URL and enter the password only when prompted.
4. Keep TLS certificate verification enabled. Do not put database credentials in source files, `.vscode/settings.json`, screenshots, or chat. Do not run schema-changing SQL against production.

This connection is for the isolated Neon test database only. Connecting to it from VS Code does not switch the application from its current MySQL production default.

### Language and localization

The interface supports English and Amharic (አማርኛ). The header selector applies changes immediately, keeps the selection in browser storage, and saves it to the signed-in account. The backend accepts `Accept-Language`; an authenticated account's saved preference takes precedence. Apply the database migrations to add account-level language preferences.

### Password reset email

Password reset uses a six-digit email OTP, a five-minute expiry, up to five verification attempts, a 60-second resend cooldown, and a short-lived HttpOnly reset authorization cookie. Configure these variables only in the backend environment (never in the frontend):

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`
- Optional `SMTP_SECURE=true|false`; by default port 465 uses implicit TLS and other ports require STARTTLS.

Use SMTP credentials and a verified sender address issued by your email provider. Validate the backend SMTP connection with `npm run smtp:check` from the repository root; the command never prints credential values. TLS certificate verification remains enabled. When SMTP is missing, every valid request receives the same generic service-unavailable response and the backend logs a configuration warning without looking up accounts. Delivery failures are logged without email addresses or OTP values, and the undelivered code is invalidated. Apply migrations with `npm run migrate --prefix backend`; this includes `011_password_reset_otps.sql`. Successful resets revoke existing admin and platform sessions and do not sign users in automatically.

For a real local reset flow, provision and start MySQL, configure `backend/.env` with valid database and SMTP settings, then run:

```powershell
npm run migrate --prefix backend
$env:VITE_DEMO_AUTH = 'false'
$env:VITE_API_URL = 'http://127.0.0.1:4000'
npm run dev --prefix backend
```

In a second PowerShell terminal from the repository root, start the frontend:

```powershell
$env:VITE_DEMO_AUTH = 'false'
$env:VITE_API_URL = 'http://127.0.0.1:4000'
npm run dev --prefix frontend
```

The browser-only demo mode intentionally cannot send email or change real account passwords.

## 10. Test Access

The predefined demo credentials are mock-only and are not valid for production or backend access:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@demo.eventhub` | `AdminDemo123` |
| Customer | `customer@demo.eventhub` | `CustomerDemo12` |
| Organizer | `organizer@demo.eventhub` | `Organizer12Ab` |
| Vendor | `vendor@demo.eventhub` | `VendorDemo12` |

Create the initial administrator only after database migrations have run. Set `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_NAME`, and `ADMIN_BOOTSTRAP_PASSWORD` privately in `backend/.env` or the backend process environment, then run `npm run bootstrap:admin` from the repository root. The password must be 12–16 characters; any characters are allowed. Provisioning hashes it with bcrypt and refuses an email that already exists without modifying that account. Never publish the environment values.

## 11. Acceptance Criteria Covered

This implementation includes the core event platform flow:

- registration and login foundation
- searchable event discovery, event details, related events, and organizer contact
- organizer-owned ticket types with safe inventory reservations and customer booking history
- booking lifecycle validation
- admin dashboard access patterns
- vendor/service browsing
- role-aware platform summary and protection rules

### Event Tickets

Ticket sales use separate `event_ticket_types` and `event_ticket_bookings` tables; existing vendor-service bookings are unchanged. Apply migration `006_event_discovery_tickets.sql` with `npm run migrate` before enabling the ticket workflow.

The current platform API routes are:

- `GET /api/platform/categories` and `GET /api/platform/categories/:slug`
- `GET /api/platform/vendors` and `GET /api/platform/vendors/:id`
- `GET /api/platform/services` and `GET /api/platform/services/:id`
- `GET /api/platform/events` (search, filters, sorting, and pagination)
- `GET /api/platform/events/:id`
- `GET /api/platform/events/:id/related`
- `GET /api/platform/events/:id/tickets`
- `POST /api/platform/events/:id/contact` (authenticated customers)
- `POST /api/platform/ticket-bookings` (authenticated customers)
- `GET /api/platform/ticket-bookings/mine`
- `GET /api/platform/ticket-bookings/:id`
- `PATCH /api/platform/ticket-bookings/:id/cancel`
- `POST /api/platform/events/:id/tickets` and `PATCH /api/platform/events/:id/tickets/:ticketId` (event owner)

Ticket reservations are held for 15 minutes and remain `pending_payment`; no payment provider or verified payment callback is configured, so the app does not mark them paid or confirmed. Organizer ticket setup APIs are available, while image upload and payment/refund integrations still require implementation/configuration.

### Homepage and Vendor Applications

- `GET /api/about/homepage-statistics` returns public aggregate metrics from active/verified vendor profiles, published reviews, active or completed events, and schema-valid booking statuses. The response is cached briefly; it does not expose individual records.
- `GET /api/platform/vendor-application` and `POST /api/platform/vendor-application` require an authenticated customer or organizer. Applications are stored as pending vendor profiles, duplicate pending applications are rejected, and submitting an application does not change the account role or grant vendor access.

### Contact Support

The public contact form submits to `POST /api/contact`; `GET /api/contact` returns configured support details and the FAQ. Submissions are rate-limited, sanitized, stored in `contact_messages`, and assigned a random public reference. Administrator and customer email delivery results are returned without rolling back saved messages. Administrators can search and filter the inbox with `GET /api/admin/contact`, update status and reply with `PATCH /api/admin/contact/:id/status`, mark messages read or unread with `PATCH /api/admin/contact/:id/read`, archive or restore with `PATCH /api/admin/contact/:id/archive`, and delete a message with `DELETE /api/admin/contact/:id`. These inbox routes require an administrator session.

Apply `007_contact_inquiry_types.sql` and `036_public_contact_details.sql` with `npm run migrate` to enable the full inquiry type list, resolved status, and the configured public support email, phone, and social links. Migration 036 fills only empty contact settings, preserving values already customized by an administrator. Address and business hours remain unset until provided.

The public top bar displays `abebeke99@gmail.com` as a mail link, `+251986481821` as a telephone link, and the configured Telegram, YouTube, Facebook, and LinkedIn profiles. Profile URLs must use HTTPS and the expected platform host. The same contact details appear on the Contact page after migration 036 is applied. These Vite values configure the top bar and do not change the footer's current output. Set the following Vite environment variables in `frontend/.env.development` for local work or in the frontend host's build environment before building for deployment; Vite reads env files only at startup:

```env
VITE_TELEGRAM_URL=https://t.me/የአንተ_ቻናል
VITE_YOUTUBE_URL=https://youtube.com/@የአንተ_ቻናል
VITE_FACEBOOK_URL=https://facebook.com/የአንተ_ገጽ
VITE_LINKEDIN_URL=https://linkedin.com/company/የአንተ_ገጽ
VITE_CONTACT_PHONE=+251986481821
```

For deployment, set these values in the frontend host's build environment and rebuild/redeploy; changing them after the build does not update the frontend. These values are public and included in the frontend bundle, so do not put credentials in them.

### Payment and refund management

Apply `017_payment_refund_management.sql` with `npm run migrate`. Administrators can search and filter real payment records at `GET /api/admin/payments`, inspect financial history at `GET /api/admin/payments/:id`, and review requests at `GET /api/admin/refunds`. CSV reports are available from `/api/admin/payments/export` and `/api/admin/refunds/export`; `/api/admin/payments/report` returns grouped payment and refund totals. These routes require an administrator session and the corresponding payment/report permissions. Payment records cannot be created or have their statuses edited through generic admin CRUD.

An authenticated customer or organizer can submit a refund request with `POST /api/customer/payments/:id/refunds` using `{ "amount": "25.00", "reason": "...", "idempotencyKey": "<UUID>" }`. The service reserves pending/processing refunds when checking eligibility, only accepts verified successful payments, and prevents requests from exceeding the amount remaining after previous refunds. A rejection requires a reason. The administrator-configured refund request window applies to new requests; `0` means no deadline.

No payment provider is configured by default. In that state, records remain read-only and an approval cannot be completed. To enable provider operations, set `PAYMENT_PROVIDER_ADAPTER` to a trusted module name under `backend/src/providers/`; the module must export `createPaymentProvider()` returning `name`, `verifyWebhook({ headers, rawBody })`, and `refundPayment({ amount, currency, transactionReference, idempotencyKey })`. `verifyWebhook` must verify the provider signature against the raw body and return a normalized event with `eventId`, `type`, `transactionReference`, `amount`, and `currency`; refund events also include `refundIdempotencyKey` and, on success, `refundReference`. `refundPayment` returns `{ status: "succeeded" | "pending" | "failed", refundReference? }`. Keep all provider credentials in environment variables. The webhook endpoint `POST /api/payments/webhook` accepts only provider-verified normalized payment success/failure/cancellation and refund result events; the server additionally matches the provider, stored transaction reference, amount, and currency before recording success. Payment success and refund success are recorded only after confirmation, and provider event/refund idempotency keys protect retries. Do not implement adapter verification using frontend-supplied status or unverified webhook fields.

### Administrator reports and analytics

Apply `019_reports_analytics.sql` with `npm run migrate`. The administrator Reports page and `GET /api/admin/reports?report=...` provide filtered, paginated database reports for users, vendors, events, bookings, payments, refunds, revenue, service categories, reviews, complaints, vendor performance, and booking outcomes. Use `period=today|last7|last30|monthly|yearly|custom`; custom ranges require `startDate` and `endDate` in `YYYY-MM-DD` form and may span up to 366 calendar days. Optional filters include `q`, `status`, `currency`, `categoryId`, `vendorId`, and `customerId`. Results include summary data, chart data, applied filters, timezone, and a generation timestamp.

Set `platform_currency` to the platform's three-letter ISO 4217 currency code and `report_timezone` to an IANA timezone in Administrator > System Settings. Date boundaries are calculated in that timezone, including daylight-saving transitions. Ensure MySQL timezone conversion is available; revenue reporting returns an explicit service error if the configured timezone cannot be resolved by MySQL. Financial reports exclude failed and cancelled payments, count provider-confirmed captured payments as gross payments, deduct succeeded refunds, and keep each currency separate rather than applying an undocumented exchange rate. CSV exports use the same report filters and sort order as the page, are available at `GET /api/admin/reports/export`, and are capped at 10,000 rows; narrow the filters for larger reports. Both report viewing and financial-report exports are permission-protected. Export actions are written to the administrator audit log. PDF export is not provided because the existing stack has no PDF reporting dependency.

### Administrator system settings

In the opt-in browser demo (`VITE_DEMO_AUTH=true`), Administrator > System Settings provides the 19-section frontend demonstration module. Its settings and sample logs are stored only in that browser's localStorage; file previews, email tests, payment options, maintenance mode, backups, and logs do not call the backend or affect live platform services. API-backed mode retains the existing server-managed settings behavior described below.

Apply `023_system_settings_module.sql` with `npm run migrate`. Administrator > System Settings reads and writes allowlisted values in `system_settings`; changes are backend-validated and audited. Consequential changes require confirmation, and reset-to-default requires an explicit confirmation. Logo URLs must use HTTPS. The configured currency and reporting timezone feed platform availability and reports. Booking cancellation/rescheduling limits and confirmation workflow, vendor application requirements, administrator notification preferences, and the refund request window are enforced by the corresponding server workflows. Settings do not rewrite existing transactions, bookings, or applications.

Payment provider, email, SMS, and security configuration are status-only where the application does not support safe runtime configuration. Credentials remain in environment variables or the provider's secret-management configuration and are never returned by settings APIs. Vendor verification remains required, and service publication remains restricted to verified vendors; unsupported service-approval customization is not exposed as an editable setting.

### Administrator audit logs

Apply `022_audit_log_management.sql` with `npm run migrate --prefix backend`. The read-only Audit Logs screen and `GET /api/admin/audit-logs` support actor, action, module, entity, request ID, severity, outcome, and date filters with pagination. `GET /api/admin/audit-logs/export` exports filtered results to CSV, capped at 10,000 rows. Viewing and exporting require `audit_logs.view` and `audit_logs.export`; the application exposes no audit-record create, update, or delete endpoints.

Audit entries are generated server-side by the existing audit writer. Requests receive a server-generated `X-Request-Id`, which is attached to audit records. The writer strips credential-like fields, excludes free-text event descriptions from change snapshots, and rejects oversized metadata. Critical changes remain part of the same transaction as their audit record where supported, so audit-write failure rolls back the operation.

### Administrator profile and security

The Administrator > Profile screen reads profile and recent account activity from the authenticated administrator session. Name and phone changes, validated profile-image uploads/removals, and password changes are persisted and audited; role, status, and email are displayed read-only. Password changes require the current password and at least 16 characters, including uppercase, lowercase, and a number, with a 72-byte bcrypt maximum. The current administrator session is rotated and other administrator and platform sessions for that account are invalidated. Verified email changes require current-password confirmation and a short-lived OTP delivered through SMTP. The profile endpoints accept no client-supplied user ID.

### Home hero image slides

The Administrator > Hero Images page manages up to five slides. Before using it, review and back up the target database, then apply pending migrations from the repository root with `npm --workspace backend run migrate`. The additive `030_hero_slides.sql` migration creates the slide table; it does not seed images or alter existing tables. Uploads accept JPG, PNG, or WebP up to 5 MB and are saved as generated filenames under `backend/uploads/hero-slides`; production must provide persistent shared storage for that directory.

Public routes are `GET /api/hero-slides` and `GET /api/hero-slides/:id/image`. Admin-only routes are `GET /api/admin/hero-slides`, `GET /api/admin/hero-slides/:id/image`, `POST /api/admin/hero-slides`, `PUT /api/admin/hero-slides/:id`, `DELETE /api/admin/hero-slides/:id`, and `PATCH /api/admin/hero-slides/reorder`.

## 12. Deployment Considerations

For a production deployment, use:

- HTTPS in front of the app
- environment-based secrets and configuration
- production MySQL or a managed relational database
- a real payment processor and notification service
- migration-based database deployment and audit retention policy

Deployment settings and troubleshooting are maintained in the Deployment checklist above.

## 13. Future Enhancements

- dedicated customer dashboard and organizer dashboard
- vendor verification workflow UI and document upload
- integration of a specific payment provider adapter and policy-specific refund terms
- notification and messaging modules
- additional languages and multi-currency support

## 14. Conclusion

This codebase provides a working foundation for the Event Organizing and Vendor Booking Platform described in the project brief, including the core booking workflow, marketplace, admin console, and platform rules required to launch a secure MVP.

- id
- full_name
- email
- password_hash
- phone
- role
- status
- created_at
- updated_at

#### OrganizerProfile

- id
- user_id
- company_name
- address
- city
- preferred_event_types
- bio

#### VendorProfile

- id
- user_id
- business_name
- business_registration_no
- category_id
- location
- description
- verified
- rating_average
- portfolio_url

#### Category

- id
- name
- parent_category_id
- slug

#### Service

- id
- vendor_id
- category_id
- title
- description
- price
- currency
- availability_status
- featured

#### Event

- id
- organizer_id
- title
- event_type
- start_date
- end_date
- venue_name
- city
- budget
- guest_count
- status
- notes

#### BookingRequest

- id
- event_id
- vendor_id
- service_id
- organizer_id
- status
- requested_date
- quote_amount
- currency
- notes

#### Contract

- id
- booking_id
- vendor_id
- organizer_id
- terms
- accepted_at
- signed_by

#### Payment

- id
- booking_id
- payer_id
- payee_id
- amount
- currency
- gateway
- status
- transaction_reference
- paid_at

#### Review

- id
- event_id
- booking_id
- organizer_id
- vendor_id
- rating
- comment
- created_at

#### Notification

- id
- user_id
- title
- message
- notification_type
- related_entity_type and related_entity_id
- status and read_at
- delivery_channel and delivery_status
- delivery_attempts and last_delivery_error
- idempotency_key
- created_at

## 9. Database Relationships

- One organizer has many events.
- One vendor has many services and bookings.
- One event has many booking requests.
- One booking request can have one quote, contract, and many payments.
- One vendor can receive many reviews.
- One organizer can leave many reviews over time.

## 10. API Design

### Authentication APIs

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/refresh
- POST /api/auth/forgot-password
- POST /api/auth/reset-password

### Organizer APIs

- GET /api/organizers/me
- POST /api/events
- GET /api/events
- GET /api/events/:id
- PATCH /api/events/:id
- DELETE /api/events/:id
- GET /api/vendors
- POST /api/booking-requests
- GET /api/booking-requests
- PATCH /api/booking-requests/:id

### Vendor APIs

- GET /api/vendors/me
- POST /api/services
- GET /api/services
- PATCH /api/services/:id
- GET /api/bookings
- POST /api/quotes
- PATCH /api/bookings/:id/status

### Admin APIs

- GET /api/hero-slides
- GET /api/hero-slides/:id/image
- GET /api/admin/hero-slides
- GET /api/admin/hero-slides/:id/image
- POST /api/admin/hero-slides
- PUT /api/admin/hero-slides/:id
- DELETE /api/admin/hero-slides/:id
- PATCH /api/admin/hero-slides/reorder
- GET /api/admin/users
- PATCH /api/admin/vendors/:id/verify
- GET /api/admin/reports/summary
- GET /api/admin/payments
- PATCH /api/admin/disputes/:id

### Payment APIs

- POST /api/payments/create-intent
- POST /api/payments/confirm
- GET /api/payments/:id
- POST /api/refunds

### Notification APIs

- GET /api/admin/notifications (recipient-scoped list, filters, pagination, unread count)
- GET /api/admin/notifications/options (configured delivery channels)
- POST /api/admin/notifications/:id/read
- POST /api/admin/notifications/read-all
- GET /api/admin/notifications/:id/history
- POST /api/admin/notifications/announcements (idempotency key required)
- POST /api/admin/notifications/:id/retry (failed email deliveries only)

## 11. Example API Response

### Event response example

```json
{
  "id": "evt_12345",
  "title": "Wedding Reception",
  "event_type": "Wedding",
  "start_date": "2026-12-15T18:00:00Z",
  "end_date": "2026-12-16T02:00:00Z",
  "budget": 18000,
  "currency": "USD",
  "status": "active",
  "organizer": {
    "id": "usr_987",
    "full_name": "Aisha Johnson"
  }
}
```

## 12. Security and Privacy

- Enforce strong password policies.
- Use JWT with refresh token rotation.
- Protect sensitive endpoints with role-based access control.
- Encrypt data in transit using TLS.
- Secure payment flows through PCI-compliant gateways.
- Store sensitive files in encrypted storage.
- Add rate limiting and validation on all APIs.
- Log admin actions for auditing.
- Ensure vendor information and organizer data are protected under privacy controls.

## 13. Non-Functional Requirements

### Scalability

- Support thousands of vendors and concurrent booking activity.
- Use queue-based processing for notifications and asynchronous jobs.

### Reliability

- Run stateless services behind load balancers.
- Use retries and idempotency keys for payments and notifications.

### Performance

- Cache frequently accessed vendor and service listings.
- Use database indexes for category, city, and price search.

### Observability

- Centralized logging with ELK or Grafana stack.
- Application performance monitoring with Sentry, DataDog, or New Relic.

## 14. Deployment Architecture

### Recommended deployment stack

- Frontend: Vercel or Netlify
- Backend: Dockerized Node.js app on AWS ECS, Azure App Service, or Render
- Database: managed MySQL compatible with the current schema
- Cache: Redis on AWS ElastiCache
- Object storage: S3 or Cloud Storage
- CDN: CloudFront or Azure CDN
- Monitoring: Prometheus + Grafana or managed cloud monitoring tools

### Infrastructure flow

- User requests route to a web app frontend.
- Frontend communicates with backend API.
- API reads/writes to MySQL.
- Payment flows go through secure gateway endpoints.
- Notifications are sent asynchronously through a message queue.

## 15. Implementation Roadmap

### Phase 1: MVP

- User login/signup
- Event creation
- Vendor search and profiles
- Booking request workflow
- Basic payment integration
- Notifications and reviews

### Phase 2: Growth features

- Vendor dashboards
- Quotation negotiation
- Contract management
- Admin analytics and moderation
- Multi-location vendor support

### Phase 3: Expansion

- AI-powered event recommendations
- Vendor ranking engine
- Mobile applications
- Multi-currency and global payment support
- Subscription plans for premium vendors

## 16. Example Project Structure

```text
event-platform/
├── src/
│   ├── app/
│   │   ├── auth/
│   │   ├── events/
│   │   ├── vendors/
│   │   ├── bookings/
│   │   ├── payments/
│   │   ├── notifications/
│   │   └── admin/
│   ├── config/
│   ├── db/
│   ├── middleware/
│   ├── services/
│   ├── utils/
│   └── server.js
├── tests/
│   ├── auth/
│   ├── events/
│   ├── bookings/
│   └── vendors/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── README.md
└── docs/
    ├── api.md
    ├── architecture.md
    └── deployment.md
```

## 17. Testing Strategy

- Unit testing for validation and service logic
- Integration tests for API endpoints and database flows
- Payment simulation tests for deposits and refunds
- End-to-end tests for organizer-to-vendor booking lifecycle
- Performance tests for high-traffic vendor search pages

## 18. Release Checklist

Before launch, confirm:

- Vendor verification flow works
- Event creation and booking flow is tested
- Payment settlement is secure and traceable
- Search and listing performance meets target
- Notifications and reminders are delivered reliably
- Admin moderation and support tools are complete
- Privacy and compliance controls are in place

## 19. Success Metrics

- Number of active organizers
- Number of verified vendors
- Booking completion rate
- Average revenue per event
- Vendor response time
- User satisfaction score
- Refund rate and dispute rate

## 20. Summary

The Event Organizing and Vendor Booking Platform is a marketplace and workflow system that allows event organizers to plan events and book vendors from a single system. By integrating event management, vendor discovery, booking, payments, communication, and analytics, the platform reduces complexity and helps both organizers and vendors operate more efficiently.

This documentation provides the foundation for a robust MVP and a scalable future roadmap.

## 21. License

This project documentation is provided for planning and development use. Add the appropriate open-source or proprietary license based on your distribution model.

## 22. Suggested Next Steps

1. Confirm the preferred technology stack.
2. Define MVP features and user journeys.
3. Design the database schema in detail.
4. Create the backend and frontend project structure.
5. Define API contracts and validation rules.
6. Build authentication and role management.
7. Implement event and booking modules.
8. Integrate payment gateway and notifications.
9. Add analytics and admin dashboards.
10. Deploy and monitor in production.
