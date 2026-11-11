import { Router } from 'express';
import { hasPermission, normalizePermissionKeys } from '../lib/rbac.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  calculateRevenueTotals,
  REPORT_SORTS,
  reportQuerySchema,
  resolveReportRange,
} from '../lib/reportAnalytics.js';

const EXPORT_ROW_LIMIT = 10000;
const CAPTURED_PAYMENT_STATUSES = ['paid', 'refunded', 'partially_refunded', 'refund_pending'];
const numericIdFields = new Set(['id', 'category_id', 'customer_id', 'vendor_id']);

function normalizeReportRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    numericIdFields.has(key) && value !== null && Number.isSafeInteger(Number(value)) ? Number(value) : value,
  ]));
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const safe = !isNumber && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
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

function dateValue(value) {
  return new Date(`${value.replace(' ', 'T')}Z`).toISOString();
}

function createDefinition(report, range, filters) {
  const values = [dateValue(range.startAt), dateValue(range.endAt)];
  const clauses = ['created_at >= $1::timestamptz', 'created_at < $2::timestamptz'];
  const search = filters.q ? `%${filters.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const definitions = {
    users: {
      from: `FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles role ON role.id = ur.role_id`,
      select: `SELECT u.id, u.full_name, u.email, u.status, u.created_at,
        STRING_AGG(DISTINCT role.name, ', ' ORDER BY role.name) AS roles`,
      group: ' GROUP BY u.id',
      countGroup: 'COUNT(DISTINCT u.id)',
      status: 'u.status',
      createdAt: 'u.created_at',
      search: '(u.full_name ILIKE $n OR u.email ILIKE $n)',
      searchValues: 2,
    },
    vendors: {
      from: `FROM vendor_profiles vp
        JOIN users vendor_user ON vendor_user.id = vp.user_id
        LEFT JOIN service_categories sc ON sc.id = vp.category_id`,
      select: `SELECT vp.id, vp.business_name, vendor_user.full_name AS contact_name,
        vendor_user.email, sc.name AS category_name, vp.verification_status AS status,
        vp.verified_at, vp.created_at`,
      status: 'vp.verification_status',
      createdAt: 'vp.created_at',
      search: '(vp.business_name ILIKE $n OR vendor_user.full_name ILIKE $n OR vendor_user.email ILIKE $n OR sc.name ILIKE $n)',
      searchValues: 4,
    },
    events: {
      from: 'FROM events e JOIN users organizer ON organizer.id = e.organizer_id',
      select: `SELECT e.id, e.title, e.event_type, e.status, e.city, e.start_date, e.published_at, e.created_at,
        organizer.full_name AS organizer_name, organizer.email AS organizer_email`,
      status: 'e.status',
      createdAt: 'e.created_at',
      search: '(e.title ILIKE $n OR e.event_type ILIKE $n OR organizer.full_name ILIKE $n OR organizer.email ILIKE $n)',
      searchValues: 4,
    },
    bookings: {
      from: `FROM bookings b
        JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT b.id, 'BK-' || b.id::text AS booking_reference, e.title AS event_title,
        customer.id AS customer_id, customer.full_name AS customer_name, customer.email AS customer_email,
        b.vendor_id, COALESCE(s.category_id, vp.category_id) AS category_id,
        vp.business_name AS vendor_name, COALESCE(s.title, b.service_description) AS service,
        sc.name AS category_name, b.status, b.quoted_amount AS amount, b.currency, b.created_at`,
      status: 'b.status',
      createdAt: 'b.created_at',
      search: `(b.id::text ILIKE $n OR e.title ILIKE $n OR customer.full_name ILIKE $n
        OR customer.email ILIKE $n OR vp.business_name ILIKE $n
        OR COALESCE(s.title, b.service_description) ILIKE $n)`,
      searchValues: 6,
      category: 'COALESCE(s.category_id, vp.category_id)',
      vendor: 'b.vendor_id',
      customer: 'customer.id',
      currency: 'b.currency',
    },
    payments: {
      from: `FROM payments p
        JOIN bookings b ON b.id = p.booking_id
        JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id`,
      select: `SELECT p.id, 'BK-' || b.id::text AS booking_reference,
        customer.id AS customer_id, customer.full_name AS customer_name,
        p.provider AS payment_provider, p.payment_method, p.provider_reference AS transaction_reference,
        p.status, p.amount, p.currency, p.created_at,
        COALESCE((SELECT SUM(rf.amount) FROM refund_requests rf
          WHERE rf.payment_id = p.id AND rf.status = 'succeeded'), 0) AS refunded_amount`,
      status: 'p.status',
      createdAt: 'p.created_at',
      search: `(p.id::text ILIKE $n OR COALESCE(p.provider_reference, '') ILIKE $n
        OR b.id::text ILIKE $n OR ('BK-' || b.id::text) ILIKE $n
        OR customer.full_name ILIKE $n OR COALESCE(p.provider, '') ILIKE $n)`,
      searchValues: 6,
      customer: 'customer.id',
      currency: 'p.currency',
    },
    refunds: {
      from: `FROM refund_requests r
        JOIN payments p ON p.id = r.payment_id
        JOIN bookings b ON b.id = p.booking_id
        JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id`,
      select: `SELECT r.id, p.provider_reference AS transaction_reference,
        'BK-' || b.id::text AS booking_reference, customer.id AS customer_id,
        customer.full_name AS customer_name,
        r.amount, r.currency, r.reason, r.status, r.created_at, r.decided_at, r.processed_at,
        r.provider_refund_reference`,
      status: 'r.status',
      createdAt: 'r.created_at',
      search: `(r.id::text ILIKE $n OR COALESCE(p.provider_reference, '') ILIKE $n
        OR b.id::text ILIKE $n OR ('BK-' || b.id::text) ILIKE $n OR customer.full_name ILIKE $n)`,
      searchValues: 5,
      customer: 'customer.id',
      currency: 'r.currency',
    },
    reviews: {
      from: `FROM reviews r
        JOIN bookings b ON b.id = r.booking_id
        JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id`,
      select: `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
        customer.id AS customer_id, b.vendor_id, COALESCE(s.category_id, vp.category_id) AS category_id,
        customer.full_name AS customer_name, vp.business_name AS vendor_name,
        COALESCE(s.title, b.service_description) AS service, 'BK-' || b.id::text AS booking_reference`,
      status: 'r.status',
      createdAt: 'r.created_at',
      search: `(r.comment ILIKE $n OR customer.full_name ILIKE $n OR vp.business_name ILIKE $n
        OR COALESCE(s.title, '') ILIKE $n)`,
      searchValues: 4,
      vendor: 'b.vendor_id',
      customer: 'customer.id',
      category: 'COALESCE(s.category_id, vp.category_id)',
    },
    complaints: {
      from: `FROM complaints c
        JOIN users customer ON customer.id = c.user_id
        LEFT JOIN bookings b ON b.id = c.booking_id
        LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT c.id, c.subject, c.details, c.status, c.resolution, c.created_at,
        c.user_id AS customer_id, b.vendor_id, COALESCE(s.category_id, vp.category_id) AS category_id,
        customer.full_name AS customer_name, customer.email AS customer_email,
        sc.name AS category_name, 'BK-' || b.id::text AS booking_reference, vp.business_name AS vendor_name`,
      status: 'c.status',
      createdAt: 'c.created_at',
      search: `(c.subject ILIKE $n OR c.details ILIKE $n OR customer.full_name ILIKE $n
        OR customer.email ILIKE $n OR vp.business_name ILIKE $n)`,
      searchValues: 5,
      vendor: 'b.vendor_id',
      customer: 'customer.id',
      category: 'COALESCE(s.category_id, vp.category_id)',
    },
    'booking-outcomes': {
      from: `FROM bookings b
        JOIN events e ON e.id = b.event_id
        JOIN users customer ON customer.id = e.organizer_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT b.id, 'BK-' || b.id::text AS booking_reference, e.title AS event_title,
        customer.id AS customer_id, customer.full_name AS customer_name, b.vendor_id,
        COALESCE(s.category_id, vp.category_id) AS category_id, vp.business_name AS vendor_name,
        COALESCE(s.title, b.service_description) AS service, b.status, b.quoted_amount AS amount,
        b.currency, b.created_at,
        COALESCE((SELECT MAX(h.created_at) FROM booking_history h
          WHERE h.booking_id = b.id AND h.to_status = b.status), b.created_at) AS outcome_at`,
      status: 'b.status',
      createdAt: 'b.created_at',
      outcomeDate: `COALESCE((SELECT MAX(outcome_history.created_at)
        FROM booking_history outcome_history
        WHERE outcome_history.booking_id = b.id AND outcome_history.to_status = b.status), b.created_at)`,
      search: `(b.id::text ILIKE $n OR e.title ILIKE $n OR customer.full_name ILIKE $n OR vp.business_name ILIKE $n)`,
      searchValues: 4,
      vendor: 'b.vendor_id',
      customer: 'customer.id',
      category: 'COALESCE(s.category_id, vp.category_id)',
      currency: 'b.currency',
    },
  };

  if (report === 'categories') {
    definitions.categories = {
      from: `FROM bookings b
        JOIN events e ON e.id = b.event_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN service_categories sc ON sc.id = COALESCE(s.category_id, vp.category_id)`,
      select: `SELECT sc.id AS category_id, COALESCE(sc.name, 'Uncategorized') AS category_name,
        COUNT(*)::int AS total_bookings,
        COUNT(*) FILTER (WHERE b.status = 'completed')::int AS completed_bookings,
        COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled_bookings,
        COUNT(*) FILTER (WHERE b.status NOT IN ('completed','cancelled'))::int AS active_bookings,
        COUNT(DISTINCT b.vendor_id)::int AS vendor_count`,
      group: ' GROUP BY sc.id, sc.name',
      chartSelect: `SELECT COALESCE(sc.name, 'Uncategorized') AS label, COUNT(*)::int AS value`,
      chartGroup: ' GROUP BY sc.id, sc.name',
      createdAt: 'b.created_at',
      status: 'b.status',
      search: `COALESCE(sc.name, 'Uncategorized') ILIKE $n`,
      searchValues: 1,
      category: 'COALESCE(s.category_id, vp.category_id)',
      vendor: 'b.vendor_id',
      customer: 'e.organizer_id',
      countGroup: null,
    };
  }
  if (report === 'vendor-performance') {
    definitions['vendor-performance'] = {
      from: `FROM vendor_profiles vp
        JOIN users vendor_user ON vendor_user.id = vp.user_id
        JOIN bookings b ON b.vendor_id = vp.id
        JOIN events e ON e.id = b.event_id
        LEFT JOIN services service ON service.id = b.service_id`,
      select: `SELECT vp.id AS vendor_id, vp.business_name, vp.verification_status,
        COUNT(b.id)::int AS total_bookings,
        COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed_bookings,
        COUNT(b.id) FILTER (WHERE b.status = 'cancelled')::int AS cancelled_bookings,
        AVG((SELECT AVG(rating)::numeric FROM reviews review_row WHERE review_row.booking_id = b.id)) AS average_rating`,
      group: ' GROUP BY vp.id, vp.business_name, vp.verification_status',
      chartSelect: 'SELECT vp.business_name AS label, COUNT(b.id)::int AS value',
      chartGroup: ' GROUP BY vp.id, vp.business_name, vp.verification_status',
      createdAt: 'b.created_at',
      search: '(vp.business_name ILIKE $n OR vendor_user.full_name ILIKE $n)',
      searchValues: 2,
      status: 'b.status',
      vendor: 'vp.id',
      customer: 'e.organizer_id',
      category: 'COALESCE(service.category_id, vp.category_id)',
    };
  }

  const definition = definitions[report];
  if (!definition) throw Object.assign(new Error('Unsupported report.'), { status: 400 });
  const dateColumn = definition.outcomeDate || definition.createdAt;
  clauses[0] = `${dateColumn} >= $1::timestamptz`;
  clauses[1] = `${dateColumn} < $2::timestamptz`;
  const addFilter = (column, value) => {
    if (value === undefined || value === null) return;
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  };
  if (search && definition.search) {
    for (let index = 0; index < definition.searchValues; index += 1) values.push(search);
    let placeholder = values.length - definition.searchValues + 1;
    clauses.push(definition.search.replaceAll('$n', () => `$${placeholder++}`));
  }
  if (definition.status) addFilter(definition.status, filters.status);
  if (definition.category) addFilter(definition.category, filters.categoryId);
  if (definition.vendor) addFilter(definition.vendor, filters.vendorId);
  if (definition.customer) addFilter(definition.customer, filters.customerId);
  if (definition.currency) addFilter(definition.currency, filters.currency);
  if (report === 'booking-outcomes' && !filters.status) {
    clauses.push("b.status IN ('completed','cancelled')");
  }
  return { definition, values, clauses };
}

function summarizeGroups(rows, field = 'status') {
  return rows.map((row) => ({ label: row[field] || 'Unknown', value: Number(row.total || 0) }));
}

function orderBy(report, filters) {
  const allowed = REPORT_SORTS[report];
  const selected = filters.sortBy && Object.hasOwn(allowed, filters.sortBy)
    ? filters.sortBy
    : Object.keys(allowed)[0];
  const tieBreaker = {
    users: 'u.id', vendors: 'vp.id', events: 'e.id', bookings: 'b.id',
    payments: 'p.id', refunds: 'r.id', revenue: 'period',
    categories: 'category_id', reviews: 'r.id', complaints: 'c.id',
    'vendor-performance': 'vp.id', 'booking-outcomes': 'b.id',
  }[report];
  return `${allowed[selected]} ${filters.sortDirection.toUpperCase()}, ${tieBreaker} DESC`;
}

async function loadCurrencySettings(database) {
  const result = await database.query(
    `SELECT setting_key, setting_value FROM system_settings
     WHERE setting_key = ANY($1::varchar[])`,
    [['platform_currency', 'report_timezone']],
  );
  const saved = Object.fromEntries(result.rows.map((row) => [row.setting_key, row.setting_value]));
  const timeZone = saved.report_timezone || 'Africa/Addis_Ababa';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw Object.assign(new Error('The configured report timezone is invalid.'), { status: 500 });
  }
  return { currency: saved.platform_currency || 'ETB', timeZone };
}

async function queryRevenue(database, range, filters) {
  const start = dateValue(range.startAt);
  const end = dateValue(range.endAt);
  const paymentValues = [start, end, CAPTURED_PAYMENT_STATUSES];
  const refundValues = [start, end];
  const currencyClause = filters.currency ? ` AND currency = $${paymentValues.length + 1}` : '';
  if (filters.currency) paymentValues.push(filters.currency);
  const refundCurrencyClause = filters.currency ? ` AND currency = $${refundValues.length + 1}` : '';
  if (filters.currency) refundValues.push(filters.currency);
  const payments = await database.query(
    `SELECT currency, COALESCE(SUM(amount), 0) AS gross_payments
     FROM payments
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
       AND status = ANY($3::varchar[])${currencyClause}
     GROUP BY currency`,
    paymentValues,
  );
  const paymentRows = await database.query(
    `SELECT (created_at AT TIME ZONE $3)::date AS period, currency, SUM(amount) AS gross_payments
     FROM payments
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
       AND status = ANY($4::varchar[])${filters.currency ? ' AND currency = $5' : ''}
     GROUP BY period, currency ORDER BY period, currency`,
    filters.currency ? [start, end, range.timeZone, CAPTURED_PAYMENT_STATUSES, filters.currency]
      : [start, end, range.timeZone, CAPTURED_PAYMENT_STATUSES],
  );
  const refunds = await database.query(
    `SELECT currency, COALESCE(SUM(amount), 0) AS refund_amount
     FROM refund_requests
     WHERE processed_at >= ($1::timestamptz AT TIME ZONE 'UTC')
       AND processed_at < ($2::timestamptz AT TIME ZONE 'UTC')
       AND status = 'succeeded'${refundCurrencyClause}
     GROUP BY currency`,
    refundValues,
  );
  const refundRows = await database.query(
    `SELECT ((processed_at AT TIME ZONE 'UTC') AT TIME ZONE $3)::date AS period,
       currency, SUM(amount) AS refund_amount
     FROM refund_requests
     WHERE processed_at >= ($1::timestamptz AT TIME ZONE 'UTC')
       AND processed_at < ($2::timestamptz AT TIME ZONE 'UTC') AND status = 'succeeded'
       ${filters.currency ? 'AND currency = $4' : ''}
     GROUP BY period, currency ORDER BY period, currency`,
    filters.currency ? [start, end, range.timeZone, filters.currency] : [start, end, range.timeZone],
  );

  const currencies = calculateRevenueTotals(
    payments.rows.map((row) => ({ currency: row.currency, gross_amount: row.gross_payments })),
    refunds.rows.map((row) => ({ currency: row.currency, refund_amount: row.refund_amount })),
  );
  const periods = new Map();
  for (const row of paymentRows.rows) {
    periods.set(`${row.period}|${row.currency}`, {
      period: row.period, currency: row.currency, grossPayments: Number(row.gross_payments || 0), refunds: 0,
    });
  }
  for (const row of refundRows.rows) {
    const key = `${row.period}|${row.currency}`;
    const value = periods.get(key) || { period: row.period, currency: row.currency, grossPayments: 0, refunds: 0 };
    value.refunds = Number(row.refund_amount || 0);
    periods.set(key, value);
  }
  const rows = [...periods.values()].map((row) => ({ ...row, netRevenue: row.grossPayments - row.refunds }))
    .sort((left, right) => String(left.period).localeCompare(String(right.period))
      || left.currency.localeCompare(right.currency));
  return { currencies, rows };
}

function financialReport(report) {
  return ['payments', 'refunds', 'revenue'].includes(report);
}

function requireFinancialPermission(req, res, isExport, report) {
  if (!financialReport(report)) return true;
  const permissions = normalizePermissionKeys(req.user?.permissions ?? req.permissions ?? []);
  const required = isExport ? 'payments.export' : 'payments.view';
  if (hasPermission(permissions, required)) return true;
  res.status(403).json({ error: `You do not have permission to ${isExport ? 'export' : 'view'} financial reports.` });
  return false;
}

async function loadReport(req, res, database, isExport) {
  const filters = parseQuery(req, res);
  if (!filters || !requireFinancialPermission(req, res, isExport, filters.report)) return;
  try {
    const settings = await loadCurrencySettings(database);
    const range = resolveReportRange(filters, { timeZone: settings.timeZone });
    const appliedFilters = {
      report: filters.report, period: range.period, startDate: range.startDate, endDate: range.endDate,
      timeZone: range.timeZone, currency: filters.currency || null, status: filters.status || null,
      q: filters.q || '', categoryId: filters.categoryId || null, vendorId: filters.vendorId || null,
      customerId: filters.customerId || null,
      sortBy: filters.sortBy || Object.keys(REPORT_SORTS[filters.report])[0],
      sortDirection: filters.sortDirection,
    };
    let rows;
    let summary;
    let chartData = [];
    let total;
    if (filters.report === 'revenue') {
      const revenue = await queryRevenue(database, range, filters);
      total = revenue.rows.length;
      if (isExport && total > EXPORT_ROW_LIMIT) {
        return res.status(413).json({ error: `This export contains ${total} rows. Narrow the date range or filters to ${EXPORT_ROW_LIMIT} rows or fewer.` });
      }
      rows = revenue.rows;
      const sortKey = { period: 'period', currency: 'currency', gross: 'grossPayments', refunds: 'refunds', net: 'netRevenue' }[
        filters.sortBy || 'period'
      ];
      rows.sort((left, right) => String(left[sortKey]).localeCompare(String(right[sortKey]), undefined, { numeric: true })
        * (filters.sortDirection === 'asc' ? 1 : -1));
      summary = revenue.currencies.map((item) => ({ ...item, label: item.currency, value: item.netRevenue }));
      chartData = rows.map((item) => ({
        label: item.period, value: item.netRevenue, currency: item.currency,
        grossPayments: item.grossPayments, refunds: item.refunds,
      }));
      if (!isExport) rows = rows.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
    } else {
      const { definition, values, clauses } = createDefinition(filters.report, range, filters);
      const where = `WHERE ${clauses.join(' AND ')}`;
      const count = await database.query(
        `SELECT COUNT(*) AS total FROM (SELECT 1 ${definition.from} ${where}${definition.group || ''}) report_rows`,
        values,
      );
      total = Number(count.rows[0]?.total || 0);
      if (isExport && total > EXPORT_ROW_LIMIT) {
        return res.status(413).json({ error: `This export contains ${total} rows. Narrow the date range or filters to ${EXPORT_ROW_LIMIT} rows or fewer.` });
      }
      const order = orderBy(filters.report, filters);
      const pageValues = [...values, isExport ? EXPORT_ROW_LIMIT + 1 : filters.pageSize];
      const limitMarker = `$${pageValues.length}`;
      let offsetSql = '';
      if (!isExport) {
        pageValues.push((filters.page - 1) * filters.pageSize);
        offsetSql = ` OFFSET $${pageValues.length}`;
      }
      const result = await database.query(
        `${definition.select} ${definition.from} ${where}${definition.group || ''}
         ORDER BY ${order} LIMIT ${limitMarker}${offsetSql}`,
        pageValues,
      );
      rows = result.rows.map(normalizeReportRow);
      if (definition.chartSelect) {
        const chart = await database.query(
          `${definition.chartSelect} ${definition.from} ${where}${definition.chartGroup}
           ORDER BY value DESC LIMIT 20`,
          values,
        );
        chartData = chart.rows.map((row) => ({ label: row.label || 'Unknown', value: Number(row.value || 0) }));
        summary = [{ label: 'Records', value: total }];
      } else {
        const statusExpression = definition.status || "'all'";
        const countExpression = definition.countGroup || 'COUNT(*)';
        const groups = await database.query(
          `SELECT ${statusExpression} AS status, ${countExpression} AS total
           ${definition.from} ${where} GROUP BY ${statusExpression}`,
          values,
        );
        chartData = summarizeGroups(groups.rows);
        summary = [{ label: 'Records', value: total }, ...summarizeGroups(groups.rows)];
      }
    }

    if (isExport) {
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const csv = [
        `# Generated at: ${new Date().toISOString()}`,
        `# Applied filters: ${JSON.stringify(appliedFilters)}`,
        ...(headers.length ? [headers.map(csvCell).join(',')] : []),
        ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
      ].join('\r\n');
      await database.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'reports.exported', 'report', $2, $3::jsonb, $4)`,
        [req.user.id, filters.report, JSON.stringify({ report: filters.report, filters: appliedFilters, rowCount: rows.length }), req.ip || null],
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filters.report}-report.csv"`);
      return res.send(`\uFEFF${csv}`);
    }
    return res.json({
      data: rows, summary, chartData,
      pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
      generatedAt: new Date().toISOString(), appliedFilters, configuredCurrency: settings.currency,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('PostgreSQL administrator report generation failed:', error?.code || error?.name || 'unknown error');
    return res.status(500).json({ error: 'The report could not be generated.' });
  }
}

export function createPostgresAdminReportsRouter({ database }) {
  const router = Router();
  router.get('/reports', requirePermission('reports.view'), (req, res) => loadReport(req, res, database, false));
  router.get('/reports/export', requirePermission('reports.export'), (req, res) => loadReport(req, res, database, true));
  return router;
}
