import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { createNotification, isNotificationEmailConfigured, sendNotificationEmail } from '../lib/notificationService.js';
import { writeAudit } from '../lib/security.js';

const router = Router();
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

const databaseFor = (req) => req.app?.locals?.database;
const notificationServices = (req) => req.app?.locals?.notificationServices || {};

async function transaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function relatedUrl(type, id) {
  const base = relatedPaths[type];
  if (!base || !/^\d+$/.test(String(id || ''))) return null;
  return `${base}?focus=${encodeURIComponent(String(id))}`;
}

router.get('/notifications/options', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
  const services = notificationServices(req);
  const configured = services.emailConfigured || isNotificationEmailConfigured;
  res.json({ data: { channels: ['in_app', ...(configured() ? ['email'] : [])] } });
}));

router.get('/notifications', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Notification filters are invalid.' });
  const { page, pageSize, q, type, read, dateFrom, dateTo, sortBy, sortDirection } = parsed.data;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return res.status(400).json({ error: 'The start date must be on or before the end date.' });
  }
  const database = databaseFor(req);
  const values = [req.admin.id];
  const conditions = ['n.user_id = ?'];
  if (q) {
    conditions.push('(n.title LIKE ? OR n.message LIKE ?)');
    values.push(`%${q}%`, `%${q}%`);
  }
  if (type) {
    conditions.push('n.notification_type = ?');
    values.push(type);
  }
  if (read !== undefined) conditions.push(read === 'true' ? "n.status = 'read'" : "n.status <> 'read'");
  if (dateFrom) {
    conditions.push('n.created_at >= ?');
    values.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    conditions.push('n.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(dateTo);
  }
  const where = conditions.join(' AND ');
  const [countRows] = await database.execute(
    `SELECT COUNT(*) AS total FROM notifications n WHERE ${where}`,
    values,
  );
  const [[unreadRow]] = await database.execute(
    "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND status <> 'read'",
    [req.admin.id],
  );
  const [rows] = await database.execute(
    `SELECT n.id, n.title, n.message, n.notification_type, n.related_entity_type, n.related_entity_id,
            n.status, n.read_at, n.delivery_channel, n.delivery_status, n.delivery_attempts,
            n.last_delivery_error, n.created_at
     FROM notifications n WHERE ${where}
     ORDER BY n.${sortBy} ${sortDirection.toUpperCase()}, n.id DESC LIMIT ? OFFSET ?`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  res.json({
    data: rows.map((row) => ({
      ...row,
      id: Number(row.id),
      read: row.status === 'read',
      relatedUrl: relatedUrl(row.related_entity_type, row.related_entity_id),
    })),
    pagination: { page, pageSize, total: Number(countRows[0]?.total || 0) },
    unreadCount: Number(unreadRow?.unread || 0),
  });
}));

router.post('/notifications/:id/read', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid notification ID is required.' });
  const database = databaseFor(req);
  const changed = await transaction(database, async (connection) => {
    const [result] = await connection.execute(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ? AND status <> 'read'`,
      [id.data, req.admin.id],
    );
    if (result.affectedRows) {
      await connection.execute(
        `INSERT INTO notification_history (notification_id, actor_id, action)
         VALUES (?, ?, 'read')`,
        [id.data, req.admin.id],
      );
    } else {
      const [rows] = await connection.execute(
        'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
        [id.data, req.admin.id],
      );
      if (!rows.length) return { notFound: true };
    }
    return Boolean(result.affectedRows);
  });
  if (changed?.notFound) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ data: { id: id.data, read: true, changed } });
}));

router.post('/notifications/read-all', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
  const database = databaseFor(req);
  const changed = await transaction(database, async (connection) => {
    await connection.execute(
      `INSERT INTO notification_history (notification_id, actor_id, action)
       SELECT id, ?, 'read' FROM notifications
       WHERE user_id = ? AND status <> 'read'`,
      [req.admin.id, req.admin.id],
    );
    const [result] = await connection.execute(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE user_id = ? AND status <> 'read'`,
      [req.admin.id],
    );
    return Number(result.affectedRows || 0);
  });
  res.json({ data: { changed } });
}));

router.get('/notifications/:id/history', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid notification ID is required.' });
  const database = databaseFor(req);
  const [owned] = await database.execute(
    'SELECT id FROM notifications WHERE id = ? AND user_id = ? LIMIT 1',
    [id.data, req.admin.id],
  );
  if (!owned.length) return res.status(404).json({ error: 'Notification not found.' });
  const [rows] = await database.execute(
    `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.details, h.created_at
     FROM notification_history h LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.notification_id = ? ORDER BY h.created_at DESC, h.id DESC`,
    [id.data],
  );
  res.json({ data: rows });
}));

