import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon customer complaints persist, enforce ownership, and store validated attachments', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 120000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const customerToken = randomUUID() + randomUUID();
  const otherCustomerToken = randomUUID() + randomUUID();
  const vendorToken = randomUUID() + randomUUID();
  const customerEmail = `pg-complaint-customer-${suffix}@example.invalid`;
  const otherCustomerEmail = `pg-complaint-other-${suffix}@example.invalid`;
  const vendorEmail = `pg-complaint-vendor-${suffix}@example.invalid`;
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  const userIds = [];
  const complaintIds = [];

  const cleanup = async () => {
    if (complaintIds.length) {
      const notifications = await database.runtimeAdapter.query(
        `SELECT id FROM notifications
         WHERE related_entity_type = 'complaint' AND related_entity_id = ANY($1::varchar[])`,
        [complaintIds.map(String)],
      );
      if (notifications.rowCount) {
        await database.runtimeAdapter.query(
          'DELETE FROM notification_history WHERE notification_id = ANY($1::bigint[])',
          [notifications.rows.map((row) => row.id)],
        );
        await database.runtimeAdapter.query(
          'DELETE FROM notifications WHERE id = ANY($1::bigint[])',
          [notifications.rows.map((row) => row.id)],
        );
      }
      await database.runtimeAdapter.query(
        `DELETE FROM audit_logs
         WHERE entity_type = 'complaint' AND entity_id = ANY($1::varchar[])`,
        [complaintIds.map(String)],
      );
      await database.runtimeAdapter.query(
        'DELETE FROM complaint_attachments WHERE complaint_id = ANY($1::bigint[])',
        [complaintIds],
      );
      await database.runtimeAdapter.query(
        'DELETE FROM complaint_history WHERE complaint_id = ANY($1::bigint[])',
        [complaintIds],
      );
      await database.runtimeAdapter.query('DELETE FROM complaints WHERE id = ANY($1::bigint[])', [complaintIds]);
    }
    if (userIds.length) {
      await database.runtimeAdapter.query('DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])', [userIds]);
      await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [userIds]);
      await database.runtimeAdapter.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
    }
  };

  try {
    await once(server, 'listening');
    const roles = await database.runtimeAdapter.query(
      `SELECT LOWER(name) AS name, id FROM roles
       WHERE LOWER(name) IN ('customer', 'vendor') AND is_active = TRUE`,
    );
    const roleIds = new Map(roles.rows.map((row) => [row.name, row.id]));
    assert.ok(roleIds.has('customer') && roleIds.has('vendor'), 'seeded customer and vendor roles must exist');
    const complaintSetting = await database.runtimeAdapter.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'notify_admin_complaints'",
    );
    const notifyAdmins = complaintSetting.rows[0]?.setting_value == null
      || ['true', '1'].includes(String(complaintSetting.rows[0].setting_value).toLowerCase());
    const adminUsers = notifyAdmins
      ? await database.runtimeAdapter.query(
        `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE`,
      )
      : { rows: [] };

    for (const [email, role, token, name] of [
      [customerEmail, 'customer', customerToken, 'Neon complaint customer'],
      [otherCustomerEmail, 'customer', otherCustomerToken, 'Neon complaint other customer'],
      [vendorEmail, 'vendor', vendorToken, 'Neon complaint vendor'],
    ]) {
      const user = await database.runtimeAdapter.query(
        `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
        [name, email, 'integration-only-not-a-password'],
      );
      const userId = user.rows[0].id;
      userIds.push(userId);
      await database.runtimeAdapter.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [userId, roleIds.get(role)],
      );
      await database.runtimeAdapter.query(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [hashToken(token), userId],
      );
    }

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cookie = (token) => `platform_session=${token}`;
    const request = (path, token, options = {}) => fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        Cookie: cookie(token),
        ...options.headers,
      },
    });

    const creation = await request('/api/customer/complaints', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Neon complaint evidence',
        details: 'Customer complaint creation and persistence verification.',
      }),
    });
    const creationBody = await creation.json();
    assert.equal(creation.status, 201, JSON.stringify(creationBody));
    const complaintId = creationBody.data.id;
    complaintIds.push(complaintId);
    assert.match(creationBody.data.reference, /^CMP-\d{6}$/);
    const complaintNotifications = await database.runtimeAdapter.query(
      `SELECT n.id, n.user_id, COUNT(h.id)::integer AS history_count FROM notifications n
       LEFT JOIN notification_history h ON h.notification_id = n.id
       WHERE n.related_entity_type = 'complaint' AND n.related_entity_id = $1
       GROUP BY n.id, n.user_id`,
      [String(complaintId)],
    );
    const complaintRecipientIds = new Set(complaintNotifications.rows.map((row) => String(row.user_id)));
    assert.ok(adminUsers.rows.every((admin) => complaintRecipientIds.has(String(admin.id))));
    assert.equal(complaintRecipientIds.size, complaintNotifications.rowCount);
    assert.ok(complaintNotifications.rows.every((row) => row.history_count === 1));
    const creationState = await database.runtimeAdapter.query(
      'SELECT action FROM complaint_history WHERE complaint_id = $1 ORDER BY id',
      [complaintId],
    );
    assert.deepEqual(creationState.rows.map((row) => row.action), ['created']);

    const unauthorizedRole = await request('/api/customer/complaints', vendorToken);
    assert.equal(unauthorizedRole.status, 403);
    assert.equal((await request(`/api/customer/complaints/${complaintId}`, otherCustomerToken)).status, 404);
    const list = await request('/api/customer/complaints', customerToken);
    assert.equal(list.status, 200);
    assert.ok((await list.json()).data.some((row) => row.id === complaintId));
    const detail = await request(`/api/customer/complaints/${complaintId}`, customerToken);
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.ok(Array.isArray(detailBody.data.history), JSON.stringify(detailBody));
    assert.equal(detailBody.data.history[0]?.action, 'created', JSON.stringify(detailBody));

    const missingBookingId = (await database.runtimeAdapter.query(
      'SELECT COALESCE(MAX(id), 0) + 1000000000 AS id FROM bookings',
    )).rows[0].id;
    const invalidBooking = await request('/api/customer/complaints', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        bookingId: Number(missingBookingId),
        subject: 'Invalid booking reference',
        details: 'This complaint must not be persisted.',
      }),
    });
    assert.equal(invalidBooking.status, 404);
    const rolledBack = await database.runtimeAdapter.query(
      `SELECT COUNT(*)::integer AS total FROM complaints
       WHERE user_id = $1 AND subject = 'Invalid booking reference'`,
      [userIds[0]],
    );
    assert.equal(rolledBack.rows[0].total, 0);

    const pdf = Buffer.from('%PDF-1.7\nNeon complaint attachment\n');
    const uploaded = await request(`/api/customer/complaints/${complaintId}/attachments?filename=proof.pdf`, customerToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf,
    });
    const uploadedBody = await uploaded.json();
    assert.equal(uploaded.status, 201, JSON.stringify(uploadedBody));
    const attachmentId = uploadedBody.data.id;
    const downloaded = await request(
      `/api/customer/complaints/${complaintId}/attachments/${attachmentId}`,
      customerToken,
    );
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
    assert.equal((await request(
      `/api/customer/complaints/${complaintId}/attachments/${attachmentId}`,
      otherCustomerToken,
    )).status, 404);

    const state = await database.runtimeAdapter.query(
      `SELECT c.status, h.action, a.file_size, a.sha256, al.action AS audit_action
       FROM complaints c
       JOIN complaint_history h ON h.complaint_id = c.id
       JOIN complaint_attachments a ON a.complaint_id = c.id
       JOIN audit_logs al ON al.entity_type = 'complaint' AND al.entity_id = c.id::varchar
       WHERE c.id = $1 AND h.action = 'attachment_added'
         AND al.action = 'complaint.attachment_added'`,
      [complaintId],
    );
    assert.equal(state.rowCount, 1);
    assert.equal(state.rows[0].status, 'open');
    assert.equal(state.rows[0].action, 'attachment_added');
    assert.equal(state.rows[0].file_size, pdf.length);
    assert.match(state.rows[0].sha256, /^[a-f0-9]{64}$/);

    console.log('Neon customer complaint, ownership, attachment, audit, and database-state integration passed.');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    try {
      await cleanup();
    } finally {
      await database.close();
    }
  }
});
