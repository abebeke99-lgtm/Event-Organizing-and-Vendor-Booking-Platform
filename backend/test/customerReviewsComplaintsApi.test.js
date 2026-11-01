import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const customerToken = 'customer-review-complaint-test-session';
const customerId = 41;
const statements = [];

async function execute(sql, values = []) {
  statements.push({ sql, values });
  if (sql.includes('FROM system_settings')) return [[]];
  if (sql.includes('FROM user_sessions s')) {
    return [values[0] === hashToken(customerToken) ? [{
      id: customerId,
      full_name: 'Customer Example',
      email: 'customer@example.test',
      phone: null,
      status: 'active',
      role: 'customer',
      permission_keys: 'reviews.view_own',
    }] : []];
  }
  if (sql.includes('FROM complaints c WHERE c.id = ? AND c.user_id = ?')) {
    return Number(values[0]) === 23 && Number(values[1]) === customerId ? [[{ id: 23 }]] : [[]];
  }
  if (sql.startsWith('SELECT id, status FROM complaints WHERE id = ? AND user_id = ?')) {
    return Number(values[0]) === 23 && Number(values[1]) === customerId ? [[{ id: 23, status: 'open' }]] : [[]];
  }
  if (sql.includes('FROM complaint_attachments a JOIN complaints c')) {
    return Number(values[1]) === 23 && Number(values[2]) === customerId ? [[{
      original_name: 'own.pdf',
      content_type: 'application/pdf',
      file_size: 8,
      file_data: Buffer.from('%PDF-1.7'),
    }]] : [[]];
  }
  if (sql.startsWith('SELECT b.id, b.status, e.organizer_id')) {
    return [[{ id: 31, status: 'completed', organizer_id: customerId }]];
  }
  if (sql.startsWith('SELECT b.id FROM bookings b')) {
    return Number(values[1]) === customerId ? [[{ id: Number(values[0]) }]] : [[]];
  }
  if (sql.startsWith('SELECT id FROM reviews WHERE booking_id')) return [[]];
  if (sql.startsWith('SELECT DISTINCT u.id') && sql.includes('r.is_admin = TRUE')) return [[{ id: 1 }]];
  if (sql.startsWith('SELECT id, status FROM complaints WHERE id = ?')) {
    return Number(values[0]) === 22 ? [[{ id: 22, status: 'open' }]] : [[]];
  }
  if (sql.startsWith('INSERT INTO reviews')) return [{ insertId: 90 }];
  if (sql.startsWith('INSERT INTO complaints')) return [{ insertId: 22 }];
  return [{ affectedRows: 1 }];
}

const database = {
  statements,
  async execute(...args) { return execute(...args); },
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

const app = createApp({ database });
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

function customerRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `platform_session=${customerToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

test('customers may review only completed bookings and ratings are immutable after submission', async () => {
  const response = await customerRequest('/api/customer/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: 31, rating: 5, comment: 'Great service' }),
  });
  assert.equal(response.status, 201);
  assert.ok(statements.some(({ sql, values }) => sql.startsWith('INSERT INTO reviews') && values[1] === 5));
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO review_history')));
  const attemptedEdit = await customerRequest('/api/customer/reviews/90', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 1 }),
  });
  assert.equal(attemptedEdit.status, 404);
});

test('customers can create complaints and cannot view attachments on another customer complaint', async () => {
  const created = await customerRequest('/api/customer/complaints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: 31, subject: 'Service concern', details: 'Please help resolve this service concern.' }),
  });
  assert.equal(created.status, 201);
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO complaint_history')));

  const foreignAttachment = await customerRequest('/api/customer/complaints/22/attachments/80');
  assert.equal(foreignAttachment.status, 404);
  const foreignUpload = await customerRequest('/api/customer/complaints/22/attachments?filename=private.pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: Buffer.from('%PDF-1.7'),
  });
  assert.equal(foreignUpload.status, 404);
  const ownAttachment = await customerRequest('/api/customer/complaints/23/attachments/80');
  assert.equal(ownAttachment.status, 200);
  assert.equal(ownAttachment.headers.get('cache-control'), 'private, no-store');
});
