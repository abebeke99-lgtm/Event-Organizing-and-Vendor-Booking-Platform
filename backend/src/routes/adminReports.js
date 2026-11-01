import { Router } from 'express';
import { requirePermission } from '../middleware/rbac.js';
import { hasPermission, normalizePermissionKeys } from '../lib/rbac.js';
import { pool } from '../db.js';
import {
  buildReportDateClause,
  calculateRevenueTotals,
  REPORT_SORTS,
  reportQuerySchema,
  resolveReportRange,
} from '../lib/reportAnalytics.js';
import { writeAudit } from '../lib/security.js';

const router = Router();
const databaseFor = (req) => req.app?.locals?.database || pool;
const EXPORT_ROW_LIMIT = 10000;
const CAPTURED_PAYMENT_STATUSES = "('paid','refunded','partially_refunded','refund_pending')";

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const safe = !isNumber && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function parseQuery(req, res) {
  const parsed = reportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Report filters are invalid.',
      details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
    return null;
  }
  return parsed.data;
}

function makeDefinition(report, range, filters) {
  const createdAt = {
    users: 'u.created_at',
    vendors: 'vp.created_at',
    events: 'e.created_at',
    bookings: 'b.created_at',
    payments: 'p.created_at',
    refunds: 'r.created_at',
    revenue: 'p.created_at',
    categories: 'b.created_at',
    reviews: 'r.created_at',
    complaints: 'c.created_at',
    'vendor-performance': 'b.created_at',
    'booking-outcomes': `COALESCE((SELECT MAX(outcome_history.created_at)
      FROM booking_history outcome_history
      WHERE outcome_history.booking_id = b.id AND outcome_history.to_status = b.status), b.created_at)`,
  }[report];
  const date = buildReportDateClause(createdAt, range);
  const clauses = [date.sql];
  const values = [...date.values];
  const add = (sql, ...params) => {
    clauses.push(sql);
    values.push(...params);
  };
  const q = filters.q ? `%${escapeLike(filters.q)}%` : null;

  const definitions = {
    users: {
      from: `FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles role ON role.id = ur.role_id`,
      select: `SELECT u.id, u.full_name, u.email, u.status, u.created_at,
        GROUP_CONCAT(DISTINCT role.name ORDER BY role.name SEPARATOR ', ') AS roles`,
      group: ' GROUP BY u.id',
      countGroup: 'COUNT(DISTINCT u.id)',
      search: q && '(u.full_name LIKE ? OR u.email LIKE ?)',
      searchValues: q && [q, q],
      status: 'u.status',
      orderBy: 'u.created_at',
    },
    vendors: {
      from: `FROM vendor_profiles vp JOIN users vendor_user ON vendor_user.id = vp.user_id
        LEFT JOIN service_categories sc ON sc.id = vp.category_id`,
      select: `SELECT vp.id, vp.business_name, vendor_user.full_name AS contact_name,
        vendor_user.email, sc.name AS category_name, vp.verification_status AS status,
        vp.verified_at, vp.created_at`,
      search: q && '(vp.business_name LIKE ? OR vendor_user.full_name LIKE ? OR vendor_user.email LIKE ? OR sc.name LIKE ?)',
      searchValues: q && [q, q, q, q],
      status: 'vp.verification_status',
      orderBy: 'vp.created_at',
    },
    events: {
      from: `FROM events e JOIN users organizer ON organizer.id = e.organizer_id`,
      select: `SELECT e.id, e.title, e.event_type, e.status, e.city, e.start_date, e.published_at, e.created_at,
        organizer.full_name AS organizer_name, organizer.email AS organizer_email`,
      search: q && '(e.title LIKE ? OR e.event_type LIKE ? OR organizer.full_name LIKE ? OR organizer.email LIKE ?)',
      searchValues: q && [q, q, q, q],
      status: 'e.status',
      orderBy: 'e.created_at',
    },
    bookings: {
      from: `FROM bookings b JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT b.id, CONCAT('BK-', b.id) AS booking_reference, e.title AS event_title,
        customer.id AS customer_id, customer.full_name AS customer_name, customer.email AS customer_email,
        b.vendor_id, COALESCE(s.category_id, vp.category_id) AS category_id,
        vp.business_name AS vendor_name, COALESCE(s.title, b.service_description) AS service,
        sc.name AS category_name, b.status, b.quoted_amount AS amount, b.currency, b.created_at`,
      search: q && `(CAST(b.id AS CHAR) LIKE ? OR e.title LIKE ? OR customer.full_name LIKE ?
        OR customer.email LIKE ? OR vp.business_name LIKE ? OR COALESCE(s.title, b.service_description) LIKE ?)`,
      searchValues: q && [q, q, q, q, q, q],
      status: 'b.status',
      orderBy: 'b.created_at',
      category: 'COALESCE(s.category_id, vp.category_id)',
      vendor: 'b.vendor_id',
      customer: 'customer.id',
    },
    payments: {
      from: `FROM payments p JOIN bookings b ON b.id = p.booking_id
        JOIN events e ON e.id = b.event_id JOIN users customer ON customer.id = e.organizer_id`,
      select: `SELECT p.id, CONCAT('BK-', b.id) AS booking_reference,
        customer.id AS customer_id, customer.full_name AS customer_name,
        p.provider AS payment_provider, p.payment_method, p.provider_reference AS transaction_reference,
        p.status, p.amount, p.currency, p.created_at,
        COALESCE((SELECT SUM(rf.amount) FROM refund_requests rf
          WHERE rf.payment_id = p.id AND rf.status = 'succeeded'), 0) AS refunded_amount`,
      search: q && `(CAST(p.id AS CHAR) LIKE ? OR COALESCE(p.provider_reference, '') LIKE ?
        OR CAST(b.id AS CHAR) LIKE ? OR CONCAT('BK-', b.id) LIKE ?
        OR customer.full_name LIKE ? OR COALESCE(p.provider, '') LIKE ?)`,
      searchValues: q && [q, q, q, q, q, q],
      status: 'p.status',
      orderBy: 'p.created_at',
      customer: 'customer.id',
    },
    refunds: {
      from: `FROM refund_requests r JOIN payments p ON p.id = r.payment_id
        JOIN bookings b ON b.id = p.booking_id JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id`,
      select: `SELECT r.id, p.provider_reference AS transaction_reference,
        CONCAT('BK-', b.id) AS booking_reference, customer.id AS customer_id,
        customer.full_name AS customer_name,
        r.amount, r.currency, r.reason, r.status, r.created_at, r.decided_at, r.processed_at,
        r.provider_refund_reference`,
      search: q && `(CAST(r.id AS CHAR) LIKE ? OR COALESCE(p.provider_reference, '') LIKE ?
        OR CAST(b.id AS CHAR) LIKE ? OR CONCAT('BK-', b.id) LIKE ? OR customer.full_name LIKE ?)`,
      searchValues: q && [q, q, q, q, q],
      status: 'r.status',
      orderBy: 'r.created_at',
      customer: 'customer.id',
    },
    reviews: {
      from: `FROM reviews r JOIN bookings b ON b.id = r.booking_id
        JOIN events e ON e.id = b.event_id JOIN users customer ON customer.id = e.organizer_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id`,
      select: `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
        customer.id AS customer_id, b.vendor_id, COALESCE(s.category_id, vp.category_id) AS category_id,
        customer.full_name AS customer_name, vp.business_name AS vendor_name,
        COALESCE(s.title, b.service_description) AS service, CONCAT('BK-', b.id) AS booking_reference`,
      search: q && `(r.comment LIKE ? OR customer.full_name LIKE ? OR vp.business_name LIKE ? OR COALESCE(s.title, '') LIKE ?)`,
      searchValues: q && [q, q, q, q],
      status: 'r.status',
      orderBy: 'r.created_at',
      vendor: 'b.vendor_id',
      customer: 'customer.id',
      category: 'COALESCE(s.category_id, vp.category_id)',
    },
    complaints: {
      from: `FROM complaints c JOIN users customer ON customer.id = c.user_id
        LEFT JOIN bookings b ON b.id = c.booking_id
        LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT c.id, c.subject, c.details, c.status, c.resolution, c.created_at,
        c.user_id AS customer_id, b.vendor_id, COALESCE(s.category_id, vp.category_id) AS category_id,
        customer.full_name AS customer_name, customer.email AS customer_email,
        sc.name AS category_name,
        CONCAT('BK-', b.id) AS booking_reference, vp.business_name AS vendor_name`,
      search: q && `(c.subject LIKE ? OR c.details LIKE ? OR customer.full_name LIKE ? OR customer.email LIKE ? OR vp.business_name LIKE ?)`,
      searchValues: q && [q, q, q, q, q],
      status: 'c.status',
      orderBy: 'c.created_at',
      vendor: 'b.vendor_id',
      customer: 'customer.id',
      category: 'COALESCE(s.category_id, vp.category_id)',
    },
    'booking-outcomes': {
      from: `FROM bookings b JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT b.id, CONCAT('BK-', b.id) AS booking_reference, e.title AS event_title,
        customer.id AS customer_id, customer.full_name AS customer_name,
        b.vendor_id, COALESCE(s.category_id, vp.category_id) AS category_id,
        vp.business_name AS vendor_name,
        COALESCE(s.title, b.service_description) AS service, b.status,
        b.quoted_amount AS amount, b.currency, b.created_at,
        COALESCE((SELECT MAX(outcome_history.created_at) FROM booking_history outcome_history
          WHERE outcome_history.booking_id = b.id AND outcome_history.to_status = b.status), b.created_at) AS outcome_at`,
      search: q && `(CAST(b.id AS CHAR) LIKE ? OR e.title LIKE ? OR customer.full_name LIKE ? OR vp.business_name LIKE ?)`,
      searchValues: q && [q, q, q, q],
      status: 'b.status',
      orderBy: 'b.created_at',
      vendor: 'b.vendor_id',
      customer: 'customer.id',
      category: 'COALESCE(s.category_id, vp.category_id)',
    },
  };

  if (report === 'revenue') {
    if (filters.currency) {
      add('p.currency = ?', filters.currency);
    }
    return { kind: 'revenue', clauses, values, filters };
  }

  if (report === 'categories') {
    const categoryDefinition = {
      from: `FROM bookings b JOIN events e ON e.id = b.event_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT sc.id AS category_id, COALESCE(sc.name, 'Uncategorized') AS category_name,
        COUNT(*) AS total_bookings,
        SUM(b.status = 'completed') AS completed_bookings,
        SUM(b.status = 'cancelled') AS cancelled_bookings,
        SUM(b.status NOT IN ('completed','cancelled')) AS active_bookings,
        COUNT(DISTINCT b.vendor_id) AS vendor_count`,
      group: ' GROUP BY sc.id, sc.name',
      chartSelect: `SELECT COALESCE(sc.name, 'Uncategorized') AS label, COUNT(*) AS value`,
      chartGroup: ' GROUP BY sc.id, sc.name',
      search: q && 'COALESCE(sc.name, ?) LIKE ?',
      searchValues: q && ['Uncategorized', q],
      status: 'b.status',
      orderBy: 'total_bookings',
      category: 'COALESCE(s.category_id, vp.category_id)',
      vendor: 'b.vendor_id',
      customer: 'e.organizer_id',
    };
    Object.assign(definitions, { categories: categoryDefinition });
  }

  if (report === 'vendor-performance') {
    const vendorDefinition = {
      from: `FROM vendor_profiles vp JOIN users vendor_user ON vendor_user.id = vp.user_id
        JOIN bookings b ON b.vendor_id = vp.id JOIN events e ON e.id = b.event_id
        LEFT JOIN services service ON service.id = b.service_id`,
      select: `SELECT vp.id AS vendor_id, vp.business_name, vp.verification_status,
        COUNT(b.id) AS total_bookings,
        SUM(b.status = 'completed') AS completed_bookings,
        SUM(b.status = 'cancelled') AS cancelled_bookings,
        AVG((SELECT AVG(rating) FROM reviews review_row WHERE review_row.booking_id = b.id)) AS average_rating`,
      group: ' GROUP BY vp.id, vp.business_name, vp.verification_status',
      chartSelect: `SELECT vp.business_name AS label, COUNT(b.id) AS value`,
      chartGroup: ' GROUP BY vp.id, vp.business_name, vp.verification_status',
      search: q && '(vp.business_name LIKE ? OR vendor_user.full_name LIKE ?)',
      searchValues: q && [q, q],
      status: 'b.status',
      orderBy: 'total_bookings',
      vendor: 'vp.id',
      customer: 'e.organizer_id',
      category: 'COALESCE(service.category_id, vp.category_id)',
    };
    Object.assign(definitions, { 'vendor-performance': vendorDefinition });
  }

  if (report === 'payments') {
    if (filters.currency) add('p.currency = ?', filters.currency);
  } else if (report === 'refunds') {
    if (filters.currency) add('r.currency = ?', filters.currency);
  } else if (report === 'bookings' || report === 'booking-outcomes') {
    if (filters.currency) add('b.currency = ?', filters.currency);
  }

  const definition = definitions[report];
  if (!definition) throw Object.assign(new Error('Unsupported report.'), { status: 400 });
  if (definition.search && q) add(definition.search, ...definition.searchValues);
  if (definition.status && filters.status) add(`${definition.status} = ?`, filters.status);
  if (definition.category && filters.categoryId) add(`${definition.category} = ?`, filters.categoryId);
  if (definition.vendor && filters.vendorId) add(`${definition.vendor} = ?`, filters.vendorId);
  if (definition.customer && filters.customerId) add(`${definition.customer} = ?`, filters.customerId);

  if (report === 'booking-outcomes' && !filters.status) {
    add("b.status IN ('completed','cancelled')");
  }
  return { kind: 'table', definition, clauses, values, filters };
}

