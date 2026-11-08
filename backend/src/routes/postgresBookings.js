import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { loadSystemSettings } from '../lib/systemSettings.js';
import { mapBookingRecord } from '../lib/marketplace.js';
import { createBookingSnapshot } from '../lib/bookingRules.js';
import {
  checkBookingDateAvailability,
  lockBookingVendor,
  releaseBookingDate,
  reserveBookingDate,
} from '../lib/bookingAvailability.js';
import { dateTimeSchema, toMysqlDateTime } from '../lib/eventInput.js';

const activeBookingStatuses = ['requested', 'under_review', 'quoted', 'accepted', 'confirmed', 'in_progress'];
const reservedBookingStatuses = ['accepted', 'confirmed', 'in_progress'];

function httpError(message, status) {
  return Object.assign(new Error(message), { status, expose: true });
}

function rowsOf(result) {
  return result.rows;
}

async function notify(database, { userId, title, message, type, relatedType, relatedId, actorId, idempotencyKey }) {
  if (!userId || Number(userId) === Number(actorId)) return;
  const result = await database.query(
    `INSERT INTO notifications
       (user_id, title, message, notification_type, related_entity_type, related_entity_id,
        idempotency_key, delivery_channel, delivery_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_app', 'delivered')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [userId, title, message, type, relatedType, String(relatedId), idempotencyKey],
  );
  if (result.rows[0]) {
    await database.query(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES ($1, $2, 'created', $3::jsonb)`,
      [result.rows[0].id, actorId, JSON.stringify({ source: type, channel: 'in_app' })],
    );
  }
}

async function audit(database, req, { actorId, action, entityType, entityId, details }) {
  await database.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address, request_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [actorId, action, entityType, String(entityId), JSON.stringify(details || {}), req.ip || null,
      req.requestId || null],
  );
}

function futureDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date > new Date();
}

