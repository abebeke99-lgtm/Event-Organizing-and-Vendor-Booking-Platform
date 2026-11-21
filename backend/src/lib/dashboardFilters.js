import { z } from 'zod';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');

export const dashboardDateRangeSchema = z.object({
  range: z.enum(['today', '7days', '30days', '90days', 'monthly', 'yearly', 'custom']).default('30days'),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
}).strict().superRefine(({ range, from, to }, context) => {
  if (range === 'custom') {
    if (!from) context.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'A start date is required.' });
    if (!to) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'An end date is required.' });
    if (from && to && from > to) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'The end date must be on or after the start date.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (from && from > today) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'Dates cannot be in the future.' });
    }
    if (to && to > today) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Dates cannot be in the future.' });
    }
  } else if (from || to) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['range'], message: 'Use from and to only with the custom range.' });
  }
});

const millisecondsPerDay = 24 * 60 * 60 * 1000;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function resolveDashboardDateRange({ range, from, to }, now = new Date()) {
  const today = new Date(`${isoDate(now)}T00:00:00.000Z`);
  let start;
  let end = today;
  if (range === 'custom') {
    start = new Date(`${from}T00:00:00.000Z`);
    end = new Date(`${to}T00:00:00.000Z`);
  } else if (range === 'monthly') {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  } else if (range === 'yearly') {
    start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  } else {
    const days = range === 'today' ? 1 : range === '7days' ? 7 : range === '90days' ? 90 : 30;
    start = new Date(today.getTime() - (days - 1) * millisecondsPerDay);
  }

  const fromDate = isoDate(start);
  const toDate = isoDate(end);
  const dayCount = Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay) + 1;
  return {
    range,
    from: fromDate,
    to: toDate,
    granularity: range === 'yearly' || dayCount > 90 ? 'monthly' : 'daily',
  };
}

export function buildCreatedAtDateFilter({ from, to }, column = 'created_at', startIndex = 1) {
  return {
    sql: ` ${column} >= $${startIndex}::date AND ${column} < ($${startIndex + 1}::date + INTERVAL '1 day')`,
    values: [from, to],
  };
}

function periodKeys({ from, to, granularity }) {
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (granularity === 'monthly') cursor.setUTCDate(1);
  const periods = [];
  while (cursor <= end) {
    periods.push(granularity === 'monthly'
      ? cursor.toISOString().slice(0, 7)
      : isoDate(cursor));
    if (granularity === 'monthly') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return periods;
}

async function queryRows(database, sql, values) {
  const result = await database.query(sql, values);
  if (!Array.isArray(result?.rows)) throw new TypeError('PostgreSQL dashboard query returned an invalid result.');
  return result.rows;
}

function numberValue(value) {
  const valueAsNumber = Number(value ?? 0);
  if (!Number.isFinite(valueAsNumber)) throw new TypeError('PostgreSQL dashboard query returned a non-numeric count.');
  return valueAsNumber;
}

function normalizeActivity(rows) {
  return rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    title: row.title,
    status: row.status,
    created_at: row.created_at,
  }));
}

