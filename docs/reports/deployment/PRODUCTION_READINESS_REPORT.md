# EventHub Production Readiness Report

Date: 2026-11-19

## Executive result

**Overall: WARNING / NOT VERIFIED**

The Netlify frontend is live and its SPA routes return HTTP 200. The backend hostname is reachable by DNS but currently returns HTTP 404 for `/`, `/api/health`, `/api/ready`, `/api/version`, and `/api/platform/me`, so it is not serving the EventHub API. The live frontend bundle previously contained `http://127.0.0.1:4000/api`, and repository configuration has now been corrected. The frontend and backend repositories pass their local suites, and Neon connectivity passes a read-only local check.

Live backend redeployment, browser authentication, role workflows, and live CORS could not be completed without a functioning deployed API and designated test accounts.

## Evidence summary

| Check | Classification | Evidence |
|---|---|---|
| Netlify frontend homepage | PASS | `https://infobekele.netlify.app/` returned HTTP 200 |
| Netlify important routes | PASS | `/register`, `/login`, `/forgot-password`, `/events`, `/vendors`, `/service-categories`, `/admin` returned HTTP 200 |
| SPA fallback | PASS | Netlify `_redirects` contains `/* /index.html 200` |
| Live backend root | FAIL | `/` returned HTTP 404 |
| Live `/api/health` | FAIL | HTTP 404 |
| Live `/api/ready` | FAIL | HTTP 404 |
| Live `/api/version` | FAIL | HTTP 404 |
| Live `/api/platform/me` | FAIL | HTTP 404 |
| Backend-to-Neon from live service | NOT VERIFIED | The live backend endpoints were unavailable |
| Local read-only Neon check | PASS | `SELECT 1` passed and 59 tables were detected |
| Live frontend API base | FAIL (resolved in repository) | Downloaded live JS bundle contained `http://127.0.0.1:4000/api` |
| Repository frontend API base | PASS | `netlify.toml` now sets `VITE_API_URL=https://event-organizing-and-vendor-booking-platform.onrender.com/api` |
| Live CORS | NOT VERIFIED | Backend returned no CORS headers because endpoints returned 404 |
| Repository CORS | PASS | Express restricts origins to `WEB_ORIGIN` and supports credentialed requests |
| Secure session cookies | PASS | Cookies are HTTP-only and production secure/SameSite settings are configurable |
| Password hashing | PASS | bcrypt cost 12 is used for password operations |
| Role-based middleware | PASS | Protected route middleware exists for platform roles and administrators |
| Live authentication workflows | NOT VERIFIED | No deployed API and no designated test accounts |
| Admin/Organizer/Vendor/Customer live workflows | NOT VERIFIED | No deployed API and no designated test accounts |
| GitHub Actions configuration | PASS | Frontend, backend, and manual deployment verification workflows exist |
| GitHub Actions execution | NOT VERIFIED | No GitHub Actions run status was accessible |
| Netlify configuration | PASS | Repository build, publish directory, SPA fallback, and API URL are configured |
| Render configuration | WARNING | Blueprint and health path are valid, but deployed hostname returned 404 |
| Deployment migration behavior | PASS | `npm run start` imports `server.js`; it verifies/connects and starts the API, but does not run migration commands |
| Live browser console | NOT VERIFIED | No browser session was shared |
| Live missing assets | WARNING | `/favicon.png` resolved to HTML on the live site |
| Repository favicon | FIXED | Existing `eventhub-symbol.png` was copied to `frontend/public/favicon.png` |
| Frontend tests | PASS | 235/235 passed |
| Backend tests | PASS | 568/568 passed |
| Production build | PASS | Vite production build passed |
| Database mutations | PASS (none performed) | Read-only checks only; no records or migrations changed |

## Live HTTP evidence

### Netlify

- `/`: HTTP 200
- `/register`: HTTP 200
- `/login`: HTTP 200
- `/forgot-password`: HTTP 200
- `/events`: HTTP 200
- `/vendors`: HTTP 200
- `/service-categories`: HTTP 200
- `/admin`: HTTP 200
- JS asset: HTTP 200
- CSS asset: HTTP 200
- `/favicon.png`: HTTP 200 with `text/html` instead of a PNG

### Render

DNS resolves the supplied hostname to a Render origin. HTTP requests did not reach an EventHub Express service:

- `/`: 404
- `/api/health`: 404
- `/api/ready`: 404
- `/api/version`: 404
- `/api/platform/me`: 404

## Frontend API and CORS configuration

The live deployed JavaScript bundle contained the loopback API URL `http://127.0.0.1:4000/api`. This is the primary frontend integration failure.

Repository fix:

- `netlify.toml` now provides `VITE_API_URL=https://event-organizing-and-vendor-booking-platform.onrender.com/api`.
- The next Netlify production build will use the Render backend origin.

The Express CORS implementation only allows configured origins and requires credentialed requests. It does not use wildcard CORS.

## Authentication and security

Repository controls verified:

- Session cookies use `httpOnly`.
- Production cookies use HTTPS-only and cross-site `SameSite` settings.
- Password changes and authentication use bcrypt with cost 12.
- Role middleware protects customer, organizer, vendor, and administrator routes.
- PostgreSQL inputs use parameterized SQL in the PostgreSQL implementation.
- Express uses Helmet.
- Authentication, contact, and search operations include rate limiting.
- Upload routes use in-memory storage and file-size limits.
- Secret values were not printed or added to reports.

Live authentication and cookie behavior remain NOT VERIFIED because the backend is unavailable.

## Database safety

Read-only Neon verification passed:

- `SELECT 1`: PASS
- 59 tables: PASS

The production application start path does not invoke migration scripts. Migration commands are separate scripts and were not run.

No records were inserted, updated, deleted, truncated, dropped, or reset.

## Safe modifications made

1. Added the public production API URL to [netlify.toml](/c:/Users/user/Videos/EventHub_Project/Event-Organizing-and-Vendor-Booking-Platform/netlify.toml).
2. Added [frontend/public/favicon.png](/c:/Users/user/Videos/EventHub_Project/Event-Organizing-and-Vendor-Booking-Platform/frontend/public/favicon.png), reusing the existing EventHub symbol asset.

No source behavior, routes, tests, migrations, database records, or secrets were changed.

## Remaining blockers and recommended actions

1. Redeploy the Render service from this repository's `main` branch using `npm ci` and `npm run start`.
2. Confirm the deployed Render service URL matches `https://event-organizing-and-vendor-booking-platform.onrender.com`.
3. Configure production secrets in Render: `DATABASE_URL`, `DIRECT_URL`, `DB_DIALECT=postgres`, `DB_SSL=true`, `WEB_ORIGIN=https://infobekele.netlify.app`, secure cookie settings, and required provider secrets.
4. Redeploy Netlify after `netlify.toml` changes are committed to the deployed branch.
5. Verify `/api/health`, `/api/ready`, `/api/version`, and `/api/platform/me`.
6. Verify CORS by requesting `/api/health` with `Origin: https://infobekele.netlify.app`.
7. Use designated test accounts to verify each dashboard and logout/session behavior.
8. Verify deployed `/favicon.png` returns PNG content after redeploy.
9. Use a browser session to capture console errors, failed requests, missing assets, and route refresh behavior.
10. Review GitHub Actions run results after the workflow definitions are executed.
