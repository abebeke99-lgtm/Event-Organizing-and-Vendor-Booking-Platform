import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const vendorToken = 'vendor-workflow-session';
const vendorId = 10;
const userId = 44;
const media = [];
const writes = [];
let dateReserved = false;
const currentPasswordHash = bcrypt.hashSync('CurrentPassword123', 4);

async function execute(sql, values = []) {
  if (sql.includes('FROM system_settings')) return [[{ setting_key: 'platform_currency', setting_value: 'ETB' }], []];
  if (sql.includes('FROM user_sessions s')) {
    return [values[0] === hashToken(vendorToken) ? [{
      id: userId, full_name: 'Workflow Vendor', email: 'workflow@example.test', phone: null,
      status: 'active', role: 'vendor', permission_keys: 'services.manage_own',
    }] : [], []];
  }
  if (sql.startsWith('SELECT q.id, q.customer_id, q.status, vp.id AS vendor_id')) {
    return [Number(values[0]) === 55 && Number(values[1]) === userId
      ? [{ id: 55, customer_id: 75, status: 'draft', vendor_id: vendorId }]
      : [], []];
  }
  if (sql.startsWith('UPDATE quotations') && sql.includes('SET status = ?, amount = COALESCE')) {
    writes.push({ kind: 'quote_response', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.includes('FROM vendor_profiles vp') && sql.includes('WHERE vp.user_id = ?')) {
    return [[{ id: vendorId, user_id: userId, business_name: 'Workflow Studio', category_id: 3,
      category_name: 'Catering', city: 'Addis Ababa', address: null, service_areas: null,
      operating_hours: null, website: null, notification_preferences: null, booking_preferences: null,
      description: '', verification_status: 'verified', verification_reason: null, verified_at: null,
      created_at: '2026-01-01', full_name: 'Workflow Vendor', email: 'workflow@example.test', phone: null, status: 'active' }], []];
  }
  if (sql.startsWith('SELECT b.id FROM bookings b JOIN events e')) return [dateReserved ? [{ id: 200 }] : [], []];
  if (sql.startsWith('INSERT INTO vendor_availability')) {
    writes.push({ kind: 'availability', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT id, currency FROM services WHERE id = ? AND vendor_id = ?')) {
    return [Number(values[0]) === 5 && Number(values[1]) === vendorId ? [{ id: 5, currency: 'ETB' }] : [], []];
  }
  if (sql.startsWith('INSERT INTO service_packages')) {
    writes.push({ kind: 'package', values });
    return [{ insertId: 31, affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT id FROM services WHERE id = ? AND vendor_id = ?')) {
    return [Number(values[0]) === 5 && Number(values[1]) === vendorId ? [{ id: 5 }] : [], []];
  }
  if (sql.startsWith('SELECT id, service_id, media_type, original_name')) {
    return [media.filter((item) => item.vendor_id === Number(values[0])).map(({ content, ...item }) => ({ ...item })), []];
  }
  if (sql.startsWith('SELECT id FROM services WHERE id = ? AND vendor_id = ?')) {
    return [Number(values[0]) === 5 && Number(values[1]) === vendorId ? [{ id: 5 }] : [], []];
  }
  if (sql.startsWith('INSERT INTO vendor_media')) {
    const [mediaVendor, serviceId, mediaType, originalName, contentType, fileSize, content] = values;
    const item = { id: media.length + 1, vendor_id: mediaVendor, service_id: serviceId, media_type: mediaType,
      original_name: originalName, content_type: contentType, file_size: fileSize, content };
    media.push(item);
    writes.push({ kind: 'media', item });
    return [{ insertId: item.id, affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT content, content_type, file_size FROM vendor_media')) {
    const item = media.find((entry) => entry.id === Number(values[0]) && entry.vendor_id === Number(values[1]));
    return [item ? [{ content: item.content, content_type: item.content_type, file_size: item.file_size }] : [], []];
  }
  if (sql.startsWith('SELECT id, status, event_id FROM vendor_availability')) return [[], []];
  if (sql.startsWith('SELECT id, status FROM vendor_availability')) return [[], []];
  if (sql.startsWith('DELETE FROM vendor_media')) return [{ affectedRows: 1 }, []];
  if (sql.startsWith('INSERT INTO notifications')) {
    writes.push({ kind: 'notification', values });
    return [{ insertId: 91, affectedRows: 1 }, []];
  }
  if (sql.startsWith('INSERT INTO notification_history')) {
    writes.push({ kind: 'notification_history', values });
    return [{ insertId: 1, affectedRows: 1 }, []];
  }
  if (sql.startsWith('UPDATE notifications SET status')) {
    writes.push({ kind: 'notification_read', values });
    return [{ affectedRows: Number(values[0]) === 91 && Number(values[1]) === userId ? 1 : 0 }, []];
  }
  if (sql.startsWith('SELECT id FROM notifications WHERE id = ? AND user_id = ?')) {
    return [Number(values[0]) === 91 && Number(values[1]) === userId ? [{ id: 91 }] : [], []];
  }
  if (sql.startsWith('DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?')) {
    writes.push({ kind: 'sessions_invalidated', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT password_hash FROM users WHERE id = ? FOR UPDATE')) return [[{ password_hash: currentPasswordHash }], []];
  if (sql.startsWith('UPDATE users SET password_hash')) {
    writes.push({ kind: 'password_update', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT b.id, e.organizer_id, e.title AS event_title')) {
    return [Number(values[0]) === 70 && Number(values[1]) === vendorId
      ? [{ id: 70, organizer_id: 75, event_title: 'Garden Wedding' }]
      : [], []];
  }
  if (sql.startsWith('INSERT INTO messages')) {
    writes.push({ kind: 'message', values });
    return [{ insertId: 101, affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT r.id, b.id AS booking_id FROM reviews')) {
    return [Number(values[0]) === 60 && Number(values[1]) === vendorId ? [{ id: 60, booking_id: 70 }] : [], []];
  }
  if (sql.startsWith('SELECT DISTINCT u.id FROM users')) return [[{ id: 80 }], []];
  if (sql.startsWith('SELECT t.id, t.title, t.status, e.id AS event_id')) {
    return [Number(values[0]) === 81 && Number(values[1]) === vendorId
      ? [{ id: 81, title: 'Confirm setup', status: 'pending', event_id: 11, event_title: 'Garden Wedding', organizer_id: 75 }]
      : [], []];
  }
  if (sql.startsWith('UPDATE event_vendor_tasks SET status')) {
    writes.push({ kind: 'task_update', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1, affectedRows: 1 }, []];
  throw new Error(`Unexpected vendor workflow SQL: ${sql}`);
}

const database = {
  async execute(...args) { return execute(...args); },
  async query(...args) { return execute(...args); },
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

const app = createApp({ database });
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60_000,
};
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

function request(path, { method = 'GET', body, token = vendorToken, contentType = 'application/json' } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Cookie: `platform_session=${token}` } : {}),
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
}

test('availability rejects reserved dates and persists vendor date controls', async () => {
  dateReserved = true;
  const conflict = await request('/api/vendor/availability', {
    method: 'POST', body: JSON.stringify({ date: '2031-02-01', status: 'blocked' }),
  });
  assert.equal(conflict.status, 409);
  dateReserved = false;
  const saved = await request('/api/vendor/availability', {
    method: 'POST', body: JSON.stringify({ date: '2031-02-01', status: 'available', note: 'Open' }),
  });
  assert.equal(saved.status, 201);
  assert.equal(writes.at(-1).kind, 'availability');
});

test('service packages require a service owned by the vendor and persist extras', async () => {
  const denied = await request('/api/vendor/services/99/packages', {
    method: 'POST', body: JSON.stringify({ name: 'Premium', price: 500, extras: [] }),
  });
  assert.equal(denied.status, 404);
  const response = await request('/api/vendor/services/5/packages', {
    method: 'POST', body: JSON.stringify({ name: 'Premium', price: 500, includedFeatures: ['Setup'], extras: [{ name: 'Flowers', price: 50 }] }),
  });
  assert.equal(response.status, 201);
  assert.equal(writes.find((entry) => entry.kind === 'package').values[0], 5);
});

test('vendor media validates file signatures and persists only vendor-owned service images', async () => {
  const invalid = await request('/api/vendor/media?type=logo&filename=logo.jpg', {
    method: 'POST', contentType: 'image/jpeg', body: Buffer.from('not an image'),
  });
  assert.equal(invalid.status, 400);
  const image = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const saved = await request('/api/vendor/media?type=service&serviceId=5&filename=service.jpg', {
    method: 'POST', contentType: 'image/jpeg', body: image,
  });
  assert.equal(saved.status, 201);
  assert.equal((await request('/api/vendor/media/1')).status, 200);
  assert.equal(Number(writes.find((entry) => entry.kind === 'media').item.service_id), 5);
});

test('vendor notification read actions are account-scoped and recorded', async () => {
  const response = await request('/api/vendor/notifications/91/read', { method: 'POST', body: undefined });
  assert.equal(response.status, 200);
  assert.ok(writes.some((entry) => entry.kind === 'notification_history'));
  const missing = await request('/api/vendor/notifications/92/read', { method: 'POST', body: undefined });
  assert.equal(missing.status, 404);
});

test('vendor password change preserves the current session and invalidates other sessions', async () => {
  const response = await request('/api/vendor/account/password', {
    method: 'POST', body: JSON.stringify({ currentPassword: 'CurrentPassword123', newPassword: 'ReplacePass123' }),
  });
  assert.equal(response.status, 200);
  assert.ok(writes.some((entry) => entry.kind === 'password_update'));
  assert.ok(writes.some((entry) => entry.kind === 'sessions_invalidated'));
});

test('vendor replies to an owned booking and notifies the organizer', async () => {
  const response = await request('/api/vendor/messages', {
    method: 'POST', body: JSON.stringify({ bookingId: 70, body: 'We will arrive at 08:00.' }),
  });
  assert.equal(response.status, 201);
  assert.ok(writes.some((entry) => entry.kind === 'message'));
  assert.ok(writes.some((entry) => entry.kind === 'notification'));
});

test('vendor responds to an owned quote request and notifies its customer', async () => {
  const response = await request('/api/platform/quotations/55/respond', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'sent', amount: 1250, notes: 'Includes setup.', validUntil: '2031-02-20' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'sent');
  assert.ok(writes.some((entry) => entry.kind === 'quote_response'));
  assert.ok(writes.some((entry) => entry.kind === 'notification'));

  const notOwned = await request('/api/platform/quotations/56/respond', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'declined' }),
  });
  assert.equal(notOwned.status, 404);
});

test('vendor can report only reviews on owned bookings to administrators', async () => {
  const response = await request('/api/vendor/reviews/60/report', {
    method: 'POST', body: JSON.stringify({ reason: 'Contains private information.' }),
  });
  assert.equal(response.status, 202);
  assert.ok(writes.some((entry) => entry.kind === 'notification'));
  assert.equal((await request('/api/vendor/reviews/61/report', {
    method: 'POST', body: JSON.stringify({ reason: 'Other review.' }),
  })).status, 404);
});

test('vendor task status updates notify the owning organizer', async () => {
  const response = await request('/api/vendor/tasks/81/status', {
    method: 'PATCH', body: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(response.status, 200);
  assert.ok(writes.some((entry) => entry.kind === 'task_update'));
  assert.ok(writes.some((entry) => entry.kind === 'notification'));
});

test('vendor booking rejection requires an explanatory reason', async () => {
  const response = await request('/api/platform/bookings/70/status', {
    method: 'PATCH', body: JSON.stringify({ status: 'rejected' }),
  });
  assert.equal(response.status, 400);
});