function validDateOnly(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function vendorStatusLabel(status) {
  return ({
    requested: 'Pending',
    under_review: 'Under Review',
    quoted: 'Quoted',
    accepted: 'Accepted',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    completed: 'Completed',
    draft: 'Draft',
  })[status] || status;
}

function mapQuote(row) {
  return {
    id: Number(row.id),
    vendorId: Number(row.vendor_id),
    vendorName: row.vendor_name || null,
    eventId: row.event_id === null ? null : Number(row.event_id),
    serviceId: row.service_id === null ? null : Number(row.service_id),
    event: row.requested_event_name || row.event_title || null,
    eventTitle: row.requested_event_name || row.event_title || null,
    eventDate: row.requested_date || null,
    eventLocation: row.requested_location || null,
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
    budget: row.budget === null ? null : Number(row.budget),
    eventType: row.requested_event_type || null,
    contactPhone: row.requested_phone || null,
    requiredServices: row.required_services || '',
    additionalRequirements: row.additional_requirements || '',
    requestMessage: row.request_message || '',
    service: row.service_description,
    status: row.status,
    amount: Number(row.amount || 0),
    currency: String(row.currency || 'ETB').trim(),
    validUntil: row.valid_until || null,
    notes: row.notes || '',
    createdAt: row.created_at || null,
  };
}

function createPostgresPlatformRouter({ database }) {
  const router = Router();

  router.get('/bookings', requirePlatformUser, asyncHandler(async (req, res) => {
    let rows;
    if (req.platformUser.role === 'vendor') {
      const vendor = rowsOf(await database.query(
        'SELECT id FROM vendor_profiles WHERE user_id = $1',
        [req.platformUser.id],
      ))[0];
      if (!vendor) return res.json({ data: [] });
      rows = rowsOf(await database.query(
        `SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount, b.currency,
                b.status, b.moderation_reason, b.created_at, e.title AS event_title,
                TO_CHAR(e.start_date, 'YYYY-MM-DD') AS event_start_date,
                u.full_name AS customer_name, vp.business_name AS vendor_name
         FROM bookings b JOIN events e ON e.id = b.event_id
         JOIN users u ON u.id = e.organizer_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id
         WHERE b.vendor_id = $1 ORDER BY b.created_at DESC`,
        [vendor.id],
      ));
    } else {
      rows = rowsOf(await database.query(
        `SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount, b.currency,
                b.status, b.moderation_reason, b.created_at, e.title AS event_title,
                TO_CHAR(e.start_date, 'YYYY-MM-DD') AS event_start_date,
                u.full_name AS customer_name, vp.business_name AS vendor_name
         FROM bookings b JOIN events e ON e.id = b.event_id
         JOIN users u ON u.id = e.organizer_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id
         WHERE e.organizer_id = $1 ORDER BY b.created_at DESC`,
        [req.platformUser.id],
      ));
    }
    return res.json({ data: rows.map(mapBookingRecord) });
  }));

  router.post('/bookings', requirePlatformUser, asyncHandler(async (req, res) => {
    if (!['customer', 'organizer'].includes(req.platformUser.role)) {
      return res.status(403).json({ error: 'Only customers and organizers can create bookings.' });
    }
    const parsed = z.object({
      eventId: z.coerce.number().int().positive(),
      serviceId: z.coerce.number().int().positive(),
      notes: z.string().trim().max(500).optional().default(''),
    }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid booking request.' });

    const result = await database.inTransaction(async (tx) => {
      const event = rowsOf(await tx.query(
        'SELECT id, organizer_id, status, start_date, title FROM events WHERE id = $1 FOR UPDATE',
        [parsed.data.eventId],
      ))[0];
      if (!event || Number(event.organizer_id) !== Number(req.platformUser.id)) {
        throw httpError('Event not found.', 404);
      }
      if (!['active', 'published', 'upcoming', 'open'].includes(event.status)) {
        throw httpError('This event is not accepting bookings.', 409);
      }
      const service = rowsOf(await tx.query(
        `SELECT s.id, s.vendor_id, s.title, s.price, s.currency, vp.user_id AS vendor_user_id,
                vp.business_name AS vendor_name
         FROM services s JOIN vendor_profiles vp ON vp.id = s.vendor_id
         JOIN users vu ON vu.id = vp.user_id AND vu.status = 'active'
         WHERE s.id = $1 AND s.status = 'active' AND vp.verification_status = 'verified'
         FOR UPDATE OF s`,
        [parsed.data.serviceId],
      ))[0];
      if (!service) throw httpError('Service not found.', 404);
      if (Number(service.price) <= 0) throw httpError('This service requires a custom quote.', 409);
      await lockBookingVendor(tx, service.vendor_id);
      if (!futureDate(event.start_date)) throw httpError('The event must have a future scheduled date.', 409);
      const scheduledDate = event.start_date;
      await checkBookingDateAvailability(tx, { vendorId: service.vendor_id, bookingId: 0, scheduledDate });
      const duplicate = rowsOf(await tx.query(
        `SELECT id FROM bookings
         WHERE event_id = $1 AND service_id = $2 AND status = ANY($3::varchar[])
         LIMIT 1 FOR UPDATE`,
        [event.id, service.id, activeBookingStatuses],
      ))[0];
      if (duplicate) throw httpError('A booking request for this service already exists for the event.', 409);

      const booking = rowsOf(await tx.query(
        `INSERT INTO bookings
           (event_id, vendor_id, service_id, scheduled_date, service_description, quoted_amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'requested') RETURNING id`,
        [event.id, service.vendor_id, service.id, scheduledDate,
          (parsed.data.notes ? `${service.title} - ${parsed.data.notes}` : service.title).slice(0, 255),
          service.price, service.currency || 'ETB'],
      ))[0];
      await tx.query(
        `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, details)
         VALUES ($1, $2, 'created', NULL, 'requested', $3::jsonb)`,
        [booking.id, req.platformUser.id, JSON.stringify({ eventId: Number(event.id), serviceId: Number(service.id) })],
      );
      await notify(tx, {
        userId: service.vendor_user_id,
        title: 'Booking requested',
        message: `A new booking request was submitted for ${event.title}.`,
        type: 'booking', relatedType: 'booking', relatedId: booking.id, actorId: req.platformUser.id,
        idempotencyKey: `booking:${booking.id}:requested:${service.vendor_user_id}`,
      });
      await audit(tx, req, {
        actorId: req.platformUser.id, action: 'booking.requested', entityType: 'booking',
        entityId: booking.id, details: { eventId: Number(event.id), serviceId: Number(service.id), vendorId: Number(service.vendor_id) },
      });
      return { id: Number(booking.id), event, service };
    });
    return res.status(201).json({
      data: {
        ...createBookingSnapshot({
          id: result.id, status: 'requested', quotedAmount: result.service.price,
          currency: result.service.currency, serviceTitle: result.service.title,
        }),
        reference: `BK-${String(result.id).padStart(6, '0')}`,
        eventId: Number(result.event.id),
        vendorId: Number(result.service.vendor_id),
      },
    });
  }));

  router.patch('/bookings/:id/status', requirePlatformUser, asyncHandler(async (req, res) => {
    const parsed = z.object({
      status: z.enum(['under_review', 'quoted', 'accepted', 'rejected', 'cancelled', 'completed']),
      reason: z.string().trim().max(500).optional().default(''),
    }).safeParse(req.body || {});
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid booking status.' });
    if (!id.success) return res.status(400).json({ error: 'Booking ID is invalid.' });
    if (req.platformUser.role === 'vendor' && parsed.data.status === 'rejected' && parsed.data.reason.length < 5) {
      return res.status(400).json({ error: 'Provide a rejection reason of at least five characters.' });
    }

    await database.inTransaction(async (tx) => {
      const settings = await loadSystemSettings(tx, [
        'booking_confirmation_workflow', 'booking_cancellation_cutoff_hours',
      ]);
      const booking = rowsOf(await tx.query(
        `SELECT b.id, b.status, b.vendor_id, b.scheduled_date, e.start_date, e.title AS event_title,
                e.organizer_id, vp.user_id AS vendor_user_id, vp.business_name AS vendor_name,
                vp.verification_status AS vendor_verification_status
         FROM bookings b JOIN events e ON e.id = b.event_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id
         WHERE b.id = $1 FOR UPDATE OF b`,
        [id.data],
      ))[0];
      if (!booking) throw httpError('Booking not found.', 404);
      await lockBookingVendor(tx, booking.vendor_id);
      const isVendor = Number(booking.vendor_user_id) === Number(req.platformUser.id);
      const isOrganizer = Number(booking.organizer_id) === Number(req.platformUser.id);
      if (!isVendor && !isOrganizer) throw httpError('Access denied.', 403);
      if (isVendor && booking.vendor_verification_status !== 'verified') {
        throw httpError('Vendor verification is required to respond to bookings.', 403);
      }
      const vendorTransitions = {
        requested: ['under_review', 'accepted', 'rejected'],
        under_review: ['quoted', 'accepted', 'rejected'],
        quoted: ['accepted', 'rejected'],
        accepted: ['completed'],
      };
      const customerTransitions = {
        requested: ['cancelled'], under_review: ['cancelled'], quoted: ['cancelled'], accepted: ['cancelled'],
      };
      const nextStatus = parsed.data.status;
      const allowed = (isVendor ? vendorTransitions[booking.status] : customerTransitions[booking.status]) || [];
      if (!allowed.includes(nextStatus)) {
        throw httpError(`Cannot change booking from ${booking.status} to ${nextStatus}.`, 409);
      }
      if (isVendor && nextStatus === 'accepted' && settings.booking_confirmation_workflow === 'administrator_approval') {
        throw httpError('Bookings require administrator approval before confirmation.', 409);
      }
      const scheduledDate = booking.scheduled_date || booking.start_date;
      if (isOrganizer && nextStatus === 'cancelled') {
        const cutoffHours = Number(settings.booking_cancellation_cutoff_hours ?? 24);
        if (new Date(scheduledDate).getTime() - Date.now() <= cutoffHours * 3600000) {
          throw httpError('This booking is inside the configured cancellation cutoff.', 409);
        }
      }
      if (nextStatus === 'accepted') {
        if (!futureDate(scheduledDate)) throw httpError('A booking cannot be confirmed after its scheduled date.', 409);
        const availability = await checkBookingDateAvailability(tx, { vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate });
        await reserveBookingDate(tx, { vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate, availability });
      }
      if (nextStatus === 'completed' && futureDate(scheduledDate)) {
        throw httpError('A booking cannot be marked completed before its scheduled date.', 409);
      }
      if (nextStatus === 'completed' && (!scheduledDate || Number.isNaN(new Date(scheduledDate).getTime()))) {
        throw httpError('A booking cannot be marked completed before its scheduled date.', 409);
      }
      await tx.query(
        `UPDATE bookings SET status = $1, scheduled_date = COALESCE(scheduled_date, $2),
           moderation_reason = $3 WHERE id = $4`,
        [nextStatus, scheduledDate, parsed.data.reason || null, booking.id],
      );
      if (nextStatus === 'cancelled') {
        await releaseBookingDate(tx, { vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate });
      }
      await tx.query(
        `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, reason)
         VALUES ($1, $2, 'status_changed', $3, $4, $5)`,
        [booking.id, req.platformUser.id, booking.status, nextStatus, parsed.data.reason || null],
      );
      const targetIds = new Set([Number(booking.organizer_id), Number(booking.vendor_user_id)]);
      for (const userId of targetIds) {
        await notify(tx, {
          userId, title: `Booking ${nextStatus.replaceAll('_', ' ')}`,
          message: `Booking ${booking.id} for ${booking.event_title} is now ${nextStatus.replaceAll('_', ' ')}.${parsed.data.reason ? ` Reason: ${parsed.data.reason}` : ''}`,
          type: 'booking', relatedType: 'booking', relatedId: booking.id, actorId: req.platformUser.id,
          idempotencyKey: `booking:${booking.id}:${nextStatus}:${userId}`,
        });
      }
      await audit(tx, req, {
        actorId: req.platformUser.id, action: `booking.${nextStatus}`, entityType: 'booking',
        entityId: booking.id, details: { previousStatus: booking.status, reason: parsed.data.reason || null },
      });
    });
    return res.json({ data: { id: id.data, status: parsed.data.status } });
  }));

  router.post(['/quotes', '/service-quote-requests'], requirePlatformUser, asyncHandler(async (req, res) => {
    if (!['customer', 'organizer'].includes(req.platformUser.role)) {
      return res.status(403).json({ error: 'Customer or organizer access is required.' });
    }
    const parsed = z.object({
      vendorId: z.coerce.number().int().positive().optional(),
      serviceId: z.coerce.number().int().positive(),
      eventId: z.coerce.number().int().positive().optional(),
      requestKey: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).optional(),
      eventName: z.string().trim().min(2).max(180).optional(),
      eventDate: dateTimeSchema.refine(
        (value) => new Date(value).getTime() > Date.now(),
        'Event date must be in the future.',
      ),
      eventLocation: z.string().trim().min(1).max(120),
      eventType: z.string().trim().min(2).max(80),
      contactPhone: z.string().trim().min(7).max(30).regex(/^\+?[0-9][0-9 ()-]{5,28}$/),
      guestCount: z.coerce.number().int().positive().max(100000).optional(),
      budget: z.coerce.number().nonnegative().max(100000000).optional(),
      requiredServices: z.string().trim().max(1000).optional().default(''),
      additionalRequirements: z.string().trim().max(2000).optional().default(''),
      message: z.string().trim().max(2000).optional().default(''),
      notes: z.string().trim().max(2000).optional().default(''),
    }).strict().safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quote request.' });

    const result = await database.inTransaction(async (tx) => {
      const service = rowsOf(await tx.query(
        `SELECT s.id, s.title, s.price, s.currency, s.vendor_id, vp.user_id AS vendor_user_id
         FROM services s JOIN vendor_profiles vp ON vp.id = s.vendor_id
         JOIN users vu ON vu.id = vp.user_id AND vu.status = 'active'
         WHERE s.id = $1 AND s.status = 'active' AND vp.verification_status = 'verified'`,
        [parsed.data.serviceId],
      ))[0];
      if (!service) throw httpError('Service not found.', 404);
      if (parsed.data.vendorId && Number(service.vendor_id) !== parsed.data.vendorId) {
        throw httpError('The selected service does not belong to this vendor.', 400);
      }
      if (parsed.data.requestKey) {
        const existing = rowsOf(await tx.query(
          'SELECT id, service_id, status, customer_id FROM quotations WHERE request_key = $1',
          [parsed.data.requestKey],
        ))[0];
        if (existing) {
          if (Number(existing.customer_id) !== Number(req.platformUser.id)
            || Number(existing.service_id) !== Number(service.id)) {
            throw httpError('This request key has already been used.', 409);
          }
          return { duplicate: true, data: { id: Number(existing.id), status: existing.status, serviceId: Number(service.id), serviceTitle: service.title } };
        }
      }
      if (parsed.data.eventId) {
        const event = rowsOf(await tx.query(
          'SELECT id FROM events WHERE id = $1 AND organizer_id = $2',
          [parsed.data.eventId, req.platformUser.id],
        ))[0];
        if (!event) throw httpError('Event not found.', 404);
      }
      const quote = rowsOf(await tx.query(
        `INSERT INTO quotations
           (vendor_id, customer_id, event_id, service_id, request_key, requested_event_name,
            requested_date, requested_location, guest_count, budget, requested_event_type,
            requested_phone, required_services, additional_requirements, request_message,
            service_description, amount, currency, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 0, $17, 'draft', $18)
         RETURNING id`,
        [service.vendor_id, req.platformUser.id, parsed.data.eventId || null, service.id,
          parsed.data.requestKey || null, parsed.data.eventName || null, toMysqlDateTime(parsed.data.eventDate),
          parsed.data.eventLocation, parsed.data.guestCount ?? null, parsed.data.budget ?? null,
          parsed.data.eventType, parsed.data.contactPhone || req.platformUser.phone || null,
          parsed.data.requiredServices || null, parsed.data.additionalRequirements || null,
          parsed.data.message || null, service.title, service.currency || 'ETB', parsed.data.notes || null],
      ))[0];
      await notify(tx, {
        userId: service.vendor_user_id, title: 'New service request',
        message: `${req.platformUser.full_name || 'A customer'} requested ${service.title}${parsed.data.eventName ? ` for ${parsed.data.eventName}` : ''}.`,
        type: 'quotation', relatedType: 'quotation', relatedId: quote.id, actorId: req.platformUser.id,
        idempotencyKey: `quotation-request:${quote.id}:${service.vendor_user_id}`,
      });
      return { duplicate: false, data: { id: Number(quote.id), status: 'draft', serviceId: Number(service.id), serviceTitle: service.title } };
    });
    return res.status(result.duplicate ? 200 : 201).json({ data: result.data });
  }));

  router.patch('/quotations/:id/respond', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    const parsed = z.object({
      status: z.enum(['sent', 'declined']),
      amount: z.coerce.number().finite().nonnegative().max(100000000).optional(),
      notes: z.string().trim().max(2000).optional().default(''),
      validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
    }).strict().safeParse(req.body || {});
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'A valid quote response is required.' });
    if (parsed.data.status === 'sent' && parsed.data.amount === undefined) {
      return res.status(400).json({ error: 'Enter the quote amount before sending a response.' });
    }
    const result = await database.inTransaction(async (tx) => {
      const quote = rowsOf(await tx.query(
        `SELECT q.id, q.customer_id, q.status, vp.id AS vendor_id
         FROM quotations q JOIN vendor_profiles vp ON vp.id = q.vendor_id
         JOIN users vu ON vu.id = vp.user_id AND vu.status = 'active'
         WHERE q.id = $1 AND vp.user_id = $2 AND vp.verification_status = 'verified'
         FOR UPDATE OF q`,
        [id.data, req.platformUser.id],
      ))[0];
      if (!quote || !['draft', 'revision_requested'].includes(quote.status)) {
        throw httpError('Open quote request not found.', 404);
      }
      await tx.query(
        `UPDATE quotations SET status = $1, amount = COALESCE($2, amount),
           notes = CASE
             WHEN NULLIF(notes, '') IS NULL THEN NULLIF($3, '')
             WHEN NULLIF($3, '') IS NULL THEN notes
             ELSE notes || E'\\n\\n' || $3
           END,
           valid_until = NULLIF($4, '')::date, updated_at = NOW()
         WHERE id = $5 AND vendor_id = $6`,
        [parsed.data.status, parsed.data.amount ?? null,
          parsed.data.notes ? `Vendor response: ${parsed.data.notes}` : '',
          parsed.data.validUntil || '', id.data, quote.vendor_id],
      );
      await notify(tx, {
        userId: quote.customer_id, title: parsed.data.status === 'sent' ? 'Vendor quotation received' : 'Vendor declined request',
        message: parsed.data.status === 'sent'
          ? `A vendor responded to quotation #${id.data}. Review the quotation in your dashboard.`
          : `A vendor declined quotation request #${id.data}.`,
        type: 'quotation', relatedType: 'quotation', relatedId: id.data, actorId: req.platformUser.id,
        idempotencyKey: `quotation-response:${id.data}:${quote.status}:${parsed.data.status}:${quote.customer_id}`,
      });
      return { id: id.data, status: parsed.data.status, amount: parsed.data.amount, validUntil: parsed.data.validUntil || null };
    });
    return res.json({ data: result });
  }));

  router.get('/organizer/quotations', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'organizer') return res.status(403).json({ error: 'Organizer access is required.' });
    const rows = rowsOf(await database.query(
      `SELECT q.*, vp.business_name AS vendor_name, e.title AS event_title
       FROM quotations q JOIN vendor_profiles vp ON vp.id = q.vendor_id
       LEFT JOIN events e ON e.id = q.event_id
       WHERE q.customer_id = $1 AND (q.event_id IS NULL OR e.organizer_id = $1)
       ORDER BY q.created_at DESC, q.id DESC`,
      [req.platformUser.id],
    ));
    return res.json({ data: rows.map(mapQuote) });
  }));

  router.patch('/organizer/quotations/:id/decision', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'organizer') return res.status(403).json({ error: 'Organizer access is required.' });
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    const parsed = z.object({
      status: z.enum(['accepted', 'declined', 'revision_requested', 'cancelled']),
      reason: z.string().trim().max(500).optional().default(''),
    }).strict().safeParse(req.body || {});
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'A valid quotation decision is required.' });
    }
    if (parsed.data.status === 'revision_requested' && parsed.data.reason.length < 5) {
      return res.status(400).json({ error: 'Enter at least five characters describing the requested revision.' });
    }
    await database.inTransaction(async (tx) => {
      const quote = rowsOf(await tx.query(
        `SELECT q.id, q.status, q.event_id, q.customer_id, vp.user_id AS vendor_user_id, e.organizer_id
         FROM quotations q JOIN vendor_profiles vp ON vp.id = q.vendor_id
         LEFT JOIN events e ON e.id = q.event_id
         WHERE q.id = $1 AND q.customer_id = $2 FOR UPDATE OF q`,
        [id.data, req.platformUser.id],
      ))[0];
      if (!quote || (quote.event_id && Number(quote.organizer_id) !== Number(req.platformUser.id))) {
        throw httpError('Quotation not found.', 404);
      }
      if (parsed.data.status === 'cancelled'
        ? quote.status !== 'draft'
        : !['sent', 'revision_requested'].includes(quote.status)) {
        throw httpError('This quotation is no longer awaiting a decision.', 409);
      }
      await tx.query(
        `UPDATE quotations SET status = $1, updated_at = NOW(),
           notes = CASE
             WHEN NULLIF(notes, '') IS NULL THEN NULLIF($2, '')
             WHEN NULLIF($2, '') IS NULL THEN notes
             ELSE notes || E'\\n\\n' || $2
           END WHERE id = $3`,
        [parsed.data.status, parsed.data.reason ? `Organizer: ${parsed.data.reason}` : '', id.data],
      );
      await notify(tx, {
        userId: quote.vendor_user_id, title: 'Quotation update',
        message: `The organizer ${parsed.data.status.replaceAll('_', ' ')} quotation #${id.data}.${parsed.data.reason ? ` ${parsed.data.reason}` : ''}`,
        type: 'booking', relatedType: 'quotation', relatedId: id.data, actorId: req.platformUser.id,
        idempotencyKey: `quotation-organizer-decision:${id.data}:${parsed.data.status}:${quote.vendor_user_id}`,
      });
      await audit(tx, req, {
        actorId: req.platformUser.id, action: `organizer.quotation_${parsed.data.status}`,
        entityType: 'quotation', entityId: id.data,
        details: { eventId: quote.event_id === null ? null : Number(quote.event_id) },
      });
    });
    return res.json({ data: { id: id.data, status: parsed.data.status } });
  }));
  return router;
}

