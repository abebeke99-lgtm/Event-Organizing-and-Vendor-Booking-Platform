import { Router } from 'express';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { getRequestId } from '../lib/requestContext.js';
import { sanitizeAuditDetails } from '../lib/auditSanitizer.js';
import { isNotificationEmailConfigured, sendNotificationEmail } from '../lib/notificationService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional().default(''),
  type: z.string().trim().max(60).optional().default(''),
  read: z.enum(['true', 'false']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortBy: z.enum(['created_at', 'title', 'notification_type', 'delivery_status']).default('created_at'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
}).strict();
const announcementSchema = z.object({
  title: z.string().trim().min(3).max(180).refine((value) => !/[\r\n]/.test(value)),
  message: z.string().trim().min(3).max(5000),
  channel: z.enum(['in_app', 'email']).default('in_app'),
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9._:-]{16,120}$/),
}).strict();
const idSchema = z.coerce.number().int().positive();
const relatedPaths = Object.freeze({
  booking: '/admin/bookings',
  event: '/admin/events',
  vendor: '/admin/vendors',
  complaint: '/admin/complaints',
  payment: '/admin/payments',
  review: '/admin/reviews',
  user: '/admin/users',
});

function sendError(req, res, status, english, amharic) {
  return res.status(status).json({ error: req.language === 'am' ? amharic : english });
}

function validDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function relatedUrl(type, id) {
  const base = relatedPaths[type];
  if (!base || !/^\d+$/.test(String(id || ''))) return null;
  return `${base}?focus=${encodeURIComponent(String(id))}`;
}

function notificationServices(req) {
  return req.app?.locals?.notificationServices || {};
}

async function writeAudit(transaction, req, { actorId, action, entityId, details }) {
  await transaction.query(
    `INSERT INTO audit_logs
       (actor_id, action, entity_type, entity_id, details, ip_address, request_id)
     VALUES ($1, $2, 'notification', $3, $4::jsonb, $5, $6)`,
    [
      actorId,
      action,
      String(entityId),
      JSON.stringify(sanitizeAuditDetails(details)),
      req.ip || null,
      getRequestId(),
    ],
  );
}

