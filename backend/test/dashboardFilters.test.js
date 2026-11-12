import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreatedAtDateFilter,
  buildDashboardTrends,
  dashboardDateRangeSchema,
} from '../src/lib/dashboardFilters.js';

test('dashboard date filters require valid dates in chronological order', () => {
  assert.equal(dashboardDateRangeSchema.safeParse({
    startDate: '2026-10-01',
    endDate: '2026-10-30',
  }).success, true);
  assert.equal(dashboardDateRangeSchema.safeParse({
    startDate: '2026-02-30',
    endDate: '2026-03-01',
  }).success, false);
  assert.equal(dashboardDateRangeSchema.safeParse({
    startDate: '2026-11-01',
    endDate: '2026-10-30',
  }).success, false);
  assert.equal(dashboardDateRangeSchema.safeParse({
    startDate: '2026-10-01',
    endDate: '2026-10-30',
    secret: 'ignored',
  }).success, false);
  assert.equal(dashboardDateRangeSchema.safeParse({
    startDate: '2025-10-29',
    endDate: '2026-10-30',
  }).success, false);
});

test('admin overview applies the selected date range to every metric and chart query', async () => {
  const { loadAdminDashboardOverview } = await import('../src/lib/dashboardFilters.js');
  const dateRange = { startDate: '2026-10-01', endDate: '2026-10-07' };
  const responses = [
    [{ total_users: 7 }],
    [{ total_administrators: 1, total_customers: 2, total_organizers: 3, total_vendors: 1 }],
    [{ total_vendors: 4, verified_vendors: 2, pending_vendors: 1 }],
    [{ total_events: 5, published_events: 3, upcoming_events: 2 }],
    [{ total_bookings: 8, pending_bookings: 2, confirmed_bookings: 3, completed_bookings: 2, cancelled_bookings: 1 }],
    [{ total_payments: 9, successful_payments: 4, pending_payments: 2, refund_requests: 1 }],
    [{ currency: 'ETB', total: '1500.00' }],
    [{ total_complaints: 3, open_complaints: 2 }],
    [{ total_reviews: 5 }],
    [{ id: 21, organizer_name: 'Organizer', vendor_name: 'Vendor', event_title: 'Conference' }],
    [{ id: 9, applicant_name: 'Applicant' }],
    [{ id: 8, subject: 'Support request' }],
    [{ id: 7, rating: 5, vendor_name: 'Vendor' }],
    [{ period: '2026-10-01', total: 3 }],
    [{ period: '2026-10-01', currency: 'ETB', transactions: 2, total: '500.00' }],
    [{ category: 'Wedding', total: 2 }],
    [{ status: 'accepted', total: 3 }],
    [{ id: 1, action: 'auth.login', entity_type: 'session', actor_name: 'Admin' }],
  ];
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [responses[queries.length - 1], []];
    },
  };

  const result = await loadAdminDashboardOverview(database, dateRange);

  assert.equal(queries.length, 18);
  for (const { values } of queries) assert.deepEqual(values, ['2026-10-01', '2026-10-07']);
  assert.deepEqual(result.users, { total_users: 7 });
  assert.deepEqual(result.userRoles, {
    total_administrators: 1,
    total_customers: 2,
    total_organizers: 3,
    total_vendors: 1,
  });
  assert.deepEqual(result.vendors, { total_vendors: 4, verified_vendors: 2, pending_vendors: 1 });
  assert.deepEqual(result.events, { total_events: 5, published_events: 3, upcoming_events: 2 });
  assert.deepEqual(result.bookings, {
    total_bookings: 8,
    pending_bookings: 2,
    confirmed_bookings: 3,
    completed_bookings: 2,
    cancelled_bookings: 1,
  });
  assert.deepEqual(result.payments, {
    total_payments: 9,
    successful_payments: 4,
    pending_payments: 2,
    refund_requests: 1,
  });
  assert.deepEqual(result.revenueByCurrency, [{ currency: 'ETB', total: '1500.00' }]);
  assert.equal(result.recentBookings[0].organizer_name, 'Organizer');
  assert.equal(result.recentVendorRequests[0].applicant_name, 'Applicant');
  assert.equal(result.recentComplaints[0].subject, 'Support request');
  assert.equal(result.recentReviews[0].rating, 5);
  assert.equal(result.recentActivities[0].action, 'auth.login');
  assert.deepEqual(result.bookingTrend, [{
    period: '2026-10-01',
    bookings: 3,
    paidTransactions: 2,
    salesByCurrency: { ETB: 500 },
  }]);
  assert.deepEqual(result.eventCategories, [{ category: 'Wedding', total: 2 }]);
  assert.deepEqual(result.bookingStatuses, [{ status: 'accepted', total: 3 }]);
  assert.match(queries[6].sql, /p\.status = 'paid'/);
  assert.match(queries[13].sql, /DATE_FORMAT\(b\.created_at, '%Y-%m-%d'\)/);
  assert.match(queries[14].sql, /p\.status = 'paid'/);
  assert.match(queries[17].sql, /FROM audit_logs a/);
});

