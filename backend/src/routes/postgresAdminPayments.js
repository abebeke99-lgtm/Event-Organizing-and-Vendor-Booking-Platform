import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  decidePostgresRefundRequest,
  isSafePostgresFinancialNote,
} from '../lib/postgresPaymentManagement.js';

const paymentStatuses = ['pending', 'authorized', 'successful', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'refund_pending'];
const refundStatuses = ['pending', 'processing', 'succeeded', 'failed', 'rejected'];
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateRangeSchema = z.object({
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
}).strict();
const paymentFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(paymentStatuses).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
}).strict();
const refundFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(refundStatuses).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
}).strict();
function validateDateRange(query, context) {
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after start date.' });
  }
}
const paymentQuerySchema = paymentFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine(validateDateRange);
const paymentExportQuerySchema = paymentFilterSchema.superRefine(validateDateRange);
const paymentReportQuerySchema = dateRangeSchema.superRefine(validateDateRange);
const refundQuerySchema = refundFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine(validateDateRange);
const refundExportQuerySchema = refundFilterSchema.superRefine(validateDateRange);
const decisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approved'),
    reason: z.string().trim().max(500).refine(isSafePostgresFinancialNote).optional(),
  }).strict(),
  z.object({
    decision: z.literal('rejected'),
    reason: z.string().trim().min(5).max(500).refine(isSafePostgresFinancialNote),
  }).strict(),
]);
const idSchema = z.coerce.number().int().positive();

const paymentSelect = `
  SELECT p.id, p.booking_id, CONCAT('BK-', b.id) AS booking_reference,
         p.amount, p.currency, p.provider, p.payment_method, p.provider_reference,
         p.status, p.created_at, p.verified_at,
         u.id AS customer_id, u.full_name AS customer_name, u.email AS customer_email,
         e.title AS event_title,
         COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'succeeded'), 0) AS refunded_amount
  FROM payments p
  JOIN bookings b ON b.id = p.booking_id
  JOIN events e ON e.id = b.event_id
  JOIN users u ON u.id = e.organizer_id
  LEFT JOIN refund_requests r ON r.payment_id = p.id`;
const paymentGroup = `
  GROUP BY p.id, p.booking_id, b.id, p.amount, p.currency, p.provider, p.payment_method,
           p.provider_reference, p.status, p.created_at, p.verified_at,
           u.id, u.full_name, u.email, e.title`;
const refundSelect = `
  SELECT r.id, r.payment_id, r.requester_id, r.amount, r.currency, r.reason, r.status,
         r.decision_reason, r.provider_refund_reference,
         r.decided_by, r.created_at, r.decided_at, r.processed_at,
         p.provider, p.provider_reference, p.status AS payment_status,
         b.id AS booking_id, CONCAT('BK-', b.id) AS booking_reference,
         u.full_name AS customer_name, u.email AS customer_email, e.title AS event_title
  FROM refund_requests r
  JOIN payments p ON p.id = r.payment_id
  JOIN bookings b ON b.id = p.booking_id
  JOIN events e ON e.id = b.event_id
  JOIN users u ON u.id = r.requester_id`;

function validDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateDates(parsed, res) {
  for (const key of ['dateFrom', 'dateTo']) {
    if (parsed[key] && !validDate(parsed[key])) {
      res.status(400).json({ error: `Enter a valid ${key === 'dateFrom' ? 'start' : 'end'} date.` });
      return false;
    }
  }
  return true;
}

function addDateFilters(clauses, values, query, column) {
  if (query.dateFrom) {
    values.push(query.dateFrom);
    clauses.push(`${column} >= ($${values.length}::date::timestamp AT TIME ZONE 'UTC')`);
  }
  if (query.dateTo) {
    values.push(query.dateTo);
    clauses.push(`${column} < (($${values.length}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`);
  }
}

