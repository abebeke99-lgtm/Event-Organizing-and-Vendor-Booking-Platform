import { Router } from 'express';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { checkBookingDateAvailability, lockBookingVendor, releaseBookingDate, reserveBookingDate } from '../lib/bookingAvailability.js';
import { loadSystemSettings } from '../lib/systemSettings.js';
import { requirePermission } from '../middleware/rbac.js';

const bookingStatuses = ['requested', 'under_review', 'quoted', 'accepted', 'rejected', 'cancelled', 'completed'];
const paymentStatuses = ['unpaid', 'pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded', 'refund_pending'];
const idSchema = z.coerce.number().int().positive();
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bookingFilterShape = {
  q: z.string().trim().max(120).optional(),
  status: z.enum(bookingStatuses).optional(),
  paymentStatus: z.enum(paymentStatuses).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  sortBy: z.enum(['id', 'status', 'scheduled_date', 'created_at', 'quoted_amount', 'event_title', 'customer_name', 'vendor_name']).default('created_at'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
};

function validateDateRange(query, context) {
  for (const key of ['dateFrom', 'dateTo']) {
    const value = query[key];
    if (value) {
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
        context.addIssue({ code: 'custom', path: [key], message: `Enter a valid ${key === 'dateFrom' ? 'start' : 'end'} date.` });
      }
    }
  }
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after start date.' });
  }
}

const bookingListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  ...bookingFilterShape,
}).strict().superRefine(validateDateRange);
const bookingExportSchema = z.object(bookingFilterShape).strict().superRefine(validateDateRange);
const bookingActionSchema = z.object({
  status: z.enum(['under_review', 'accepted', 'rejected', 'cancelled', 'completed']),
  reason: z.string().trim().max(500).optional().default(''),
}).strict();
const sortColumns = {
  id: 'b.id',
  status: 'b.status',
  scheduled_date: 'COALESCE(b.scheduled_date, e.start_date)',
  created_at: 'b.created_at',
  quoted_amount: 'b.quoted_amount',
  event_title: 'e.title',
  customer_name: 'customer.full_name',
  vendor_name: 'vp.business_name',
};
const bookingRescheduleSchema = z.object({
  scheduled_date: z.string().trim().min(16).max(32),
  reason: z.string().trim().min(5).max(500),
}).strict();

const bookingSelect = `
  SELECT b.id, b.event_id, b.vendor_id, b.service_id, b.service_description,
         b.scheduled_date, b.quoted_amount, b.currency, b.status, b.moderation_reason, b.created_at,
         COALESCE(b.scheduled_date, e.start_date) AS event_start_date, e.start_date,
         e.title AS event_title, e.event_type, e.city AS event_city, e.venue AS event_venue,
         customer.id AS customer_id, customer.full_name AS customer_name,
         customer.email AS customer_email, customer.phone AS customer_phone,
         vp.business_name AS vendor_name, vendor_user.id AS vendor_user_id,
         vendor_user.full_name AS vendor_contact_name, vendor_user.email AS vendor_email,
         vendor_user.phone AS vendor_phone, s.title AS service_title,
         category.id AS category_id, category.name AS category_name,
         (SELECT p.status FROM payments p
          WHERE p.booking_id = b.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS payment_status,
         (SELECT COUNT(*) FROM payments p WHERE p.booking_id = b.id) AS payment_count
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  JOIN users customer ON customer.id = e.organizer_id
  JOIN vendor_profiles vp ON vp.id = b.vendor_id
  JOIN users vendor_user ON vendor_user.id = vp.user_id
  LEFT JOIN services s ON s.id = b.service_id
  LEFT JOIN service_categories category ON category.id = COALESCE(s.category_id, vp.category_id)`;

