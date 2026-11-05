import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { requirePermission } from '../middleware/rbac.js';
import { loadPublicMarketplace, mapBookingRecord } from '../lib/marketplace.js';
import { listPublicServices } from '../lib/serviceCatalog.js';
import { listPublicVendors } from '../lib/vendorCatalog.js';
import { createRefundRequest, isSafeFinancialNote } from '../lib/paymentManagement.js';
import { hashToken, writeAudit } from '../lib/security.js';
import { createNotification, notifyAdministrators } from '../lib/notificationService.js';
import { isStrongPassword } from '../lib/authFlow.js';
import { checkBookingDateAvailability, lockBookingVendor, releaseBookingDate, reserveBookingDate } from '../lib/bookingAvailability.js';
import { loadSystemSettings } from '../lib/systemSettings.js';
import {
  complaintAttachmentParser,
  sanitizeComplaintAttachmentName,
  validateComplaintAttachment,
} from '../lib/complaintAttachments.js';

const router = Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

const databaseFor = (req) => req.app?.locals?.database || pool;
const getRoute = (path, handler) => router.get(path, asyncHandler(handler));
const postRoute = (path, handler) => router.post(path, asyncHandler(handler));
const patchRoute = (path, handler) => router.patch(path, asyncHandler(handler));
const deleteRoute = (path, handler) => router.delete(path, asyncHandler(handler));
const getPermissionRoute = (path, permission, handler) => router.get(path, requirePermission(permission), asyncHandler(handler));
const postPermissionRoute = (path, permission, handler) => router.post(path, requirePermission(permission), asyncHandler(handler));
const deletePermissionRoute = (path, permission, handler) => router.delete(path, requirePermission(permission), asyncHandler(handler));
async function transaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
const catalogQueryFields = {
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  verified: z.enum(['true', 'false', '1', '0']).optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  minRating: z.coerce.number().finite().min(0).max(5).optional(),
   sort: z.enum(['recommended', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'name-az']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
};

function catalogQuerySchema(sorts, extraFields = {}) {
  return z.object({
    ...catalogQueryFields,
    ...extraFields,
    sort: z.enum(sorts).optional(),
  }).strict().superRefine((query, context) => {
  if (query.minPrice !== undefined && query.maxPrice !== undefined && query.maxPrice < query.minPrice) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price.' });
  }
  });
}
const vendorCatalogQuerySchema = catalogQuerySchema(['recommended', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'name-az']);
const serviceCatalogQuerySchema = catalogQuerySchema(
  ['recommended', 'relevance', 'highest-rated', 'price-low', 'price-high', 'alphabetical'],
  { availableOnly: z.enum(['true', 'false', '1', '0']).optional() },
);
const favoriteSchema = z.object({ vendorId: z.coerce.number().int().positive() }).strict();

function parseCatalogQuery(req, res, schema) {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid catalog filters.',
      details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
    return null;
  }
  return parsed.data;
}

router.use(requirePlatformUser);
router.use((req, res, next) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Customer access is required.' });
  }
  next();
});

const customerBookingSelect = `
  SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount,
         COALESCE(NULLIF(TRIM(b.currency), ''), 'ETB') AS currency,
         b.service_id, b.scheduled_date, b.status, b.moderation_reason, b.created_at,
         e.title AS event_title, e.event_type, e.description AS event_description,
         e.start_date AS event_start_date, e.city AS event_city, e.venue AS event_venue,
         e.budget AS event_budget, e.guest_count AS event_guest_count, e.notes AS event_notes,
         u.full_name AS customer_name, vp.business_name AS vendor_name, s.title AS service_title,
         (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS payment_status,
         (b.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)) AS can_review,
         EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS has_review,
         (b.status IN ('requested', 'under_review', 'quoted', 'accepted')
           AND COALESCE(b.scheduled_date, e.start_date) > DATE_ADD(NOW(), INTERVAL CAST(COALESCE(
             (SELECT setting_value FROM system_settings WHERE setting_key = 'booking_cancellation_cutoff_hours'), '24'
           ) AS UNSIGNED) HOUR)) AS can_cancel,
         (b.status IN ('requested', 'quoted', 'accepted')
           AND COALESCE((SELECT setting_value FROM system_settings WHERE setting_key = 'booking_rescheduling_enabled'), 'true') IN ('true', '1')
           AND COALESCE(b.scheduled_date, e.start_date) > DATE_ADD(NOW(), INTERVAL CAST(COALESCE(
             (SELECT setting_value FROM system_settings WHERE setting_key = 'booking_reschedule_cutoff_hours'), '24'
           ) AS UNSIGNED) HOUR)) AS can_reschedule
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  JOIN users u ON u.id = e.organizer_id
  JOIN vendor_profiles vp ON vp.id = b.vendor_id
  LEFT JOIN services s ON s.id = b.service_id
  WHERE e.organizer_id = ?`;

