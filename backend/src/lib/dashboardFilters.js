import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dashboardDateRangeSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
}).strict().superRefine(({ startDate, endDate }, context) => {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Start date is invalid.' });
  }
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== endDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date is invalid.' });
  }
  if (startDate > endDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after start date.' });
  }
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
    && end.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Date range cannot exceed 366 days.' });
  }
});

export function buildCreatedAtDateFilter({ startDate, endDate }, column = 'created_at', dialect = 'mysql') {
  if (dialect === 'postgres') {
    return {
      sql: ` WHERE ${column} >= $1::date AND ${column} < ($2::date + INTERVAL '1 day')`,
      values: [startDate, endDate],
    };
  }
  return {
    sql: ` WHERE ${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`,
    values: [startDate, endDate],
  };
}

export function buildDashboardTrends(bookings, payments) {
  const trendByPeriod = new Map();
  for (const row of bookings) {
    trendByPeriod.set(row.period, {
      period: row.period,
      bookings: Number(row.total),
      paidTransactions: 0,
      salesByCurrency: {},
    });
  }
  for (const row of payments) {
    const trend = trendByPeriod.get(row.period) || {
      period: row.period,
      bookings: 0,
      paidTransactions: 0,
      salesByCurrency: {},
    };
    trend.paidTransactions += Number(row.transactions);
    trend.salesByCurrency[row.currency] = Number(row.total);
    trendByPeriod.set(row.period, trend);
  }
  return [...trendByPeriod.values()].sort((left, right) => left.period.localeCompare(right.period));
}

export async function loadAdminDashboardOverview(database, dateRange) {
  const dialect = database.dialect === 'postgres' ? 'postgres' : 'mysql';
  if (dialect === 'postgres') {
    if (typeof database.inTransaction !== 'function') {
      throw new TypeError('PostgreSQL dashboard queries require transaction-capable database access.');
    }
    return database.inTransaction((transaction) => loadDashboardOverviewQueries(transaction, dateRange, dialect));
  }
  return loadDashboardOverviewQueries(database, dateRange, dialect);
}

