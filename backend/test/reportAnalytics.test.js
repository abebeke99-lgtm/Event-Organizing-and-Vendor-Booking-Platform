import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  calculateRevenueTotals,
  reportQuerySchema,
  resolveReportRange,
} from '../src/lib/reportAnalytics.js';
import { SYSTEM_SETTING_SCHEMAS } from '../src/lib/systemSettings.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'admin-reports-test-session';
const generatedUser = {
  id: 8,
  full_name: 'Report User',
  email: 'user@example.test',
  status: 'active',
  created_at: '2030-01-02 09:00:00',
  roles: 'customer',
};

function createDatabase({ total = 1 } = {}) {
  const statements = [];
  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{
        id: 1,
        full_name: 'Platform Admin',
        email: 'admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }] : []];
    }
    if (sql.includes("setting_key IN ('platform_currency','report_timezone')")) {
      return [[{ setting_key: 'platform_currency', setting_value: 'ETB' }, { setting_key: 'report_timezone', setting_value: 'Africa/Addis_Ababa' }]];
    }
    if (sql.includes('AS database_time')) return [[{ database_time: '2000-01-01 00:00:00' }]];
    if (sql.includes('AS local_time')) return [[{ local_time: '2000-01-01 03:00:00' }]];
    if (sql.startsWith('SELECT p.currency, COALESCE(SUM(p.amount)')) {
      return [[{ currency: 'ETB', gross_payments: 100 }, { currency: 'USD', gross_payments: 20 }]];
    }
    if (sql.startsWith('SELECT DATE(CONVERT_TZ(p.created_at')) {
      return [[{ period: '2030-01-02', currency: 'ETB', gross_payments: 100 }]];
    }
    if (sql.startsWith('SELECT r.currency, COALESCE(SUM(r.amount)')) {
      return [[{ currency: 'ETB', refund_amount: 25 }]];
    }
    if (sql.startsWith('SELECT DATE(CONVERT_TZ(r.processed_at')) {
      return [[{ period: '2030-01-02', currency: 'ETB', refund_amount: 25 }]];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM (SELECT 1 FROM users')) {
      return [[{ total }]];
    }
    if (sql.startsWith('SELECT u.id, u.full_name')) {
      return [[generatedUser]];
    }
    if (sql.startsWith('SELECT u.status AS status')) {
      return [[{ status: 'active', total }]];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
    return [[]];
  }
  return {
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
}

test('report date presets use configured local calendar boundaries, including DST changes', () => {
  const addisRange = resolveReportRange(
    { period: 'today' },
    { timeZone: 'Africa/Addis_Ababa', now: new Date('2030-01-01T22:00:00.000Z') },
  );
  assert.equal(addisRange.startDate, '2030-01-02');
  assert.equal(addisRange.startAt, '2030-01-01 21:00:00');
  assert.equal(addisRange.endAt, '2030-01-02 21:00:00');

  const dstRange = resolveReportRange(
    { period: 'today' },
    { timeZone: 'America/New_York', now: new Date('2026-03-08T16:00:00.000Z') },
  );
  assert.equal(dstRange.startAt, '2026-03-08 05:00:00');
  assert.equal(dstRange.endAt, '2026-03-09 04:00:00');
});

test('custom report ranges reject missing, invalid, reversed, and oversized boundaries', () => {
  assert.equal(reportQuerySchema.safeParse({ report: 'users', period: 'custom' }).success, false);
  assert.equal(reportQuerySchema.safeParse({
    report: 'users', period: 'custom', startDate: '2030-02-30', endDate: '2030-03-01',
  }).success, false);
  assert.equal(reportQuerySchema.safeParse({
    report: 'users', period: 'custom', startDate: '2030-02-02', endDate: '2030-02-01',
  }).success, false);
  assert.equal(reportQuerySchema.safeParse({
    report: 'users', period: 'custom', startDate: '2029-01-01', endDate: '2030-01-02',
  }).success, false);
  assert.equal(reportQuerySchema.safeParse({ report: 'payments', status: 'successful' }).success, false);
  assert.equal(reportQuerySchema.safeParse({ report: 'users', sortBy: 'email; DROP TABLE users' }).success, false);
});

test('report settings validate ISO currency and IANA timezone values', () => {
  assert.equal(SYSTEM_SETTING_SCHEMAS.platform_currency.safeParse('ETB').success, true);
  assert.equal(SYSTEM_SETTING_SCHEMAS.platform_currency.safeParse('US').success, false);
  assert.equal(SYSTEM_SETTING_SCHEMAS.report_timezone.safeParse('Africa/Addis_Ababa').success, true);
  assert.equal(SYSTEM_SETTING_SCHEMAS.report_timezone.safeParse('Not/A-Timezone').success, false);
});

test('revenue calculation keeps currencies separate and deducts successful refund amounts', () => {
  assert.deepEqual(calculateRevenueTotals(
    [{ currency: 'ETB', gross_amount: '100.00' }, { currency: 'USD', gross_amount: '30.00' }],
    [{ currency: 'ETB', refund_amount: '25.00' }, { currency: 'EUR', refund_amount: '4.00' }],
  ), [
    { currency: 'ETB', grossPayments: 100, refunds: 25, netRevenue: 75 },
    { currency: 'EUR', grossPayments: 0, refunds: 4, netRevenue: -4 },
    { currency: 'USD', grossPayments: 30, refunds: 0, netRevenue: 30 },
  ]);
});

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

function adminRequest(path) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Cookie: `admin_session=${adminToken}` },
    signal: AbortSignal.timeout(8000),
  });
}