function mapCustomerBookingRecord(row) {
  const booking = mapBookingRecord(row);
  return {
    ...booking,
    serviceTitle: String(row.service_title || row.service_description || '').trim(),
    serviceDescription: row.service_description || '',
    serviceId: row.service_id == null ? null : Number(row.service_id),
    scheduledDate: row.scheduled_date || row.event_start_date || null,
    eventCity: row.event_city || null,
    eventVenue: row.event_venue || null,
    eventType: row.event_type || null,
    eventDescription: row.event_description || null,
    eventBudget: row.event_budget == null ? null : Number(row.event_budget),
    eventGuestCount: row.event_guest_count == null ? null : Number(row.event_guest_count),
    eventNotes: row.event_notes || null,
    location: [row.event_venue, row.event_city].filter(Boolean).join(', ') || null,
    paymentStatus: row.payment_status || 'unpaid',
    canReview: row.can_review === true || Number(row.can_review) === 1,
    hasReview: row.has_review === true || Number(row.has_review) === 1,
    canCancel: row.can_cancel === true || Number(row.can_cancel) === 1,
    canReschedule: row.can_reschedule === true || Number(row.can_reschedule) === 1,
  };
}

getRoute('/overview', async (req, res) => {
  const database = databaseFor(req);
  const userId = req.platformUser.id;
  const [bookingRows, eventRows, quotationRows, paymentRows, messageRows, notificationRows] = await Promise.all([
    database.execute('SELECT b.status FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = ?', [userId]),
    database.execute("SELECT id FROM events WHERE organizer_id = ? AND start_date >= NOW() AND status <> 'cancelled'", [userId]),
    database.execute(
      `SELECT q.status FROM quotations q
       LEFT JOIN events e ON e.id = q.event_id
       WHERE q.customer_id = ? OR e.organizer_id = ?`,
      [userId, userId]
    ),
    database.execute(
      `SELECT p.status, p.amount FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN events e ON e.id = b.event_id
       WHERE e.organizer_id = ?`,
      [userId]
    ),
    database.execute('SELECT id FROM messages WHERE recipient_id = ? AND read_at IS NULL', [userId]),
    database.execute("SELECT id FROM notifications WHERE user_id = ? AND status <> 'read'", [userId]),
  ]);

  const bookings = bookingRows[0];
  const payments = paymentRows[0];
  return ok(res, {
    totalBookings: bookings.length,
    pendingBookings: bookings.filter((booking) => ['requested', 'under_review', 'quoted'].includes(booking.status)).length,
    confirmedBookings: bookings.filter((booking) => ['accepted', 'confirmed', 'in_progress'].includes(booking.status)).length,
    completedBookings: bookings.filter((booking) => booking.status === 'completed').length,
    upcomingEvents: eventRows[0].length,
    pendingQuotations: quotationRows[0].filter((quote) => ['draft', 'sent', 'revision_requested'].includes(quote.status)).length,
    unreadMessages: messageRows[0].length,
    unreadNotifications: notificationRows[0].length,
    outstandingPayments: payments
      .filter((payment) => ['pending', 'authorized'].includes(payment.status))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
  });
});

getRoute('/vendors', async (req, res) => {
  const filters = parseCatalogQuery(req, res, vendorCatalogQuerySchema);
  if (!filters) return;
  const marketplace = await loadPublicMarketplace(databaseFor(req));
  const result = listPublicVendors(marketplace.vendors, filters);
  return res.json({
    success: true,
    data: result.vendors,
    pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages },
  });
});

getRoute('/services', async (req, res) => {
  const filters = parseCatalogQuery(req, res, serviceCatalogQuerySchema);
  if (!filters) return;
  const marketplace = await loadPublicMarketplace(databaseFor(req));
  const result = listPublicServices(marketplace.services, filters);
  return res.json({
    success: true,
    data: result.services,
    pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages },
  });
});

getRoute('/categories', async (req, res) => {
  const marketplace = await loadPublicMarketplace(databaseFor(req));
  return ok(res, marketplace.categories.map((category) => ({
    ...category,
    active: category.isActive,
  })));
});

getRoute('/bookings', async (req, res) => {
  const [rows] = await databaseFor(req).execute(`${customerBookingSelect} ORDER BY b.created_at DESC`, [req.platformUser.id]);
  return ok(res, rows.map(mapCustomerBookingRecord));
});

getRoute('/bookings/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Booking ID is invalid.' });
  const [rows] = await databaseFor(req).execute(
    `${customerBookingSelect} AND b.id = ? LIMIT 1`,
    [req.platformUser.id, id.data],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Booking not found.' });
  return ok(res, mapCustomerBookingRecord(rows[0]));
});

