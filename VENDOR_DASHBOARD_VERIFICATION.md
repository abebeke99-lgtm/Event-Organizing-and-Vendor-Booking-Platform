# Vendor Dashboard Verification

## Isolated-Neon integration

The booking/dashboard integration passed against the isolated Neon test database. In the full-suite measurement, the four concurrent endpoints used by the vendor overview (`overview`, `booking-requests`, `services`, and `notifications`) returned HTTP 200 in 20 samples. Bundle latency was p50 1,078 ms, p95 1,234 ms, and p99 3,294 ms.

Thirteen additional vendor page endpoints returned HTTP 200 and valid JSON: profile, verification, service packages, packages, categories, pricing, history, tasks, payments, messages, reviews, reports, and account. This separate page-coverage batch is not an overview performance measurement. The test also exercises vendor booking, quotation, availability, and messaging workflows, including authorization and conflict behavior, and cleans up only its own isolated-test fixtures. The full opt-in backend suite passed 590/590 tests.

## Limits

The p99 exceeds the 2-second goal. These are isolated API measurements, not production or full-browser timings. GET coverage does not certify every vendor mutation, form validation, or permission combination. Production vendor accounts/data were not accessed.