test('PostgreSQL admin overview uses positional parameters, PostgreSQL aggregates, and one transaction', async () => {
  const { loadAdminDashboardOverview } = await import('../src/lib/dashboardFilters.js');
  const responses = [
    [{
      total_users: 7,
      total_administrators: 1,
      total_customers: 2,
      total_organizers: 3,
      total_vendors: 1,
      verified_vendors: 2,
      pending_vendors: 1,
      total_events: 5,
      published_events: 3,
      upcoming_events: 2,
      total_bookings: 8,
      pending_bookings: 2,
      confirmed_bookings: 3,
      completed_bookings: 2,
      cancelled_bookings: 1,
      total_payments: 9,
      successful_payments: 4,
      pending_payments: 2,
      refund_requests: 1,
      total_complaints: 3,
      open_complaints: 2,
      total_reviews: 5,
      revenue_by_currency: [{ currency: 'ETB', total: '1500.00' }],
      event_categories: [{ category: 'Wedding', total: 2 }],
      booking_statuses: [{ status: 'accepted', total: 3 }],
    }],
    [{ id: 21, organizer_name: 'Organizer', vendor_name: 'Vendor', event_title: 'Conference' }],
    [{ id: 9, applicant_name: 'Applicant' }],
    [{ id: 8, subject: 'Support request' }],
    [{ id: 7, rating: 5, vendor_name: 'Vendor' }],
    [{
      booking_trend: [{ period: '2026-10-01', total: 3 }],
      payment_trend: [{ period: '2026-10-01', currency: 'ETB', transactions: 2, total: '500.00' }],
    }],
    [{ id: 1, action: 'auth.login', entity_type: 'session', actor_name: 'Admin' }],
  ];
  const queries = [];
  let transactionCount = 0;
  let concurrentQueries = 0;
  let maximumConcurrentQueries = 0;
  const database = {
    dialect: 'postgres',
    async query(sql, values) {
      concurrentQueries += 1;
      maximumConcurrentQueries = Math.max(maximumConcurrentQueries, concurrentQueries);
      await new Promise((resolve) => setImmediate(resolve));
      queries.push({ sql, values });
      concurrentQueries -= 1;
      return { rows: responses[queries.length - 1] };
    },
    async inTransaction(work) {
      transactionCount += 1;
      return work(this);
    },
  };

  const dateRange = { startDate: '2026-10-01', endDate: '2026-10-07' };
  const result = await loadAdminDashboardOverview(database, dateRange);

  assert.equal(transactionCount, 1);
  assert.equal(maximumConcurrentQueries, 1);
  assert.equal(queries.length, 7);
  for (const { sql, values } of queries) {
    assert.deepEqual(values, ['2026-10-01', '2026-10-07']);
    assert.match(sql, /\$1::date/);
    assert.match(sql, /\$2::date/);
    assert.doesNotMatch(sql, /\?|DATE_ADD|DATE_FORMAT|SUM\([^)]*status\s*=/i);
  }
  assert.match(queries[0].sql, /COUNT\(\*\) FILTER \(WHERE vp\.verification_status = 'verified'\)/);
  assert.match(queries[0].sql, /LEFT JOIN user_roles ur/);
  assert.match(queries[5].sql, /TO_CHAR\(b\.created_at, 'YYYY-MM-DD'\)/);
  assert.match(queries[6].sql, /FROM audit_logs a/);
  assert.deepEqual(result.bookingTrend, [{
    period: '2026-10-01',
    bookings: 3,
    paidTransactions: 2,
    salesByCurrency: { ETB: 500 },
  }]);
  assert.deepEqual(result.revenueByCurrency, [{ currency: 'ETB', total: '1500.00' }]);
});

test('date filters bind inclusive date bounds as parameters', () => {
  assert.deepEqual(buildCreatedAtDateFilter({
    startDate: '2026-10-01',
    endDate: '2026-10-30',
  }, 'p.created_at'), {
    sql: ' WHERE p.created_at >= ? AND p.created_at < DATE_ADD(?, INTERVAL 1 DAY)',
    values: ['2026-10-01', '2026-10-30'],
  });
});

test('PostgreSQL dashboard date filters use typed positional date parameters', () => {
  assert.deepEqual(buildCreatedAtDateFilter({
    startDate: '2026-10-01',
    endDate: '2026-10-30',
  }, 'p.created_at', 'postgres'), {
    sql: " WHERE p.created_at >= $1::date AND p.created_at < ($2::date + INTERVAL '1 day')",
    values: ['2026-10-01', '2026-10-30'],
  });
});

test('dashboard trends merge booking counts and paid sales without combining currencies', () => {
  assert.deepEqual(buildDashboardTrends(
    [{ period: '2026-10', total: 4 }, { period: '2026-11', total: 2 }],
    [
      { period: '2026-10', currency: 'ETB', transactions: 2, total: '1200.00' },
      { period: '2026-10', currency: 'USD', transactions: 1, total: '50.00' },
    ],
  ), [
    {
      period: '2026-10',
      bookings: 4,
      paidTransactions: 3,
      salesByCurrency: { ETB: 1200, USD: 50 },
    },
    {
      period: '2026-11',
      bookings: 2,
      paidTransactions: 0,
      salesByCurrency: {},
    },
  ]);
});

test('admin overview propagates database failures for the API error handler', async () => {
  const { loadAdminDashboardOverview } = await import('../src/lib/dashboardFilters.js');
  await assert.rejects(
    loadAdminDashboardOverview({
      async query() {
        throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
      },
    }, { startDate: '2026-10-01', endDate: '2026-10-07' }),
    { code: 'ECONNREFUSED' },
  );
});
