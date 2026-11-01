import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { decideRefundRequest, isSafeFinancialNote } from '../lib/paymentManagement.js';

const router = Router();
const databaseFor = (req) => req.app?.locals?.database || pool;
const paymentStatuses = ['pending', 'authorized', 'successful', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'refund_pending'];
const refundStatuses = ['pending', 'processing', 'succeeded', 'failed', 'rejected'];
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paymentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(paymentStatuses).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
}).strict().superRefine((query, context) => {
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after start date.' });
  }
});
const refundQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(refundStatuses).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
}).strict().superRefine((query, context) => {
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after start date.' });
  }
});
const decisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approved'),
    reason: z.string().trim().max(500).refine(isSafeFinancialNote).optional(),
  }).strict(),
  z.object({
    decision: z.literal('rejected'),
    reason: z.string().trim().min(5).max(500).refine(isSafeFinancialNote),
  }).strict(),
]);
const idSchema = z.coerce.number().int().positive();

function isValidDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateDates(parsed, res) {
  for (const key of ['dateFrom', 'dateTo']) {
    if (parsed[key] && !isValidDate(parsed[key])) {
      res.status(400).json({ error: `Enter a valid ${key === 'dateFrom' ? 'start' : 'end'} date.` });
      return false;
    }
  }
  return true;
}

function paymentFilters(query) {
  const clauses = [];
  const values = [];
  if (query.q) {
    clauses.push(`(
      CAST(p.id AS CHAR) = ? OR CAST(b.id AS CHAR) = ? OR CONCAT('BK-', b.id) = ? OR p.provider_reference LIKE ?
      OR COALESCE(p.provider, '') LIKE ? OR COALESCE(p.payment_method, '') LIKE ?
      OR u.full_name LIKE ? OR u.email LIKE ?
    )`);
    values.push(query.q, query.q, query.q, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.status) {
    clauses.push('p.status = ?');
    values.push(query.status === 'successful' ? 'paid' : query.status);
  }
  if (query.dateFrom) {
    clauses.push('p.created_at >= ?');
    values.push(`${query.dateFrom} 00:00:00`);
  }
  if (query.dateTo) {
    clauses.push('p.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(`${query.dateTo} 00:00:00`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function refundFilters(query) {
  const clauses = [];
  const values = [];
  if (query.q) {
    clauses.push(`(
      CAST(r.id AS CHAR) = ? OR CAST(r.payment_id AS CHAR) = ? OR CAST(b.id AS CHAR) = ? OR CONCAT('BK-', b.id) = ?
      OR p.provider_reference LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR r.reason LIKE ?
    )`);
    values.push(query.q, query.q, query.q, query.q, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.status) {
    clauses.push('r.status = ?');
    values.push(query.status);
  }
  if (query.dateFrom) {
    clauses.push('r.created_at >= ?');
    values.push(`${query.dateFrom} 00:00:00`);
  }
  if (query.dateTo) {
    clauses.push('r.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(`${query.dateTo} 00:00:00`);
  }
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

const paymentSelect = `
  SELECT p.id, p.booking_id, CONCAT('BK-', b.id) AS booking_reference,
         p.amount, p.currency, p.provider, p.payment_method, p.provider_reference,
         p.status, p.created_at, p.verified_at,
         u.id AS customer_id, u.full_name AS customer_name, u.email AS customer_email,
         e.title AS event_title,
         COALESCE(SUM(CASE WHEN r.status = 'succeeded' THEN r.amount ELSE 0 END), 0) AS refunded_amount
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

function providerConfigured(provider) {
  return Boolean(typeof provider?.name === 'string' && provider.name.trim()
    && typeof provider.verifyWebhook === 'function'
    && typeof provider.refundPayment === 'function');
}

router.get('/payments', requirePermission('payments.view'), asyncHandler(async (req, res) => {
  const parsed = paymentQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Payment filters are invalid.' });
  const query = parsed.data;
  if (!validateDates(query, res)) return;
  const { where, values } = paymentFilters(query);
  const database = databaseFor(req);
  const [[count]] = await database.execute(
    `SELECT COUNT(DISTINCT p.id) AS total FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id ${where}`,
    values,
  );
  const [rows] = await database.execute(
    `${paymentSelect} ${where} ${paymentGroup}
     ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...values, query.pageSize, (query.page - 1) * query.pageSize],
  );
  res.json({
    data: rows,
    pagination: { page: query.page, pageSize: query.pageSize, total: Number(count.total) },
    integration: { configured: providerConfigured(req.app.locals.paymentProvider), state: providerConfigured(req.app.locals.paymentProvider) ? 'configured' : 'pending' },
  });
}));

router.get('/payments/export', requirePermission('payments.export'), asyncHandler(async (req, res) => {
  const parsed = paymentQuerySchema.omit({ page: true, pageSize: true }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Payment report filters are invalid.' });
  if (!validateDates(parsed.data, res)) return;
  const { where, values } = paymentFilters(parsed.data);
  const [rows] = await databaseFor(req).execute(
    `${paymentSelect} ${where} ${paymentGroup} ORDER BY p.created_at DESC, p.id DESC`,
    values,
  );
  sendCsv(res, 'payment-report.csv', [
    'Transaction ID', 'Booking reference', 'Customer', 'Customer email', 'Event', 'Amount',
    'Currency', 'Refunded amount', 'Payment method', 'Provider', 'Transaction reference',
    'Status', 'Created at', 'Verified at',
  ], rows.map((row) => [
    row.id, row.booking_reference, row.customer_name, row.customer_email, row.event_title,
    row.amount, row.currency, row.refunded_amount, row.payment_method, row.provider,
    row.provider_reference, row.status, row.created_at, row.verified_at,
  ]));
}));

router.get('/payments/report', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const parsed = paymentQuerySchema.omit({ page: true, pageSize: true, status: true, q: true }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Payment report date filters are invalid.' });
  if (!validateDates(parsed.data, res)) return;
  const filters = paymentFilters(parsed.data);
  const [payments] = await databaseFor(req).execute(
    `SELECT p.status, p.currency, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS amount
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     ${filters.where}
     GROUP BY p.status, p.currency ORDER BY p.currency, p.status`,
    filters.values,
  );
  const refundConditions = [];
  const refundValues = [];
  if (parsed.data.dateFrom) {
    refundConditions.push('r.created_at >= ?');
    refundValues.push(`${parsed.data.dateFrom} 00:00:00`);
  }
  if (parsed.data.dateTo) {
    refundConditions.push('r.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    refundValues.push(`${parsed.data.dateTo} 00:00:00`);
  }
  const [refunds] = await databaseFor(req).execute(
    `SELECT r.status, r.currency, COUNT(*) AS count, COALESCE(SUM(r.amount), 0) AS amount
     FROM refund_requests r ${refundConditions.length ? `WHERE ${refundConditions.join(' AND ')}` : ''}
     GROUP BY r.status, r.currency ORDER BY r.currency, r.status`,
    refundValues,
  );
  res.json({ data: { payments, refunds } });
}));

router.get('/payments/:id', requirePermission('payments.view'), asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid payment ID is required.' });
  const database = databaseFor(req);
  const [payments] = await database.execute(
    `${paymentSelect} WHERE p.id = ? ${paymentGroup}`,
    [id.data],
  );
  if (!payments.length) return res.status(404).json({ error: 'Payment not found.' });
  const [refunds] = await database.execute(
    `${refundSelect} WHERE r.payment_id = ? ORDER BY r.created_at DESC, r.id DESC`,
    [id.data],
  );
  const [history] = await database.execute(
    `SELECT h.id, h.refund_id, h.actor_id, u.full_name AS actor_name, h.action,
            h.from_status, h.to_status, h.details, h.created_at
     FROM payment_history h LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.payment_id = ? ORDER BY h.created_at DESC, h.id DESC`,
    [id.data],
  );
  res.json({ data: { payment: payments[0], refunds, history } });
}));