function getWhere(definition) {
  return ` WHERE ${definition.clauses.join(' AND ')}`;
}

function getOrdering(report, filters) {
  const allowed = REPORT_SORTS[report];
  const requested = filters.sortBy && Object.hasOwn(allowed, filters.sortBy) ? filters.sortBy : Object.keys(allowed)[0];
  const tieBreaker = {
    users: 'u.id',
    vendors: 'vp.id',
    events: 'e.id',
    bookings: 'b.id',
    payments: 'p.id',
    refunds: 'r.id',
    revenue: 'period',
    categories: 'category_id',
    reviews: 'r.id',
    complaints: 'c.id',
    'vendor-performance': 'vp.id',
    'booking-outcomes': 'b.id',
  }[report];
  return `${allowed[requested]} ${filters.sortDirection.toUpperCase()}, ${tieBreaker} DESC`;
}

async function getCurrencySettings(database) {
  const [rows] = await database.execute(
    `SELECT setting_key, setting_value FROM system_settings
     WHERE setting_key IN ('platform_currency','report_timezone')`,
  );
  const saved = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  const timeZone = saved.report_timezone || 'Africa/Addis_Ababa';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw Object.assign(new Error('The configured report timezone is invalid.'), { status: 500 });
  }
  const [[databaseZone]] = await database.execute(
    `SELECT CONVERT_TZ('2000-01-01 00:00:00', '+00:00', @@session.time_zone) AS database_time`,
  );
  if (!databaseZone?.database_time) {
    throw Object.assign(new Error('MySQL timezone conversion is unavailable for this database session.'), { status: 503 });
  }
  return { currency: saved.platform_currency || 'ETB', timeZone };
}