function createPostgresCustomerRouter({ database }) {
  const router = Router();
  const bookingRowsForCustomer = async (userId, id = null) => {
    const values = id === null ? [userId] : [userId, id];
    const idFilter = id === null ? '' : 'AND b.id = $2';
    const result = await database.query(
      `SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount,
              COALESCE(NULLIF(BTRIM(b.currency), ''), 'ETB') AS currency, b.service_id,
              b.scheduled_date, b.status, b.moderation_reason, b.created_at,
              e.title AS event_title, e.event_type, e.description AS event_description,
              e.start_date AS event_start_date, e.city AS event_city, e.venue AS event_venue,
              e.budget AS event_budget, e.guest_count AS event_guest_count, e.notes AS event_notes,
              u.full_name AS customer_name, vp.business_name AS vendor_name, s.title AS service_title,
              (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS payment_status,
              (b.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)) AS can_review,
              EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS has_review
       FROM bookings b JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = e.organizer_id
       JOIN vendor_profiles vp ON vp.id = b.vendor_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE e.organizer_id = $1 ${idFilter}
       ORDER BY b.created_at DESC`,
      values,
    );
    return result.rows;
  };
  const mapCustomerBooking = (row, settings) => {
    const scheduledDate = row.scheduled_date || row.event_start_date;
    const cutoff = Number(settings.booking_cancellation_cutoff_hours ?? 24);
    const rescheduleCutoff = Number(settings.booking_reschedule_cutoff_hours ?? 24);
    const settingEnabled = settings.booking_rescheduling_enabled !== false
      && settings.booking_rescheduling_enabled !== 'false'
      && settings.booking_rescheduling_enabled !== '0';
    const inFuture = scheduledDate && new Date(scheduledDate) > new Date();
    const remainingHours = inFuture ? (new Date(scheduledDate).getTime() - Date.now()) / 3600000 : -1;
    const booking = mapBookingRecord({
      ...row,
    event_start_date: String(row.event_start_date).slice(0, 10),
    });
    return {
      ...booking,
      serviceTitle: String(row.service_title || row.service_description || '').trim(),
      serviceDescription: row.service_description || '',
      serviceId: row.service_id === null ? null : Number(row.service_id),
      scheduledDate,
      eventCity: row.event_city || null,
      eventVenue: row.event_venue || null,
      eventType: row.event_type || null,
      eventDescription: row.event_description || null,
      eventBudget: row.event_budget === null ? null : Number(row.event_budget),
      eventGuestCount: row.event_guest_count === null ? null : Number(row.event_guest_count),
      eventNotes: row.event_notes || null,
      location: [row.event_venue, row.event_city].filter(Boolean).join(', ') || null,
      paymentStatus: row.payment_status || 'unpaid',
      canReview: Boolean(row.can_review),
      hasReview: Boolean(row.has_review),
      canCancel: ['requested', 'under_review', 'quoted', 'accepted'].includes(row.status)
        && remainingHours > cutoff,
      canReschedule: ['requested', 'quoted', 'accepted'].includes(row.status)
        && settingEnabled && remainingHours > rescheduleCutoff,
    };
  };

  router.get('/bookings', requirePlatformUser, asyncHandler(async (req, res) => {
    const [rows, settings] = await Promise.all([
      bookingRowsForCustomer(req.platformUser.id),
      loadSystemSettings(database, ['booking_cancellation_cutoff_hours', 'booking_reschedule_cutoff_hours', 'booking_rescheduling_enabled']),
    ]);
    return res.json({ success: true, data: rows.map((row) => mapCustomerBooking(row, settings)) });
  }));

  router.get('/bookings/:id', requirePlatformUser, asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Booking ID is invalid.' });
    const [rows, settings] = await Promise.all([
      bookingRowsForCustomer(req.platformUser.id, id.data),
      loadSystemSettings(database, ['booking_cancellation_cutoff_hours', 'booking_reschedule_cutoff_hours', 'booking_rescheduling_enabled']),
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found.' });
    return res.json({ success: true, data: mapCustomerBooking(rows[0], settings) });
  }));

  router.patch('/bookings/:id/reschedule', requirePlatformUser, asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    const parsed = z.object({
      scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      reason: z.string().trim().min(5).max(500),
    }).strict().safeParse(req.body || {});
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: 'Provide a valid booking date and rescheduling reason.' });
    }
    const [year, month, day, hour, minute] = parsed.data.scheduledDate.split(/[-T:]/).map(Number);
    const localDate = new Date(year, month - 1, day, hour, minute);
    if (localDate.getFullYear() !== year || localDate.getMonth() !== month - 1
      || localDate.getDate() !== day || localDate.getHours() !== hour
      || localDate.getMinutes() !== minute || localDate <= new Date()) {
      return res.status(400).json({ error: 'Enter a valid future booking date and time.' });
    }
    const scheduledDate = `${parsed.data.scheduledDate.replace('T', ' ')}:00`;
    const result = await database.inTransaction(async (tx) => {
      const booking = rowsOf(await tx.query(
        `SELECT b.id, b.status, b.vendor_id, b.scheduled_date, e.start_date, e.title AS event_title,
                e.organizer_id, vp.user_id AS vendor_user_id, vp.business_name AS vendor_name
         FROM bookings b JOIN events e ON e.id = b.event_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id
         WHERE b.id = $1 AND e.organizer_id = $2 FOR UPDATE OF b`,
        [id.data, req.platformUser.id],
      ))[0];
      if (!booking) throw httpError('Booking not found.', 404);
      await lockBookingVendor(tx, booking.vendor_id);
      const settings = await loadSystemSettings(tx, ['booking_rescheduling_enabled', 'booking_reschedule_cutoff_hours']);
      if (settings.booking_rescheduling_enabled === false || settings.booking_rescheduling_enabled === 'false'
        || settings.booking_rescheduling_enabled === '0') {
        throw httpError('Booking rescheduling is disabled by the current system policy.', 409);
      }
      if (!['requested', 'quoted', 'accepted'].includes(booking.status)) {
        throw httpError('This booking cannot be rescheduled in its current status.', 409);
      }
      const previousDate = booking.scheduled_date || booking.start_date;
      if (!previousDate || new Date(previousDate) <= new Date()) {
        throw httpError('A booking cannot be rescheduled after its scheduled date.', 409);
      }
      if (new Date(previousDate).getTime() === localDate.getTime()) {
        throw httpError('Choose a different date to reschedule this booking.', 409);
      }
      const cutoffHours = Number(settings.booking_reschedule_cutoff_hours ?? 24);
      if (new Date(previousDate).getTime() - Date.now() <= cutoffHours * 3600000) {
        throw httpError('This booking is inside the configured rescheduling cutoff.', 409);
      }
      const availability = await checkBookingDateAvailability(tx, {
        vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate,
      });
      if (booking.status === 'accepted') {
        await reserveBookingDate(tx, { vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate, availability });
      }
      await tx.query(
        'UPDATE bookings SET scheduled_date = $1, moderation_reason = $2 WHERE id = $3',
        [scheduledDate, parsed.data.reason, booking.id],
      );
      if (booking.status === 'accepted'
        && new Date(previousDate).toISOString().slice(0, 10) !== localDate.toISOString().slice(0, 10)) {
        await releaseBookingDate(tx, {
          vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate: previousDate,
        });
      }
      await tx.query(
        `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, reason, details)
         VALUES ($1, $2, 'rescheduled', $3, $3, $4, $5::jsonb)`,
        [booking.id, req.platformUser.id, booking.status, parsed.data.reason,
          JSON.stringify({ from: previousDate, to: scheduledDate })],
      );
      await notify(tx, {
        userId: booking.vendor_user_id, title: 'Booking rescheduled',
        message: `The customer rescheduled ${booking.event_title} to ${scheduledDate}. ${parsed.data.reason}`,
        type: 'booking', relatedType: 'booking', relatedId: booking.id, actorId: req.platformUser.id,
        idempotencyKey: `booking:${booking.id}:rescheduled:${scheduledDate}:${booking.vendor_user_id}`,
      });
      await audit(tx, req, {
        actorId: req.platformUser.id, action: 'customer.booking_rescheduled', entityType: 'booking',
        entityId: booking.id, details: { from: previousDate, to: scheduledDate, reason: parsed.data.reason },
      });
      return { id: Number(booking.id), scheduled_date: scheduledDate, status: booking.status };
    });
    return res.json({ data: result });
  }));

  router.get('/quotations', requirePlatformUser, asyncHandler(async (req, res) => {
    const rows = rowsOf(await database.query(
      `SELECT q.*, vp.business_name AS vendor_name, e.title AS event_title
       FROM quotations q JOIN vendor_profiles vp ON vp.id = q.vendor_id
       LEFT JOIN events e ON e.id = q.event_id
       WHERE q.customer_id = $1 OR e.organizer_id = $1 ORDER BY q.created_at DESC`,
      [req.platformUser.id],
    ));
    return res.json({ success: true, data: rows.map(mapQuote) });
  }));

  router.patch('/quotations/:id/decision', requirePlatformUser, asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    const parsed = z.object({
      status: z.enum(['accepted', 'declined', 'revision_requested', 'cancelled']),
      reason: z.string().trim().max(500).optional().default(''),
    }).strict().safeParse(req.body || {});
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Quotation decision is invalid.' });
    }
    if (parsed.data.status === 'revision_requested' && parsed.data.reason.length < 5) {
      return res.status(400).json({ error: 'Describe the requested revision in at least five characters.' });
    }
    await database.inTransaction(async (tx) => {
      const quote = rowsOf(await tx.query(
        `SELECT q.id, q.status, q.event_id, q.vendor_id, q.customer_id,
                vp.user_id AS vendor_user_id, e.organizer_id
         FROM quotations q JOIN vendor_profiles vp ON vp.id = q.vendor_id
         LEFT JOIN events e ON e.id = q.event_id
         WHERE q.id = $1 AND q.customer_id = $2 FOR UPDATE OF q`,
        [id.data, req.platformUser.id],
      ))[0];
      if (!quote || (quote.event_id && Number(quote.organizer_id) !== Number(req.platformUser.id))) {
        throw httpError('Quotation not found.', 404);
      }
      if (parsed.data.status === 'cancelled'
        ? quote.status !== 'draft'
        : !['sent', 'revision_requested'].includes(quote.status)) {
        throw httpError('This quotation is no longer awaiting a decision.', 409);
      }
      await tx.query(
        `UPDATE quotations SET status = $1, updated_at = NOW(),
           notes = CASE
             WHEN NULLIF(notes, '') IS NULL THEN NULLIF($2, '')
             WHEN NULLIF($2, '') IS NULL THEN notes
             ELSE notes || E'\\n\\n' || $2
           END WHERE id = $3`,
        [parsed.data.status, parsed.data.reason ? `Customer: ${parsed.data.reason}` : '', id.data],
      );
      await notify(tx, {
        userId: quote.vendor_user_id, title: 'Quotation update',
        message: `The customer ${parsed.data.status.replaceAll('_', ' ')} quotation #${id.data}.${parsed.data.reason ? ` ${parsed.data.reason}` : ''}`,
        type: 'booking', relatedType: 'quotation', relatedId: id.data, actorId: req.platformUser.id,
        idempotencyKey: `quotation-decision:${id.data}:${parsed.data.status}:${quote.vendor_user_id}`,
      });
      await audit(tx, req, {
        actorId: req.platformUser.id, action: `customer.quotation_${parsed.data.status}`,
        entityType: 'quotation', entityId: id.data, details: { eventId: quote.event_id === null ? null : Number(quote.event_id) },
      });
    });
    return res.json({ data: { id: id.data, status: parsed.data.status } });
  }));
  return router;
}

