import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'postgres-admin-reports-unit-session';
const statements = [];

const database = {
  async query(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('r.is_admin = TRUE')) {
      return {
        rows: values[0] === hashToken(adminToken) ? [{
          id: 8, full_name: 'Report Administrator', email: 'admin@example.test',
          phone: null, status: 'active', roles: 'Administrator',
        }] : [],
      };
    }
    if (sql.includes('setting_key = ANY($1::varchar[])')) {
      return { rows: [
        { setting_key: 'platform_currency', setting_value: 'ETB' },
        { setting_key: 'report_timezone', setting_value: 'Africa/Addis_Ababa' },
      ] };
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM (SELECT 1')) {
      return { rows: [{ total: '0' }] };
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 };
    return { rows: [] };
  },
};

const app = createApp({ database, databaseDialect: 'postgres' });
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

function request(path, authenticated = true) {
  return fetch(`${baseUrl}${path}`, {
    headers: authenticated ? { Cookie: `admin_session=${adminToken}` } : {},
    signal: AbortSignal.timeout(8000),
  });
}

test('PostgreSQL reports expose every report type and preserve authorization', async () => {
  const unauthenticated = await request('/reports?report=users', false);
  assert.equal(unauthenticated.status, 401);

  const reports = [
    'users', 'vendors', 'events', 'bookings', 'payments', 'refunds',
    'revenue', 'categories', 'reviews', 'complaints', 'vendor-performance', 'booking-outcomes',
  ];
  for (const report of reports) {
    const response = await request(`/reports?report=${report}&period=last30`);
    assert.equal(response.status, 200, report);
    const body = await response.json();
    assert.equal(body.appliedFilters.report, report);
    assert.equal(body.pagination.page, 1);
    assert.ok(Array.isArray(body.data));
  }

  const exportResponse = await request('/reports/export?report=users&period=last30');
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
  assert.match(await exportResponse.text(), /# Applied filters:/);
  assert.ok(statements.some(({ sql }) => sql.startsWith('INSERT INTO audit_logs')));
});

test('PostgreSQL report filters remain parameterized and reject invalid fields', async () => {
  const start = statements.length;
  const response = await request('/reports?report=users&period=custom&startDate=2030-01-01&endDate=2030-01-05&q=%25_%5C&status=active');
  assert.equal(response.status, 200);
  const userQuery = statements.slice(start).find(({ sql }) => sql.startsWith('SELECT u.id, u.full_name, u.email, u.status'));
  assert.ok(userQuery);
  assert.match(userQuery.sql, /ILIKE \$\d/);
  assert.match(userQuery.sql, /u\.status = \$\d/);
  assert.ok(userQuery.values.includes('%\\%\\_\\\\%'));

  const invalid = await request('/reports?report=users&sortBy=email');
  assert.equal(invalid.status, 400);
});