test('report endpoints require an authenticated administrator', async () => {
  const response = await fetch(`${baseUrl}/api/admin/reports?report=payments`);
  assert.equal(response.status, 401);
  const exportResponse = await fetch(`${baseUrl}/api/admin/reports/export?report=payments`);
  assert.equal(exportResponse.status, 401);
});

test('report listing and CSV export share the same validated filters', async () => {
  const filters = 'report=users&period=custom&startDate=2030-01-01&endDate=2030-01-05&q=Report&status=active';
  const response = await adminRequest(`/api/admin/reports?${filters}`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].id, 8);
  assert.equal(result.appliedFilters.timeZone, 'Africa/Addis_Ababa');
  assert.equal(result.appliedFilters.startDate, '2030-01-01');

  const exportResponse = await adminRequest(`/api/admin/reports/export?${filters}`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
  const csv = await exportResponse.text();
  assert.match(csv, /# Applied filters:/);
  assert.match(csv, /Report User/);

  const queries = database.statements.filter(({ sql }) => sql.startsWith('SELECT u.id, u.full_name') && sql.includes('u.created_at'));
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /u\.status = \?/);
  assert.deepEqual(queries[0].values.slice(0, 2), ['2029-12-31 21:00:00', '2030-01-05 21:00:00']);
  assert.deepEqual(queries[0].values.slice(0, -2), queries[1].values.slice(0, -2));
  assert.ok(database.statements.some(({ sql }) => sql.startsWith('INSERT INTO audit_logs')));
});

test('revenue reports separate gross payments and succeeded refunds by currency', async () => {
  const response = await adminRequest('/api/admin/reports?report=revenue&period=custom&startDate=2030-01-01&endDate=2030-01-05');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.summary.map(({ currency, grossPayments, refunds, netRevenue }) => ({
    currency, grossPayments, refunds, netRevenue,
  })), [
    { currency: 'ETB', grossPayments: 100, refunds: 25, netRevenue: 75 },
    { currency: 'USD', grossPayments: 20, refunds: 0, netRevenue: 20 },
  ]);
  assert.equal(result.data[0].netRevenue, 75);
  const financialQueries = database.statements.filter(({ sql }) => /FROM (payments|refund_requests)/.test(sql));
  assert.equal(financialQueries.length, 4);
  assert.ok(financialQueries.every(({ sql }) => !sql.includes('JOIN')));
  assert.ok(financialQueries.filter(({ sql }) => sql.includes('FROM payments'))[0].sql.includes("p.status IN ('paid','refunded','partially_refunded','refund_pending')"));
  assert.ok(financialQueries.filter(({ sql }) => sql.includes('FROM refund_requests'))[0].sql.includes("r.status = 'succeeded'"));
});

test('large report exports are rejected before loading the report rows', async () => {
  const largeDatabase = createDatabase({ total: 10001 });
  const largeApp = createApp({ database: largeDatabase });
  const largeServer = largeApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => largeServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${largeServer.address().port}/api/admin/reports/export?report=users&period=last30`, {
      headers: { Cookie: `admin_session=${adminToken}` },
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.status, 413);
    assert.equal(
      largeDatabase.statements.some(({ sql }) => sql.startsWith('SELECT u.id, u.full_name') && sql.includes('u.created_at')),
      false,
      JSON.stringify(largeDatabase.statements.map(({ sql }) => sql.slice(0, 180))),
    );
  } finally {
    await new Promise((resolve, reject) => {
      largeServer.close((error) => error ? reject(error) : resolve());
      largeServer.closeAllConnections();
    });
  }
});
