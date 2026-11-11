# PostgreSQL Administrator Notifications Migration Report

Updated: 2026-11-11  
Database: verified isolated Neon PostgreSQL 18 database `eventhub` only. No production database or deployment setting was accessed.

## Endpoints

All paths are mounted under `/api/admin` after the existing `requireAdmin` middleware. Each endpoint also keeps the existing `requirePermission('notifications.manage')` gate.

| Method and path | Function | SQL calls | Live test |
|---|---|---:|---|
| `GET /notifications/options` | email-channel availability | 0 | Options/auth subtest |
| `GET /notifications` | list, count, unread count | 3 | Filter/page/empty subtest |
| `POST /notifications/:id/read` | mark owned item read | 2 | Ownership/idempotency subtest |
| `POST /notifications/read-all` | bulk mark current admin inbox read + history | 1 | Bulk-read subtest |
| `GET /notifications/:id/history` | ownership check and history list | 2 | History-scope subtest |
| `POST /notifications/announcements` | idempotent recipient creation and delivery state | 5 | Announcement transaction/idempotency subtest |
| `POST /notifications/:id/retry` | failed-email claim, send, and outcome persistence | 4 | Retry/failure/success/scope subtest |

## Query-Level Evidence

The 19 `.query()` call sites are in [backend/src/routes/postgresAdminNotifications.js](backend/src/routes/postgresAdminNotifications.js). The static generated CSV records them with source line and function. Exact SQL operations, endpoint mapping, and test evidence:

| Source function / statement | Endpoint | PostgreSQL behavior | Test evidence/status |
|---|---|---|---|
| `writeAudit`: `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address, request_id) VALUES ($1, $2, 'notification', $3, $4::jsonb, $5, $6)` | announcements; successful retry | Parameterized JSONB audit write; runs in same transaction as the state change | Announcement/retry subtest checks announcement-created and retry audit persistence; live Neon exercised |
| `addHistory`: `INSERT INTO notification_history (notification_id, actor_id, action, details) VALUES ($1, $2, $3, $4::jsonb)` | read, read-all, announcement, delivery failure/success, retry | Parameterized JSONB history write | All seven endpoint subtests exercise creation/read/email history; live Neon exercised |
| `SELECT COUNT(*)::integer AS total FROM notifications n WHERE ...` | `GET /notifications` | Recipient-scoped total for active filters | List subtest checks empty and paginated totals; live Neon exercised |
| `SELECT COUNT(*)::integer AS unread FROM notifications WHERE user_id = $1 AND status <> 'read'` | `GET /notifications` | Unread count is always scoped to `req.admin.id` | List subtest asserts unread count; live Neon exercised |
| `SELECT n.id, ... FROM notifications n WHERE ... ORDER BY n.<allow-listed-column> ... LIMIT $n OFFSET $n` | `GET /notifications` | Parameterized filters/pagination; sort identifier comes from a strict enum | List subtest tests query/type/read filters, pagination, sorting; live Neon exercised |
| `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = $1 AND user_id = $2 AND status <> 'read' RETURNING id` | `POST /notifications/:id/read` | Atomic owner-scoped state transition | Read subtest verifies changed and repeat behavior; live Neon exercised |
| `SELECT id FROM notifications WHERE id = $1 AND user_id = $2` | `POST /notifications/:id/read` | Distinguishes already-read own row from another recipient/missing row without leaking ownership | Cross-recipient test gets 404; live Neon exercised |
| `WITH changed AS (UPDATE notifications ... WHERE user_id = $1 AND status <> 'read' RETURNING id), logged AS (INSERT INTO notification_history ... SELECT id, $1, 'read' FROM changed RETURNING notification_id) SELECT COUNT(*)::integer AS changed FROM changed` | `POST /notifications/read-all` | Single-statement recipient-scoped update and history write | Bulk-read test verifies one change, zero on repeat, and unchanged foreign row; live Neon exercised |
| `SELECT id FROM notifications WHERE id = $1 AND user_id = $2` | `GET /notifications/:id/history` | Verifies ownership before history access | History subtest checks own and foreign records; live Neon exercised |
| `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.details, h.created_at FROM notification_history h LEFT JOIN users u ... WHERE h.notification_id = $1 ORDER BY ...` | `GET /notifications/:id/history` | History restricted to previously verified owned notification | History subtest checks created/read history; live Neon exercised |
| `SELECT DISTINCT u.id, u.email FROM users ... WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE ORDER BY u.id` | `POST /notifications/announcements` | Recipient set derived from active administrator roles, never from request-supplied recipient IDs | Announcement subtest compares created count to active DB recipients; live Neon exercised |
| `INSERT INTO notifications (...) VALUES ($1, $2, $3, 'announcement', $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` | `POST /notifications/announcements` | Per-recipient idempotency and channel-specific initial delivery state | Duplicate announcement subtest verifies no second delivery/creation; live Neon exercised |
| `SELECT id, delivery_status FROM notifications WHERE idempotency_key = $1 AND user_id = $2` | `POST /notifications/announcements` | Resolves an idempotent duplicate only for the expected recipient | Duplicate request live-tested; conflicting unresolved key rollback branch not forced |
| `UPDATE notifications SET delivery_status = 'failed', status = 'failed', delivery_attempts = delivery_attempts + 1, last_delivery_error = $1 WHERE id = $2 AND user_id = $3 AND delivery_status = 'pending' RETURNING id` | `POST /notifications/announcements` email failure | Persists safe error code and increments attempts only for pending recipient row | Email-failure announcement subtest checks status/attempts; live Neon exercised |
| `UPDATE notifications SET delivery_status = 'delivered', status = 'sent', delivery_attempts = delivery_attempts + 1, last_delivery_error = NULL WHERE id = $1 AND user_id = $2 AND delivery_status = 'pending' RETURNING id` | `POST /notifications/announcements` email success | Persists provider-confirmed result only if this request still owns the pending transition | Router code present; the live announcement test uses a failing provider, not a successful initial email delivery; this call site is not live-verified |
| `SELECT n.id, ... FROM notifications n JOIN users u ... WHERE n.id = $1 AND n.user_id = $2 FOR UPDATE OF n` | `POST /notifications/:id/retry` | Locks and scopes retry candidate to authenticated admin | Retry subtest covers own failed row; live Neon exercised |
| `UPDATE notifications SET delivery_status = 'pending' WHERE id = $1 AND user_id = $2 AND delivery_channel = 'email' AND delivery_status = 'failed' RETURNING id` | retry | Atomic claim prevents concurrent duplicate retry | Repeat after successful delivery returns 409; live Neon exercised |
| `UPDATE notifications SET delivery_status = 'failed', status = 'failed', delivery_attempts = delivery_attempts + 1, last_delivery_error = $1 WHERE id = $2 AND user_id = $3 AND delivery_status = 'pending' RETURNING id` | retry failure | Persists safe provider failure and keeps the message retry-eligible | Retry failure subtest checks state/attempt count; live Neon exercised |
| `UPDATE notifications SET delivery_status = 'delivered', status = 'sent', delivery_attempts = delivery_attempts + 1, last_delivery_error = NULL WHERE id = $1 AND user_id = $2 AND delivery_status = 'pending' RETURNING id` | retry success | Finalizes only a claimed pending delivery | Retry success subtest checks state, attempt count, history, and audit; live Neon exercised |