patchRoute('/bookings/:id/reschedule', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({
    scheduledDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    reason: z.string().trim().min(5).max(500),
  }).strict().safeParse(req.body || {});
  if (!id.success || !parsed.success) {
    return res.status(400).json({ error: 'Provide a valid booking date and rescheduling reason.' });
  }
  const [year, month, day, hour, minute] = parsed.data.scheduledDate.split(/[-T:]/).map(Number);
  const localDate = new Date(year, month - 1, day, hour, minute);
  if (localDate.getFullYear() !== year || localDate.getMonth() !== month - 1 || localDate.getDate() !== day
    || localDate.getHours() !== hour || localDate.getMinutes() !== minute
    || localDate <= new Date()) {
    return res.status(400).json({ error: 'Enter a valid future booking date and time.' });
  }
  const scheduledDate = `${parsed.data.scheduledDate.replace('T', ' ')}:00`;
  const database = databaseFor(req);
  try {
    const result = await transaction(database, async (connection) => {
      const [[booking]] = await connection.execute(
        `SELECT b.id, b.status, b.vendor_id, b.scheduled_date, e.start_date, e.title AS event_title,
                e.organizer_id, vp.user_id AS vendor_user_id, vp.business_name AS vendor_name
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id
         WHERE b.id = ? AND e.organizer_id = ? LIMIT 1 FOR UPDATE`,
        [id.data, req.platformUser.id],
      );
      if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });

      await lockBookingVendor(connection, booking.vendor_id);
      const settings = await loadSystemSettings(connection, [
        'booking_rescheduling_enabled',
        'booking_reschedule_cutoff_hours',
      ]);
      if (!settings.booking_rescheduling_enabled) {
        throw Object.assign(new Error('Booking rescheduling is disabled by the current system policy.'), { status: 409 });
      }
      if (!['requested', 'quoted', 'accepted'].includes(booking.status)) {
        throw Object.assign(new Error('This booking cannot be rescheduled in its current status.'), { status: 409 });
      }
      const previousDate = booking.scheduled_date || booking.start_date;
      if (!previousDate) {
        throw Object.assign(new Error('A booking cannot be rescheduled after its scheduled date.'), { status: 409 });
      }
      const [dateRows] = await connection.execute(
        'SELECT ? <= NOW() AS booking_in_past, ? = ? AS same_datetime, DATE(?) = DATE(?) AS same_day',
        [previousDate, previousDate, scheduledDate, previousDate, scheduledDate],
      );
      if (dateRows[0]?.booking_in_past) {
        throw Object.assign(new Error('A booking cannot be rescheduled after its scheduled date.'), { status: 409 });
      }
      const [cutoffRows] = await connection.execute(
        'SELECT ? <= DATE_ADD(NOW(), INTERVAL ? HOUR) AS inside_cutoff',
        [previousDate, settings.booking_reschedule_cutoff_hours],
      );
      if (cutoffRows[0]?.inside_cutoff) {
        throw Object.assign(new Error('This booking is inside the configured rescheduling cutoff.'), { status: 409 });
      }
      if (dateRows[0]?.same_datetime) {
        throw Object.assign(new Error('Choose a different date to reschedule this booking.'), { status: 409 });
      }

      const availability = await checkBookingDateAvailability(connection, {
        vendorId: booking.vendor_id,
        bookingId: booking.id,
        scheduledDate,
      });
      if (booking.status === 'accepted') {
        await reserveBookingDate(connection, {
          vendorId: booking.vendor_id,
          bookingId: booking.id,
          scheduledDate,
          availability,
        });
      }
      await connection.execute(
        'UPDATE bookings SET scheduled_date = ?, moderation_reason = ? WHERE id = ?',
        [scheduledDate, parsed.data.reason, booking.id],
      );
      if (booking.status === 'accepted' && !dateRows[0]?.same_day) {
        await releaseBookingDate(connection, {
          vendorId: booking.vendor_id,
          bookingId: booking.id,
          scheduledDate: previousDate,
        });
      }
      await connection.execute(
        `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, reason, details)
         VALUES (?, ?, 'rescheduled', ?, ?, ?, ?)`,
        [booking.id, req.platformUser.id, booking.status, booking.status, parsed.data.reason, JSON.stringify({ from: previousDate, to: scheduledDate })],
      );
      await writeAudit(connection, {
        actorId: req.platformUser.id,
        action: 'customer.booking_rescheduled',
        entityType: 'booking',
        entityId: booking.id,
        details: { from: previousDate, to: scheduledDate, reason: parsed.data.reason },
        ip: req.ip,
      });
      await createNotification(connection, {
        userId: booking.vendor_user_id,
        title: 'Booking rescheduled',
        message: `The customer rescheduled ${booking.event_title} to ${scheduledDate}. ${parsed.data.reason}`,
        type: 'booking',
        relatedType: 'booking',
        relatedId: booking.id,
        actorId: req.platformUser.id,
      });
      return { id: Number(booking.id), scheduled_date: scheduledDate, status: booking.status };
    });
    return res.json({ data: result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

getRoute('/history', async (req, res) => {
  const historicalStatuses = ['completed', 'cancelled', 'rejected', 'accepted', 'quoted', 'under_review', 'requested'];
  const parsed = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(historicalStatuses).optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }).strict().superRefine((query, context) => {
    for (const key of ['dateFrom', 'dateTo']) {
      if (!query[key]) continue;
      const [year, month, day] = query[key].split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Enter a valid calendar date.' });
      }
    }
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'End date must be on or after the start date.' });
    }
  }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid booking history filters.',
      details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  const query = parsed.data;
  const filters = [
    `(b.status IN ('completed', 'cancelled', 'rejected')
      OR COALESCE(b.scheduled_date, e.start_date) < NOW())`,
  ];
  const values = [req.platformUser.id];
  if (query.status) {
    filters.push('b.status = ?');
    values.push(query.status);
  }
  if (query.dateFrom) {
    filters.push('e.start_date >= ?');
    values.push(query.dateFrom);
  }
  if (query.dateTo) {
    filters.push('e.start_date < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(query.dateTo);
  }
  if (query.search) {
    const search = `%${query.search}%`;
    filters.push(`(
      CONCAT('BK-', LPAD(b.id, 6, '0')) LIKE ?
      OR CAST(b.id AS CHAR) LIKE ?
      OR COALESCE(vp.business_name, '') LIKE ?
      OR COALESCE(s.title, b.service_description, '') LIKE ?
      OR COALESCE(e.title, '') LIKE ?
    )`);
    values.push(search, search, search, search, search);
  }
  const whereClause = `e.organizer_id = ? AND ${filters.join(' AND ')}`;
  const database = databaseFor(req);
  const joins = `
    FROM bookings b
    JOIN events e ON e.id = b.event_id
    JOIN vendor_profiles vp ON vp.id = b.vendor_id
    LEFT JOIN services s ON s.id = b.service_id`;
  const [countResult, rowsResult] = await Promise.all([
    database.execute(`SELECT COUNT(*) AS total ${joins} WHERE ${whereClause}`, values),
    database.execute(
      `${customerBookingSelect} AND ${filters.join(' AND ')}
       ORDER BY COALESCE(b.scheduled_date, e.start_date) DESC, b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...values, query.limit, (query.page - 1) * query.limit],
    ),
  ]);
  const rows = rowsResult[0];
  const total = Number(countResult[0][0]?.total || 0);
  return res.json({
    success: true,
    data: rows.map(mapCustomerBookingRecord),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

getRoute('/events', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
        `SELECT id, title, event_type, description, city, venue, cover_image_url, start_date,
          'ETB' AS currency,
          end_date, budget, guest_count, capacity, notes, status
     FROM events WHERE organizer_id = ? ORDER BY start_date DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    type: row.event_type,
    description: row.description || '',
    city: row.city || '',
    location: row.city || '',
    venue: row.venue || '',
    coverImage: row.cover_image_url || null,
    date: row.start_date,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: row.budget === null ? null : Number(row.budget),
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
    capacity: row.capacity === null ? null : Number(row.capacity),
    currency: row.currency || 'ETB',
    notes: row.notes || '',
    status: row.status,
  })));
});