function paymentFilters(query) {
  const clauses = [];
  const values = [];
  if (query.q) {
    values.push(query.q, query.q, query.q, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
    const [paymentId, bookingId, bookingReference, providerReference, provider, paymentMethod, customerName, customerEmail]
      = values.map((_, index) => `$${index + 1}`);
    clauses.push(`(
      p.id::text = ${paymentId} OR b.id::text = ${bookingId} OR CONCAT('BK-', b.id) = ${bookingReference}
      OR p.provider_reference ILIKE ${providerReference} OR COALESCE(p.provider, '') ILIKE ${provider}
      OR COALESCE(p.payment_method, '') ILIKE ${paymentMethod} OR u.full_name ILIKE ${customerName}
      OR u.email ILIKE ${customerEmail}
    )`);
  }
  if (query.status) {
    values.push(query.status === 'successful' ? 'paid' : query.status);
    clauses.push(`p.status = $${values.length}`);
  }
  addDateFilters(clauses, values, query, 'p.created_at');
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function refundFilters(query) {
  const clauses = [];
  const values = [];
  if (query.q) {
    values.push(query.q, query.q, query.q, query.q, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
    const [refundId, paymentId, bookingId, bookingReference, providerReference, customerName, customerEmail, reason]
      = values.map((_, index) => `$${index + 1}`);
    clauses.push(`(
      r.id::text = ${refundId} OR r.payment_id::text = ${paymentId} OR b.id::text = ${bookingId}
      OR CONCAT('BK-', b.id) = ${bookingReference} OR p.provider_reference ILIKE ${providerReference}
      OR u.full_name ILIKE ${customerName} OR u.email ILIKE ${customerEmail} OR r.reason ILIKE ${reason}
    )`);
  }
  if (query.status) {
    values.push(query.status);
    clauses.push(`r.status = $${values.length}`);
  }
  addDateFilters(clauses, values, query, 'r.created_at');
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function sendCsv(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send([headers, ...rows.map((row) => row.map(csvCell))].map((row) => row.join(',')).join('\r\n'));
}

function paymentProviderConfigured(provider) {
  return Boolean(typeof provider?.name === 'string' && provider.name.trim()
    && typeof provider.verifyWebhook === 'function'
    && typeof provider.refundPayment === 'function');
}

function normalizePayment(row) {
  return {
    ...row,
    id: Number(row.id),
    booking_id: Number(row.booking_id),
    customer_id: Number(row.customer_id),
    amount: Number(row.amount),
    refunded_amount: Number(row.refunded_amount),
  };
}

function normalizeRefund(row) {
  return {
    ...row,
    id: Number(row.id),
    payment_id: Number(row.payment_id),
    requester_id: Number(row.requester_id),
    amount: Number(row.amount),
    ...(row.decided_by === null || row.decided_by === undefined ? {} : { decided_by: Number(row.decided_by) }),
  };
}

export function createPostgresAdminPaymentsRouter({ database }) {
  const router = Router();

  router.get('/payments', requirePermission('payments.view'), asyncHandler(async (req, res) => {
    const parsed = paymentQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Payment filters are invalid.' });
    const query = parsed.data;
    if (!validateDates(query, res)) return;
    const { where, values } = paymentFilters(query);
    const count = await database.query(
      `SELECT COUNT(DISTINCT p.id) AS total FROM payments p
       JOIN bookings b ON b.id = p.booking_id JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = e.organizer_id ${where}`,
      values,
    );
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const rows = await database.query(
      `${paymentSelect} ${where} ${paymentGroup}
       ORDER BY p.created_at DESC, p.id DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues,
    );
    const configured = paymentProviderConfigured(req.app.locals.paymentProvider);
    return res.json({
      data: rows.rows.map(normalizePayment),
      pagination: { page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].total) },
      integration: { configured, state: configured ? 'configured' : 'pending' },
    });
  }));

  router.get('/payments/export', requirePermission('payments.export'), asyncHandler(async (req, res) => {
    const parsed = paymentExportQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Payment report filters are invalid.' });
    if (!validateDates(parsed.data, res)) return;
    const { where, values } = paymentFilters(parsed.data);
    const rows = await database.query(
      `${paymentSelect} ${where} ${paymentGroup} ORDER BY p.created_at DESC, p.id DESC`,
      values,
    );
    sendCsv(res, 'payment-report.csv', [
      'Transaction ID', 'Booking reference', 'Customer', 'Customer email', 'Event', 'Amount',
      'Currency', 'Refunded amount', 'Payment method', 'Provider', 'Transaction reference',
      'Status', 'Created at', 'Verified at',
    ], rows.rows.map((row) => {
      const payment = normalizePayment(row);
      return [payment.id, payment.booking_reference, payment.customer_name, payment.customer_email,
        payment.event_title, payment.amount, payment.currency, payment.refunded_amount,
        payment.payment_method, payment.provider, payment.provider_reference, payment.status,
        payment.created_at, payment.verified_at];
    }));
  }));

  router.get('/payments/report', requirePermission('reports.view'), asyncHandler(async (req, res) => {
    const parsed = paymentReportQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Payment report date filters are invalid.' });
    if (!validateDates(parsed.data, res)) return;
    const filters = paymentFilters(parsed.data);
    const payments = await database.query(
      `SELECT p.status, p.currency, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS amount
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       JOIN events e ON e.id = b.event_id JOIN users u ON u.id = e.organizer_id
       ${filters.where} GROUP BY p.status, p.currency ORDER BY p.currency, p.status`,
      filters.values,
    );
    const refundConditions = [];
    const refundValues = [];
    addDateFilters(refundConditions, refundValues, parsed.data, 'r.created_at');
    const refunds = await database.query(
      `SELECT r.status, r.currency, COUNT(*) AS count, COALESCE(SUM(r.amount), 0) AS amount
       FROM refund_requests r ${refundConditions.length ? `WHERE ${refundConditions.join(' AND ')}` : ''}
       GROUP BY r.status, r.currency ORDER BY r.currency, r.status`,
      refundValues,
    );
    return res.json({ data: { payments: payments.rows, refunds: refunds.rows } });
  }));

  router.get('/payments/:id', requirePermission('payments.view'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'A valid payment ID is required.' });
    const payments = await database.query(`${paymentSelect} WHERE p.id = $1 ${paymentGroup}`, [id.data]);
    if (!payments.rowCount) return res.status(404).json({ error: 'Payment not found.' });
    const refunds = await database.query(
      `${refundSelect} WHERE r.payment_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
      [id.data],
    );
    const history = await database.query(
      `SELECT h.id, h.refund_id, h.actor_id, u.full_name AS actor_name, h.action,
              h.from_status, h.to_status, h.details, h.created_at
       FROM payment_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.payment_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
      [id.data],
    );
    return res.json({
      data: {
        payment: normalizePayment(payments.rows[0]),
        refunds: refunds.rows.map(normalizeRefund),
        history: history.rows.map((row) => ({
          ...row,
          id: Number(row.id),
          ...(row.refund_id === null ? {} : { refund_id: Number(row.refund_id) }),
          ...(row.actor_id === null ? {} : { actor_id: Number(row.actor_id) }),
        })),
      },
    });
  }));

  router.get('/refunds/export', requirePermission('payments.export'), asyncHandler(async (req, res) => {
    const parsed = refundExportQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Refund report filters are invalid.' });
    if (!validateDates(parsed.data, res)) return;
    const { where, values } = refundFilters(parsed.data);
    const rows = await database.query(
      `${refundSelect} ${where} ORDER BY r.created_at DESC, r.id DESC`,
      values,
    );
    sendCsv(res, 'refund-report.csv', [
      'Refund ID', 'Transaction ID', 'Booking reference', 'Customer', 'Amount', 'Currency',
      'Reason', 'Status', 'Decision reason', 'Provider', 'Transaction reference',
      'Provider refund reference', 'Created at', 'Processed at',
    ], rows.rows.map((row) => [row.id, row.payment_id, row.booking_reference, row.customer_name,
      row.amount, row.currency, row.reason, row.status, row.decision_reason, row.provider,
      row.provider_reference, row.provider_refund_reference, row.created_at, row.processed_at]));
  }));

  router.get('/refunds/:id', requirePermission('payments.view'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'A valid refund ID is required.' });
    const refunds = await database.query(`${refundSelect} WHERE r.id = $1`, [id.data]);
    if (!refunds.rowCount) return res.status(404).json({ error: 'Refund request not found.' });
    const history = await database.query(
      `SELECT h.id, h.payment_id, h.actor_id, u.full_name AS actor_name, h.action,
              h.from_status, h.to_status, h.details, h.created_at
       FROM payment_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.refund_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
      [id.data],
    );
    return res.json({
      data: {
        refund: normalizeRefund(refunds.rows[0]),
        history: history.rows.map((row) => ({
          ...row,
          id: Number(row.id),
          payment_id: Number(row.payment_id),
          ...(row.actor_id === null ? {} : { actor_id: Number(row.actor_id) }),
        })),
      },
    });
  }));

  router.get('/refunds', requirePermission('payments.view'), asyncHandler(async (req, res) => {
    const parsed = refundQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Refund filters are invalid.' });
    const query = parsed.data;
    if (!validateDates(query, res)) return;
    const { where, values } = refundFilters(query);
    const count = await database.query(
      `SELECT COUNT(*) AS total FROM refund_requests r JOIN payments p ON p.id = r.payment_id
       JOIN bookings b ON b.id = p.booking_id JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = r.requester_id ${where}`,
      values,
    );
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const rows = await database.query(
      `${refundSelect} ${where} ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues,
    );
    const configured = paymentProviderConfigured(req.app.locals.paymentProvider);
    return res.json({
      data: rows.rows.map(normalizeRefund),
      pagination: { page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].total) },
      integration: { configured, state: configured ? 'configured' : 'pending' },
    });
  }));

  router.patch('/refunds/:id/decision', requirePermission('payments.refund'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = decisionSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: 'A valid refund decision is required. Rejections must include a reason.' });
    }
    const result = await decidePostgresRefundRequest(database, {
      refundId: id.data,
      ...parsed.data,
      actorId: req.admin.id,
      ip: req.ip,
      paymentProvider: req.app.locals.paymentProvider,
    });
    return res.json({ data: result });
  }));

  return router;
}