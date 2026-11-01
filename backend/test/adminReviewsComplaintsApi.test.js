import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'admin-reviews-complaints-test-session';
let currentReview = {
  id: 7,
  booking_id: 31,
  rating: 1,
  comment: 'Original customer review',
  status: 'published',
  created_at: '2026-10-10 10:00:00',
  customer_id: 41,
  customer_name: 'Review Customer',
  customer_email: 'customer@example.test',
  vendor_id: 9,
  vendor_name: 'Test Vendor',
  service_id: 12,
  service_title: 'Photography',
  event_id: 19,
  event_title: 'Wedding',
};
let currentComplaint = {
  id: 22,
  user_id: 41,
  booking_id: 31,
  subject: 'Late service',
  details: 'Vendor arrived much later than planned.',
  status: 'open',
  resolution: null,
  assigned_to: null,
  created_at: '2026-10-11 12:00:00',
  customer_name: 'Review Customer',
  customer_email: 'customer@example.test',
  vendor_id: 9,
  vendor_name: 'Test Vendor',
  vendor_user_id: 55,
  assignee_name: null,
  event_title: 'Wedding',
};

function createDatabase() {
  const statements = [];
  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{
        id: 1, full_name: 'Platform Admin', email: 'admin@example.test',
        phone: null, status: 'active', roles: 'Admin',
      }] : []];
    }
    if (sql.includes('COUNT(*) AS total') && sql.includes('reviews r')) return [[{ total: 1 }]];
    if (sql.includes('COUNT(*) AS total') && sql.includes('complaints c')) return [[{ total: 1 }]];
    if (sql.startsWith('SELECT DISTINCT vp.id')) return [[{ id: 9, business_name: 'Test Vendor' }]];
    if (sql.startsWith('SELECT DISTINCT s.id')) return [[{ id: 12, title: 'Photography' }]];
    if (sql.startsWith('SELECT DISTINCT u.id') && sql.includes('r.is_admin = TRUE')) {
      return [[{ id: 1, full_name: 'Platform Admin', email: 'admin@example.test' }]];
    }
    if (sql.startsWith('SELECT id, booking_id, status FROM reviews')) {
      return [[{ id: currentReview.id, booking_id: currentReview.booking_id, status: currentReview.status }]];
    }
    if (sql.startsWith('SELECT r.id, r.booking_id') && sql.includes('WHERE r.id = ?')) return [[{ ...currentReview }]];
    if (sql.startsWith('SELECT r.id, r.booking_id')) return [[{ ...currentReview }]];
    if (sql.startsWith('SELECT h.id, h.actor_id') && sql.includes('review_history')) {
      return [[{ id: 1, actor_id: null, actor_name: null, action: 'created', from_status: null, to_status: 'published', reason: null }]];
    }
    if (sql.startsWith('SELECT id, original_name')) {
      return [[{ id: 80, original_name: 'evidence.pdf', content_type: 'application/pdf', file_size: 8, sha256: 'a'.repeat(64), uploaded_by: 41, created_at: '2026-10-11 12:00:00' }]];
    }
    if (sql.startsWith('SELECT h.id, h.actor_id') && sql.includes('complaint_history')) {
      return [[{ id: 2, actor_id: 41, actor_name: 'Review Customer', action: 'created', from_status: null, to_status: 'open', reason: null, details: null, created_at: currentComplaint.created_at }]];
    }
    if (sql.startsWith('SELECT c.id, c.user_id') && sql.includes('WHERE c.id = ? FOR UPDATE')) return [[{ ...currentComplaint }]];
    if (sql.startsWith('SELECT c.id, c.user_id') && sql.includes('LEFT JOIN events e')) return [[{ ...currentComplaint, reference: `CMP-${String(currentComplaint.id).padStart(6, '0')}` }]];
    if (sql.startsWith('SELECT u.id FROM users u') && sql.includes('r.is_admin = TRUE')) {
      return Number(values[0]) === 1 ? [[{ id: 1 }]] : [[]];
    }
    if (sql.startsWith('SELECT original_name, content_type, file_size, file_data')) {
      return [[{ original_name: 'evidence.pdf', content_type: 'application/pdf', file_size: 8, file_data: Buffer.from('%PDF-1.7') }]];
    }
    if (sql.startsWith('SELECT id, status FROM complaints WHERE id = ?')) return [[{ id: Number(values[0]), status: currentComplaint.status }]];
    if (sql.startsWith('UPDATE reviews SET status')) currentReview = { ...currentReview, status: values[0] };
    if (sql.startsWith('UPDATE complaints SET status')) {
      currentComplaint = { ...currentComplaint, status: values[0], resolution: values[1], assigned_to: values[2] };
    }
    if (sql.startsWith('INSERT INTO complaint_attachments')) return [{ insertId: 80 }];
    return [{ affectedRows: 1 }];
  }
  return {
    statements,
    reset() {
      currentReview = { ...currentReview, status: 'published' };
      currentComplaint = { ...currentComplaint, status: 'open', resolution: null, assigned_to: null };
    },
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
}