function financialDateWhere(column, range) {
  return buildReportDateClause(column, range);
}

async function queryRevenue(database, range, filters) {
  const [[timezoneCheck]] = await database.execute(
    `SELECT CONVERT_TZ('2000-01-01 00:00:00', @@session.time_zone, ?) AS local_time`,
    [range.timeZone],
  );
  if (!timezoneCheck?.local_time) {
    throw Object.assign(new Error('MySQL timezone tables are required for revenue reports.'), { status: 503 });
  }
  const paymentDate = financialDateWhere('p.created_at', range);
  const refundDate = financialDateWhere('r.processed_at', range);
  const paymentClauses = [paymentDate.sql, `p.status IN ${CAPTURED_PAYMENT_STATUSES}`];
  const refundClauses = [refundDate.sql, "r.status = 'succeeded'"];
  const paymentValues = [...paymentDate.values];
  const refundValues = [...refundDate.values];
  if (filters.currency) {
    paymentClauses.push('p.currency = ?');
    refundClauses.push('r.currency = ?');
    paymentValues.push(filters.currency);
    refundValues.push(filters.currency);
  }
  const [paymentTotals] = await database.execute(
    `SELECT p.currency, COALESCE(SUM(p.amount), 0) AS gross_payments
     FROM payments p WHERE ${paymentClauses.join(' AND ')} GROUP BY p.currency`,
    paymentValues,
  );
  const [paymentRows] = await database.execute(
    `SELECT DATE(CONVERT_TZ(p.created_at, @@session.time_zone, ?)) AS period,
       p.currency, SUM(p.amount) AS gross_payments
     FROM payments p WHERE ${paymentClauses.join(' AND ')}
     GROUP BY period, p.currency ORDER BY period, p.currency`,
    [range.timeZone, ...paymentValues],
  );
  const [refundTotals] = await database.execute(
    `SELECT r.currency, COALESCE(SUM(r.amount), 0) AS refund_amount
     FROM refund_requests r WHERE ${refundClauses.join(' AND ')} GROUP BY r.currency`,
    refundValues,
  );
  const [refundRows] = await database.execute(
    `SELECT DATE(CONVERT_TZ(r.processed_at, @@session.time_zone, ?)) AS period,
       r.currency, SUM(r.amount) AS refund_amount
     FROM refund_requests r WHERE ${refundClauses.join(' AND ')}
     GROUP BY period, r.currency ORDER BY period, r.currency`,
    [range.timeZone, ...refundValues],
  );

  const currencies = calculateRevenueTotals(
    paymentTotals.map((row) => ({ currency: row.currency, gross_amount: row.gross_payments })),
    refundTotals.map((row) => ({ currency: row.currency, refund_amount: row.refund_amount })),
  );

  const seriesByPeriod = new Map();
  for (const row of paymentRows) {
    const key = `${row.period}|${row.currency}`;
    seriesByPeriod.set(key, {
      period: row.period,
      currency: row.currency,
      grossPayments: Number(row.gross_payments || 0),
      refunds: 0,
    });
  }
  for (const row of refundRows) {
    const key = `${row.period}|${row.currency}`;
    const item = seriesByPeriod.get(key) || { period: row.period, currency: row.currency, grossPayments: 0, refunds: 0 };
    item.refunds = Number(row.refund_amount || 0);
    seriesByPeriod.set(key, item);
  }
  const rows = [...seriesByPeriod.values()].map((item) => ({
    ...item,
    netRevenue: item.grossPayments - item.refunds,
  })).sort((a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency));
  return { rows, currencies };
}