export async function loadAdminDashboardOverview(database, period) {
  if (typeof database?.query !== 'function') {
    throw new TypeError('PostgreSQL dashboard queries require Pool or Client query access.');
  }
  const dateFilter = (column) => buildCreatedAtDateFilter(period, column);
  const [users, vendors, events, bookings, payments, refunds, complaints, reviews,
    revenue, registrations, bookingSeries, revenueSeries, recentActivity] = await Promise.all([
    queryRows(database,
      `SELECT COALESCE(COUNT(DISTINCT u.id), 0)::int AS total,
              COALESCE(COUNT(DISTINCT u.id) FILTER (
                WHERE r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator')
              ), 0)::int AS administrators,
              COALESCE(COUNT(DISTINCT u.id) FILTER (WHERE LOWER(r.name) = 'customer'), 0)::int AS customers,
              COALESCE(COUNT(DISTINCT u.id) FILTER (WHERE LOWER(r.name) = 'organizer'), 0)::int AS organizers,
              COALESCE(COUNT(DISTINCT u.id) FILTER (WHERE LOWER(r.name) = 'vendor'), 0)::int AS vendors
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
       WHERE ${dateFilter('u.created_at').sql}`,
      dateFilter('u.created_at').values),
    queryRows(database,
      `SELECT COALESCE(COUNT(*), 0)::int AS total,
              COALESCE(COUNT(*) FILTER (WHERE verification_status = 'verified'), 0)::int AS verified,
              COALESCE(COUNT(*) FILTER (WHERE verification_status = 'pending'), 0)::int AS pending
       FROM vendor_profiles
       WHERE ${dateFilter('created_at').sql}`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT COALESCE(COUNT(*), 0)::int AS total,
              COALESCE(COUNT(*) FILTER (WHERE status IN ('active', 'published', 'upcoming', 'open')), 0)::int AS published,
              COALESCE(COUNT(*) FILTER (
                WHERE start_date >= CURRENT_DATE AND status IN ('active', 'published', 'upcoming', 'open')
              ), 0)::int AS upcoming
       FROM events
       WHERE ${dateFilter('created_at').sql}`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT COALESCE(COUNT(*), 0)::int AS total,
              COALESCE(COUNT(*) FILTER (WHERE status IN ('requested', 'quoted', 'under_review')), 0)::int AS pending,
              COALESCE(COUNT(*) FILTER (WHERE status = 'accepted'), 0)::int AS confirmed,
              COALESCE(COUNT(*) FILTER (WHERE status = 'completed'), 0)::int AS completed,
              COALESCE(COUNT(*) FILTER (WHERE status = 'cancelled'), 0)::int AS cancelled
       FROM bookings
       WHERE ${dateFilter('created_at').sql}`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT COALESCE(COUNT(*), 0)::int AS total,
              COALESCE(COUNT(*) FILTER (WHERE status = 'paid'), 0)::int AS successful,
              COALESCE(COUNT(*) FILTER (WHERE status IN ('pending', 'authorized')), 0)::int AS pending_authorized
       FROM payments
       WHERE ${dateFilter('created_at').sql}`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT COALESCE(COUNT(*), 0)::int AS total
       FROM refund_requests
       WHERE ${dateFilter('created_at').sql}`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT COALESCE(COUNT(*), 0)::int AS total,
              COALESCE(COUNT(*) FILTER (WHERE status IN ('open', 'under_review', 'investigating')), 0)::int AS open
       FROM complaints
       WHERE ${dateFilter('created_at').sql}`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT COALESCE(COUNT(*), 0)::int AS total
       FROM reviews
       WHERE ${dateFilter('created_at').sql}`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT currency, COALESCE(SUM(amount), 0)::text AS total
       FROM payments
       WHERE ${dateFilter('created_at').sql} AND status = 'paid'
       GROUP BY currency
       ORDER BY currency`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT TO_CHAR(${period.granularity === 'monthly' ? "date_trunc('month', created_at)" : 'created_at::date'}, '${period.granularity === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD'}') AS period,
              COALESCE(COUNT(*), 0)::int AS total
       FROM users
       WHERE ${dateFilter('created_at').sql}
       GROUP BY period
       ORDER BY period`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT TO_CHAR(${period.granularity === 'monthly' ? "date_trunc('month', created_at)" : 'created_at::date'}, '${period.granularity === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD'}') AS period,
              COALESCE(COUNT(*), 0)::int AS total
       FROM bookings
       WHERE ${dateFilter('created_at').sql}
       GROUP BY period
       ORDER BY period`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT TO_CHAR(${period.granularity === 'monthly' ? "date_trunc('month', created_at)" : 'created_at::date'}, '${period.granularity === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD'}') AS period,
              currency, COALESCE(SUM(amount), 0)::text AS total
       FROM payments
       WHERE ${dateFilter('created_at').sql} AND status = 'paid'
       GROUP BY period, currency
       ORDER BY period, currency`,
      dateFilter('created_at').values),
    queryRows(database,
      `SELECT id, type, title, status, created_at
       FROM (
         SELECT u.id::text AS id, 'user'::text AS type,
                'New user: ' || u.full_name AS title, u.status, u.created_at
         FROM users u
         WHERE ${buildCreatedAtDateFilter(period, 'u.created_at', 1).sql}
         UNION ALL
         SELECT b.id::text AS id, 'booking'::text AS type,
                'New booking: ' || COALESCE(e.title, 'Booking #' || b.id::text) AS title,
                b.status, b.created_at
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE ${buildCreatedAtDateFilter(period, 'b.created_at', 3).sql}
         UNION ALL
         SELECT p.id::text AS id, 'payment'::text AS type,
                'Payment #' || p.id::text AS title, p.status, p.created_at
         FROM payments p
         WHERE ${buildCreatedAtDateFilter(period, 'p.created_at', 5).sql}
         UNION ALL
         SELECT vp.id::text AS id, 'vendor_application'::text AS type,
                'Vendor application: ' || vp.business_name AS title,
                vp.verification_status AS status, vp.created_at
         FROM vendor_profiles vp
         WHERE ${buildCreatedAtDateFilter(period, 'vp.created_at', 7).sql}
       ) activity
       ORDER BY created_at DESC, type, id DESC
       LIMIT 10`,
      [...periodKeysForActivityValues(period)]),
  ]);

  const activityKeys = periodKeys(period);
  const registrationCounts = new Map(registrations.map((row) => [row.period, numberValue(row.total)]));
  const bookingCounts = new Map(bookingSeries.map((row) => [row.period, numberValue(row.total)]));
  const revenueByPeriodCurrency = new Map(
    revenueSeries.map((row) => [`${row.period}:${row.currency}`, numberValue(row.total)]),
  );
  const currencies = [...new Set(revenueSeries.map((row) => row.currency))].sort();

  return {
    period: { from: period.from, to: period.to },
    users: {
      total: numberValue(users[0]?.total),
      administrators: numberValue(users[0]?.administrators),
      customers: numberValue(users[0]?.customers),
      organizers: numberValue(users[0]?.organizers),
      vendors: numberValue(users[0]?.vendors),
    },
    vendors: {
      total: numberValue(vendors[0]?.total),
      verified: numberValue(vendors[0]?.verified),
      pending: numberValue(vendors[0]?.pending),
    },
    events: {
      total: numberValue(events[0]?.total),
      published: numberValue(events[0]?.published),
      upcoming: numberValue(events[0]?.upcoming),
    },
    bookings: {
      total: numberValue(bookings[0]?.total),
      pending: numberValue(bookings[0]?.pending),
      confirmed: numberValue(bookings[0]?.confirmed),
      completed: numberValue(bookings[0]?.completed),
      cancelled: numberValue(bookings[0]?.cancelled),
    },
    payments: {
      total: numberValue(payments[0]?.total),
      successful: numberValue(payments[0]?.successful),
      pendingAuthorized: numberValue(payments[0]?.pending_authorized),
      refundRequests: numberValue(refunds[0]?.total),
    },
    complaints: {
      open: numberValue(complaints[0]?.open),
      total: numberValue(complaints[0]?.total),
    },
    reviews: { total: numberValue(reviews[0]?.total) },
    revenue: revenue.map((row) => ({ currency: row.currency, total: row.total })),
    charts: {
      registrations: activityKeys.map((key) => ({ period: key, total: registrationCounts.get(key) || 0 })),
      bookings: activityKeys.map((key) => ({ period: key, total: bookingCounts.get(key) || 0 })),
      revenue: activityKeys.flatMap((key) => currencies.map((currency) => ({
        period: key,
        currency,
        total: revenueByPeriodCurrency.get(`${key}:${currency}`) || 0,
      }))),
    },
    recentActivity: normalizeActivity(recentActivity),
  };
}

function periodKeysForActivityValues(period) {
  return Array.from({ length: 4 }, () => period.from).flatMap((from, index) => {
    const columns = ['u.created_at', 'b.created_at', 'p.created_at', 'vp.created_at'];
    const filter = buildCreatedAtDateFilter(period, columns[index]);
    return filter.values;
  });
}
