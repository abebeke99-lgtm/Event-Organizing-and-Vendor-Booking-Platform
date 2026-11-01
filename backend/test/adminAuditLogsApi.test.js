import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken, writeAudit } from '../src/lib/security.js';
import { requestContextMiddleware } from '../src/lib/requestContext.js';

const adminToken = 'admin-audit-test-session';
const statements = [];
let totalRecords = 35;
const auditRecord = {
  id: 21,
  actor_id: 7,
  actor_name: 'Audit Administrator',
  action: 'booking.status_changed',
  entity_type: 'booking',
  entity_id: '91',
  details: { from: 'requested', to: 'accepted', contact_email: 'private@example.test', nested: { session_token: 'must-not-be-returned' } },
  ip_address: '127.0.0.1',
  request_id: '8be1fd6a-fcd9-4dd4-a992-892b2b4a2d04',
  outcome: 'success',
  severity: 'warning',
  created_at: '2026-10-30 12:45:00',
  module: 'booking',
};

async function execute(sql, values = []) {
  statements.push({ sql, values });
  if (sql.includes('FROM admin_sessions s')) {
    return [values[0] === hashToken(adminToken) ? [{
      id: 1,
      full_name: 'Audit Administrator',
      email: 'admin@example.test',
      phone: null,
      status: 'active',
      roles: 'Admin',
    }] : []];
  }
  if (sql.startsWith('SELECT DISTINCT action')) return [[{ action: 'booking.status_changed' }]];
  if (sql.startsWith('SELECT DISTINCT SUBSTRING_INDEX')) return [[{ module: 'booking' }]];
  if (sql.startsWith('SELECT COUNT(*) AS total FROM audit_logs')) return [[{ total: totalRecords }]];
  if (sql.startsWith('SELECT a.id, a.actor_id, u.full_name AS actor_name')) return [[{ ...auditRecord }]];
  return [{ affectedRows: 0 }];
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

test('audit records require an authenticated administrator', async () => {
  const response = await fetch(`${baseUrl}/api/admin/audit-logs`);
  assert.equal(response.status, 401);
});

test('audit log search, date and module filters are parameterized and paginated', async () => {
  statements.length = 0;
  const response = await adminRequest('/api/admin/audit-logs?page=2&pageSize=10&q=BK-000091&actor=Audit&module=booking&entityType=booking&entityId=91&requestId=8be1fd6a-fcd9-4dd4-a992-892b2b4a2d04&severity=warning&outcome=success&dateFrom=2026-10-01&dateTo=2026-10-31&sortBy=actor_name&sortDirection=asc');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);
  const result = await response.json();
  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.pageSize, 10);
  assert.equal(result.pagination.total, 35);
  assert.equal(result.data[0].actor_name, 'Audit Administrator');
  assert.equal(result.data[0].details.nested.session_token, undefined);
  assert.equal(result.data[0].details.contact_email, undefined);
  const listQuery = statements.find(({ sql }) => sql.startsWith('SELECT a.id, a.actor_id'));
  assert.match(listQuery.sql, /a\.request_id = \?/);
  assert.match(listQuery.sql, /SUBSTRING_INDEX\(a\.action, '\.', 1\) = \?/);
  assert.deepEqual(listQuery.values.slice(-2), [10, 10]);
  assert.ok(listQuery.values.includes('8be1fd6a-fcd9-4dd4-a992-892b2b4a2d04'));
});

test('audit log options provide available filters and export capability', async () => {
  const response = await adminRequest('/api/admin/audit-logs/options');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.data.actions, ['booking.status_changed']);
  assert.deepEqual(result.data.modules, ['booking']);
  assert.equal(result.data.canExport, true);
});

test('audit log filters reject invalid dates and reversed ranges', async () => {
  const invalidDate = await adminRequest('/api/admin/audit-logs?dateFrom=2026-02-31');
  assert.equal(invalidDate.status, 400);
  const reversedRange = await adminRequest('/api/admin/audit-logs?dateFrom=2026-10-20&dateTo=2026-10-01');
  assert.equal(reversedRange.status, 400);
});

test('audit log CSV export is permission-protected, filtered, and capped', async () => {
  const response = await adminRequest('/api/admin/audit-logs/export?module=booking');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /audit-logs\.csv/);
  assert.match(await response.text(), /booking\.status_changed/);

  totalRecords = 10001;
  try {
    const tooMany = await adminRequest('/api/admin/audit-logs/export');
    assert.equal(tooMany.status, 413);
  } finally {
    totalRecords = 35;
  }
});

test('audit records have no application create, update, or delete endpoints', async () => {
  const attempts = await Promise.all([
    adminRequest('/api/admin/audit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    adminRequest('/api/admin/audit-logs/21', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    adminRequest('/api/admin/audit-logs/21', { method: 'DELETE' }),
  ]);
  assert.ok(attempts.every((response) => response.status >= 400));
  assert.equal(statements.some(({ sql }) => /\b(?:UPDATE|DELETE)\s+audit_logs/i.test(sql)), false);
});

test('server audit creation redacts credential fields and records request correlation', async () => {
  let inserted;
  let requestId;
  const executor = {
    async execute(sql, values) {
      assert.match(sql, /INSERT INTO audit_logs/);
      inserted = values;
    },
  };
  await new Promise((resolve, reject) => {
    requestContextMiddleware({}, {
      setHeader(name, value) {
        if (name === 'X-Request-Id') requestId = value;
      },
    }, () => {
      writeAudit(executor, {
        actorId: 7,
        action: 'settings.updated',
        entityType: 'system_settings',
        details: {
          changes: [{ key: 'SMTP_PASSWORD', from: 'old-value', to: 'new-value' }],
          nested: { access_token: 'secret-token', providerReference: 'sensitive-reference', contact_email: 'private@example.test', enabled: true },
        },
        ip: '127.0.0.1',
      }).then(resolve, reject);
    });
  });
  assert.equal(inserted[6], requestId);
  assert.equal(inserted[7], 'success');
  assert.equal(inserted[8], 'critical');
  const savedDetails = JSON.parse(inserted[4]);
  assert.deepEqual(savedDetails.changes[0], { key: 'SMTP_PASSWORD', redacted: true });
  assert.equal(savedDetails.nested.access_token, undefined);
  assert.equal(savedDetails.nested.providerReference, undefined);
  assert.equal(savedDetails.nested.contact_email, undefined);
  assert.equal(JSON.stringify(savedDetails).includes('secret-token'), false);
});
