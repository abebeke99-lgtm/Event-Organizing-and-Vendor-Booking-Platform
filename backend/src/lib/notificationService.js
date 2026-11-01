import nodemailer from 'nodemailer';
import { getPasswordResetEmailConfig } from './passwordResetEmail.js';
import { loadSystemSettings } from './systemSettings.js';

export async function createNotification(database, {
  userId,
  title,
  message,
  type = 'system',
  relatedType = null,
  relatedId = null,
  idempotencyKey = null,
  channel = 'in_app',
  actorId = null,
}) {
  const [result] = await database.execute(
    `INSERT INTO notifications
       (user_id, title, message, notification_type, related_entity_type, related_entity_id,
        idempotency_key, delivery_channel, delivery_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [userId, title, message, type, relatedType, relatedId === null ? null : String(relatedId),
      idempotencyKey, channel, channel === 'in_app' ? 'delivered' : 'pending'],
  );
  const notification = { id: Number(result.insertId), created: Number(result.affectedRows) === 1 };
  if (notification.created) {
    await database.execute(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES (?, ?, 'created', ?)`,
      [notification.id, actorId, JSON.stringify({ source: type, channel })],
    );
  }
  return notification;
}

export async function notifyAdministrators(database, {
  title,
  message,
  type,
  relatedType = null,
  relatedId = null,
  idempotencyKey,
  actorId = null,
}) {
  const notificationPreference = {
    user_registration: 'notify_admin_user_registrations',
    vendor_verification: 'notify_admin_vendor_applications',
    complaint: 'notify_admin_complaints',
  }[type];
  if (notificationPreference) {
    const preferences = await loadSystemSettings(database, [notificationPreference]);
    if (!preferences[notificationPreference]) return [];
  }
  const [admins] = await database.execute(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE`,
  );
  const notifications = [];
  for (const admin of admins) {
    const notification = await createNotification(database, {
      userId: admin.id,
      title,
      message,
      type,
      relatedType,
      relatedId,
      idempotencyKey: `${idempotencyKey}:${admin.id}`,
      actorId,
    });
    notifications.push(notification.id);
  }
  return notifications;
}

export function isNotificationEmailConfigured(environment = process.env) {
  return Boolean(getPasswordResetEmailConfig(environment));
}

export async function sendNotificationEmail({ email, title, message }, environment = process.env) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Notification email is not configured.');

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
  });
  const result = await transporter.sendMail({
    from: config.from,
    to: email,
    subject: title,
    text: message,
  });
  const accepted = (result.accepted || []).some((address) => {
    const value = typeof address === 'string' ? address : address.address;
    return String(value || '').toLowerCase() === email.toLowerCase();
  });
  if (!accepted || result.rejected?.length) throw new Error('Email provider did not accept the notification.');
  return { messageId: result.messageId || null };
}