getPermissionRoute('/favorites', 'favorites.manage_own', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT vp.id, vp.business_name, vp.city, vp.description, vp.verification_status,
            sc.name AS category
     FROM favorites f
     JOIN vendor_profiles vp ON vp.id = f.vendor_id
     LEFT JOIN service_categories sc ON sc.id = vp.category_id
     WHERE f.user_id = ?
     ORDER BY f.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    name: row.business_name,
    business_name: row.business_name,
    category: row.category || 'General',
    city: row.city || '',
    description: row.description || '',
    verified: row.verification_status === 'verified',
  })));
});

postPermissionRoute('/favorites', 'favorites.manage_own', async (req, res) => {
  const parsed = favoriteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'A valid vendor ID is required.' });

  const database = databaseFor(req);
  const [[vendor]] = await database.execute(
    "SELECT id FROM vendor_profiles WHERE id = ? AND verification_status = 'verified'",
    [parsed.data.vendorId]
  );
  if (!vendor) return res.status(404).json({ error: 'Verified vendor not found.' });

  try {
    const [result] = await database.execute(
      'INSERT INTO favorites (user_id, vendor_id) VALUES (?, ?)',
      [req.platformUser.id, vendor.id]
    );
    return res.status(201).json({ success: true, data: { id: Number(result.insertId), vendorId: Number(vendor.id) } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Vendor is already saved.' });
    throw error;
  }
});

deletePermissionRoute('/favorites/:vendorId', 'favorites.manage_own', async (req, res) => {
  const vendorId = z.coerce.number().int().positive().safeParse(req.params.vendorId);
  if (!vendorId.success) return res.status(400).json({ error: 'Vendor ID is invalid.' });
  const [result] = await databaseFor(req).execute(
    'DELETE FROM favorites WHERE user_id = ? AND vendor_id = ?',
    [req.platformUser.id, vendorId.data]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Saved vendor not found.' });
  return res.status(204).end();
});

getPermissionRoute('/saved-services', 'favorites.manage_own', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT s.id, s.title, s.description, s.price,
            COALESCE(NULLIF(TRIM(s.currency), ''), 'ETB') AS currency, vp.business_name,
            vp.city, sc.name AS category, s.status
     FROM customer_service_favorites f
     JOIN services s ON s.id = f.service_id
     JOIN vendor_profiles vp ON vp.id = s.vendor_id
     LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE f.user_id = ? AND s.status <> 'archived' AND vp.verification_status = 'verified'
     ORDER BY f.created_at DESC`,
    [req.platformUser.id],
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    description: row.description || '',
    price: Number(row.price || 0),
    currency: row.currency,
    vendorName: row.business_name,
    city: row.city || '',
    category: row.category || 'General',
    status: row.status,
  })));
});

postPermissionRoute('/saved-services', 'favorites.manage_own', async (req, res) => {
  const parsed = z.object({ serviceId: z.coerce.number().int().positive() }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'A valid service ID is required.' });
  const database = databaseFor(req);
  const [rows] = await database.execute(
    `SELECT s.id FROM services s JOIN vendor_profiles vp ON vp.id = s.vendor_id
     WHERE s.id = ? AND s.status = 'active' AND vp.verification_status = 'verified'`,
    [parsed.data.serviceId],
  );
  if (!rows.length) return res.status(404).json({ error: 'Published service not found.' });
  try {
    const [result] = await database.execute(
      'INSERT INTO customer_service_favorites (user_id, service_id) VALUES (?, ?)',
      [req.platformUser.id, parsed.data.serviceId],
    );
    return res.status(201).json({ data: { id: Number(result.insertId), serviceId: parsed.data.serviceId } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Service is already saved.' });
    throw error;
  }
});

deletePermissionRoute('/saved-services/:serviceId', 'favorites.manage_own', async (req, res) => {
  const serviceId = z.coerce.number().int().positive().safeParse(req.params.serviceId);
  if (!serviceId.success) return res.status(400).json({ error: 'Service ID is invalid.' });
  const [result] = await databaseFor(req).execute(
    'DELETE FROM customer_service_favorites WHERE user_id = ? AND service_id = ?',
    [req.platformUser.id, serviceId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Saved service not found.' });
  return res.status(204).end();
});

getRoute('/quotations', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT q.id, q.vendor_id, q.event_id, q.service_id, q.service_description, q.amount,
            COALESCE(NULLIF(TRIM(q.currency), ''), 'ETB') AS currency,
            q.status, q.valid_until, q.requested_event_name, q.requested_date, q.requested_location,
            q.guest_count, q.budget, q.requested_event_type, q.requested_phone,
            q.required_services, q.additional_requirements, q.request_message,
            q.notes, q.created_at, vp.business_name AS vendor_name,
            e.title AS event_title
     FROM quotations q
     JOIN vendor_profiles vp ON vp.id = q.vendor_id
     LEFT JOIN events e ON e.id = q.event_id
     WHERE q.customer_id = ? OR e.organizer_id = ?
     ORDER BY q.created_at DESC`,
    [req.platformUser.id, req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    vendorId: Number(row.vendor_id),
    vendorName: row.vendor_name,
    eventId: row.event_id ? Number(row.event_id) : null,
    serviceId: row.service_id === null ? null : Number(row.service_id),
    event: row.requested_event_name || row.event_title || null,
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
    currency: row.currency,
    validUntil: row.valid_until,
    notes: row.notes || '',
    createdAt: row.created_at,
  })));
});

