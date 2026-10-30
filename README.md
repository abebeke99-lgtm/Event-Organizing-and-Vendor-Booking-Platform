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
- Payment tracking and refund workflow support
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
- Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for MySQL. Production requires `DB_SSL=true` and a valid PEM CA certificate in `DB_SSL_CA`; certificate verification remains enabled.

## Deployment

- Render API: build with `npm ci` and start with `npm run start` from the repository root. Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL=true`, `DB_SSL_CA`, `WEB_ORIGIN`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=none`. Enter the password and Aiven CA PEM only in Render's secure environment settings. `npm --workspace backend run db:check` performs read-only connection, `SELECT 1`, and selected-database checks; it does not migrate or modify data.
- Netlify frontend: set `VITE_API_URL` to the verified public Render API origin, without `/api` or a trailing slash, then redeploy. The frontend appends `/api` to API requests and includes cookies.
- After deployment, verify `GET /` returns `200 {"status":"ok"}` and `GET /api/health` returns `200 {"status":"ok"}`. Database unavailability must produce a `503` from `/api/health`.
- Do not run database initialization or migrations as part of deployment without first reviewing the SQL against the existing schema and taking a backup.

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
- Payment and refund workflow placeholders for production providers
- Notification and audit trail support

## 8. Project Structure

- backend/ — Express API and database logic
- backend/src/routes — auth, admin, and platform routes
- backend/src/lib — reusable business rules and helpers
- frontend/src — React UI and dashboard
- README.md — project overview and local setup guide

## 9. Local Setup

1. Open the workspace folder.
2. Use the configured runtime to install dependencies if needed.
3. Start the backend from the workspace with the project runtime.
4. Start the frontend with Vite.
5. Use the demo accounts or create your own platform users through the auth endpoints.

## 10. Test Access

No production or demo credentials are shipped as a supported sign-in method. Create an administrator with the `bootstrap:admin` command and a private `ADMIN_BOOTSTRAP_*` environment configuration only after the database is provisioned. Do not publish those values.

## 11. Acceptance Criteria Covered

This implementation includes the core event platform flow:

- registration and login foundation
- event and vendor marketplace basics
- booking lifecycle validation
- admin dashboard access patterns
- vendor/service browsing
- role-aware platform summary and protection rules

## 12. Deployment Considerations

For a production deployment, use:

- HTTPS in front of the app
- environment-based secrets and configuration
- production MySQL or a managed relational database
- a real payment processor and notification service
- migration-based database deployment and audit retention policy

### Current Netlify and Render settings

- Netlify base directory: repository root
- Netlify build command: `npm ci && npm run build`
- Netlify publish directory: `frontend/dist`
- SPA fallback: `frontend/public/_redirects` and `netlify.toml` rewrite routes to `/index.html`
- Set Netlify `VITE_API_URL` to the verified public Render API origin. The API allows credentialed requests only from the configured frontend origin in production.
- Render root directory: repository root
- Render build command: `npm ci`
- Render start command: `npm run start`
- Render health check: `/api/health`

Set these backend environment variables in Render: `NODE_ENV=production`, `WEB_ORIGIN=https://infobekele.netlify.app`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL=true`, `DB_SSL_CA`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=none`. Render supplies `PORT`; the server binds to `0.0.0.0`. Do not put database credentials in frontend variables.

The live API health check currently returns HTTP 503, so its database connection is unavailable. Verify the managed MySQL host, database name, user grants, network access, and TLS settings in Render before login or CRUD can work. Do not run `npm run migrate` against production until each SQL file has been reviewed and the existing database has a verified backup; the current migrations include data upserts.

## 13. Future Enhancements

- dedicated customer dashboard and organizer dashboard
- vendor verification workflow UI and document upload
- real payment integration and webhook verification
- notification and messaging modules
- advanced reports and analytics
- multi-language and multi-currency support

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
- type
- subject
- body
- status
- sent_at

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

- GET /api/notifications
- PATCH /api/notifications/:id/read
- POST /api/notifications/send

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
