import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { requirePermission } from '../middleware/rbac.js';
import { loadPublicMarketplace, mapBookingRecord } from '../lib/marketplace.js';
import { listPublicServices } from '../lib/serviceCatalog.js';
import { listPublicVendors } from '../lib/vendorCatalog.js';
import { createRefundRequest, isSafeFinancialNote } from '../lib/paymentManagement.js';
import { writeAudit } from '../lib/security.js';
import { notifyAdministrators } from '../lib/notificationService.js';
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

function catalogQuerySchema(sorts) {
  return z.object({
    ...catalogQueryFields,
    sort: z.enum(sorts).optional(),
  }).strict().superRefine((query, context) => {
  if (query.minPrice !== undefined && query.maxPrice !== undefined && query.maxPrice < query.minPrice) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price.' });
  }
  });
}
const vendorCatalogQuerySchema = catalogQuerySchema(['recommended', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'name-az']);
const serviceCatalogQuerySchema = catalogQuerySchema(['recommended', 'highest-rated', 'price-low', 'price-high', 'alphabetical']);
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
  SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount, b.currency,
         b.status, b.moderation_reason, b.created_at,
         e.title AS event_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
         u.full_name AS customer_name, vp.business_name AS vendor_name
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  JOIN users u ON u.id = e.organizer_id
  JOIN vendor_profiles vp ON vp.id = b.vendor_id
  WHERE e.organizer_id = ?`;

getRoute('/overview', async (req, res) => {
  const database = databaseFor(req);
  const userId = req.platformUser.id;
  const [bookingRows, eventRows, quotationRows, paymentRows, messageRows, notificationRows] = await Promise.all([
    database.execute('SELECT status FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = ?', [userId]),
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
    confirmedBookings: bookings.filter((booking) => ['accepted', 'completed'].includes(booking.status)).length,
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
  return ok(res, rows.map(mapBookingRecord));
});

getRoute('/history', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `${customerBookingSelect} AND b.status IN ('completed', 'cancelled', 'rejected') ORDER BY b.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map(mapBookingRecord));
});

getRoute('/events', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT id, title, event_type, city, start_date, end_date, budget, guest_count, status
     FROM events WHERE organizer_id = ? ORDER BY start_date DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    type: row.event_type,
    city: row.city || '',
    date: row.start_date,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: row.budget === null ? null : Number(row.budget),
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
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

getRoute('/quotations', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT q.id, q.vendor_id, q.event_id, q.service_description, q.amount, q.currency,
            q.status, q.valid_until, q.notes, q.created_at, vp.business_name AS vendor_name,
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
    event: row.event_title || null,
    service: row.service_description,
    status: row.status,
    amount: Number(row.amount || 0),
    currency: row.currency,
    validUntil: row.valid_until,
    notes: row.notes || '',
    createdAt: row.created_at,
  })));
});

getRoute('/payments', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT p.id, p.booking_id, p.amount, p.currency, p.provider, p.provider_reference,
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
    `SELECT m.id, m.subject, m.body, m.read_at, m.created_at, u.full_name AS sender
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.recipient_id = ?
     ORDER BY m.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    sender: row.sender,
    subject: row.subject || '',
    body: row.body,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  })));
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
    `SELECT id, title, message, status, created_at
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
    read: row.status === 'read',
    createdAt: row.created_at,
  })));
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

export default router;
