import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreatedAtDateFilter,
  dashboardDateRangeSchema,
  loadAdminDashboardOverview,
  resolveDashboardDateRange,
} from '../src/lib/dashboardFilters.js';

function dayOffset(offset) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function responseFor(sql) {
  if (sql.includes('AS administrators')) {
    return [{ total: '4', administrators: '1', customers: '1', organizers: '1', vendors: '1' }];
  }
  if (sql.includes('AS published')) return [{ total: '3', published: '2', upcoming: '1' }];
  if (sql.includes('AS pending_authorized')) return [{ total: '4', successful: '2', pending_authorized: '1' }];
  if (sql.includes('FROM vendor_profiles') && sql.includes('AS pending')) {
    return [{ total: '2', verified: '1', pending: '1' }];
  }
  if (sql.includes('FROM refund_requests')) return [{ total: '1' }];
  if (sql.includes('FROM complaints')) return [{ total: '2', open: '1' }];
  if (sql.includes('FROM reviews')) return [{ total: '5' }];
  if (sql.includes('GROUP BY period, currency')) {
    return [{ period: dayOffset(-2), currency: 'ETB', total: '125.25' }];
  }
  if (sql.includes('GROUP BY currency')) return [{ currency: 'ETB', total: '250.50' }];
  if (sql.includes('AS period') && sql.includes('FROM users')) {
    return [{ period: dayOffset(-2), total: '2' }];
  }
  if (sql.includes('AS period') && sql.includes('FROM bookings')) {
    return [{ period: dayOffset(-1), total: '3' }];
  }
  if (sql.includes('AS pending') && sql.includes('FROM bookings')) {
    return [{ total: '6', pending: '2', confirmed: '1', completed: '2', cancelled: '1' }];
  }
  if (sql.includes('FROM (') && sql.includes('activity')) {
    return [{ id: '18', type: 'payment', title: 'Payment #18', status: 'paid', created_at: new Date().toISOString() }];
  }
  throw new Error(`Unexpected dashboard query: ${sql}`);
}

test('dashboard date ranges validate presets and custom dates', () => {
  assert.equal(dashboardDateRangeSchema.safeParse({}).success, true);
  for (const range of ['today', '7days', '30days', '90days', 'monthly', 'yearly']) {
    assert.equal(dashboardDateRangeSchema.safeParse({ range }).success, true);
  }
  assert.equal(dashboardDateRangeSchema.safeParse({
    range: 'custom',
    from: dayOffset(-3),
    to: dayOffset(0),
  }).success, true);
  assert.equal(dashboardDateRangeSchema.safeParse({
    range: 'custom',
    from: dayOffset(-1),
  }).success, false);
  assert.equal(dashboardDateRangeSchema.safeParse({
    range: 'custom',
    from: dayOffset(0),
    to: dayOffset(-1),
  }).success, false);
  assert.equal(dashboardDateRangeSchema.safeParse({
    range: '30days',
    from: dayOffset(-3),
    to: dayOffset(0),
  }).success, false);
  assert.equal(dashboardDateRangeSchema.safeParse({ range: 'all-time' }).success, false);
});

test('dashboard presets calculate inclusive dates and chart granularity server-side', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  assert.deepEqual(resolveDashboardDateRange({ range: 'today' }, now), {
    range: 'today', from: '2026-10-30', to: '2026-10-30', granularity: 'daily',
  });
  assert.deepEqual(resolveDashboardDateRange({ range: '7days' }, now), {
    range: '7days', from: '2026-10-24', to: '2026-10-30', granularity: 'daily',
  });
  assert.deepEqual(resolveDashboardDateRange({ range: '30days' }, now), {
    range: '30days', from: '2026-10-01', to: '2026-10-30', granularity: 'daily',
  });
  assert.deepEqual(resolveDashboardDateRange({ range: '90days' }, now), {
    range: '90days', from: '2026-08-02', to: '2026-10-30', granularity: 'daily',
  });
  assert.deepEqual(resolveDashboardDateRange({ range: 'monthly' }, now), {
    range: 'monthly', from: '2026-10-01', to: '2026-10-30', granularity: 'daily',
  });
  assert.deepEqual(resolveDashboardDateRange({ range: 'yearly' }, now), {
    range: 'yearly', from: '2026-01-01', to: '2026-10-30', granularity: 'monthly',
  });
});

test('dashboard date filters use PostgreSQL positional parameters and inclusive end dates', () => {
  const period = { from: '2026-10-01', to: '2026-10-30' };
  assert.deepEqual(buildCreatedAtDateFilter(period, 'p.created_at'), {
    sql: " p.created_at >= $1::date AND p.created_at < ($2::date + INTERVAL '1 day')",
    values: [period.from, period.to],
  });
});

test('overview runs PostgreSQL queries in parallel and returns zero-filled numeric series', async () => {
  const from = dayOffset(-2);
  const to = dayOffset(0);
  const period = resolveDashboardDateRange({ range: 'custom', from, to });
  let activeQueries = 0;
  let maximumConcurrentQueries = 0;
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push({ sql, values });
      activeQueries += 1;
      maximumConcurrentQueries = Math.max(maximumConcurrentQueries, activeQueries);
      await Promise.resolve();
      activeQueries -= 1;
      return { rows: responseFor(sql) };
    },
  };

  const result = await loadAdminDashboardOverview(database, period);

  assert.equal(queries.length, 13);
  assert.equal(maximumConcurrentQueries, 13);
  for (const { sql, values } of queries) {
    for (let index = 0; index < values.length; index += 2) {
      assert.deepEqual(values.slice(index, index + 2), [from, to]);
    }
    assert.doesNotMatch(sql, /\?|DATE_FORMAT|DATE_ADD|execute\(/i);
  }
  assert.deepEqual(result.period, { from, to });
  assert.deepEqual(result.users, {
    total: 4, administrators: 1, customers: 1, organizers: 1, vendors: 1,
  });
  assert.deepEqual(result.vendors, { total: 2, verified: 1, pending: 1 });
  assert.deepEqual(result.events, { total: 3, published: 2, upcoming: 1 });
  assert.deepEqual(result.bookings, {
    total: 6, pending: 2, confirmed: 1, completed: 2, cancelled: 1,
  });
  assert.deepEqual(result.payments, {
    total: 4, successful: 2, pendingAuthorized: 1, refundRequests: 1,
  });
  assert.deepEqual(result.complaints, { open: 1, total: 2 });
  assert.deepEqual(result.reviews, { total: 5 });
  assert.deepEqual(result.revenue, [{ currency: 'ETB', total: '250.50' }]);
  assert.deepEqual(result.charts.registrations, [
    { period: from, total: 2 }, { period: dayOffset(-1), total: 0 }, { period: to, total: 0 },
  ]);
  assert.deepEqual(result.charts.bookings, [
    { period: from, total: 0 }, { period: dayOffset(-1), total: 3 }, { period: to, total: 0 },
  ]);
  assert.deepEqual(result.charts.revenue, [
    { period: from, currency: 'ETB', total: 125.25 },
    { period: dayOffset(-1), currency: 'ETB', total: 0 },
    { period: to, currency: 'ETB', total: 0 },
  ]);
  assert.deepEqual(result.recentActivity, [{
    id: '18',
    type: 'payment',
    title: 'Payment #18',
    status: 'paid',
    created_at: result.recentActivity[0].created_at,
  }]);
});

test('overview preserves PostgreSQL errors for the route handler', async () => {
  const failure = Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
  await assert.rejects(loadAdminDashboardOverview({
    async query() {
      throw failure;
    },
  }, resolveDashboardDateRange({ range: 'today' })), failure);
});