patchRoute('/quotations/:id/decision', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({
    status: z.enum(['accepted', 'declined', 'revision_requested', 'cancelled']),
    reason: z.string().trim().max(500).optional().default(''),
  }).strict().safeParse(req.body || {});
  if (!id.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Quotation decision is invalid.' });
  if (parsed.data.status === 'revision_requested' && parsed.data.reason.length < 5) {
    return res.status(400).json({ error: 'Describe the requested revision in at least five characters.' });
  }
  const database = databaseFor(req);
  try {
    await transaction(database, async (connection) => {
      const [[quote]] = await connection.execute(
        `SELECT q.id, q.status, q.event_id, q.vendor_id, vp.user_id AS vendor_user_id, e.organizer_id
         FROM quotations q JOIN vendor_profiles vp ON vp.id = q.vendor_id
         LEFT JOIN events e ON e.id = q.event_id
         WHERE q.id = ? AND q.customer_id = ? LIMIT 1 FOR UPDATE`,
        [id.data, req.platformUser.id],
      );
      if (!quote || (quote.event_id && Number(quote.organizer_id) !== Number(req.platformUser.id))) {
        throw Object.assign(new Error('Quotation not found.'), { status: 404 });
      }
      if (parsed.data.status === 'cancelled' ? quote.status !== 'draft' : !['sent', 'revision_requested'].includes(quote.status)) {
        throw Object.assign(new Error('This quotation is no longer awaiting a decision.'), { status: 409 });
      }
      await connection.execute(
        'UPDATE quotations SET status = ?, updated_at = NOW(), notes = CONCAT_WS(\'\\n\\n\', NULLIF(notes, \'\'), NULLIF(?, \'\')) WHERE id = ?',
        [parsed.data.status, parsed.data.reason ? `Customer: ${parsed.data.reason}` : '', id.data],
      );
      await createNotification(connection, {
        userId: quote.vendor_user_id,
        title: 'Quotation update',
        message: `The customer ${parsed.data.status.replaceAll('_', ' ')} quotation #${id.data}.${parsed.data.reason ? ` ${parsed.data.reason}` : ''}`,
        type: 'booking',
        relatedType: 'quotation',
        relatedId: id.data,
        actorId: req.platformUser.id,
      });
      await writeAudit(connection, {
        actorId: req.platformUser.id,
        action: `customer.quotation_${parsed.data.status}`,
        entityType: 'quotation',
        entityId: id.data,
        details: { eventId: quote.event_id === null ? null : Number(quote.event_id) },
        ip: req.ip,
      });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  return res.json({ data: { id: id.data, status: parsed.data.status } });
});

getRoute('/payments', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT p.id, p.booking_id, p.amount,
            COALESCE(NULLIF(TRIM(p.currency), ''), 'ETB') AS currency,
            p.provider, p.provider_reference,
            p.status, p.created_at, b.service_description, e.title AS event_title
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN events e ON e.id = b.event_id
     WHERE e.organizer_id = ?
     ORDER BY p.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    reference: row.provider_reference || `PAY-${String(row.id).padStart(6, '0')}`,
    provider: row.provider || null,
    status: row.status,
    amount: Number(row.amount || 0),
    currency: row.currency,
    service: row.service_description,
    event: row.event_title,
    date: row.created_at,
  })));
});

