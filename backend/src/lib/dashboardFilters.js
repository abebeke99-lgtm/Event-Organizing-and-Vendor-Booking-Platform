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

export function buildCreatedAtDateFilter({ startDate, endDate }, column = 'created_at') {
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
  const createdFilter = (alias) => buildCreatedAtDateFilter(dateRange, `${alias}.created_at`);
  const usersFilter = createdFilter('u');
  const vendorsFilter = createdFilter('vp');
  const eventsFilter = createdFilter('e');
  const bookingsFilter = createdFilter('b');
  const paymentsFilter = createdFilter('p');
  const complaintsFilter = createdFilter('c');
  const reviewsFilter = createdFilter('r');
  const queryRows = (sql, values) => database.query(sql, values).then(([rows]) => rows);

  const [
    userRows,
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
  ] = await Promise.all([
    queryRows(
      `SELECT COUNT(*) AS total_users
       FROM users u${usersFilter.sql}`,
      usersFilter.values,
    ),
    queryRows(
      `SELECT COUNT(*) AS total_vendors,
              COALESCE(SUM(vp.verification_status = 'verified'), 0) AS verified_vendors,
              COALESCE(SUM(vp.verification_status = 'pending'), 0) AS pending_vendors
       FROM vendor_profiles vp${vendorsFilter.sql}`,
      vendorsFilter.values,
    ),
    queryRows(
      `SELECT COUNT(*) AS total_events,
              COALESCE(SUM(e.status IN ('active', 'published', 'upcoming', 'open')), 0) AS published_events,
              COALESCE(SUM(e.start_date >= CURRENT_DATE AND e.status IN ('active', 'published', 'upcoming', 'open')), 0) AS upcoming_events
       FROM events e${eventsFilter.sql}`,
      eventsFilter.values,
    ),
    queryRows(
      `SELECT COUNT(*) AS total_bookings,
              COALESCE(SUM(b.status IN ('requested', 'quoted', 'under_review')), 0) AS pending_bookings,
              COALESCE(SUM(b.status = 'accepted'), 0) AS confirmed_bookings,
              COALESCE(SUM(b.status = 'completed'), 0) AS completed_bookings,
              COALESCE(SUM(b.status = 'cancelled'), 0) AS cancelled_bookings
       FROM bookings b${bookingsFilter.sql}`,
      bookingsFilter.values,
    ),
    queryRows(
      `SELECT COUNT(*) AS total_payments,
              COALESCE(SUM(p.status = 'paid'), 0) AS successful_payments,
              COALESCE(SUM(p.status IN ('pending', 'authorized')), 0) AS pending_payments,
              COALESCE(SUM(p.status = 'refund_pending'), 0) AS refund_requests
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
      `SELECT COUNT(*) AS total_complaints,
              COALESCE(SUM(c.status IN ('open', 'investigating')), 0) AS open_complaints
       FROM complaints c${complaintsFilter.sql}`,
      complaintsFilter.values,
    ),
    queryRows(
      `SELECT COUNT(*) AS total_reviews
       FROM reviews r${reviewsFilter.sql}`,
      reviewsFilter.values,
    ),
    queryRows(
      `SELECT b.id, b.status, b.quoted_amount, b.currency, b.created_at,
              e.title AS event_title, u.full_name AS customer_name,
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
      `SELECT DATE_FORMAT(b.created_at, '%Y-%m-%d') AS period, COUNT(*) AS total
       FROM bookings b${bookingsFilter.sql}
       GROUP BY DATE_FORMAT(b.created_at, '%Y-%m-%d')
       ORDER BY period`,
      bookingsFilter.values,
    ),
    queryRows(
      `SELECT DATE_FORMAT(p.created_at, '%Y-%m-%d') AS period, p.currency,
              COUNT(*) AS transactions, SUM(p.amount) AS total
       FROM payments p${paymentsFilter.sql} AND p.status = 'paid'
       GROUP BY DATE_FORMAT(p.created_at, '%Y-%m-%d'), p.currency
       ORDER BY period, p.currency`,
      paymentsFilter.values,
    ),
    queryRows(
      `SELECT COALESCE(NULLIF(TRIM(e.event_type), ''), 'Uncategorized') AS category,
              COUNT(*) AS total
       FROM events e${eventsFilter.sql}
       GROUP BY COALESCE(NULLIF(TRIM(e.event_type), ''), 'Uncategorized')
       ORDER BY total DESC, category ASC`,
      eventsFilter.values,
    ),
    queryRows(
      `SELECT b.status, COUNT(*) AS total
       FROM bookings b${bookingsFilter.sql}
       GROUP BY b.status
       ORDER BY total DESC, b.status ASC`,
      bookingsFilter.values,
    ),
  ]);

  const [users] = userRows;
  const [vendors] = vendorRows;
  const [events] = eventRows;
  const [bookings] = bookingRows;
  const [payments] = paymentRows;
  const [complaints] = complaintRows;
  const [reviews] = reviewRows;

  return {
    users,
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
    filters: dateRange,
  };
}