router.get('/refunds/export', requirePermission('payments.export'), asyncHandler(async (req, res) => {
  const parsed = refundQuerySchema.omit({ page: true, pageSize: true }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Refund report filters are invalid.' });
  if (!validateDates(parsed.data, res)) return;
  const { where, values } = refundFilters(parsed.data);
  const [rows] = await databaseFor(req).execute(
    `${refundSelect} ${where} ORDER BY r.created_at DESC, r.id DESC`,
    values,
  );
  sendCsv(res, 'refund-report.csv', [
    'Refund ID', 'Transaction ID', 'Booking reference', 'Customer', 'Amount', 'Currency',
    'Reason', 'Status', 'Decision reason', 'Provider', 'Transaction reference',
    'Provider refund reference', 'Created at', 'Processed at',
  ], rows.map((row) => [
    row.id, row.payment_id, row.booking_reference, row.customer_name, row.amount, row.currency,
    row.reason, row.status, row.decision_reason, row.provider, row.provider_reference,
    row.provider_refund_reference, row.created_at, row.processed_at,
  ]));
}));

router.get('/refunds', requirePermission('payments.view'), asyncHandler(async (req, res) => {
  const parsed = refundQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Refund filters are invalid.' });
  const query = parsed.data;
  if (!validateDates(query, res)) return;
  const { where, values } = refundFilters(query);
  const database = databaseFor(req);
  const [[count]] = await database.execute(
    `SELECT COUNT(*) AS total FROM refund_requests r
     JOIN payments p ON p.id = r.payment_id
     JOIN bookings b ON b.id = p.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = r.requester_id ${where}`,
    values,
  );
  const [rows] = await database.execute(
    `${refundSelect} ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...values, query.pageSize, (query.page - 1) * query.pageSize],
  );
  res.json({
    data: rows,
    pagination: { page: query.page, pageSize: query.pageSize, total: Number(count.total) },
    integration: { configured: providerConfigured(req.app.locals.paymentProvider), state: providerConfigured(req.app.locals.paymentProvider) ? 'configured' : 'pending' },
  });
}));

router.patch('/refunds/:id/decision', requirePermission('payments.refund'), asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = decisionSchema.safeParse(req.body);
  if (!id.success || !parsed.success) {
    return res.status(400).json({
      error: 'A valid refund decision is required. Rejections must include a reason.',
    });
  }
  const result = await decideRefundRequest(databaseFor(req), {
    refundId: id.data,
    ...parsed.data,
    actorId: req.admin.id,
    ip: req.ip,
    paymentProvider: req.app.locals.paymentProvider,
  });
  res.json({ data: result });
}));

export default router;