function summarizeGroups(rows, field = 'status') {
  return rows.map((row) => ({
    label: row[field] || 'Unknown',
    value: Number(row.total || 0),
  }));
}

function getFinancialReport(report) {
  return ['payments', 'refunds', 'revenue'].includes(report);
}

async function loadReport(req, res, isExport) {
  const filters = parseQuery(req, res);
  if (!filters) return;
  if (getFinancialReport(filters.report)) {
    const permissions = normalizePermissionKeys(req.user?.permissions ?? req.permissions ?? []);
    if (!hasPermission(permissions, 'payments.view')) {
      return res.status(403).json({ error: 'You do not have permission to view financial reports.' });
    }
  }
  const database = databaseFor(req);
  try {
    const settings = await getCurrencySettings(database);
    const range = resolveReportRange(filters, { timeZone: settings.timeZone });
    const appliedFilters = {
      report: filters.report,
      period: range.period,
      startDate: range.startDate,
      endDate: range.endDate,
      timeZone: range.timeZone,
      currency: filters.currency || null,
      status: filters.status || null,
      q: filters.q || '',
      categoryId: filters.categoryId || null,
      vendorId: filters.vendorId || null,
      customerId: filters.customerId || null,
      sortBy: filters.sortBy || Object.keys(REPORT_SORTS[filters.report])[0],
      sortDirection: filters.sortDirection,
    };
    let rows;
    let summary;
    let chartData = [];
    let total;
    let definition;

    if (filters.report === 'revenue') {
      const revenue = await queryRevenue(database, range, filters);
      rows = revenue.rows;
      summary = revenue.currencies.map((item) => ({
        ...item,
        label: item.currency,
        value: item.netRevenue,
      }));
      chartData = rows.map((row) => ({
        label: row.period,
        value: row.netRevenue,
        currency: row.currency,
        grossPayments: row.grossPayments,
        refunds: row.refunds,
      }));
      total = rows.length;
      if (isExport && total > EXPORT_ROW_LIMIT) {
        return res.status(413).json({
          error: `This export contains ${total} rows. Narrow the date range or filters to ${EXPORT_ROW_LIMIT} rows or fewer.`,
        });
      }
      {
        const selectedSort = filters.sortBy || Object.keys(REPORT_SORTS.revenue)[0];
        const key = REPORT_SORTS.revenue[selectedSort];
        const field = key === 'period' ? 'period' : key;
        rows.sort((a, b) => {
          const result = String(a[field]).localeCompare(String(b[field]), undefined, { numeric: true });
          return filters.sortDirection === 'asc' ? result : -result;
        });
      }
      if (!isExport) {
        rows = rows.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
      }
    } else {
      definition = makeDefinition(filters.report, range, filters);
      const where = getWhere(definition);
      const { definition: reportDefinition } = definition;
      const orderBy = getOrdering(filters.report, filters);
      const [countRows] = await database.execute(
        `SELECT COUNT(*) AS total FROM (SELECT 1 ${reportDefinition.from}${where}${reportDefinition.group || ''}) report_rows`,
        definition.values,
      );
      total = Number(countRows[0]?.total || 0);
      if (isExport && total > EXPORT_ROW_LIMIT) {
        return res.status(413).json({
          error: `This export contains ${total} rows. Narrow the date range or filters to ${EXPORT_ROW_LIMIT} rows or fewer.`,
        });
      }
      const limit = isExport ? EXPORT_ROW_LIMIT + 1 : filters.pageSize;
      const offset = isExport ? 0 : (filters.page - 1) * filters.pageSize;
      const [resultRows] = await database.execute(
        `${reportDefinition.select} ${reportDefinition.from}${where}${reportDefinition.group || ''}
         ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [...definition.values, limit, offset],
      );
      rows = resultRows;

      let groupRows = [];
      if (reportDefinition.chartSelect) {
        const [chartRows] = await database.execute(
          `${reportDefinition.chartSelect} ${reportDefinition.from}${where}${reportDefinition.chartGroup}
           ORDER BY value DESC LIMIT 20`,
          definition.values,
        );
        chartData = chartRows.map((row) => ({ label: row.label || 'Unknown', value: Number(row.value || 0) }));
      } else {
        const groupExpression = reportDefinition.status || "'all'";
        const groupCount = reportDefinition.countGroup || 'COUNT(*)';
        const [statusRows] = await database.execute(
          `SELECT ${groupExpression} AS status, ${groupCount} AS total
           ${reportDefinition.from}${where}
           GROUP BY ${groupExpression}`,
          definition.values,
        );
        groupRows = statusRows;
        chartData = summarizeGroups(groupRows);
      }
      summary = reportDefinition.chartSelect
        ? [{ label: 'Records', value: total }]
        : [{ label: 'Records', value: total }, ...summarizeGroups(groupRows)];
    }

    if (isExport && total > EXPORT_ROW_LIMIT) {
      return res.status(413).json({
        error: `This export contains ${total} rows. Narrow the date range or filters to ${EXPORT_ROW_LIMIT} rows or fewer.`,
      });
    }
    if (isExport) {
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const csv = [
        `# Generated at: ${new Date().toISOString()}`,
        `# Applied filters: ${JSON.stringify(appliedFilters)}`,
        ...(headers.length ? [headers.map(csvCell).join(',')] : []),
        ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
      ].join('\r\n');
      await writeAudit(database, {
        actorId: req.user?.id,
        action: 'reports.exported',
        entityType: 'report',
        details: { report: filters.report, filters: appliedFilters, rowCount: rows.length },
        ip: req.ip,
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filters.report}-report.csv"`);
      return res.send(`\uFEFF${csv}`);
    }
    return res.json({
      data: rows,
      summary,
      chartData,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
      generatedAt: new Date().toISOString(),
      appliedFilters,
      configuredCurrency: settings.currency,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Administrator report generation failed:', error.code || error.name || 'unknown error');
    return res.status(500).json({ error: 'The report could not be generated.' });
  }
}

router.get('/', requirePermission('reports.view'), (req, res) => loadReport(req, res, false));
router.get('/export', requirePermission('reports.export'), (req, res) => {
  if (['payments', 'refunds', 'revenue'].includes(String(req.query.report))) {
    const permissions = normalizePermissionKeys(req.user?.permissions ?? req.permissions ?? []);
    if (!hasPermission(permissions, 'payments.export')) {
      return res.status(403).json({ error: 'You do not have permission to export financial reports.' });
    }
  }
  return loadReport(req, res, true);
});

export default router;