function addFilters(query) {
  const clauses = [];
  const values = [];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.q) {
    const term = bind(`%${query.q}%`);
    const digits = query.q.match(/^BK-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
    const normalizedDigits = digits.replace(/^0+(?=\d)/, '');
    const exactId = bind(normalizedDigits);
    clauses.push(`(
      b.id::text = ${exactId} OR b.id::text ILIKE ${term}
      OR customer.full_name ILIKE ${term} OR customer.email ILIKE ${term}
      OR vp.business_name ILIKE ${term} OR vendor_user.full_name ILIKE ${term}
      OR e.title ILIKE ${term} OR b.service_description ILIKE ${term}
      OR COALESCE(s.title, '') ILIKE ${term}
    )`);
  }
  if (query.status) clauses.push(`b.status = ${bind(query.status)}`);
  if (query.paymentStatus === 'unpaid') {
    clauses.push('NOT EXISTS (SELECT 1 FROM payments payment_filter WHERE payment_filter.booking_id = b.id)');
  } else if (query.paymentStatus) {
    clauses.push(`EXISTS (SELECT 1 FROM payments payment_filter
                          WHERE payment_filter.booking_id = b.id AND payment_filter.status = ${bind(query.paymentStatus)})`);
  }
  if (query.categoryId) clauses.push(`COALESCE(s.category_id, vp.category_id) = ${bind(query.categoryId)}`);
  if (query.dateFrom) clauses.push(`COALESCE(b.scheduled_date, e.start_date)::date >= ${bind(query.dateFrom)}::date`);
  if (query.dateTo) clauses.push(`COALESCE(b.scheduled_date, e.start_date)::date <= ${bind(query.dateTo)}::date`);
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function sendError(res, error) {
  return res.status(400).json({
    error: 'Invalid request data.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

function effectiveBookingDate(booking) {
  return booking.scheduled_date || booking.start_date;
}

function dateValue(value) {
  if (value instanceof Date) return value;
  return new Date(String(value || '').replace(' ', 'T'));
}

function bookingCanComplete(booking) {
  const scheduledDate = dateValue(effectiveBookingDate(booking));
  return !Number.isNaN(scheduledDate.valueOf()) && scheduledDate <= new Date();
}

function bookingOutput(row) {
  return {
    ...row,
    id: Number(row.id),
    reference: `BK-${String(row.id).padStart(6, '0')}`,
    can_complete: bookingCanComplete(row),
    quoted_amount: Number(row.quoted_amount),
    payment_count: Number(row.payment_count || 0),
    payment_status: row.payment_status || 'unpaid',
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function lockBookingAndVendor(tx, bookingId) {
  const result = await tx.query(
    `SELECT b.id, b.event_id, b.vendor_id, b.service_id, b.status, b.scheduled_date,
            e.start_date, e.title AS event_title, e.organizer_id,
            customer.full_name AS customer_name, customer.id AS customer_id,
            vp.business_name AS vendor_name, vendor_user.id AS vendor_user_id
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN users customer ON customer.id = e.organizer_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     JOIN users vendor_user ON vendor_user.id = vp.user_id
     WHERE b.id = $1 FOR UPDATE OF b`,
    [bookingId],
  );
  const booking = result.rows[0];
  if (!booking) throw httpError('Booking not found.', 404);
  await lockBookingVendor(tx, booking.vendor_id);
  return booking;
}

async function writeAudit(tx, req, { actorId, action, bookingId, details }) {
  await tx.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address, request_id)
     VALUES ($1, $2, 'booking', $3, $4::jsonb, $5, $6)`,
    [actorId, action, String(bookingId), JSON.stringify(details), req.ip || null, req.requestId || null],
  );
}

async function notifyBookingParties(tx, booking, actorId, action, reason = '') {
  const title = action === 'accepted' ? 'Booking confirmed'
    : action === 'cancelled' ? 'Booking cancelled'
      : action === 'rejected' ? 'Booking declined'
        : action === 'rescheduled' ? 'Booking rescheduled'
          : `Booking ${action.replaceAll('_', ' ')}`;
  const message = `${title}: ${booking.event_title || `Booking #${booking.id}`} with ${booking.vendor_name || 'your vendor'}.${reason ? ` Reason: ${reason}` : ''}`;
  for (const userId of new Set([Number(booking.customer_id), Number(booking.vendor_user_id)])) {
    if (!userId || userId === Number(actorId)) continue;
    const result = await tx.query(
      `INSERT INTO notifications
         (user_id, title, message, notification_type, related_entity_type, related_entity_id,
          idempotency_key, delivery_channel, delivery_status)
       VALUES ($1, $2, $3, 'booking', 'booking', $4, $5, 'in_app', 'delivered')
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [userId, title, message, String(booking.id), action === 'rescheduled' ? null : `booking:${booking.id}:${action}:${userId}`],
    );
    if (result.rows[0]) {
      await tx.query(
        `INSERT INTO notification_history (notification_id, actor_id, action, details)
         VALUES ($1, $2, 'created', $3::jsonb)`,
        [result.rows[0].id, actorId, JSON.stringify({ source: 'booking', channel: 'in_app' })],
      );
    }
  }
}

function isFuture(value) {
  const date = dateValue(value);
  return !Number.isNaN(date.valueOf()) && date > new Date();
}

function scheduledInput(value) {
  const normalized = value.length === 16 ? `${value}:00` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) return null;
  const [year, month, day, hour, minute, second] = normalized.match(/\d+/g).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.valueOf())
    || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
  return { date, sqlValue: normalized.replace('T', ' ') };
}

export function createPostgresAdminBookingsRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/bookings/export', requirePermission('bookings.moderate'), async (req, res, next) => {
    const parsed = bookingExportSchema.safeParse(req.query);
    if (!parsed.success) return sendError(res, parsed.error);
    const { where, values } = addFilters(parsed.data);
    try {
      const rows = await database.query(
        `${bookingSelect}${where}
         ORDER BY ${sortColumns[parsed.data.sortBy]} ${parsed.data.sortDirection.toUpperCase()}, b.id DESC LIMIT 10000`,
        values,
      );
      const columns = [
        'reference', 'status', 'payment_status', 'customer_name', 'customer_email',
        'vendor_name', 'vendor_email', 'event_title', 'service_title', 'service_description',
        'category_name', 'scheduled_date', 'quoted_amount', 'currency', 'created_at',
      ];
      const lines = [
        columns.map(csvCell).join(','),
        ...rows.rows.map((row) => [
          `BK-${String(row.id).padStart(6, '0')}`, row.status, row.payment_status || 'unpaid',
          row.customer_name, row.customer_email, row.vendor_name, row.vendor_email,
          row.event_title, row.service_title, row.service_description, row.category_name,
          row.event_start_date, row.quoted_amount, row.currency, row.created_at,
        ].map(csvCell).join(',')),
      ];
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="booking-report.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(`\uFEFF${lines.join('\r\n')}`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/bookings/:id', requirePermission('bookings.moderate'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Booking ID is invalid.' });
    try {
      const selected = await database.query(`${bookingSelect} WHERE b.id = $1`, [id.data]);
      const booking = selected.rows[0];
      if (!booking) return res.status(404).json({ error: 'Booking not found.' });
      const [payments, refunds, history] = await Promise.all([
        database.query(
          `SELECT id, amount, currency, provider, payment_method, provider_reference, status, verified_at, created_at
           FROM payments WHERE booking_id = $1 ORDER BY created_at DESC, id DESC`,
          [id.data],
        ),
        database.query(
          `SELECT refund.id, refund.payment_id, refund.amount, refund.currency, refund.reason, refund.status,
                  refund.provider_refund_reference, refund.created_at, refund.decided_at, refund.processed_at
           FROM refund_requests refund JOIN payments payment ON payment.id = refund.payment_id
           WHERE payment.booking_id = $1 ORDER BY refund.created_at DESC, refund.id DESC`,
          [id.data],
        ),
        database.query(
          `SELECT id, actor_id, action, from_status, to_status, reason, details, created_at
           FROM booking_history WHERE booking_id = $1 ORDER BY id DESC`,
          [id.data],
        ),
      ]);
      return res.json({
        data: {
          ...bookingOutput(booking),
          payments: payments.rows,
          refunds: refunds.rows,
          history: history.rows,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/bookings', requirePermission('bookings.moderate'), async (req, res, next) => {
    const parsed = bookingListSchema.safeParse(req.query);
    if (!parsed.success) return sendError(res, parsed.error);
    const { page, pageSize, sortBy, sortDirection } = parsed.data;
    const { where, values } = addFilters(parsed.data);
    try {
      const count = await database.query(
        `SELECT COUNT(*) AS total
         FROM bookings b JOIN events e ON e.id = b.event_id
         JOIN users customer ON customer.id = e.organizer_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id
         JOIN users vendor_user ON vendor_user.id = vp.user_id
         LEFT JOIN services s ON s.id = b.service_id${where}`,
        values,
      );
      const pageValues = [...values, pageSize, (page - 1) * pageSize];
      const rows = await database.query(
        `${bookingSelect}${where}
         ORDER BY ${sortColumns[sortBy]} ${sortDirection.toUpperCase()}, b.id DESC
         LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues,
      );
      return res.json({
        data: rows.rows.map(bookingOutput),
        pagination: { page, pageSize, total: Number(count.rows[0]?.total || 0) },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/bookings/:id/status', requirePermission('bookings.moderate'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = bookingActionSchema.safeParse(req.body || {});
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: 'A valid booking status and reason are required.' });
    }
    const { status, reason } = parsed.data;
    if (['rejected', 'cancelled'].includes(status) && reason.length < 5) {
      return res.status(400).json({ error: 'A cancellation or rejection reason of at least 5 characters is required.' });
    }
    try {
      await database.inTransaction(async (tx) => {
        const booking = await lockBookingAndVendor(tx, id.data);
        const transitions = {
          requested: ['under_review', 'accepted', 'rejected', 'cancelled'],
          quoted: ['under_review', 'accepted', 'rejected', 'cancelled'],
          under_review: ['accepted', 'rejected', 'cancelled'],
          accepted: ['cancelled', 'completed'],
        };
        if (!(transitions[booking.status] || []).includes(status)) {
          throw httpError(`Cannot change booking from ${booking.status} to ${status}.`, 409);
        }
        const scheduledDate = effectiveBookingDate(booking);
        if (status === 'cancelled') {
          const settings = await loadSystemSettings(tx, ['booking_cancellation_cutoff_hours']);
          const cutoffHours = Number(settings.booking_cancellation_cutoff_hours ?? 24);
          if (!Number.isFinite(cutoffHours) || dateValue(scheduledDate).getTime() - Date.now() <= cutoffHours * 3600000) {
            throw httpError('This booking is inside the configured cancellation cutoff.', 409);
          }
        }
        if (status === 'accepted') {
          if (!isFuture(scheduledDate)) throw httpError('A booking cannot be confirmed after its scheduled date.', 409);
          const availability = await checkBookingDateAvailability(tx, {
            vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate,
          });
          await reserveBookingDate(tx, { vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate, availability });
        }
        if (status === 'completed') {
          const completionDate = dateValue(scheduledDate);
          if (!scheduledDate || Number.isNaN(completionDate.valueOf()) || completionDate > new Date()) {
            throw httpError('A booking cannot be marked completed before its scheduled date.', 409);
          }
        }
        await tx.query(
          `UPDATE bookings SET status = $1, scheduled_date = COALESCE(scheduled_date, $2),
             moderation_reason = $3 WHERE id = $4`,
          [status, scheduledDate, reason || null, id.data],
        );
        if (status === 'cancelled') {
          await releaseBookingDate(tx, { vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate });
        }
        await tx.query(
          `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, reason, details)
           VALUES ($1, $2, 'status_changed', $3, $4, $5, $6::jsonb)`,
          [id.data, req.admin.id, booking.status, status, reason || null, JSON.stringify({ schedule: scheduledDate })],
        );
        await writeAudit(tx, req, {
          actorId: req.admin.id, action: 'booking.status_changed', bookingId: id.data,
          details: { from: booking.status, to: status, reason: reason || null },
        });
        await notifyBookingParties(tx, booking, req.admin.id, status, reason);
      });
      return res.json({ data: { id: id.data, status } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.post('/bookings/:id/reschedule', requirePermission('bookings.moderate'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = bookingRescheduleSchema.safeParse(req.body || {});
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: 'Provide a valid booking date and rescheduling reason.' });
    }
    const newDate = scheduledInput(parsed.data.scheduled_date);
    if (!newDate) return res.status(400).json({ error: 'Enter a valid scheduled date and time.' });
    if (newDate.date <= new Date()) return res.status(400).json({ error: 'The new booking date must be in the future.' });
    try {
      await database.inTransaction(async (tx) => {
        const booking = await lockBookingAndVendor(tx, id.data);
        const settings = await loadSystemSettings(tx, ['booking_rescheduling_enabled', 'booking_reschedule_cutoff_hours']);
        if (!settings.booking_rescheduling_enabled) {
          throw httpError('Booking rescheduling is disabled by the current system policy.', 409);
        }
        if (!['requested', 'quoted', 'accepted'].includes(booking.status)) {
          throw httpError('This booking cannot be rescheduled in its current status.', 409);
        }
        const previousDate = effectiveBookingDate(booking);
        if (!isFuture(previousDate)) throw httpError('A booking cannot be rescheduled after its scheduled date.', 409);
        const cutoffHours = Number(settings.booking_reschedule_cutoff_hours ?? 24);
        if (!Number.isFinite(cutoffHours) || dateValue(previousDate).getTime() - Date.now() <= cutoffHours * 3600000) {
          throw httpError('This booking is inside the configured rescheduling cutoff.', 409);
        }
        if (dateValue(previousDate).getTime() === newDate.date.getTime()) {
          throw httpError('Choose a different date to reschedule this booking.', 409);
        }
        const availability = await checkBookingDateAvailability(tx, {
          vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate: newDate.sqlValue,
        });
        if (booking.status === 'accepted') {
          await reserveBookingDate(tx, {
            vendorId: booking.vendor_id, bookingId: booking.id,
            scheduledDate: newDate.sqlValue, availability,
          });
        }
        await tx.query(
          'UPDATE bookings SET scheduled_date = $1, moderation_reason = $2 WHERE id = $3',
          [newDate.sqlValue, parsed.data.reason, id.data],
        );
        if (booking.status === 'accepted') {
          await releaseBookingDate(tx, {
            vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate: previousDate,
          });
        }
        await tx.query(
          `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, reason, details)
           VALUES ($1, $2, 'rescheduled', $3, $3, $4, $5::jsonb)`,
          [id.data, req.admin.id, booking.status, parsed.data.reason,
            JSON.stringify({ from: previousDate, to: newDate.sqlValue })],
        );
        await writeAudit(tx, req, {
          actorId: req.admin.id, action: 'booking.rescheduled', bookingId: id.data,
          details: { from: previousDate, to: newDate.sqlValue, reason: parsed.data.reason },
        });
        await notifyBookingParties(tx, booking, req.admin.id, 'rescheduled', parsed.data.reason);
      });
      return res.json({ data: { id: id.data, scheduled_date: newDate.sqlValue } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}