async function addHistory(transaction, { notificationId, actorId, action, details = null }) {
  await transaction.query(
    `INSERT INTO notification_history (notification_id, actor_id, action, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [notificationId, actorId, action, details === null ? null : JSON.stringify(details)],
  );
}

function safeDeliveryError(error) {
  return String(error?.code || error?.name || 'EMAIL_DELIVERY_FAILED').slice(0, 100);
}

export function createPostgresAdminNotificationsRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/notifications/options', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
    const services = notificationServices(req);
    const configured = services.emailConfigured || isNotificationEmailConfigured;
    return res.json({ data: { channels: ['in_app', ...(configured() ? ['email'] : [])] } });
  }));

  router.get('/notifications', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
    const parsed = pageSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(req, res, 400, 'Notification filters are invalid.', 'የማሳወቂያ ማጣሪያዎች ትክክል አይደሉም።');
    }
    const { page, pageSize, q, type, read, dateFrom, dateTo, sortBy, sortDirection } = parsed.data;
    if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo))) {
      return sendError(req, res, 400, 'Enter a valid notification date.', 'ትክክለኛ የማሳወቂያ ቀን ያስገቡ።');
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return sendError(req, res, 400, 'The start date must be on or before the end date.', 'የመጀመሪያው ቀን ከመጨረሻው ቀን በፊት ወይም እኩል መሆን አለበት።');
    }

    const values = [req.admin.id];
    const conditions = ['n.user_id = $1'];
    if (q) {
      values.push(`%${q}%`, `%${q}%`);
      conditions.push(`(n.title ILIKE $${values.length - 1} OR n.message ILIKE $${values.length})`);
    }
    if (type) {
      values.push(type);
      conditions.push(`n.notification_type = $${values.length}`);
    }
    if (read !== undefined) conditions.push(read === 'true' ? "n.status = 'read'" : "n.status <> 'read'");
    if (dateFrom) {
      values.push(dateFrom);
      conditions.push(`n.created_at >= ($${values.length}::date::timestamp AT TIME ZONE 'UTC')`);
    }
    if (dateTo) {
      values.push(dateTo);
      conditions.push(`n.created_at < (($${values.length}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`);
    }
    const where = conditions.join(' AND ');
    const count = await database.query(
      `SELECT COUNT(*)::integer AS total FROM notifications n WHERE ${where}`,
      values,
    );
    const unread = await database.query(
      "SELECT COUNT(*)::integer AS unread FROM notifications WHERE user_id = $1 AND status <> 'read'",
      [req.admin.id],
    );
    const pageValues = [...values, pageSize, (page - 1) * pageSize];
    const rows = await database.query(
      `SELECT n.id, n.title, n.message, n.notification_type, n.related_entity_type, n.related_entity_id,
              n.status, n.read_at, n.delivery_channel, n.delivery_status, n.delivery_attempts,
              n.last_delivery_error, n.created_at
       FROM notifications n WHERE ${where}
       ORDER BY n.${sortBy} ${sortDirection.toUpperCase()}, n.id DESC
       LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues,
    );
    return res.json({
      data: rows.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        read: row.status === 'read',
        relatedUrl: relatedUrl(row.related_entity_type, row.related_entity_id),
      })),
      pagination: { page, pageSize, total: Number(count.rows[0]?.total || 0) },
      unreadCount: Number(unread.rows[0]?.unread || 0),
    });
  }));

  router.post('/notifications/:id/read', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      return sendError(req, res, 400, 'A valid notification ID is required.', 'ትክክለኛ የማሳወቂያ መለያ ያስፈልጋል።');
    }
    const result = await database.inTransaction(async (transaction) => {
      const changed = await transaction.query(
        `UPDATE notifications
         SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
         WHERE id = $1 AND user_id = $2 AND status <> 'read'
         RETURNING id`,
        [id.data, req.admin.id],
      );
      if (changed.rowCount) {
        await addHistory(transaction, { notificationId: id.data, actorId: req.admin.id, action: 'read' });
        return { changed: true };
      }
      const owned = await transaction.query(
        'SELECT id FROM notifications WHERE id = $1 AND user_id = $2',
        [id.data, req.admin.id],
      );
      return owned.rowCount ? { changed: false } : { notFound: true };
    });
    if (result.notFound) {
      return sendError(req, res, 404, 'Notification not found.', 'ማሳወቂያው አልተገኘም።');
    }
    return res.json({ data: { id: id.data, read: true, changed: result.changed } });
  }));

  router.post('/notifications/read-all', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
    const changed = await database.inTransaction(async (transaction) => {
      const result = await transaction.query(
        `WITH changed AS (
           UPDATE notifications
           SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
           WHERE user_id = $1 AND status <> 'read'
           RETURNING id
         ), logged AS (
           INSERT INTO notification_history (notification_id, actor_id, action)
           SELECT id, $1, 'read' FROM changed
           RETURNING notification_id
         )
         SELECT COUNT(*)::integer AS changed FROM changed`,
        [req.admin.id],
      );
      return Number(result.rows[0]?.changed || 0);
    });
    return res.json({ data: { changed } });
  }));

  router.get('/notifications/:id/history', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      return sendError(req, res, 400, 'A valid notification ID is required.', 'ትክክለኛ የማሳወቂያ መለያ ያስፈልጋል።');
    }
    const owned = await database.query(
      'SELECT id FROM notifications WHERE id = $1 AND user_id = $2',
      [id.data, req.admin.id],
    );
    if (!owned.rowCount) {
      return sendError(req, res, 404, 'Notification not found.', 'ማሳወቂያው አልተገኘም።');
    }
    const history = await database.query(
      `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.details, h.created_at
       FROM notification_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.notification_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
      [id.data],
    );
    return res.json({ data: history.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      actor_id: row.actor_id === null ? null : Number(row.actor_id),
    })) });
  }));

  router.post('/notifications/announcements', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
    const parsed = announcementSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return sendError(req, res, 400,
        'Provide a valid announcement title, message, channel, and idempotency key.',
        'ትክክለኛ የማስታወቂያ ርዕስ፣ መልዕክት፣ ቻናል እና የድግግሞሽ መከላከያ ቁልፍ ያስገቡ።');
    }
    const services = notificationServices(req);
    const emailConfigured = services.emailConfigured || isNotificationEmailConfigured;
    if (parsed.data.channel === 'email' && !emailConfigured()) {
      return sendError(req, res, 503, 'Email notifications are not configured.', 'የኢሜይል ማሳወቂያዎች አልተዋቀሩም።');
    }

    const announcement = await database.inTransaction(async (transaction) => {
      const idempotencyPrefix = `announcement:${parsed.data.idempotencyKey}:`;
      await transaction.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`admin-announcement:${parsed.data.idempotencyKey}`],
      );
      const existing = await transaction.query(
        `SELECT n.id, n.user_id AS recipient_id, n.title, n.message, n.delivery_channel,
                n.delivery_status, u.email
         FROM notifications n LEFT JOIN users u ON u.id = n.user_id
         WHERE LEFT(n.idempotency_key, CHAR_LENGTH($1)) = $1
         ORDER BY n.id`,
        [idempotencyPrefix],
      );
      if (existing.rowCount) {
        const payloadMatches = existing.rows.every((row) => (
          row.title === parsed.data.title
          && row.message === parsed.data.message
          && row.delivery_channel === parsed.data.channel
        ));
        if (!payloadMatches) return { conflict: true };
        return {
          recipients: existing.rows.map((row) => ({
            id: Number(row.id),
            recipientId: row.recipient_id === null ? null : Number(row.recipient_id),
            email: row.email,
            alreadyExists: true,
            deliveryStatus: row.delivery_status || 'pending',
          })),
        };
      }

      const admins = await transaction.query(
        `SELECT DISTINCT u.id, u.email
         FROM users u JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
         ORDER BY u.id`,
      );
      const created = [];
      for (const recipient of admins.rows) {
        const key = `announcement:${parsed.data.idempotencyKey}:${recipient.id}`;
        const insert = await transaction.query(
          `INSERT INTO notifications
             (user_id, title, message, notification_type, idempotency_key, delivery_channel, delivery_status)
           VALUES ($1, $2, $3, 'announcement', $4, $5, $6)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [recipient.id, parsed.data.title, parsed.data.message, key, parsed.data.channel,
            parsed.data.channel === 'in_app' ? 'delivered' : 'pending'],
        );
        if (insert.rowCount) {
          const notificationId = insert.rows[0].id;
          await addHistory(transaction, {
            notificationId,
            actorId: req.admin.id,
            action: 'created',
            details: { source: 'announcement', channel: parsed.data.channel },
          });
          await writeAudit(transaction, req, {
            actorId: req.admin.id,
            action: 'notification.announcement_created',
            entityId: notificationId,
            details: { channel: parsed.data.channel, recipientId: Number(recipient.id) },
          });
          created.push({ id: Number(notificationId), recipientId: Number(recipient.id), email: recipient.email });
          continue;
        }
        const existing = await transaction.query(
          'SELECT id, delivery_status FROM notifications WHERE idempotency_key = $1 AND user_id = $2',
          [key, recipient.id],
        );
        if (!existing.rowCount) throw new Error('Notification idempotency record could not be resolved.');
        created.push({
          id: Number(existing.rows[0].id),
          recipientId: Number(recipient.id),
          email: recipient.email,
          alreadyExists: true,
          deliveryStatus: existing.rows[0].delivery_status || 'pending',
        });
      }
      return { recipients: created };
    });
    if (announcement.conflict) {
      return sendError(
        req,
        res,
        409,
        'This idempotency key was already used for a different announcement.',
        'ይህ የድግግሞሽ መከላከያ ቁልፍ ለተለየ ማስታወቂያ አስቀድሞ ተጠቅሟል።',
      );
    }

    const outcomes = [];
    for (const notification of announcement.recipients) {
      if (notification.alreadyExists) {
        outcomes.push({ id: notification.id, deliveryStatus: notification.deliveryStatus, alreadyExists: true });
        continue;
      }
      if (parsed.data.channel === 'in_app') {
        outcomes.push({ id: notification.id, deliveryStatus: 'delivered' });
        continue;
      }
      let delivery;
      try {
        const sender = services.emailSender || sendNotificationEmail;
        delivery = await sender({ email: notification.email, title: parsed.data.title, message: parsed.data.message });
      } catch (error) {
        const safeError = safeDeliveryError(error);
        await database.inTransaction(async (transaction) => {
          const update = await transaction.query(
            `UPDATE notifications
             SET delivery_status = 'failed', status = 'failed', delivery_attempts = delivery_attempts + 1,
                 last_delivery_error = $1
             WHERE id = $2 AND user_id = $3 AND delivery_status = 'pending'
             RETURNING id`,
            [safeError, notification.id, notification.recipientId],
          );
          if (update.rowCount) {
            await addHistory(transaction, {
              notificationId: notification.id,
              actorId: req.admin.id,
              action: 'email_failed',
              details: { error: safeError },
            });
          }
        });
        outcomes.push({ id: notification.id, deliveryStatus: 'failed' });
        continue;
      }
      await database.inTransaction(async (transaction) => {
        const update = await transaction.query(
          `UPDATE notifications
           SET delivery_status = 'delivered', status = 'sent', delivery_attempts = delivery_attempts + 1,
               last_delivery_error = NULL
           WHERE id = $1 AND user_id = $2 AND delivery_status = 'pending'
           RETURNING id`,
          [notification.id, notification.recipientId],
        );
        if (update.rowCount) {
          await addHistory(transaction, {
            notificationId: notification.id,
            actorId: req.admin.id,
            action: 'email_delivered',
            details: { providerMessageId: delivery?.messageId || null },
          });
        }
      });
      outcomes.push({ id: notification.id, deliveryStatus: 'delivered' });
    }
    const newlyCreated = outcomes.filter((outcome) => !outcome.alreadyExists).length;
    return res.status(newlyCreated ? 201 : 200).json({
      data: { created: newlyCreated, idempotencyKey: parsed.data.idempotencyKey, deliveries: outcomes },
    });
  }));

  router.post('/notifications/:id/retry', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      return sendError(req, res, 400, 'A valid notification ID is required.', 'ትክክለኛ የማሳወቂያ መለያ ያስፈልጋል።');
    }
    const services = notificationServices(req);
    const emailConfigured = services.emailConfigured || isNotificationEmailConfigured;
    if (!emailConfigured()) {
      return sendError(req, res, 503, 'Email notifications are not configured.', 'የኢሜይል ማሳወቂያዎች አልተዋቀሩም።');
    }

    const claim = await database.inTransaction(async (transaction) => {
      const result = await transaction.query(
        `SELECT n.id, n.title, n.message, n.delivery_status, n.delivery_channel, u.email
         FROM notifications n JOIN users u ON u.id = n.user_id
         WHERE n.id = $1 AND n.user_id = $2 FOR UPDATE OF n`,
        [id.data, req.admin.id],
      );
      const notification = result.rows[0];
      if (!notification) return { notFound: true };
      if (notification.delivery_channel !== 'email' || notification.delivery_status !== 'failed') {
        return { conflict: true };
      }
      const updated = await transaction.query(
        `UPDATE notifications SET delivery_status = 'pending'
         WHERE id = $1 AND user_id = $2 AND delivery_channel = 'email' AND delivery_status = 'failed'
         RETURNING id`,
        [id.data, req.admin.id],
      );
      if (!updated.rowCount) return { conflict: true };
      await addHistory(transaction, {
        notificationId: id.data,
        actorId: req.admin.id,
        action: 'email_retry_started',
        details: { retry: true },
      });
      return { notification };
    });
    if (claim.notFound) return sendError(req, res, 404, 'Notification not found.', 'ማሳወቂያው አልተገኘም።');
    if (claim.conflict) {
      return sendError(req, res, 409, 'Only failed email deliveries can be retried.', 'የተሳኩ ያልሆኑ የኢሜይል ማድረሻዎች ብቻ እንደገና ሊሞከሩ ይችላሉ።');
    }

    const notification = claim.notification;
    let delivery;
    try {
      const sender = services.emailSender || sendNotificationEmail;
      delivery = await sender({ email: notification.email, title: notification.title, message: notification.message });
    } catch (error) {
      const safeError = safeDeliveryError(error);
      await database.inTransaction(async (transaction) => {
        const update = await transaction.query(
          `UPDATE notifications
           SET delivery_status = 'failed', status = 'failed',
               delivery_attempts = delivery_attempts + 1, last_delivery_error = $1
           WHERE id = $2 AND user_id = $3 AND delivery_status = 'pending'
           RETURNING id`,
          [safeError, id.data, req.admin.id],
        );
        if (update.rowCount) {
          await addHistory(transaction, {
            notificationId: id.data,
            actorId: req.admin.id,
            action: 'email_failed',
            details: { error: safeError, retry: true },
          });
        }
      });
      return sendError(req, res, 502,
        'The email provider did not confirm delivery. The notification remains eligible for retry.',
        'የኢሜይል አቅራቢው መድረሱን አላረጋገጠም። ማሳወቂያው እንደገና ሊሞከር ይችላል።');
    }
    const updated = await database.inTransaction(async (transaction) => {
      const result = await transaction.query(
        `UPDATE notifications
         SET delivery_status = 'delivered', status = 'sent', delivery_attempts = delivery_attempts + 1,
             last_delivery_error = NULL
         WHERE id = $1 AND user_id = $2 AND delivery_status = 'pending'
         RETURNING id`,
        [id.data, req.admin.id],
      );
      if (!result.rowCount) return false;
      await addHistory(transaction, {
        notificationId: id.data,
        actorId: req.admin.id,
        action: 'email_delivered',
        details: { providerMessageId: delivery?.messageId || null, retry: true },
      });
      await writeAudit(transaction, req, {
        actorId: req.admin.id,
        action: 'notification.delivery_retried',
        entityId: id.data,
        details: { result: 'delivered' },
      });
      return true;
    });
    if (!updated) {
      return sendError(req, res, 409, 'This email delivery is no longer eligible for retry.', 'ይህ የኢሜይል ማድረሻ እንደገና ለመሞከር ብቁ አይደለም።');
    }
    return res.json({ data: { id: id.data, deliveryStatus: 'delivered' } });
  }));

  return router;
}