The `UPDATE` template used for announcement delivery failure/success is two separate call sites (shown separately above); the inventory has 19 call sites total. The successful initial-email branch is the one remaining notification query call site without direct live Neon execution evidence. The test does cover successful retry, which uses a separate call site with the same SQL shape.

## Security and Compatibility

- Admin authentication comes from the existing PostgreSQL `requireAdmin` middleware in `app.js`; endpoint permission middleware requires `notifications.manage`.
- Notification list/read/history/retry paths use `req.admin.id`. Recipient IDs supplied by clients are not accepted.
- Announcement recipients are selected from active administrator role membership. Per-recipient idempotency keys prevent duplicate notifications and retries on duplicate requests do not send email again.
- Email configuration/sending use the existing `notificationServices` injection points; integration tests use a test sender and do not send real email.
- Invalid filters, missing records, cross-recipient access, unconfigured email, retry conflicts, provider failure, and an Amharic validation response are covered.
- An FK violation inside a Neon transaction verifies notification insert rollback; fixture cleanup deletes only rows matching this run's exact idempotency keys, with history deleted before notification rows.
- No database schema migration was required. Existing MySQL notification code and dependency remain unchanged.

## Test Results

- `RUN_NEON_INTEGRATION=true node --test backend/test/postgresAdminIntegration.test.js`: 8 passed, 0 failed, 0 skipped (7 notification endpoint subtests plus the existing admin workflow parent test).
- Existing notification/auth/RBAC unit tests: 20 passed, 0 failed, 0 skipped. The notification unit cases use injected in-memory executors and are not Neon evidence.
- Frontend tests: 172 passed, 0 failed; no dedicated frontend notification-only test file was found. The actual `AdminNotifications.jsx` endpoint paths/payloads were inspected.
- `npm --workspace backend run audit:postgres-queries`: 1,018 total calls, 18 infrastructure, 1,000 application calls not certified.
- The full backend suite was not rerun in this phase.
- Production was not accessed or changed.