router.post('/notifications/announcements', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
  const parsed = announcementSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Provide a valid announcement title, message, channel, and idempotency key.' });
  const services = notificationServices(req);
  const emailConfigured = services.emailConfigured || isNotificationEmailConfigured;
  if (parsed.data.channel === 'email' && !emailConfigured()) {
    return res.status(503).json({ error: 'Email notifications are not configured.' });
  }
  const database = databaseFor(req);
  const recipients = await transaction(database, async (connection) => {
    const [admins] = await connection.execute(
      `SELECT DISTINCT u.id, u.email
       FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
       ORDER BY u.id`,
    );
    const created = [];
    for (const recipient of admins) {
      const key = `announcement:${parsed.data.idempotencyKey}:${recipient.id}`;
      const notification = await createNotification(connection, {
        userId: recipient.id,
        title: parsed.data.title,
        message: parsed.data.message,
        type: 'announcement',
        idempotencyKey: key,
        channel: parsed.data.channel,
        actorId: req.admin.id,
      });
      if (notification.created) {
        await writeAudit(connection, {
          actorId: req.admin.id,
          action: 'notification.announcement_created',
          entityType: 'notification',
          entityId: notification.id,
          details: { channel: parsed.data.channel, recipientId: Number(recipient.id) },
          ip: req.ip,
        });
        created.push({ id: notification.id, recipientId: Number(recipient.id), email: recipient.email });
      } else {
        const [existing] = await connection.execute(
          'SELECT delivery_status FROM notifications WHERE id = ? AND user_id = ?',
          [notification.id, recipient.id],
        );
        created.push({
          id: notification.id,
          recipientId: Number(recipient.id),
          email: recipient.email,
          alreadyExists: true,
          deliveryStatus: existing[0]?.delivery_status || 'pending',
        });
      }
    }
    return created;
  });

  const outcomes = [];
  for (const notification of recipients) {
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
      delivery = await sender({
        email: notification.email,
        title: parsed.data.title,
        message: parsed.data.message,
      });
    } catch (error) {
      const safeError = String(error?.code || error?.name || 'EMAIL_DELIVERY_FAILED').slice(0, 100);
      await database.execute(
        `UPDATE notifications
         SET delivery_status = 'failed', status = 'failed', delivery_attempts = delivery_attempts + 1,
             last_delivery_error = ?
         WHERE id = ? AND user_id = ?`,
        [safeError, notification.id, notification.recipientId],
      );
      await database.execute(
        `INSERT INTO notification_history (notification_id, actor_id, action, details)
         VALUES (?, ?, 'email_failed', JSON_OBJECT('error', ?))`,
        [notification.id, req.admin.id, safeError],
      );
      outcomes.push({ id: notification.id, deliveryStatus: 'failed' });
      continue;
    }
    await database.execute(
      `UPDATE notifications
       SET delivery_status = 'delivered', status = 'sent', delivery_attempts = delivery_attempts + 1,
           last_delivery_error = NULL
       WHERE id = ? AND user_id = ?`,
      [notification.id, notification.recipientId],
    );
    await database.execute(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES (?, ?, 'email_delivered', JSON_OBJECT('providerMessageId', ?))`,
      [notification.id, req.admin.id, delivery?.messageId || null],
    );
    outcomes.push({ id: notification.id, deliveryStatus: 'delivered' });
  }
  const newlyCreated = outcomes.filter((outcome) => !outcome.alreadyExists).length;
  res.status(newlyCreated ? 201 : 200).json({
    data: {
      created: newlyCreated,
      idempotencyKey: parsed.data.idempotencyKey,
      deliveries: outcomes,
    },
  });
}));

router.post('/notifications/:id/retry', requirePermission('notifications.manage'), asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid notification ID is required.' });
  const database = databaseFor(req);
  const services = notificationServices(req);
  const emailConfigured = services.emailConfigured || isNotificationEmailConfigured;
  if (!emailConfigured()) return res.status(503).json({ error: 'Email notifications are not configured.' });
  const [rows] = await database.execute(
    `SELECT n.id, n.title, n.message, n.delivery_status, n.delivery_channel, u.email
     FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.id = ? AND n.user_id = ? LIMIT 1`,
    [id.data, req.admin.id],
  );
  const notification = rows[0];
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  if (notification.delivery_channel !== 'email' || notification.delivery_status !== 'failed') {
    return res.status(409).json({ error: 'Only failed email deliveries can be retried.' });
  }
  const [claim] = await database.execute(
    `UPDATE notifications SET delivery_status = 'pending'
     WHERE id = ? AND user_id = ? AND delivery_channel = 'email' AND delivery_status = 'failed'`,
    [id.data, req.admin.id],
  );
  if (!claim.affectedRows) return res.status(409).json({ error: 'This email delivery is no longer eligible for retry.' });
  let delivery;
  try {
    const sender = services.emailSender || sendNotificationEmail;
    delivery = await sender({ email: notification.email, title: notification.title, message: notification.message });
  } catch (error) {
    const safeError = String(error?.code || error?.name || 'EMAIL_DELIVERY_FAILED').slice(0, 100);
    await database.execute(
      `UPDATE notifications
       SET delivery_status = 'failed', status = 'failed',
           delivery_attempts = delivery_attempts + 1, last_delivery_error = ?
       WHERE id = ? AND user_id = ? AND delivery_status = 'pending'`,
      [safeError, id.data, req.admin.id],
    );
    await database.execute(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES (?, ?, 'email_failed', JSON_OBJECT('error', ?, 'retry', TRUE))`,
      [id.data, req.admin.id, safeError],
    );
    return res.status(502).json({ error: 'The email provider did not confirm delivery. The notification remains eligible for retry.' });
  }
  await database.execute(
    `UPDATE notifications
     SET delivery_status = 'delivered', status = 'sent', delivery_attempts = delivery_attempts + 1,
         last_delivery_error = NULL
     WHERE id = ? AND user_id = ? AND delivery_status = 'pending'`,
    [id.data, req.admin.id],
  );
  await database.execute(
    `INSERT INTO notification_history (notification_id, actor_id, action, details)
     VALUES (?, ?, 'email_delivered', JSON_OBJECT('providerMessageId', ?, 'retry', TRUE))`,
    [id.data, req.admin.id, delivery?.messageId || null],
  );
  await writeAudit(database, {
    actorId: req.admin.id,
    action: 'notification.delivery_retried',
    entityType: 'notification',
    entityId: id.data,
    details: { result: 'delivered' },
    ip: req.ip,
  });
  return res.json({ data: { id: id.data, deliveryStatus: 'delivered' } });
}));

export default router;