getRoute('/refunds', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT rr.id, rr.payment_id, rr.amount,
            COALESCE(NULLIF(TRIM(rr.currency), ''), 'ETB') AS currency, rr.reason, rr.status,
            rr.decision_reason, rr.created_at, rr.decided_at, p.provider_reference
     FROM refund_requests rr
     JOIN payments p ON p.id = rr.payment_id
     JOIN bookings b ON b.id = p.booking_id
     JOIN events e ON e.id = b.event_id
     WHERE e.organizer_id = ? ORDER BY rr.created_at DESC`,
    [req.platformUser.id],
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    paymentId: Number(row.payment_id),
    reference: row.provider_reference || null,
    amount: Number(row.amount),
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    decisionReason: row.decision_reason || null,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  })));
});

getRoute('/refunds', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT rr.id, rr.payment_id, rr.amount,
            COALESCE(NULLIF(TRIM(rr.currency), ''), 'ETB') AS currency, rr.reason, rr.status,
            rr.decision_reason, rr.created_at, rr.decided_at, p.provider_reference
     FROM refund_requests rr
     JOIN payments p ON p.id = rr.payment_id
     JOIN bookings b ON b.id = p.booking_id
     JOIN events e ON e.id = b.event_id
     WHERE e.organizer_id = ? ORDER BY rr.created_at DESC`,
    [req.platformUser.id],
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    paymentId: Number(row.payment_id),
    reference: row.provider_reference || null,
    amount: Number(row.amount),
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    decisionReason: row.decision_reason || null,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  })));
});

postRoute('/payments/:id/refunds', async (req, res) => {
  const paymentId = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({
    amount: z.union([z.string().trim().max(13), z.number().finite()]),
    reason: z.string().trim().min(5).max(500).refine(isSafeFinancialNote, 'Do not include card data or payment credentials.'),
    idempotencyKey: z.string().uuid(),
  }).strict().safeParse(req.body);
  if (!paymentId.success || !parsed.success) {
    return res.status(400).json({ error: 'A valid payment ID, refund amount, reason, and idempotency key are required.' });
  }
  const result = await createRefundRequest(databaseFor(req), {
    paymentId: paymentId.data,
    requesterId: req.platformUser.id,
    ...parsed.data,
    ip: req.ip,
  });
  return res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
});

getRoute('/messages', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT m.id, m.booking_id, m.sender_id, m.recipient_id, m.subject, m.body, m.read_at, m.created_at,
            u.full_name AS sender, e.id AS event_id, e.title AS event_title, vp.business_name AS vendor_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     JOIN bookings b ON b.id = m.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE e.organizer_id = ? AND (m.sender_id = ? OR m.recipient_id = ?)
     ORDER BY m.created_at DESC`,
    [req.platformUser.id, req.platformUser.id, req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    eventId: Number(row.event_id),
    event: row.event_title,
    vendor: row.vendor_name,
    senderId: Number(row.sender_id),
    recipientId: Number(row.recipient_id),
    sender: row.sender,
    subject: row.subject || '',
    body: row.body,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  })));
});

postRoute('/messages', async (req, res) => {
  const parsed = z.object({
    bookingId: z.coerce.number().int().positive(),
    body: z.string().trim().min(1).max(4000),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Message details are invalid.' });
  const database = databaseFor(req);
  const [[booking]] = await database.execute(
    `SELECT b.id, e.title AS event_title, e.organizer_id, vp.user_id AS vendor_user_id, vp.business_name
     FROM bookings b JOIN events e ON e.id = b.event_id JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE b.id = ? AND e.organizer_id = ? AND b.status NOT IN ('cancelled', 'rejected') LIMIT 1`,
    [parsed.data.bookingId, req.platformUser.id],
  );
  if (!booking) return res.status(404).json({ error: 'Active booking not found.' });
  const messageId = await transaction(database, async (connection) => {
    const [result] = await connection.execute(
      'INSERT INTO messages (sender_id, recipient_id, booking_id, subject, body) VALUES (?, ?, ?, ?, ?)',
      [req.platformUser.id, booking.vendor_user_id, booking.id, `Question about ${booking.event_title}`.slice(0, 180), parsed.data.body],
    );
    await createNotification(connection, {
      userId: booking.vendor_user_id,
      title: 'New customer message',
      message: `New message about ${booking.event_title}.`,
      type: 'booking',
      relatedType: 'booking',
      relatedId: booking.id,
      actorId: req.platformUser.id,
    });
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'customer.message_sent',
      entityType: 'booking',
      entityId: booking.id,
      details: { messageId: Number(result.insertId) },
      ip: req.ip,
    });
    return Number(result.insertId);
  });
  res.status(201).json({ data: { id: messageId, bookingId: Number(booking.id), status: 'sent' } });
});

postRoute('/messages/:id/read', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid message ID is required.' });
  const [result] = await databaseFor(req).execute(
    `UPDATE messages m JOIN bookings b ON b.id = m.booking_id JOIN events e ON e.id = b.event_id
     SET m.read_at = COALESCE(m.read_at, NOW())
     WHERE m.id = ? AND m.recipient_id = ? AND e.organizer_id = ?`,
    [id.data, req.platformUser.id, req.platformUser.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Message not found.' });
  res.json({ data: { id: id.data, read: true } });
});

getRoute('/reviews', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT r.id, r.booking_id, r.rating, r.comment, r.status, r.created_at,
            b.vendor_id, vp.business_name AS vendor_name
     FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE e.organizer_id = ?
     ORDER BY r.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    vendorId: Number(row.vendor_id),
    vendorName: row.vendor_name,
    rating: Number(row.rating),
    comment: row.comment || '',
    status: row.status,
    createdAt: row.created_at,
  })));
});

postRoute('/reviews', async (req, res) => {
  const schema = z.object({
    bookingId: z.coerce.number().int().positive(),
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional().default(''),
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Review details are invalid.' });
  const database = databaseFor(req);
  try {
    const result = await transaction(database, async (db) => {
      const [[booking]] = await db.execute(
        `SELECT b.id, b.status, e.organizer_id
         FROM bookings b JOIN events e ON e.id = b.event_id
         WHERE b.id = ? FOR UPDATE`,
        [parsed.data.bookingId],
      );
      if (!booking || Number(booking.organizer_id) !== Number(req.platformUser.id)) {
        throw Object.assign(new Error('Booking not found.'), { status: 404 });
      }
      if (booking.status !== 'completed') {
        throw Object.assign(new Error('Reviews can only be submitted for completed bookings.'), { status: 409 });
      }
      const [[existing]] = await db.execute('SELECT id FROM reviews WHERE booking_id = ? LIMIT 1', [booking.id]);
      if (existing) throw Object.assign(new Error('A review has already been submitted for this booking.'), { status: 409 });
      const [created] = await db.execute(
        "INSERT INTO reviews (booking_id, rating, comment, status) VALUES (?, ?, ?, 'published')",
        [booking.id, parsed.data.rating, parsed.data.comment || null],
      );
      await db.execute(
        `INSERT INTO review_history (review_id, actor_id, action, to_status)
         VALUES (?, ?, 'created', 'published')`,
        [created.insertId, req.platformUser.id],
      );
      await writeAudit(db, {
        actorId: req.platformUser.id,
        action: 'review.created',
        entityType: 'review',
        entityId: created.insertId,
        details: { bookingId: Number(booking.id), rating: parsed.data.rating },
        ip: req.ip,
      });
      return { id: created.insertId, bookingId: Number(booking.id), rating: parsed.data.rating, status: 'published' };
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

getRoute('/complaints', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT c.id, c.booking_id, c.subject, c.details, c.status, c.resolution, c.created_at,
            vp.business_name AS vendor_name
     FROM complaints c LEFT JOIN bookings b ON b.id = c.booking_id
     LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 100`,
    [req.platformUser.id],
  );
  return ok(res, rows.map((row) => ({ ...row, reference: `CMP-${String(row.id).padStart(6, '0')}` })));
});

