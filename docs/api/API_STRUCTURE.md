# EventHub API Structure

## Mount areas

- `/api/auth`: authentication and session routes.
- `/api/platform/oauth`: OAuth provider routes.
- `/api/platform`: public platform and organizer marketplace routes.
- `/api/customer`: customer account, marketplace, and booking routes.
- `/api/vendor`: vendor catalog, bookings, and dashboard routes.
- `/api/admin`: administrator users, catalog, events, bookings, reports, reviews, payments, notifications, audit logs, profile, and settings.
- `/api/ai`: AI health, status, chat, and authenticated conversations.
- `/api/contact`: public contact routes.
- `/api/payments/webhook`: payment provider webhook route.
- `/api/users/me/avatar`: user avatar routes.
- `/api/health` and `/api/ready`: database readiness checks.
- `/api/version`: deployment version metadata.

## Implementation

The Express application is in `backend/src/app.js`. Feature routes are in `backend/src/routes/`, and PostgreSQL route implementations use `backend/src/lib/postgres*.js` and `backend/postgres/`.

## Compatibility and authorization

Public routes are exposed for marketplace discovery. Platform roles use role-aware middleware. Administrator routes require the administrator middleware. Existing mount paths are preserved for frontend compatibility.

Cleanup verification preserved all mounted route modules and did not delete or consolidate route implementations.