function createPostgresVendorRouter({ database }) {
  const router = Router();

  async function ownVendor(req) {
    return rowsOf(await database.query(
      'SELECT id, verification_status, operating_hours FROM vendor_profiles WHERE user_id = $1',
      [req.platformUser.id],
    ))[0] || null;
  }

  router.get('/availability', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const vendor = await ownVendor(req);
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    const [availability, bookings] = await Promise.all([
      database.query('SELECT available_date, status, note FROM vendor_availability WHERE vendor_id = $1 ORDER BY available_date', [vendor.id]),
      database.query(
        `SELECT b.id, COALESCE(b.scheduled_date::date, e.start_date::date) AS available_date,
                e.title AS event_title, b.service_description
         FROM bookings b JOIN events e ON e.id = b.event_id
         WHERE b.vendor_id = $1 AND b.status = ANY($2::varchar[])
         ORDER BY available_date`,
        [vendor.id, reservedBookingStatuses],
      ),
    ]);
    const schedule = new Map(availability.rows.map((row) => [String(row.available_date).slice(0, 10), {
      date: String(row.available_date).slice(0, 10), status: row.status, note: row.note || '',
    }]));
    for (const booking of bookings.rows) {
      const date = String(booking.available_date).slice(0, 10);
      schedule.set(date, {
        ...(schedule.get(date) || {}), date, status: 'booked', note: booking.event_title,
        bookingId: Number(booking.id), service: booking.service_description,
      });
    }
    return res.json({ success: true, data: {
      schedule: [...schedule.values()].sort((a, b) => a.date.localeCompare(b.date)),
      businessHours: vendor.operating_hours || {},
    } });
  }));

  const availabilitySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['available', 'blocked']),
    note: z.string().trim().max(255).optional().default(''),
  }).strict();
  async function availabilityConflict(tx, vendorId, date) {
    await lockBookingVendor(tx, vendorId);
    return rowsOf(await tx.query(
      `SELECT b.id FROM bookings b JOIN events e ON e.id = b.event_id
       WHERE b.vendor_id = $1 AND b.status = ANY($2::varchar[])
         AND COALESCE(b.scheduled_date::date, e.start_date::date) = $3::date LIMIT 1`,
      [vendorId, reservedBookingStatuses, date],
    )).length > 0;
  }

  router.post('/availability', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const parsed = availabilitySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request data.', details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) });
    if (!validDateOnly(parsed.data.date)
      || parsed.data.date < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'Past availability dates cannot be changed.' });
    }
    const vendor = await ownVendor(req);
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    if (vendor.verification_status !== 'verified') {
      return res.status(403).json({ error: `Vendor access is unavailable while the account is ${vendor.verification_status.replaceAll('_', ' ')}.` });
    }
    await database.inTransaction(async (tx) => {
      if (await availabilityConflict(tx, vendor.id, parsed.data.date)) {
        throw httpError('A confirmed booking already reserves this date.', 409);
      }
      await tx.query(
        `INSERT INTO vendor_availability (vendor_id, available_date, status, note)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (vendor_id, available_date)
         DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note`,
        [vendor.id, parsed.data.date, parsed.data.status, parsed.data.note || null],
      );
    });
    return res.status(201).json({ data: { date: parsed.data.date, status: parsed.data.status, note: parsed.data.note } });
  }));

  router.patch('/availability/:date', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const parsed = availabilitySchema.safeParse({ ...req.body, date: req.params.date });
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request data.' });
    if (!validDateOnly(parsed.data.date)
      || parsed.data.date < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'Past availability dates cannot be changed.' });
    }
    const vendor = await ownVendor(req);
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    if (vendor.verification_status !== 'verified') {
      return res.status(403).json({ error: `Vendor access is unavailable while the account is ${vendor.verification_status.replaceAll('_', ' ')}.` });
    }
    const updated = await database.inTransaction(async (tx) => {
      if (await availabilityConflict(tx, vendor.id, parsed.data.date)) {
        throw httpError('A confirmed booking already reserves this date.', 409);
      }
      return rowsOf(await tx.query(
        `UPDATE vendor_availability SET status = $1, note = $2
         WHERE vendor_id = $3 AND available_date = $4::date RETURNING available_date`,
        [parsed.data.status, parsed.data.note || null, vendor.id, parsed.data.date],
      )).length > 0;
    });
    if (!updated) return res.status(404).json({ error: 'Availability record not found.' });
    return res.json({ data: { date: parsed.data.date, status: parsed.data.status, note: parsed.data.note } });
  }));

  router.delete('/availability/:date', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(req.params.date);
    if (!date.success || !validDateOnly(date.data)) return res.status(400).json({ error: 'A valid availability date is required.' });
    const vendor = await ownVendor(req);
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    if (vendor.verification_status !== 'verified') {
      return res.status(403).json({ error: `Vendor access is unavailable while the account is ${vendor.verification_status.replaceAll('_', ' ')}.` });
    }
    const deleted = await database.inTransaction(async (tx) => {
      if (await availabilityConflict(tx, vendor.id, date.data)) {
        throw httpError('A confirmed booking already reserves this date.', 409);
      }
      return rowsOf(await tx.query(
        'DELETE FROM vendor_availability WHERE vendor_id = $1 AND available_date = $2::date RETURNING id',
        [vendor.id, date.data],
      )).length > 0;
    });
    if (!deleted) return res.status(404).json({ error: 'Availability record not found.' });
    return res.status(204).end();
  }));

  router.get('/quotations', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const vendor = await ownVendor(req);
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    const rows = rowsOf(await database.query(
      `SELECT q.*, u.full_name AS customer_name, e.title AS event_title
       FROM quotations q LEFT JOIN users u ON u.id = q.customer_id
       LEFT JOIN events e ON e.id = q.event_id
       WHERE q.vendor_id = $1 ORDER BY q.created_at DESC`,
      [vendor.id],
    ));
    return res.json({ success: true, data: rows.map((row) => ({
      ...mapQuote(row),
      status: vendorStatusLabel(row.status),
      customer: row.customer_name || 'Customer pending',
    })) });
  }));

  router.get('/bookings', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const vendor = await ownVendor(req);
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    const rows = rowsOf(await database.query(
      `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
              e.title AS event_title, e.city, e.venue, e.guest_count, e.notes AS event_notes,
              TO_CHAR(e.start_date, 'YYYY-MM-DD') AS event_start_date,
              u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
              (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status
       FROM bookings b JOIN events e ON e.id = b.event_id JOIN users u ON u.id = e.organizer_id
       WHERE b.vendor_id = $1 AND b.status IN ('accepted', 'completed')
       ORDER BY e.start_date DESC`,
      [vendor.id],
    ));
    return res.json({ success: true, data: rows.map((row) => ({
      id: Number(row.id), customer: row.customer_name, customerEmail: row.customer_email,
      customerPhone: row.customer_phone, event: row.event_title,
      service: row.service_description,
      eventLocation: [row.venue, row.city].filter(Boolean).join(', '),
      date: row.event_start_date, status: row.status, amount: Number(row.quoted_amount || 0),
      status: vendorStatusLabel(row.status),
      currency: String(row.currency || 'ETB').trim(), paymentStatus: row.payment_status || 'unpaid',
    })) });
  }));

  router.get('/booking-requests', requirePlatformUser, asyncHandler(async (req, res) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    const vendor = await ownVendor(req);
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    const rows = rowsOf(await database.query(
      `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
              e.title AS event_title, e.city, e.notes AS event_notes, e.guest_count, e.venue,
              TO_CHAR(e.start_date, 'YYYY-MM-DD') AS event_start_date,
              u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
              (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status
       FROM bookings b JOIN events e ON e.id = b.event_id JOIN users u ON u.id = e.organizer_id
       WHERE b.vendor_id = $1 AND b.status IN ('requested', 'under_review', 'quoted')
       ORDER BY b.created_at DESC`,
      [vendor.id],
    ));
    return res.json({ success: true, data: rows.map((row) => ({
      id: Number(row.id), customer: row.customer_name, customerEmail: row.customer_email,
      customerPhone: row.customer_phone, event: row.event_title, date: row.event_start_date,
      eventLocation: [row.venue, row.city].filter(Boolean).join(', '), guestCount: row.guest_count === null ? null : Number(row.guest_count),
      requirements: row.event_notes || '', service: row.service_description,
      status: ({ requested: 'Pending', under_review: 'Under Review', quoted: 'Quoted' })[row.status] || row.status,
      amount: Number(row.quoted_amount || 0), currency: String(row.currency || 'ETB').trim(),
      paymentStatus: row.payment_status || 'unpaid',
    })) });
  }));
  return router;
}

export function createPostgresBookingRouters({ database }) {
  return {
    platform: createPostgresPlatformRouter({ database }),
    customer: createPostgresCustomerRouter({ database }),
    vendor: createPostgresVendorRouter({ database }),
  };
}