postRoute('/complaints', async (req, res) => {
  const schema = z.object({
    bookingId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    subject: z.string().trim().min(3).max(180),
    details: z.string().trim().min(10).max(10000),
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Complaint details are invalid.' });
  const database = databaseFor(req);
  try {
    const complaintId = await transaction(database, async (db) => {
      if (parsed.data.bookingId) {
        const [[booking]] = await db.execute(
          `SELECT b.id FROM bookings b JOIN events e ON e.id = b.event_id
           WHERE b.id = ? AND e.organizer_id = ?`,
          [parsed.data.bookingId, req.platformUser.id],
        );
        if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });
      }
      const [created] = await db.execute(
        `INSERT INTO complaints (user_id, booking_id, subject, details, status)
         VALUES (?, ?, ?, ?, 'open')`,
        [req.platformUser.id, parsed.data.bookingId || null, parsed.data.subject, parsed.data.details],
      );
      await db.execute(
        `INSERT INTO complaint_history (complaint_id, actor_id, action, to_status)
         VALUES (?, ?, 'created', 'open')`,
        [created.insertId, req.platformUser.id],
      );
      await writeAudit(db, {
        actorId: req.platformUser.id,
        action: 'complaint.created',
        entityType: 'complaint',
        entityId: created.insertId,
        details: { bookingId: parsed.data.bookingId || null },
        ip: req.ip,
      });
      await notifyAdministrators(db, {
        title: 'New customer complaint',
        message: `Complaint CMP-${String(created.insertId).padStart(6, '0')} requires review.`,
        type: 'complaint',
        relatedType: 'complaint',
        relatedId: created.insertId,
        idempotencyKey: `complaint:${created.insertId}:created`,
        actorId: req.platformUser.id,
      });
      return created.insertId;
    });
    return res.status(201).json({ success: true, data: { id: complaintId, reference: `CMP-${String(complaintId).padStart(6, '0')}`, status: 'open' } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

getRoute('/complaints/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
  const database = databaseFor(req);
  const [[complaint]] = await database.execute(
    `SELECT c.id, c.booking_id, c.subject, c.details, c.status, c.resolution, c.created_at
     FROM complaints c WHERE c.id = ? AND c.user_id = ?`,
    [id.data, req.platformUser.id],
  );
  if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
  const [[attachments], [history]] = await Promise.all([
    database.execute(
      'SELECT id, original_name, content_type, file_size, created_at FROM complaint_attachments WHERE complaint_id = ? ORDER BY id DESC',
      [id.data],
    ),
    database.execute(
      `SELECT action, from_status, to_status, reason, created_at
       FROM complaint_history WHERE complaint_id = ? ORDER BY id DESC`,
      [id.data],
    ),
  ]);
  return ok(res, { ...complaint, reference: `CMP-${String(id.data).padStart(6, '0')}`, attachments, history });
});

router.post('/complaints/:id/attachments', complaintAttachmentParser, asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'Upload a PDF, JPEG, PNG, or WebP attachment.' });
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  const validation = validateComplaintAttachment(req.body, contentType);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  const database = databaseFor(req);
  const [[complaint]] = await database.execute(
    'SELECT id, status FROM complaints WHERE id = ? AND user_id = ?',
    [id.data, req.platformUser.id],
  );
  if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
  const [result] = await database.execute(
    `INSERT INTO complaint_attachments
     (complaint_id, uploaded_by, original_name, content_type, file_size, sha256, file_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id.data, req.platformUser.id, sanitizeComplaintAttachmentName(req.query.filename),
      contentType, validation.fileSize, validation.sha256, req.body,
    ],
  );
  await database.execute(
    `INSERT INTO complaint_history (complaint_id, actor_id, action, from_status, to_status, details)
     VALUES (?, ?, 'attachment_added', ?, ?, ?)`,
    [id.data, req.platformUser.id, complaint.status, complaint.status, JSON.stringify({ attachmentId: result.insertId, contentType, fileSize: validation.fileSize })],
  );
  await writeAudit(database, {
    actorId: req.platformUser.id,
    action: 'complaint.attachment_added',
    entityType: 'complaint',
    entityId: id.data,
    details: { attachmentId: result.insertId, contentType, fileSize: validation.fileSize },
    ip: req.ip,
  });
  return res.status(201).json({ success: true, data: { id: result.insertId } });
}));

getRoute('/complaints/:id/attachments/:attachmentId', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const attachmentId = z.coerce.number().int().positive().safeParse(req.params.attachmentId);
  if (!id.success || !attachmentId.success) return res.status(400).json({ error: 'Attachment ID is invalid.' });
  const [[file]] = await databaseFor(req).execute(
    `SELECT a.original_name, a.content_type, a.file_size, a.file_data
     FROM complaint_attachments a JOIN complaints c ON c.id = a.complaint_id
     WHERE a.id = ? AND c.id = ? AND c.user_id = ?`,
    [attachmentId.data, id.data, req.platformUser.id],
  );
  if (!file) return res.status(404).json({ error: 'Attachment not found.' });
  res.set({
    'Content-Type': file.content_type,
    'Content-Length': file.file_size,
    'Content-Disposition': `attachment; filename="${sanitizeComplaintAttachmentName(file.original_name)}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(file.file_data);
});

getRoute('/notifications', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT id, title, message, notification_type, related_entity_type, related_entity_id, status, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    message: row.message,
    type: row.notification_type,
    relatedType: row.related_entity_type,
    relatedId: row.related_entity_id,
    read: row.status === 'read',
    createdAt: row.created_at,
  })));
});

