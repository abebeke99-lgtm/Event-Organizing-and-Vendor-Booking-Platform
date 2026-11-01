import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'admin-notifications-test-session';
const records = new Map();
const statements = [];
let nextId = 100;
let sendEmail = async () => ({ messageId: 'provider-1' });
let emailConfigured = false;

async function execute(sql, values = []) {
  statements.push({ sql, values });
  if (sql.includes('FROM admin_sessions s')) {
    return [values[0] === hashToken(adminToken) ? [{
      id: 1, full_name: 'Platform Admin', email: 'admin@example.test',
      phone: null, status: 'active', roles: 'Admin',
    }] : []];
  }
  if (sql.includes('COUNT(*) AS total FROM notifications')) return [[{ total: records.size }]];
  if (sql.includes('COUNT(*) AS unread FROM notifications')) {
    return [[{ unread: [...records.values()].filter((row) => row.user_id === Number(values[0]) && row.status !== 'read').length }]];
  }
  if (sql.startsWith('SELECT n.id, n.title, n.message, n.notification_type')) {
    return [[...records.values()].filter((row) => row.user_id === Number(values[0]) || !sql.includes('n.user_id = ?'))
      .map((row) => ({ ...row }))];
  }
  if (sql.startsWith('SELECT DISTINCT u.id, u.email')) return [[
    { id: 1, email: 'admin@example.test' },
    { id: 2, email: 'second-admin@example.test' },
  ]];
  if (sql.startsWith('SELECT delivery_status FROM notifications')) {
    const row = [...records.values()].find((item) => item.id === Number(values[0]) && item.user_id === Number(values[1]));
    return [row ? [{ delivery_status: row.delivery_status }] : []];
  }
  if (sql.startsWith('SELECT n.id, n.title, n.message, n.delivery_status')) {
    const row = records.get(Number(values[0]));
    return [row && row.user_id === Number(values[1]) ? [{ ...row, email: 'admin@example.test' }] : []];
  }
  if (sql.startsWith('SELECT id FROM notifications WHERE id = ? AND user_id = ?')) {
    const row = records.get(Number(values[0]));
    return [row && row.user_id === Number(values[1]) ? [{ id: row.id }] : []];
  }
  if (sql.startsWith('SELECT h.id')) return [[]];
  if (sql.startsWith('INSERT INTO notifications')) {
    const key = values[6];
    const existing = key && [...records.values()].find((row) => row.idempotency_key === key);
    if (existing) return [{ insertId: existing.id, affectedRows: 0 }];
    const id = nextId++;
    records.set(id, {
      id, user_id: Number(values[0]), title: values[1], message: values[2],
      notification_type: values[3], related_entity_type: values[4], related_entity_id: values[5],
      idempotency_key: key, delivery_channel: values[7], delivery_status: values[8],
      delivery_attempts: 0, status: 'queued', created_at: '2026-11-01 10:00:00',
    });
    return [{ insertId: id, affectedRows: 1 }];
  }
  if (sql.startsWith("UPDATE notifications SET status = 'read'")) {
    const id = Number(values[0]);
    const row = records.get(id);
    if (!row || row.user_id !== Number(values[1]) || row.status === 'read') return [{ affectedRows: 0 }];
    row.status = 'read';
    row.read_at = '2026-11-02 10:00:00';
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith("UPDATE notifications SET delivery_status = 'pending'")) {
    const row = records.get(Number(values[0]));
    if (!row || row.user_id !== Number(values[1]) || row.delivery_status !== 'failed') return [{ affectedRows: 0 }];
    row.delivery_status = 'pending';
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('UPDATE notifications')) {
    const id = Number(values[values.length - 2]);
    const row = records.get(id);
    if (row) {
      if (sql.includes("delivery_status = 'delivered'")) row.delivery_status = 'delivered';
      if (sql.includes("delivery_status = 'failed'")) row.delivery_status = 'failed';
      row.status = sql.includes("status = 'sent'") ? 'sent' : 'failed';
      row.delivery_attempts += 1;
    }
    return [{ affectedRows: row ? 1 : 0 }];
  }
  return [{ insertId: 1, affectedRows: 1 }];
}

const database = {
  execute,
  async query() { return [[], []]; },
  async getConnection() {
    return {
      execute,
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
    };
  },
};
const app = createApp({
  database,
  notificationEmailConfigured: () => emailConfigured,
  notificationEmailSender: (...args) => sendEmail(...args),
});
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

function adminRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `admin_session=${adminToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

test('notification center requires an authenticated administrator', async () => {
  assert.equal((await fetch(`${baseUrl}/api/admin/notifications`)).status, 401);
});

test('notification history is recipient-scoped and only configured channels are advertised', async () => {
  const options = await adminRequest('/api/admin/notifications/options');
  assert.deepEqual((await options.json()).data.channels, ['in_app']);
  emailConfigured = true;
  const configured = await adminRequest('/api/admin/notifications/options');
  assert.deepEqual((await configured.json()).data.channels, ['in_app', 'email']);
  emailConfigured = false;
});

test('admin notification listing is recipient-scoped and returns filters, read state, and related links', async () => {
  records.set(10, {
    id: 10, user_id: 1, title: 'Complaint needs review', message: 'New complaint',
    notification_type: 'complaint', related_entity_type: 'complaint', related_entity_id: '44',
    status: 'queued', read_at: null, delivery_channel: 'in_app', delivery_status: 'delivered',
    delivery_attempts: 0, last_delivery_error: null, created_at: '2026-11-01 10:00:00',
  });
  records.set(11, {
    id: 11, user_id: 2, title: 'Private notice', message: 'Other admin only',
    notification_type: 'system', related_entity_type: null, related_entity_id: null,
    status: 'queued', read_at: null, delivery_channel: 'in_app', delivery_status: 'delivered',
    delivery_attempts: 0, last_delivery_error: null, created_at: '2026-11-01 10:00:00',
  });
  const response = await adminRequest('/api/admin/notifications?type=complaint&read=false&sortBy=title&sortDirection=asc');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, 10);
  assert.equal(result.data[0].relatedUrl, '/admin/complaints?focus=44');
  assert.ok(statements.some(({ sql, values }) => sql.includes('n.user_id = ?') && values.includes(1)));
  const history = await adminRequest('/api/admin/notifications/10/history');
  assert.equal(history.status, 200);
  assert.ok(statements.some(({ sql, values }) => sql.includes('WHERE id = ? AND user_id = ?') && values[1] === 1));
});

test('mark-read rejects another administrator’s notification and marks owned rows read', async () => {
  const forbidden = await adminRequest('/api/admin/notifications/11/read', { method: 'POST' });
  assert.equal(forbidden.status, 404);
  const response = await adminRequest('/api/admin/notifications/10/read', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(records.get(10).status, 'read');
  assert.ok(statements.some(({ sql }) => sql.includes("VALUES (?, ?, 'read')")));
});

test('announcements are stored once per administrator and deduplicate by idempotency key', async () => {
  const payload = {
    title: 'Maintenance notice',
    message: 'The service will be unavailable briefly.',
    channel: 'in_app',
    idempotencyKey: 'announce-maintenance-0001',
  };
  const first = await adminRequest('/api/admin/notifications/announcements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).data.created, 2);
  const second = await adminRequest('/api/admin/notifications/announcements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).data.created, 0);
  assert.equal([...records.values()].filter((row) => row.notification_type === 'announcement').length, 2);
});

test('email announcements require configuration and retry only eligible failed deliveries', async () => {
  const payload = {
    title: 'Provider notice',
    message: 'This is an email announcement.',
    channel: 'email',
    idempotencyKey: 'announce-email-0000001',
  };
  const unavailable = await adminRequest('/api/admin/notifications/announcements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(unavailable.status, 503);

  emailConfigured = true;
  let sends = 0;
  sendEmail = async () => { sends += 1; throw Object.assign(new Error('provider failed'), { code: 'ECONNECTION' }); };
  const failed = await adminRequest('/api/admin/notifications/announcements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(failed.status, 201);
  const failedIds = [...records.values()].filter((row) => row.notification_type === 'announcement' && row.delivery_channel === 'email');
  assert.equal(failedIds.length, 2);
  assert.equal(failedIds[0].delivery_status, 'failed');
  sendEmail = async () => { sends += 1; return { messageId: 'confirmed' }; };
  const retried = await adminRequest(`/api/admin/notifications/${failedIds[0].id}/retry`, { method: 'POST' });
  assert.equal(retried.status, 200);
  assert.equal(records.get(failedIds[0].id).delivery_status, 'delivered');
  assert.equal(sends, 3);
  const duplicateRetry = await adminRequest(`/api/admin/notifications/${failedIds[0].id}/retry`, { method: 'POST' });
  assert.equal(duplicateRetry.status, 409);
});