async function loadDashboardOverviewQueries(database, dateRange, dialect) {
  const createdFilter = (alias) => buildCreatedAtDateFilter(dateRange, `${alias}.created_at`, dialect);
  const usersFilter = createdFilter('u');
  const vendorsFilter = createdFilter('vp');
  const eventsFilter = createdFilter('e');
  const bookingsFilter = createdFilter('b');
  const paymentsFilter = createdFilter('p');
  const complaintsFilter = createdFilter('c');
  const reviewsFilter = createdFilter('r');
  let pendingQuery = Promise.resolve();
  let queryFailure = null;
  const queryRows = async (sql, values) => {
    if (dialect !== 'postgres') {
      const result = await database.query(sql, values);
      return result[0];
    }
    const result = pendingQuery.then(async () => {
      if (queryFailure) throw queryFailure;
      try {
        return await database.query(sql, values);
      } catch (error) {
        queryFailure = error;
        throw error;
      }
    });
    pendingQuery = result.then(() => undefined, () => undefined);
    return (await result).rows;
  };
  const aggregate = (condition) => dialect === 'postgres'
    ? `(COUNT(*) FILTER (WHERE ${condition}))::int`
    : `COALESCE(SUM(${condition}), 0)`;
  const count = dialect === 'postgres' ? 'COUNT(*)::int' : 'COUNT(*)';
  const distinctCount = (expression) => dialect === 'postgres'
    ? `(COUNT(DISTINCT ${expression}))::int`
    : `COUNT(DISTINCT ${expression})`;
  const period = (column) => dialect === 'postgres'
    ? `TO_CHAR(${column}, 'YYYY-MM-DD')`
    : `DATE_FORMAT(${column}, '%Y-%m-%d')`;
  const bookingPeriod = period('b.created_at');
  const paymentPeriod = period('p.created_at');

  const [
    userRows,
    userRoleRows,
    vendorRows,
    eventRows,
    bookingRows,
    paymentRows,
    revenueByCurrency,
    complaintRows,
    reviewRows,
    recentBookings,
    recentVendorRequests,
    recentComplaints,
    recentReviews,
    bookingTrend,
    paymentTrend,
    eventCategories,
    bookingStatuses,
    recentActivities,
  ] = await Promise.all([
    queryRows(
      `SELECT ${count} AS total_users
       FROM users u${usersFilter.sql}`,
      usersFilter.values,
    ),
    queryRows(
      `SELECT ${distinctCount("CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN u.id END")} AS total_administrators,
              ${distinctCount("CASE WHEN LOWER(r.name) = 'customer' THEN u.id END")} AS total_customers,
              ${distinctCount("CASE WHEN LOWER(r.name) = 'organizer' THEN u.id END")} AS total_organizers,
              ${distinctCount("CASE WHEN LOWER(r.name) = 'vendor' THEN u.id END")} AS total_vendors
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE${usersFilter.sql}`,
      usersFilter.values,
    ),
    queryRows(
      `SELECT ${count} AS total_vendors,
              ${aggregate("vp.verification_status = 'verified'")} AS verified_vendors,
              ${aggregate("vp.verification_status = 'pending'")} AS pending_vendors
       FROM vendor_profiles vp${vendorsFilter.sql}`,
      vendorsFilter.values,
    ),
    queryRows(
      `SELECT ${count} AS total_events,
              ${aggregate("e.status IN ('active', 'published', 'upcoming', 'open')")} AS published_events,
              ${aggregate("e.start_date >= CURRENT_DATE AND e.status IN ('active', 'published', 'upcoming', 'open')")} AS upcoming_events
       FROM events e${eventsFilter.sql}`,
      eventsFilter.values,
    ),
    queryRows(
      `SELECT ${count} AS total_bookings,
              ${aggregate("b.status IN ('requested', 'quoted', 'under_review')")} AS pending_bookings,
              ${aggregate("b.status = 'accepted'")} AS confirmed_bookings,
              ${aggregate("b.status = 'completed'")} AS completed_bookings,
              ${aggregate("b.status = 'cancelled'")} AS cancelled_bookings
       FROM bookings b${bookingsFilter.sql}`,
      bookingsFilter.values,
    ),
    queryRows(
      `SELECT ${count} AS total_payments,
              ${aggregate("p.status = 'paid'")} AS successful_payments,
              ${aggregate("p.status IN ('pending', 'authorized')")} AS pending_payments,
              ${aggregate("p.status = 'refund_pending'")} AS refund_requests
       FROM payments p${paymentsFilter.sql}`,
      paymentsFilter.values,
    ),
    queryRows(
      `SELECT p.currency, SUM(p.amount) AS total
       FROM payments p${paymentsFilter.sql} AND p.status = 'paid'
       GROUP BY p.currency ORDER BY p.currency`,
      paymentsFilter.values,
    ),
    queryRows(
      `SELECT ${count} AS total_complaints,
              ${aggregate("c.status IN ('open', 'under_review')")} AS open_complaints
       FROM complaints c${complaintsFilter.sql}`,
      complaintsFilter.values,
    ),
    queryRows(
      `SELECT ${count} AS total_reviews
       FROM reviews r${reviewsFilter.sql}`,
      reviewsFilter.values,
    ),
    queryRows(
      `SELECT b.id, b.status, b.quoted_amount, b.currency, b.created_at,
              e.title AS event_title, u.full_name AS organizer_name,
              vp.business_name AS vendor_name
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = e.organizer_id
       JOIN vendor_profiles vp ON vp.id = b.vendor_id${bookingsFilter.sql}
       ORDER BY b.created_at DESC, b.id DESC LIMIT 8`,
      bookingsFilter.values,
    ),
    queryRows(
      `SELECT vp.id, vp.business_name, vp.created_at, u.full_name AS applicant_name, u.email
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id${vendorsFilter.sql} AND vp.verification_status = 'pending'
       ORDER BY vp.created_at DESC, vp.id DESC LIMIT 6`,
      vendorsFilter.values,
    ),
    queryRows(
      `SELECT c.id, c.subject, c.status, c.created_at, u.full_name AS customer_name
       FROM complaints c
       JOIN users u ON u.id = c.user_id${complaintsFilter.sql}
       ORDER BY c.created_at DESC, c.id DESC LIMIT 6`,
      complaintsFilter.values,
    ),
    queryRows(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
              u.full_name AS customer_name, vp.business_name AS vendor_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = e.organizer_id
       JOIN vendor_profiles vp ON vp.id = b.vendor_id${reviewsFilter.sql}
       ORDER BY r.created_at DESC, r.id DESC LIMIT 6`,
      reviewsFilter.values,
    ),
    queryRows(
      `SELECT ${bookingPeriod} AS period, ${count} AS total
       FROM bookings b${bookingsFilter.sql}
       GROUP BY ${bookingPeriod}
       ORDER BY period`,
      bookingsFilter.values,
    ),
    queryRows(
      `SELECT ${paymentPeriod} AS period, p.currency,
              ${count} AS transactions, SUM(p.amount) AS total
       FROM payments p${paymentsFilter.sql} AND p.status = 'paid'
       GROUP BY ${paymentPeriod}, p.currency
       ORDER BY period, p.currency`,
      paymentsFilter.values,
    ),
    queryRows(
      `SELECT COALESCE(NULLIF(TRIM(e.event_type), ''), 'Uncategorized') AS category,
              ${count} AS total
       FROM events e${eventsFilter.sql}
       GROUP BY COALESCE(NULLIF(TRIM(e.event_type), ''), 'Uncategorized')
       ORDER BY total DESC, category ASC`,
      eventsFilter.values,
    ),
    queryRows(
      `SELECT b.status, ${count} AS total
       FROM bookings b${bookingsFilter.sql}
       GROUP BY b.status
       ORDER BY total DESC, b.status ASC`,
      bookingsFilter.values,
    ),
    queryRows(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
              u.full_name AS actor_name
       FROM audit_logs a
       JOIN users u ON u.id = a.actor_id${createdFilter('a').sql}
       ORDER BY a.created_at DESC, a.id DESC LIMIT 8`,
      createdFilter('a').values,
    ),
  ]);

  const [users] = userRows;
  const [userRoles] = userRoleRows;
  const [vendors] = vendorRows;
  const [events] = eventRows;
  const [bookings] = bookingRows;
  const [payments] = paymentRows;
  const [complaints] = complaintRows;
  const [reviews] = reviewRows;

  return {
    users,
    userRoles,
    vendors,
    events,
    bookings,
    payments,
    revenueByCurrency,
    complaints,
    reviews,
    recentBookings,
    recentVendorRequests,
    recentComplaints,
    recentReviews,
    bookingTrend: buildDashboardTrends(bookingTrend, paymentTrend),
    eventCategories,
    bookingStatuses,
    recentActivities,
    filters: dateRange,
  };
}
