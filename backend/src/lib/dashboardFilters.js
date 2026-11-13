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
  const queryRows = async (sql, values) => {
    if (dialect !== 'postgres') {
      const result = await database.query(sql, values);
      return result[0];
    }
    return (await database.query(sql, values)).rows;
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

  if (dialect === 'postgres') {
    const [row] = await queryRows(
      `WITH user_summary AS (
         SELECT COUNT(*)::int AS total_users FROM users u${usersFilter.sql}
       ),
       role_summary AS (
         SELECT
           COUNT(DISTINCT CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN u.id END)::int AS total_administrators,
           COUNT(DISTINCT CASE WHEN LOWER(r.name) = 'customer' THEN u.id END)::int AS total_customers,
           COUNT(DISTINCT CASE WHEN LOWER(r.name) = 'organizer' THEN u.id END)::int AS total_organizers,
           COUNT(DISTINCT CASE WHEN LOWER(r.name) = 'vendor' THEN u.id END)::int AS total_vendors
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE${usersFilter.sql}
       ),
       vendor_summary AS (
         SELECT COUNT(*)::int AS total_vendors,
                COUNT(*) FILTER (WHERE vp.verification_status = 'verified')::int AS verified_vendors,
                COUNT(*) FILTER (WHERE vp.verification_status = 'pending')::int AS pending_vendors
         FROM vendor_profiles vp${vendorsFilter.sql}
       ),
       event_summary AS (
         SELECT COUNT(*)::int AS total_events,
                COUNT(*) FILTER (WHERE e.status IN ('active', 'published', 'upcoming', 'open'))::int AS published_events,
                COUNT(*) FILTER (WHERE e.start_date >= CURRENT_DATE
                  AND e.status IN ('active', 'published', 'upcoming', 'open'))::int AS upcoming_events
         FROM events e${eventsFilter.sql}
       ),
       booking_summary AS (
         SELECT COUNT(*)::int AS total_bookings,
                COUNT(*) FILTER (WHERE b.status IN ('requested', 'quoted', 'under_review'))::int AS pending_bookings,
                COUNT(*) FILTER (WHERE b.status = 'accepted')::int AS confirmed_bookings,
                COUNT(*) FILTER (WHERE b.status = 'completed')::int AS completed_bookings,
                COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled_bookings
         FROM bookings b${bookingsFilter.sql}
       ),
       payment_summary AS (
         SELECT COUNT(*)::int AS total_payments,
                COUNT(*) FILTER (WHERE p.status = 'paid')::int AS successful_payments,
                COUNT(*) FILTER (WHERE p.status IN ('pending', 'authorized'))::int AS pending_payments,
                COUNT(*) FILTER (WHERE p.status = 'refund_pending')::int AS refund_requests
         FROM payments p${paymentsFilter.sql}
       ),
       complaint_summary AS (
         SELECT COUNT(*)::int AS total_complaints,
                COUNT(*) FILTER (WHERE c.status IN ('open', 'under_review'))::int AS open_complaints
         FROM complaints c${complaintsFilter.sql}
       ),
       review_summary AS (
         SELECT COUNT(*)::int AS total_reviews FROM reviews r${reviewsFilter.sql}
       ),
       revenue_by_currency AS (
         SELECT COALESCE(jsonb_agg(
           jsonb_build_object('currency', revenue.currency, 'total', revenue.total::text)
           ORDER BY revenue.currency
         ), '[]'::jsonb) AS data
         FROM (
           SELECT p.currency, SUM(p.amount) AS total
           FROM payments p${paymentsFilter.sql} AND p.status = 'paid'
           GROUP BY p.currency
         ) revenue
       ),
       event_categories AS (
         SELECT COALESCE(jsonb_agg(
           jsonb_build_object('category', category, 'total', total)
           ORDER BY total DESC, category ASC
         ), '[]'::jsonb) AS data
         FROM (
           SELECT COALESCE(NULLIF(TRIM(e.event_type), ''), 'Uncategorized') AS category,
                  COUNT(*)::int AS total
           FROM events e${eventsFilter.sql}
           GROUP BY COALESCE(NULLIF(TRIM(e.event_type), ''), 'Uncategorized')
         ) categories
       ),
       booking_statuses AS (
         SELECT COALESCE(jsonb_agg(
           jsonb_build_object('status', status, 'total', total)
           ORDER BY total DESC, status ASC
         ), '[]'::jsonb) AS data
         FROM (
           SELECT b.status, COUNT(*)::int AS total
           FROM bookings b${bookingsFilter.sql}
           GROUP BY b.status
         ) statuses
       ),
       recent_bookings AS (
         SELECT b.id::text AS id, b.status, b.quoted_amount::text AS quoted_amount,
                b.currency, b.created_at,
                e.title AS event_title, u.full_name AS organizer_name,
                vp.business_name AS vendor_name
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         JOIN users u ON u.id = e.organizer_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id${bookingsFilter.sql}
         ORDER BY b.created_at DESC, b.id DESC LIMIT 8
       ),
       recent_vendor_requests AS (
         SELECT vp.id::text AS id, vp.business_name, vp.created_at,
                u.full_name AS applicant_name, u.email
         FROM vendor_profiles vp
         JOIN users u ON u.id = vp.user_id${vendorsFilter.sql} AND vp.verification_status = 'pending'
         ORDER BY vp.created_at DESC, vp.id DESC LIMIT 6
       ),
       recent_complaints AS (
         SELECT c.id::text AS id, c.subject, c.status, c.created_at, u.full_name AS customer_name
         FROM complaints c
         JOIN users u ON u.id = c.user_id${complaintsFilter.sql}
         ORDER BY c.created_at DESC, c.id DESC LIMIT 6
       ),
       recent_reviews AS (
         SELECT r.id::text AS id, r.rating, r.comment, r.status, r.created_at,
                u.full_name AS customer_name, vp.business_name AS vendor_name
         FROM reviews r
         JOIN bookings b ON b.id = r.booking_id
         JOIN events e ON e.id = b.event_id
         JOIN users u ON u.id = e.organizer_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id${reviewsFilter.sql}
         ORDER BY r.created_at DESC, r.id DESC LIMIT 6
       ),
       trend_summary AS (
         SELECT
           (SELECT COALESCE(jsonb_agg(
              jsonb_build_object('period', period, 'total', total) ORDER BY period
            ), '[]'::jsonb)
            FROM (
              SELECT ${bookingPeriod} AS period, COUNT(*)::int AS total
              FROM bookings b${bookingsFilter.sql}
              GROUP BY ${bookingPeriod}
            ) booking_trends) AS booking_trend,
           (SELECT COALESCE(jsonb_agg(
              jsonb_build_object('period', period, 'currency', currency,
                'transactions', transactions, 'total', total::text)
              ORDER BY period, currency
            ), '[]'::jsonb)
            FROM (
              SELECT ${paymentPeriod} AS period, p.currency,
                     COUNT(*)::int AS transactions, SUM(p.amount) AS total
              FROM payments p${paymentsFilter.sql} AND p.status = 'paid'
              GROUP BY ${paymentPeriod}, p.currency
            ) payment_trends) AS payment_trend
       ),
       recent_activities AS (
         SELECT a.id::text AS id, a.action, a.entity_type, a.entity_id, a.created_at,
                u.full_name AS actor_name
         FROM audit_logs a
         JOIN users u ON u.id = a.actor_id${createdFilter('a').sql}
         ORDER BY a.created_at DESC, a.id DESC LIMIT 8
       )
       SELECT user_summary.total_users,
              role_summary.total_administrators, role_summary.total_customers,
              role_summary.total_organizers, role_summary.total_vendors,
              vendor_summary.total_vendors, vendor_summary.verified_vendors, vendor_summary.pending_vendors,
              event_summary.total_events, event_summary.published_events, event_summary.upcoming_events,
              booking_summary.total_bookings, booking_summary.pending_bookings, booking_summary.confirmed_bookings,
              booking_summary.completed_bookings, booking_summary.cancelled_bookings,
              payment_summary.total_payments, payment_summary.successful_payments,
              payment_summary.pending_payments, payment_summary.refund_requests,
              complaint_summary.total_complaints, complaint_summary.open_complaints,
              review_summary.total_reviews, revenue_by_currency.data AS revenue_by_currency,
              event_categories.data AS event_categories, booking_statuses.data AS booking_statuses,
              trend_summary.booking_trend, trend_summary.payment_trend,
              COALESCE((SELECT jsonb_agg(to_jsonb(recent_bookings)
                ORDER BY recent_bookings.created_at DESC, recent_bookings.id DESC)
                FROM recent_bookings), '[]'::jsonb) AS recent_bookings,
              COALESCE((SELECT jsonb_agg(to_jsonb(recent_vendor_requests)
                ORDER BY recent_vendor_requests.created_at DESC, recent_vendor_requests.id DESC)
                FROM recent_vendor_requests), '[]'::jsonb) AS recent_vendor_requests,
              COALESCE((SELECT jsonb_agg(to_jsonb(recent_complaints)
                ORDER BY recent_complaints.created_at DESC, recent_complaints.id DESC)
                FROM recent_complaints), '[]'::jsonb) AS recent_complaints,
              COALESCE((SELECT jsonb_agg(to_jsonb(recent_reviews)
                ORDER BY recent_reviews.created_at DESC, recent_reviews.id DESC)
                FROM recent_reviews), '[]'::jsonb) AS recent_reviews,
              COALESCE((SELECT jsonb_agg(to_jsonb(recent_activities)
                ORDER BY recent_activities.created_at DESC, recent_activities.id DESC)
                FROM recent_activities), '[]'::jsonb) AS recent_activities
       FROM user_summary
       CROSS JOIN role_summary
       CROSS JOIN vendor_summary
       CROSS JOIN event_summary
       CROSS JOIN booking_summary
       CROSS JOIN payment_summary
       CROSS JOIN complaint_summary
       CROSS JOIN review_summary
       CROSS JOIN revenue_by_currency
       CROSS JOIN event_categories
       CROSS JOIN booking_statuses
       CROSS JOIN trend_summary`,
      usersFilter.values,
    );

    if (!row) throw new Error('PostgreSQL dashboard summary query returned no result.');
    return {
      users: { total_users: row.total_users },
      userRoles: {
        total_administrators: row.total_administrators,
        total_customers: row.total_customers,
        total_organizers: row.total_organizers,
        total_vendors: row.total_vendors,
      },
      vendors: {
        total_vendors: row.total_vendors,
        verified_vendors: row.verified_vendors,
        pending_vendors: row.pending_vendors,
      },
      events: {
        total_events: row.total_events,
        published_events: row.published_events,
        upcoming_events: row.upcoming_events,
      },
      bookings: {
        total_bookings: row.total_bookings,
        pending_bookings: row.pending_bookings,
        confirmed_bookings: row.confirmed_bookings,
        completed_bookings: row.completed_bookings,
        cancelled_bookings: row.cancelled_bookings,
      },
      payments: {
        total_payments: row.total_payments,
        successful_payments: row.successful_payments,
        pending_payments: row.pending_payments,
        refund_requests: row.refund_requests,
      },
      revenueByCurrency: row.revenue_by_currency,
      complaints: {
        total_complaints: row.total_complaints,
        open_complaints: row.open_complaints,
      },
      reviews: { total_reviews: row.total_reviews },
      recentBookings: row.recent_bookings,
      recentVendorRequests: row.recent_vendor_requests,
      recentComplaints: row.recent_complaints,
      recentReviews: row.recent_reviews,
      bookingTrend: buildDashboardTrends(row.booking_trend, row.payment_trend),
      eventCategories: row.event_categories,
      bookingStatuses: row.booking_statuses,
      recentActivities: row.recent_activities,
      filters: dateRange,
    };
  }

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