const database = createDatabase();
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

function adminRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `admin_session=${adminToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

test('review and complaint records require authenticated administrator access', async () => {
  assert.equal((await fetch(`${baseUrl}/api/admin/reviews`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/admin/complaints`)).status, 401);
});

test('review search and filters return customer, vendor, service, and booking context', async () => {
  const response = await adminRequest('/api/admin/reviews?q=RV-000007&rating=1&vendorId=9&serviceId=12&status=published&dateFrom=2026-10-01&dateTo=2026-10-31');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].rating, 1);
  assert.equal(result.data[0].customer_name, 'Review Customer');
  assert.equal(result.data[0].vendor_name, 'Test Vendor');
  assert.equal(result.data[0].service_title, 'Photography');
  assert.equal(result.data[0].booking_id, 31);
});

test('review moderation requires a reason and preserves original rating and text', async () => {
  const invalid = await adminRequest('/api/admin/reviews/7/moderation', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'hidden', reason: 'no' }),
  });
  assert.equal(invalid.status, 400);
  const response = await adminRequest('/api/admin/reviews/7/moderation', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'hidden', reason: 'Policy violation confirmed' }),
  });
  assert.equal(response.status, 200);
  assert.equal(currentReview.rating, 1);
  assert.equal(currentReview.comment, 'Original customer review');
  assert.equal(currentReview.status, 'hidden');
  assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO review_history')));
  assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO audit_logs')));
  const restored = await adminRequest('/api/admin/reviews/7/moderation', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'published', reason: 'Policy review completed' }),
  });
  assert.equal(restored.status, 200);
  assert.equal(currentReview.status, 'published');
  database.reset();
});

test('complaints support private detail, assignment, resolution, timeline, and notifications', async () => {
  const listing = await adminRequest('/api/admin/complaints?q=CMP-000022&status=open&dateFrom=2026-10-01&dateTo=2026-10-31');
  assert.equal(listing.status, 200);
  const details = await adminRequest('/api/admin/complaints/22');
  assert.equal(details.status, 200);
  const record = await details.json();
  assert.equal(record.data.details, currentComplaint.details);
  assert.equal(record.data.attachments[0].original_name, 'evidence.pdf');
  assert.equal(record.data.history[0].action, 'created');

  const missingResolution = await adminRequest('/api/admin/complaints/22', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved', reason: 'Closing case', resolution: ' ' }),
  });
  assert.equal(missingResolution.status, 400);

  const response = await adminRequest('/api/admin/complaints/22', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'resolved',
      reason: 'Reviewed evidence and contacted the vendor',
      resolution: 'Refund coordinated with vendor.',
      assignedTo: 1,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(currentComplaint.status, 'resolved');
  assert.equal(currentComplaint.assigned_to, 1);
  assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO complaint_history')));
  assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO notifications')));
  assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO audit_logs')));
  database.reset();
});

test('complaint attachments are validated and downloaded only through the protected route', async () => {
  const invalid = await adminRequest('/api/admin/complaints/22/attachments?filename=evidence.pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: Buffer.from('not a pdf'),
  });
  assert.equal(invalid.status, 400);

  const upload = await adminRequest('/api/admin/complaints/22/attachments?filename=evidence.pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: Buffer.from('%PDF-1.7'),
  });
  assert.equal(upload.status, 201);
  assert.ok(database.statements.some(({ sql }) => sql.includes("'attachment_added'")));

  const download = await adminRequest('/api/admin/complaints/22/attachments/80');
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await download.text(), '%PDF-1.7');
});
