# Live Deployment Verification

## Netlify

Verified public frontend:

- `https://infobekele.netlify.app/`: HTTP 200
- `/register`: HTTP 200
- `/login`: HTTP 200
- `/forgot-password`: HTTP 200
- `/events`: HTTP 200
- `/vendors`: HTTP 200
- `/service-categories`: HTTP 200
- `/customer/dashboard`: HTTP 200
- `/organizer/dashboard`: HTTP 200
- `/vendor/dashboard`: HTTP 200
- `/admin`: HTTP 200

These checks verify SPA fallback responses and public route availability. Browser interaction, language switching, authenticated dashboards, and API calls require live browser validation.

## Render

No live backend was confirmed.

Probed:

- `https://event-organizing-and-vendor-booking-platform.onrender.com`
- `https://event-organizing-and-vendor-booking.onrender.com`

Both `/`, `/api/health`, and `/api/version` returned HTTP 404 or no EventHub API response.

## Deployment configuration

- Render Blueprint: `render.yaml`
- Netlify configuration: `netlify.toml`
- Render health path: `/api/ready`
- Netlify publish directory: `frontend/dist`
- Frontend API build variable: must be set to the confirmed deployed backend HTTPS origin plus `/api`

## Live communication status

Frontend: verified public delivery.

Backend: not verified.

Database: live read-only Neon runtime check passed.

Frontend-to-backend-to-database: not verified until the exact Render URL is supplied.
