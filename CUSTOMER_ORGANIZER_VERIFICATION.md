# Customer and Organizer Verification

## Isolated-Neon integration

The booking/dashboard integration passed against the isolated Neon test database. Organizer overview, events, vendors, and bookings returned HTTP 200; the concurrent bundle was 4.12s in this run. Customer overview, vendors, services, bookings, events, messages, and notifications returned HTTP 200; the concurrent bundle was 2.68s.

The same run exercised booking creation, date availability conflicts, quotations, rescheduling, messaging, notifications, reviews, complaints, and access checks. Expected conflict and unauthorized responses were asserted as part of the test; generated fixtures were removed from the isolated test database.

## Limits

These are single-run results, not p95 or production-load measurements. Organizer and customer bundle samples exceed the 2-second performance goal. This does not certify every UI interaction or all query call sites. Production customer/organizer data was not accessed.
