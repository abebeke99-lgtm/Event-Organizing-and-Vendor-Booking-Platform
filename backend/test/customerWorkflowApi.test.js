import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const token = 'customer-workflow-session';
const customerId = 42;
const savedServices = [];
const quotations = [];
const writes = [];
let activeEventBookings = 0;
let nextQuotationId = 60;
const passwordHash = bcrypt.hashSync('CurrentPassword123', 4);

async function execute(sql, values = []) {
  if (sql.includes('FROM system_settings')) return [[], []];
  if (sql.includes('FROM user_sessions s')) {
    return [values[0] === hashToken(token) ? [{
      id: customerId, full_name: 'Customer Test', email: 'customer@example.test', phone: null,
      status: 'active', role: 'customer', permission_keys: 'favorites.manage_own,bookings.view_own',
    }] : [], []];
  }
  if (sql.startsWith('SELECT s.id FROM services s JOIN vendor_profiles')) {
    return [Number(values[0]) === 5 ? [{ id: 5 }] : [], []];
  }
  if (sql.startsWith('SELECT s.id, s.title, s.price, s.currency, s.vendor_id')) {
    return [Number(values[0]) === 5 ? [{
      id: 5, title: 'Wedding Catering', price: 500, currency: 'ETB',
      vendor_id: 8, vendor_user_id: 88,
    }] : [], []];
  }
  if (sql.startsWith('SELECT id, service_id, status, customer_id FROM quotations')) {
    return [quotations.filter((quote) => quote.request_key === values[0]).map((quote) => ({
      id: quote.id, service_id: quote.service_id, status: quote.status, customer_id: quote.customer_id,
    })), []];
  }
  if (sql.startsWith('INSERT INTO quotations')) {
    const quote = {
      id: nextQuotationId++, vendor_id: values[0], customer_id: values[1], service_id: values[3],
      request_key: values[4], requested_event_name: values[5], requested_date: values[6],
      requested_location: values[7], guest_count: values[8], budget: values[9],
      requested_event_type: values[10], requested_phone: values[11],
      required_services: values[12], additional_requirements: values[13], request_message: values[14],
      service_description: values[15], status: 'draft',
    };
    quotations.push(quote);
    writes.push({ kind: 'quote_request', values });
    return [{ insertId: quote.id, affectedRows: 1 }, []];
  }
  if (sql.startsWith('INSERT INTO customer_service_favorites')) {
    if (savedServices.some((item) => item.user_id === Number(values[0]) && item.service_id === Number(values[1]))) {
      throw Object.assign(new Error('Duplicate service favorite'), { code: 'ER_DUP_ENTRY' });
    }
    const item = { id: savedServices.length + 1, user_id: Number(values[0]), service_id: Number(values[1]) };
    savedServices.push(item);
    return [{ insertId: item.id, affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT s.id, s.title, s.description, s.price')) {
    return [savedServices.filter((item) => item.user_id === Number(values[0])).map((item) => ({
      id: item.service_id, title: 'Wedding Catering', description: 'Full service meal', price: 500,
      currency: 'ETB', business_name: 'Aster Catering', city: 'Addis Ababa', category: 'Catering', status: 'active',
    })), []];
  }
  if (sql.startsWith('DELETE FROM customer_service_favorites')) {
    const index = savedServices.findIndex((item) => item.user_id === Number(values[0]) && item.service_id === Number(values[1]));
    if (index < 0) return [{ affectedRows: 0 }, []];
    savedServices.splice(index, 1);
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT q.id, q.status, q.event_id, q.vendor_id')) {
    return [[
      ...(Number(values[0]) === 41 && Number(values[1]) === customerId
        ? [{ id: 41, status: 'sent', event_id: 11, vendor_id: 8, vendor_user_id: 88, organizer_id: customerId }]
        : []),
      ...(Number(values[0]) === 43 && Number(values[1]) === customerId
        ? [{ id: 43, status: 'draft', event_id: null, vendor_id: 8, vendor_user_id: 88, organizer_id: null }]
        : []),
    ], []];
  }
  if (sql.startsWith('UPDATE quotations SET status')) {
    writes.push({ kind: 'quote_decision', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT b.id, e.title AS event_title, e.organizer_id, vp.user_id')) {
    return [Number(values[0]) === 70 && Number(values[1]) === customerId
      ? [{ id: 70, event_title: 'Garden Wedding', organizer_id: customerId, vendor_user_id: 88, business_name: 'Aster Catering' }]
      : [], []];
  }
  if (sql.startsWith('INSERT INTO messages')) {
    writes.push({ kind: 'message', values });
    return [{ insertId: 101, affectedRows: 1 }, []];
  }
  if (sql.startsWith('UPDATE messages m JOIN bookings')) return [{ affectedRows: Number(values[0]) === 101 ? 1 : 0 }, []];
  if (sql.startsWith('UPDATE notifications SET status')) return [{ affectedRows: Number(values[0]) === 90 ? 1 : 0 }, []];
  if (sql.startsWith('INSERT INTO notification_history')) {
    writes.push({ kind: 'notification_history', values });
    return [{ insertId: 1, affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT id FROM notifications WHERE id = ? AND user_id = ?')) {
    return [Number(values[0]) === 90 && Number(values[1]) === customerId ? [{ id: 90 }] : [], []];
  }
  if (sql.startsWith('INSERT INTO notifications')) {
    writes.push({ kind: 'notification', values });
    return [{ insertId: 91, affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT password_hash FROM users WHERE id = ? FOR UPDATE')) return [[{ password_hash: passwordHash }], []];
  if (sql.startsWith('UPDATE users SET password_hash')) {
    writes.push({ kind: 'password_update', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?')) {
    writes.push({ kind: 'sessions_invalidated', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('UPDATE users SET full_name = ?')) {
    writes.push({ kind: 'profile_update', values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT id, organizer_id, title, event_type, description')) {
    const eventId = Number(values[0]);
    return [[11, 12].includes(eventId) ? [{ id: eventId, organizer_id: eventId === 11 ? customerId : 99, title: 'Garden Wedding', event_type: 'Wedding',
      description: '', city: 'Addis Ababa', venue: '', cover_image_url: null, gallery_images: '[]',
      start_date: '2031-02-01 10:00:00', end_date: null, budget: 10000, guest_count: 100,
      capacity: null, notes: '', status: 'draft' }] : [], []];
  }
  if (sql.startsWith('SELECT id, organizer_id, capacity FROM events WHERE id = ? FOR UPDATE')) {
    const eventId = Number(values[0]);
    return [[11, 12].includes(eventId) ? [{ id: eventId, organizer_id: eventId === 11 ? customerId : 99, capacity: null }] : [], []];
  }
  if (sql.startsWith('SELECT id, organizer_id, status FROM events WHERE id = ? LIMIT 1')) {
    const eventId = Number(values[0]);
    return [[11, 12].includes(eventId) ? [{ id: eventId, organizer_id: eventId === 11 ? customerId : 99, status: 'draft' }] : [], []];
  }
  if (sql.startsWith('SELECT COUNT(*) AS total FROM bookings')) return [[{ total: activeEventBookings }], []];
  if (sql.startsWith('UPDATE events SET')) {
    writes.push({ kind: 'event_update', sql, values });
    return [{ affectedRows: 1 }, []];
  }
  if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1, affectedRows: 1 }, []];
  return [[], []];
}

const database = {
  async execute(...args) { return execute(...args); },
  async query(...args) { return execute(...args); },
  async getConnection() {
    return { execute, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
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

function request(path, { method = 'GET', body, authenticated = true } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(authenticated ? { Cookie: `platform_session=${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
}

test('service wishlist is owner-scoped, persistent, and duplicate-safe', async () => {
  assert.equal((await request('/api/customer/saved-services', { authenticated: false })).status, 401);
  assert.equal((await request('/api/customer/saved-services', { method: 'POST', body: { serviceId: 5 } })).status, 201);
  assert.equal((await request('/api/customer/saved-services', { method: 'POST', body: { serviceId: 5 } })).status, 409);
  const saved = await request('/api/customer/saved-services');
  assert.equal((await saved.json()).data[0].id, 5);
  assert.equal((await request('/api/customer/saved-services/5', { method: 'DELETE' })).status, 204);
});

test('customer quotation decisions are restricted to owned quotations and notify vendors', async () => {
  const response = await request('/api/customer/quotations/41/decision', { method: 'PATCH', body: { status: 'accepted' } });
  assert.equal(response.status, 200);
  assert.ok(writes.some((entry) => entry.kind === 'quote_decision'));
  assert.ok(writes.some((entry) => entry.kind === 'notification'));
  assert.equal((await request('/api/customer/quotations/42/decision', { method: 'PATCH', body: { status: 'accepted' } })).status, 404);
  const cancelled = await request('/api/customer/quotations/43/decision', { method: 'PATCH', body: { status: 'cancelled' } });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).data.status, 'cancelled');
  assert.equal((await request('/api/customer/quotations/41/decision', { method: 'PATCH', body: { status: 'cancelled' } })).status, 409);
});

test('service quote requests store event details, notify the vendor, and are idempotent', async () => {
  const body = {
    vendorId: 8,
    serviceId: 5,
    requestKey: '8d4a9d8e-6e15-4f89-9d8c-a0d76e3537f0',
    eventName: 'Garden Wedding',
    eventDate: '2031-02-01T10:00',
    eventLocation: 'Addis Ababa',
    eventType: 'Wedding',
    contactPhone: '+251 911 234 567',
    guestCount: 120,
    budget: 12000,
    requiredServices: 'Buffet service and setup.',
    additionalRequirements: 'Vegetarian options requested.',
    message: 'Please share your available packages.',
  };
  const created = await request('/api/platform/quotes', { method: 'POST', body });
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).data, {
    id: 60, status: 'draft', serviceId: 5, serviceTitle: 'Wedding Catering',
  });
  assert.equal(quotations.length, 1);
  assert.equal(quotations[0].requested_event_name, body.eventName);
  assert.equal(quotations[0].requested_location, body.eventLocation);
  assert.equal(quotations[0].requested_event_type, body.eventType);
  assert.equal(quotations[0].requested_phone, body.contactPhone);
  assert.equal(quotations[0].required_services, body.requiredServices);
  assert.equal(quotations[0].guest_count, body.guestCount);
  assert.ok(writes.some((entry) => entry.kind === 'notification'));

  const duplicate = await request('/api/platform/quotes', { method: 'POST', body });
  assert.equal(duplicate.status, 200);
  assert.equal(quotations.length, 1);

  const incompleteDetails = await request('/api/platform/quotes', {
    method: 'POST',
    body: { serviceId: 5, eventName: 'Garden Wedding' },
  });
  assert.equal(incompleteDetails.status, 400);
  const mismatchedVendor = await request('/api/platform/quotes', {
    method: 'POST',
    body: { ...body, requestKey: 'bb35c7ce-d4e8-4705-9d8c-385708359edf', vendorId: 99 },
  });
  assert.equal(mismatchedVendor.status, 400);
  assert.equal((await request('/api/platform/quotes', { method: 'POST', authenticated: false, body })).status, 401);
});

test('customer booking messages are persisted and notify the assigned vendor', async () => {
  const response = await request('/api/customer/messages', { method: 'POST', body: { bookingId: 70, body: 'Please confirm setup time.' } });
  assert.equal(response.status, 201);
  assert.ok(writes.some((entry) => entry.kind === 'message'));
  assert.ok(writes.some((entry) => entry.kind === 'notification'));
});

test('customer profile edits and password rotation are authenticated and audited', async () => {
  const profile = await request('/api/customer/profile', { method: 'PATCH', body: { fullName: 'Updated Customer', phone: '+251900000000' } });
  assert.equal(profile.status, 200);
  const password = await request('/api/customer/profile/password', { method: 'POST', body: { currentPassword: 'CurrentPassword123', newPassword: 'ReplacePass123' } });
  assert.equal(password.status, 200);
  assert.ok(writes.some((entry) => entry.kind === 'profile_update'));
  assert.ok(writes.some((entry) => entry.kind === 'password_update'));
});

test('customer event edit is owner-scoped and cancellation preserves active bookings', async () => {
  const updated = await request('/api/platform/events/11', { method: 'PATCH', body: { title: 'Updated Garden Wedding' } });
  assert.equal(updated.status, 200);
  assert.equal((await request('/api/platform/events/12', { method: 'PATCH', body: { title: 'Other event' } })).status, 403);
  activeEventBookings = 1;
  assert.equal((await request('/api/platform/events/11/cancel', { method: 'PATCH' })).status, 409);
  activeEventBookings = 0;
  assert.equal((await request('/api/platform/events/11/cancel', { method: 'PATCH' })).status, 200);
});