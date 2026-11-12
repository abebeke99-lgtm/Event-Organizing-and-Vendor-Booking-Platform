import { Router } from 'express';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  ADMIN_EVENT_STATUSES,
  adminEventListSchema,
  hasScheduleOverlap,
  parseAdminEventInput,
  resolveEventStatus,
  toEventLocalDateTime,
} from '../lib/adminEvents.js';

const eventIdSchema = z.coerce.number().int().positive();
const statusActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }).strict(),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(5).max(1000) }).strict(),
  z.object({ action: z.literal('publish') }).strict(),
  z.object({ action: z.literal('unpublish'), reason: z.string().trim().min(5).max(1000).optional() }).strict(),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(5).max(1000) }).strict(),
  z.object({ action: z.literal('complete') }).strict(),
]);

function sendValidationError(res, error) {
  return res.status(400).json({
    error: 'Invalid request data.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

function statusError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function writeAudit(executor, { actorId, action, entityId, details, ip }) {
  await executor.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, 'event', $3, $4::jsonb, $5)`,
    [actorId, action, String(entityId), JSON.stringify(details), ip || null],
  );
}

function eventOutput(event) {
  return {
    ...event,
    status: resolveEventStatus(event.status),
    start_date: toEventLocalDateTime(event.start_date),
    end_date: toEventLocalDateTime(event.end_date),
  };
}

export function createPostgresAdminEventsRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/events/options', requirePermission('events.view'), async (_req, res, next) => {
    try {
      const [organizers, categories] = await Promise.all([
        database.query(
          `SELECT DISTINCT u.id, u.full_name, u.email
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE u.status = 'active' AND r.is_active = TRUE
             AND LOWER(r.name) IN ('organizer', 'customer')
           ORDER BY u.full_name, u.id`,
        ),
        database.query(
          'SELECT id, name FROM service_categories WHERE is_active = TRUE ORDER BY name',
        ),
      ]);
      return res.json({ data: { organizers: organizers.rows, categories: categories.rows } });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/events', requirePermission('events.view'), async (req, res, next) => {
    const parsed = adminEventListSchema.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { page, pageSize, q, status } = parsed.data;
    const conditions = [];
    const values = [];
    const bind = (value) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (q) {
      const term = bind(`%${q}%`);
      const eventId = bind(q);
      conditions.push(`(
        e.title ILIKE ${term} OR e.id::text = ${eventId} OR e.event_type ILIKE ${term}
        OR COALESCE(e.city, '') ILIKE ${term} OR COALESCE(e.venue, '') ILIKE ${term}
        OR u.full_name ILIKE ${term} OR COALESCE(u.email, '') ILIKE ${term}
        OR EXISTS (
          SELECT 1 FROM event_ticket_bookings etb
          JOIN users customer ON customer.id = etb.customer_id
          WHERE etb.event_id = e.id
            AND (customer.full_name ILIKE ${term} OR customer.email ILIKE ${term})
        )
        OR EXISTS (
          SELECT 1 FROM bookings b
          JOIN vendor_profiles vp ON vp.id = b.vendor_id
          LEFT JOIN service_categories category ON category.id = vp.category_id
          WHERE b.event_id = e.id
            AND (vp.business_name ILIKE ${term} OR COALESCE(category.name, '') ILIKE ${term})
        )
        OR EXISTS (
          SELECT 1 FROM service_categories category
          WHERE LOWER(category.name) = LOWER(e.event_type) AND category.name ILIKE ${term}
        )
      )`);
    }

    if (status) {
      if (status === 'published') {
        conditions.push("e.status IN ('active', 'published', 'upcoming', 'open')");
      } else {
        conditions.push(`e.status = ${bind(resolveEventStatus(status))}`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    try {
      const count = await database.query(
        `SELECT COUNT(*) AS total FROM events e JOIN users u ON u.id = e.organizer_id ${where}`,
        values,
      );
      const pageValues = [...values, pageSize, (page - 1) * pageSize];
      const rows = await database.query(
        `SELECT e.id, e.organizer_id, e.title, e.event_type, e.description, e.city, e.venue,
                e.cover_image_url, e.gallery_images, e.start_date, e.end_date, e.budget,
                e.guest_count, e.capacity, e.status, e.rejection_reason, e.published_at,
                e.is_featured, e.notes, e.created_at, u.full_name AS organizer_name,
                u.email AS organizer_email,
                COALESCE((SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id), 0)
                  + COALESCE((SELECT COUNT(*) FROM event_ticket_bookings etb WHERE etb.event_id = e.id), 0)
                  AS booking_count,
                COALESCE((SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id), 0)
                  AS vendor_booking_count,
                COALESCE((SELECT COUNT(*) FROM event_ticket_bookings etb WHERE etb.event_id = e.id), 0)
                  AS ticket_booking_count,
                (SELECT STRING_AGG(DISTINCT vp.business_name, ', ' ORDER BY vp.business_name)
                 FROM bookings b JOIN vendor_profiles vp ON vp.id = b.vendor_id
                 WHERE b.event_id = e.id) AS vendor_names
         FROM events e JOIN users u ON u.id = e.organizer_id ${where}
         ORDER BY e.start_date DESC, e.id DESC
         LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues,
      );
      return res.json({
        data: rows.rows.map(eventOutput),
        pagination: { page, pageSize, total: Number(count.rows[0].total) },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/events', requirePermission('events.create'), async (req, res, next) => {
    const parsed = parseAdminEventInput(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const event = parsed.data;

    try {
      const eventId = await database.inTransaction(async (client) => {
        const organizerResult = await client.query(
          `SELECT u.id FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE u.id = $1 AND u.status = 'active' AND r.is_active = TRUE
             AND LOWER(r.name) IN ('organizer', 'customer')
           LIMIT 1 FOR UPDATE OF u`,
          [event.organizer_id],
        );
        const organizer = organizerResult.rows[0];
        if (!organizer) throw statusError('Choose an active organizer or customer account.', 400);
        const overlap = await hasScheduleOverlap(client, {
          organizerId: organizer.id,
          startDate: event.start_date,
          endDate: event.end_date,
        });
        if (overlap) {
          throw statusError(`This organizer already has an event scheduled during that time: ${overlap.title}.`, 409);
        }

        const fields = [
          'organizer_id', 'title', 'event_type', 'description', 'city', 'venue',
          'cover_image_url', 'gallery_images', 'start_date', 'end_date', 'budget',
          'capacity', 'guest_count', 'notes',
        ];
        const placeholders = fields.map((field, index) => (
          field === 'gallery_images' ? `$${index + 1}::jsonb` : `$${index + 1}`
        ));
        const created = await client.query(
          `INSERT INTO events (${fields.join(', ')}, status)
           VALUES (${placeholders.join(', ')}, 'draft') RETURNING id`,
          fields.map((field) => event[field] ?? null),
        );
        const createdId = created.rows[0].id;
        const details = { title: event.title };
        await client.query(
          `INSERT INTO event_history
             (event_id, actor_id, action, from_status, to_status, details)
           VALUES ($1, $2, 'event.created', NULL, 'draft', $3::jsonb)`,
          [createdId, req.admin.id, JSON.stringify(details)],
        );
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'event.created',
          entityId: createdId,
          details: { ...details, status: 'draft' },
          ip: req.ip,
        });
        return createdId;
      });
      return res.status(201).json({ data: { id: eventId, status: 'draft' } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') return res.status(409).json({ error: 'A record with the same unique value already exists.' });
      return next(error);
    }
  });

  router.get('/events/:id', requirePermission('events.view'), async (req, res, next) => {
    const id = eventIdSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Event ID is invalid.' });
    try {
      const eventResult = await database.query(
        `SELECT e.*, u.full_name AS organizer_name, u.email AS organizer_email
         FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = $1`,
        [id.data],
      );
      const event = eventResult.rows[0];
      if (!event) return res.status(404).json({ error: 'Event not found.' });
      const [vendorBookings, ticketBookings, eventHistory, auditHistory] = await Promise.all([
        database.query(
          `SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount,
                  b.currency, b.status, b.moderation_reason, b.created_at,
                  vp.business_name AS vendor_name, vendor.full_name AS vendor_contact,
                  category.name AS category
           FROM bookings b
           JOIN vendor_profiles vp ON vp.id = b.vendor_id
           JOIN users vendor ON vendor.id = vp.user_id
           LEFT JOIN service_categories category ON category.id = vp.category_id
           WHERE b.event_id = $1 ORDER BY b.created_at DESC, b.id DESC`,
          [id.data],
        ),
        database.query(
          `SELECT etb.id, etb.booking_reference, etb.customer_id,
                  customer.full_name AS customer_name, customer.email AS customer_email,
                  tt.name AS ticket_name, etb.quantity, etb.unit_price, etb.total_amount,
                  etb.payment_status, etb.booking_status, etb.created_at
           FROM event_ticket_bookings etb
           JOIN users customer ON customer.id = etb.customer_id
           JOIN event_ticket_types tt ON tt.id = etb.ticket_type_id
           WHERE etb.event_id = $1 ORDER BY etb.created_at DESC, etb.id DESC`,
          [id.data],
        ),
        database.query(
          `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.from_status,
                  h.to_status, h.reason, h.details, h.created_at
           FROM event_history h LEFT JOIN users u ON u.id = h.actor_id
           WHERE h.event_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
          [id.data],
        ),
        database.query(
          `SELECT a.id, a.actor_id, u.full_name AS actor_name, a.action, a.details, a.created_at
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
           WHERE a.entity_type = 'event' AND a.entity_id = $1
           ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
          [String(id.data)],
        ),
      ]);
      const history = eventHistory.rows.map((row) => ({ ...row, source: 'event_history' }));
      const auditedActions = new Set(history.map((row) => `${row.actor_id}:${row.action}`));
      for (const row of auditHistory.rows) {
        if (!auditedActions.has(`${row.actor_id}:${row.action}`)) {
          history.push({ ...row, source: 'audit_logs', from_status: null, to_status: null, reason: null });
        }
      }
      history.sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
      return res.json({
        data: {
          event: eventOutput(event),
          vendorBookings: vendorBookings.rows,
          ticketBookings: ticketBookings.rows,
          history,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/events/:id', requirePermission('events.edit'), async (req, res, next) => {
    const id = eventIdSchema.safeParse(req.params.id);
    const parsed = parseAdminEventInput(req.body, { partial: true });
    if (!id.success) return res.status(400).json({ error: 'Event ID is invalid.' });
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const changes = parsed.data;
    const fields = Object.keys(changes);
    if (!fields.length) return res.status(400).json({ error: 'Provide at least one editable event field.' });

    try {
      await database.inTransaction(async (client) => {
        const eventResult = await client.query(
          `SELECT id, organizer_id, title, status, start_date, end_date, capacity, is_featured
           FROM events WHERE id = $1 FOR UPDATE`,
          [id.data],
        );
        const event = eventResult.rows[0];
        if (!event) throw statusError('Event not found.', 404);
        const nextStart = changes.start_date ?? event.start_date;
        const nextEnd = changes.end_date === undefined ? event.end_date : changes.end_date;
        if (nextEnd && Date.parse(nextEnd) <= Date.parse(nextStart)) {
          throw statusError('Event end date must be after its start date.', 400);
        }
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [event.organizer_id]);
        const overlap = await hasScheduleOverlap(client, {
          organizerId: event.organizer_id,
          startDate: nextStart,
          endDate: nextEnd,
          excludingEventId: id.data,
        });
        if (overlap) {
          throw statusError(`This organizer already has an event scheduled during that time: ${overlap.title}.`, 409);
        }
        if (changes.capacity !== undefined && changes.capacity !== null) {
          const inventory = await client.query(
            `SELECT COALESCE(SUM(tt.sold_quantity), 0) AS sold,
                    COALESCE(SUM(reserved.quantity), 0) AS reserved
             FROM event_ticket_types tt
             LEFT JOIN (
               SELECT ticket_type_id, SUM(quantity) AS quantity
               FROM event_ticket_bookings
               WHERE booking_status = 'pending_payment'
                 AND created_at >= NOW() - INTERVAL '15 minutes'
               GROUP BY ticket_type_id
             ) reserved ON reserved.ticket_type_id = tt.id
             WHERE tt.event_id = $1 AND tt.status = 'active'`,
            [id.data],
          );
          const row = inventory.rows[0];
          if (Number(row.sold) + Number(row.reserved) > changes.capacity) {
            throw statusError('Capacity cannot be lower than tickets sold or reserved.', 409);
          }
        }

        const values = [];
        const updates = fields.map((field) => {
          values.push(changes[field]);
          const placeholder = `$${values.length}`;
          return field === 'gallery_images'
            ? `${field} = ${placeholder}::jsonb`
            : `${field} = ${placeholder}`;
        });
        values.push(id.data);
        await client.query(
          `UPDATE events SET ${updates.join(', ')} WHERE id = $${values.length}`,
          values,
        );
        const auditableFields = fields.filter((field) => (
          !['description', 'notes', 'gallery_images', 'cover_image_url'].includes(field)
        ));
        const details = {
          fields,
          before: Object.fromEntries(auditableFields.map((field) => [field, event[field] ?? null])),
          after: Object.fromEntries(auditableFields.map((field) => [field, changes[field] ?? null])),
        };
        await client.query(
          `INSERT INTO event_history
             (event_id, actor_id, action, from_status, to_status, details)
           VALUES ($1, $2, 'event.updated', $3, $3, $4::jsonb)`,
          [id.data, req.admin.id, event.status, JSON.stringify(details)],
        );
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'event.updated',
          entityId: id.data,
          details,
          ip: req.ip,
        });
      });
      return res.json({ data: { id: id.data } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.patch('/events/:id/status', requirePermission('events.edit'), async (req, res, next) => {
    const id = eventIdSchema.safeParse(req.params.id);
    const parsed = statusActionSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'Event ID is invalid.' : parsed.error.issues[0]?.message || 'Invalid event action.',
      });
    }

    const { action, reason } = parsed.data;
    try {
      const result = await database.inTransaction(async (client) => {
        const eventResult = await client.query(
          `SELECT id, organizer_id, title, status, start_date, end_date
           FROM events WHERE id = $1 FOR UPDATE`,
          [id.data],
        );
        const event = eventResult.rows[0];
        if (!event) throw statusError('Event not found.', 404);

        const currentStatus = resolveEventStatus(event.status);
        let nextStatus;
        let notificationTitle;
        let notificationMessage;
        if (action === 'approve') {
          if (currentStatus !== 'pending_approval') {
            throw statusError('Only events pending approval can be approved.', 409);
          }
          nextStatus = 'active';
          notificationTitle = 'Your event was approved';
          notificationMessage = `Your event "${event.title}" has been approved and published.`;
        } else if (action === 'reject') {
          if (currentStatus !== 'pending_approval') {
            throw statusError('Only events pending approval can be rejected.', 409);
          }
          nextStatus = 'rejected';
          notificationTitle = 'Your event needs changes';
          notificationMessage = `Your event "${event.title}" was rejected. Reason: ${reason}`;
        } else if (action === 'publish') {
          if (!['draft', 'rejected'].includes(currentStatus)) {
            throw statusError('Only draft or rejected events can be published.', 409);
          }
          nextStatus = 'active';
          notificationTitle = 'Your event was published';
          notificationMessage = `Your event "${event.title}" is now published.`;
        } else if (action === 'unpublish') {
          if (!['active', 'published', 'booked', 'upcoming', 'open'].includes(currentStatus)) {
            throw statusError('Only published events can be unpublished.', 409);
          }
          nextStatus = 'draft';
          notificationTitle = 'Your event was unpublished';
          notificationMessage = `Your event "${event.title}" is no longer available for new bookings.${reason ? ` Reason: ${reason}` : ''}`;
        } else if (action === 'cancel') {
          if (['cancelled', 'completed'].includes(currentStatus)) {
            throw statusError('This event cannot be cancelled.', 409);
          }
          nextStatus = 'cancelled';
          notificationTitle = 'Your event was cancelled';
          notificationMessage = `Your event "${event.title}" was cancelled. Reason: ${reason}`;
        } else {
          if (['cancelled', 'completed'].includes(currentStatus)) {
            throw statusError('This event cannot be completed.', 409);
          }
          const endDate = event.end_date || event.start_date;
          if (new Date(endDate).getTime() > Date.now()) {
            throw statusError('An event cannot be marked completed before its scheduled end.', 409);
          }
          nextStatus = 'completed';
          notificationTitle = 'Your event was completed';
          notificationMessage = `Your event "${event.title}" has been marked completed.`;
        }

        await client.query(
          `UPDATE events
           SET status = $1::varchar,
               published_at = CASE WHEN $1::varchar = 'active' THEN COALESCE(published_at, NOW()) ELSE published_at END,
               rejection_reason = CASE WHEN $1::varchar = 'rejected' THEN $2 ELSE NULL END
           WHERE id = $3`,
          [nextStatus, reason || null, id.data],
        );
        await client.query(
          `INSERT INTO event_history
             (event_id, actor_id, action, from_status, to_status, reason, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [id.data, req.admin.id, `event.${action}`, currentStatus, nextStatus, reason || null, JSON.stringify({})],
        );
        await writeAudit(client, {
          actorId: req.admin.id,
          action: `event.${action}`,
          entityId: id.data,
          details: { from: currentStatus, to: nextStatus, reason: reason || null },
          ip: req.ip,
        });

        const recipients = new Set([Number(event.organizer_id)]);
        if (['unpublish', 'cancel'].includes(action)) {
          const relatedUsers = await client.query(
            `SELECT etb.customer_id AS user_id
             FROM event_ticket_bookings etb WHERE etb.event_id = $1
             UNION
             SELECT vp.user_id AS user_id
             FROM bookings b
             JOIN vendor_profiles vp ON vp.id = b.vendor_id
             WHERE b.event_id = $1`,
            [id.data],
          );
          for (const recipient of relatedUsers.rows) {
            if (recipient.user_id !== null && recipient.user_id !== undefined) {
              recipients.add(Number(recipient.user_id));
            }
          }
        }

        for (const recipientId of recipients) {
          const notification = await client.query(
            `INSERT INTO notifications
               (user_id, title, message, notification_type, related_entity_type, related_entity_id,
                delivery_channel, delivery_status)
             VALUES ($1, $2, $3, 'event', 'event', $4, 'in_app', 'delivered')
             RETURNING id`,
            [recipientId, notificationTitle, notificationMessage, String(id.data)],
          );
          await client.query(
            `INSERT INTO notification_history (notification_id, actor_id, action, details)
             VALUES ($1, $2, 'created', $3::jsonb)`,
            [notification.rows[0].id, req.admin.id, JSON.stringify({ source: 'event', channel: 'in_app' })],
          );
        }

        return { id: id.data, status: nextStatus };
      });
      return res.json({ data: result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}

export { ADMIN_EVENT_STATUSES };