postRoute('/notifications/:id/read', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid notification ID is required.' });
  const database = databaseFor(req);
  const changed = await transaction(database, async (connection) => {
    const [result] = await connection.execute(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ? AND status <> 'read'`,
      [id.data, req.platformUser.id],
    );
    if (result.affectedRows) {
      await connection.execute("INSERT INTO notification_history (notification_id, actor_id, action) VALUES (?, ?, 'read')", [id.data, req.platformUser.id]);
      return true;
    }
    const [owned] = await connection.execute('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [id.data, req.platformUser.id]);
    return owned.length > 0;
  });
  if (!changed) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ data: { id: id.data, read: true } });
});

postRoute('/notifications/read-all', async (req, res) => {
  const database = databaseFor(req);
  const changed = await transaction(database, async (connection) => {
    await connection.execute(
      `INSERT INTO notification_history (notification_id, actor_id, action)
       SELECT id, ?, 'read' FROM notifications WHERE user_id = ? AND status <> 'read'`,
      [req.platformUser.id, req.platformUser.id],
    );
    const [result] = await connection.execute(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE user_id = ? AND status <> 'read'`,
      [req.platformUser.id],
    );
    return Number(result.affectedRows || 0);
  });
  res.json({ data: { changed } });
});

getRoute('/profile', async (req, res) => {
  return ok(res, {
    fullName: req.platformUser.full_name,
    email: req.platformUser.email,
    phone: req.platformUser.phone,
    role: req.platformUser.role,
    status: req.platformUser.status,
  });
});

patchRoute('/profile', async (req, res) => {
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(40).optional().default(''),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Profile details are invalid.' });
  await databaseFor(req).execute('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [parsed.data.fullName, parsed.data.phone || null, req.platformUser.id]);
  await writeAudit(databaseFor(req), {
    actorId: req.platformUser.id,
    action: 'customer.profile_updated',
    entityType: 'user',
    entityId: req.platformUser.id,
    details: { fields: ['full_name', 'phone'] },
    ip: req.ip,
  });
  res.json({ data: { fullName: parsed.data.fullName, email: req.platformUser.email, phone: parsed.data.phone || null, role: req.platformUser.role } });
});

postRoute('/profile/password', async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(16).refine(isStrongPassword),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Provide your current password and a 12–16 character new password with uppercase, lowercase, and a number.' });
  if (parsed.data.currentPassword === parsed.data.newPassword) return res.status(400).json({ error: 'Choose a new password different from your current password.' });
  const database = databaseFor(req);
  const currentTokenHash = hashToken(req.cookies.platform_session);
  try {
    await transaction(database, async (connection) => {
      const [[account]] = await connection.execute('SELECT password_hash FROM users WHERE id = ? FOR UPDATE', [req.platformUser.id]);
      if (!account || !await bcrypt.compare(parsed.data.currentPassword, account.password_hash)) {
        throw Object.assign(new Error('The current password is incorrect.'), { status: 400 });
      }
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.platformUser.id]);
      await connection.execute('DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?', [req.platformUser.id, currentTokenHash]);
      await writeAudit(connection, {
        actorId: req.platformUser.id,
        action: 'customer.password_changed',
        entityType: 'user',
        entityId: req.platformUser.id,
        details: { otherSessionsInvalidated: true },
        ip: req.ip,
        severity: 'critical',
      });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  res.json({ message: 'Password changed. Other account sessions have been signed out.' });
});

export default router;
