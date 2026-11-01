import express, { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { requirePermission } from '../middleware/rbac.js';
import { ensureVendorProfile, loadVendorProfileForUser } from '../lib/marketplace.js';
import { writeAudit } from '../lib/security.js';
import {
  MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES,
  sanitizeVendorDocumentName,
  validateVendorVerificationDocument,
  VENDOR_VERIFICATION_DOCUMENT_TYPES,
} from '../lib/vendorVerificationDocuments.js';

const router = Router();
const vendorVerificationDocumentParser = express.raw({
  type: [...VENDOR_VERIFICATION_DOCUMENT_TYPES],
  limit: MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES,
});

const statusLabel = (status) => ({
  requested: 'Pending',
  under_review: 'Under Review',
  quoted: 'Quoted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  draft: 'Draft',
  active: 'Published',
  archived: 'Inactive',
}[status] || status);

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
const patchPermissionRoute = (path, permission, handler) => router.patch(path, requirePermission(permission), asyncHandler(handler));
const deletePermissionRoute = (path, permission, handler) => router.delete(path, requirePermission(permission), asyncHandler(handler));
const categoryIdSchema = z.preprocess(
  (value) => value === '' || value === null ? null : value,
  z.coerce.number().int().positive().nullable()
).optional();
const priceSchema = z.preprocess(
  (value) => value === '' || value === null ? null : value,
  z.coerce.number().finite().min(0).max(100000000).nullable()
).optional();
const profilePatchSchema = z.object({
  businessName: z.string().trim().min(2).max(160).optional(),
  categoryId: categoryIdSchema,
  city: z.string().trim().max(120).optional(),
  description: z.string().trim().max(10000).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
}).strict();
const serviceFieldsSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(10000).optional().default(''),
  categoryId: categoryIdSchema,
  price: priceSchema,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional().default('ETB'),
  status: z.enum(['draft', 'active']).optional().default('draft'),
}).strict();
const servicePatchSchema = serviceFieldsSchema.partial();

function sendValidationError(res, error) {
  return res.status(400).json({
    error: 'Invalid request data.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

async function validateCategory(database, categoryId) {
  if (categoryId === undefined || categoryId === null) return true;
  const [rows] = await database.execute(
    'SELECT id FROM service_categories WHERE id = ? AND is_active = TRUE',
    [categoryId]
  );
  return rows.length > 0;
}

async function runTransaction(database, work) {
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

function mapVendorProfile(vendor) {
  return {
    businessName: vendor.business_name,
    logo: null,
    businessType: vendor.category_name || 'Event services',
    serviceLocation: vendor.city || 'Not set',
    phone: vendor.phone || null,
    email: vendor.email,
    address: null,
    serviceAreas: vendor.city ? [vendor.city] : [],
    yearsOfExperience: null,
    hours: null,
    website: null,
    verificationStatus: vendor.verification_status,
    description: vendor.description || '',
  };
}

router.use(requirePlatformUser);
router.use(asyncHandler(async (req, res, next) => {
  if (req.platformUser.role !== 'vendor') {
    return res.status(403).json({ error: 'Vendor access is required.' });
  }
  const vendor = await ensureVendorProfile(
    req.platformUser.id,
    req.platformUser.full_name,
    databaseFor(req)
  );
  if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
  req.vendor = vendor;
  const allowedWhileUnverified = req.method === 'GET' || (
    req.path === '/verification/documents'
    && req.method === 'POST'
    && ['pending', 'under_review', 'information_requested'].includes(vendor.verification_status)
  ) || (
    req.path === '/profile' && req.method === 'PATCH' && vendor.verification_status !== 'suspended'
  );
  if (vendor.verification_status !== 'verified' && !allowedWhileUnverified) {
    return res.status(403).json({ error: `Vendor access is unavailable while the account is ${vendor.verification_status.replaceAll('_', ' ')}.` });
  }
  next();
}));

getRoute('/overview', async (req, res) => {
  const userId = req.platformUser.id;
  const vendorId = req.vendor.id;
  const [serviceRows, bookingRows, quotationRows, paymentRows, messageRows, availabilityRows, ratingRows, notificationRows] = await Promise.all([
    pool.execute('SELECT id, status FROM services WHERE vendor_id = ?', [vendorId]),
    pool.execute('SELECT id, status FROM bookings WHERE vendor_id = ?', [vendorId]),
    pool.execute('SELECT id, status FROM quotations WHERE vendor_id = ?', [vendorId]),
    pool.execute(
      `SELECT p.status, p.amount
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.vendor_id = ?`,
      [vendorId]
    ),
    pool.execute('SELECT id, read_at FROM messages WHERE recipient_id = ?', [userId]),
    pool.execute("SELECT id FROM vendor_availability WHERE vendor_id = ? AND status = 'available' AND available_date >= CURDATE()", [vendorId]),
    pool.execute(
      `SELECT r.rating FROM reviews r JOIN bookings b ON b.id = r.booking_id
       WHERE b.vendor_id = ? AND r.status = 'published'`,
      [vendorId]
    ),
    pool.execute("SELECT id FROM notifications WHERE user_id = ? AND status <> 'read'", [userId]),
  ]);

  const services = serviceRows[0];
  const bookings = bookingRows[0];
  const quotations = quotationRows[0];
  const payments = paymentRows[0];
  const messages = messageRows[0];
  const ratings = ratingRows[0].map((row) => Number(row.rating || 0));
  const activeStatuses = new Set(['active']);
  const pendingStatuses = new Set(['requested', 'under_review', 'quoted']);
  const confirmedStatuses = new Set(['accepted', 'completed']);

  return ok(res, {
    totalServices: services.length,
    activeServices: services.filter((service) => activeStatuses.has(service.status)).length,
    inactiveServices: services.filter((service) => !activeStatuses.has(service.status)).length,
    pendingBookings: bookings.filter((booking) => pendingStatuses.has(booking.status)).length,
    confirmedBookings: bookings.filter((booking) => confirmedStatuses.has(booking.status)).length,
    upcomingDates: availabilityRows[0].length,
    pendingQuotations: quotations.filter((quote) => ['draft', 'sent', 'revision_requested'].includes(quote.status)).length,
    totalEarnings: payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    pendingPayouts: payments.filter((payment) => ['pending', 'authorized'].includes(payment.status)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    averageRating: ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : 0,
    unreadMessages: messages.filter((message) => !message.read_at).length,
    notifications: notificationRows[0].length,
  });
});

getRoute('/profile', async (req, res) => {
  return ok(res, mapVendorProfile(req.vendor));
});

patchRoute('/profile', async (req, res) => {
  const parsed = profilePatchSchema.safeParse(req.body || {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  if (!Object.keys(parsed.data).length) {
    return res.status(400).json({ error: 'Provide at least one profile field to update.' });
  }

  const database = databaseFor(req);
  if (!await validateCategory(database, parsed.data.categoryId)) {
    return res.status(400).json({ error: 'Select an active service category.' });
  }

  const profileFields = {
    businessName: 'business_name',
    categoryId: 'category_id',
    city: 'city',
    description: 'description',
  };
  const fields = Object.keys(profileFields).filter((field) => parsed.data[field] !== undefined);

  await runTransaction(database, async (connection) => {
    if (fields.length) {
      await connection.execute(
        `UPDATE vendor_profiles SET ${fields.map((field) => `${profileFields[field]} = ?`).join(', ')} WHERE user_id = ?`,
        [...fields.map((field) => parsed.data[field]), req.platformUser.id]
      );
    }
    if (parsed.data.phone !== undefined) {
      await connection.execute('UPDATE users SET phone = ? WHERE id = ?', [parsed.data.phone, req.platformUser.id]);
    }
  });

  const updatedVendor = await loadVendorProfileForUser(req.platformUser.id, database);
  req.vendor = updatedVendor;
  return ok(res, mapVendorProfile(updatedVendor));
});

getRoute('/verification', async (req, res) => {
  const vendor = req.vendor;
  const [documents] = await databaseFor(req).execute(
    `SELECT id, original_name, content_type, file_size, created_at
     FROM vendor_verification_documents WHERE vendor_id = ? ORDER BY created_at DESC`,
    [vendor.id],
  );
  const [history] = await databaseFor(req).execute(
    `SELECT from_status, to_status, reason, created_at
     FROM vendor_verification_history WHERE vendor_id = ? ORDER BY created_at DESC`,
    [vendor.id],
  );
  return ok(res, {
    status: vendor.verification_status,
    submittedAt: vendor.created_at,
    reviewProgress: vendor.verification_status.replaceAll('_', ' '),
    reasons: vendor.verification_reason ? [vendor.verification_reason] : [],
    documents,
    history,
  });
});

router.post('/verification/documents', vendorVerificationDocumentParser, asyncHandler(async (req, res) => {
  const contentType = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const validationError = validateVendorVerificationDocument(req.body, contentType);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!['pending', 'under_review', 'information_requested'].includes(req.vendor.verification_status)) {
    return res.status(409).json({ error: 'Documents cannot be added for this vendor status.' });
  }
  const database = databaseFor(req);
  const [[count]] = await database.execute(
    'SELECT COUNT(*) AS total FROM vendor_verification_documents WHERE vendor_id = ?',
    [req.vendor.id],
  );
  if (Number(count.total) >= 10) return res.status(400).json({ error: 'A vendor application may contain at most 10 documents.' });
  const name = sanitizeVendorDocumentName(req.query.filename);
  const [result] = await database.execute(
    `INSERT INTO vendor_verification_documents
       (vendor_id, uploaded_by, original_name, content_type, file_size, content)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.vendor.id, req.platformUser.id, name, contentType, req.body.length, req.body],
  );
  await writeAudit(database, {
    actorId: req.platformUser.id,
    action: 'vendor.document_submitted',
    entityType: 'vendor',
    entityId: req.vendor.id,
    details: { documentId: result.insertId, name, contentType, fileSize: req.body.length },
    ip: req.ip,
  });
  return res.status(201).json({
    data: { id: result.insertId, original_name: name, content_type: contentType, file_size: req.body.length },
  });
}));

getPermissionRoute('/services', 'services.manage_own', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT s.id, s.title, s.description, s.price, s.currency, s.status, s.created_at,
            COALESCE(sc.name, 'General') AS category,
            (SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.id) AS booking_count
     FROM services s
     LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.vendor_id = ?
     ORDER BY s.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    name: row.title,
    title: row.title,
    description: row.description || '',
    category: row.category,
    status: statusLabel(row.status),
    price: Number(row.price || 0),
    currency: row.currency,
    bookings: Number(row.booking_count || 0),
  })));
});

postPermissionRoute('/services', 'services.manage_own', async (req, res) => {
  const parsed = serviceFieldsSchema.safeParse(req.body || {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  if (!await validateCategory(databaseFor(req), parsed.data.categoryId)) {
    return res.status(400).json({ error: 'Select an active service category.' });
  }
  if (parsed.data.status === 'active' && req.vendor.verification_status !== 'verified') {
    return res.status(409).json({ error: 'Vendor verification is required before publishing a service.' });
  }

  const [result] = await databaseFor(req).execute(
    `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.vendor.id, parsed.data.categoryId ?? null, parsed.data.title, parsed.data.description, parsed.data.price ?? null, parsed.data.currency, parsed.data.status]
  );
  return res.status(201).json({
    success: true,
    data: {
      id: Number(result.insertId),
      vendorId: Number(req.vendor.id),
      title: parsed.data.title,
      description: parsed.data.description,
      categoryId: parsed.data.categoryId ?? null,
      price: parsed.data.price ?? null,
      currency: parsed.data.currency,
      status: statusLabel(parsed.data.status),
    },
  });
});

patchPermissionRoute('/services/:id', 'services.manage_own', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = servicePatchSchema.safeParse(req.body || {});
  if (!id.success || !parsed.success) {
    return parsed.success
      ? res.status(400).json({ error: 'Service ID is invalid.' })
      : sendValidationError(res, parsed.error);
  }
  const fields = Object.keys(parsed.data);
  if (!fields.length) return res.status(400).json({ error: 'Provide at least one service field to update.' });

  const database = databaseFor(req);
  const [[service]] = await database.execute(
    'SELECT id, status FROM services WHERE id = ? AND vendor_id = ? LIMIT 1',
    [id.data, req.vendor.id]
  );
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  if (!await validateCategory(database, parsed.data.categoryId)) {
    return res.status(400).json({ error: 'Select an active service category.' });
  }
  if (parsed.data.status === 'active' && req.vendor.verification_status !== 'verified') {
    return res.status(409).json({ error: 'Vendor verification is required before publishing a service.' });
  }

  const columns = {
    title: 'title',
    description: 'description',
    categoryId: 'category_id',
    price: 'price',
    currency: 'currency',
    status: 'status',
  };
  await database.execute(
    `UPDATE services SET ${fields.map((field) => `${columns[field]} = ?`).join(', ')} WHERE id = ? AND vendor_id = ?`,
    [...fields.map((field) => parsed.data[field] === undefined ? null : parsed.data[field]), id.data, req.vendor.id]
  );
  return ok(res, { id: id.data, status: statusLabel(parsed.data.status || service.status) });
});

deletePermissionRoute('/services/:id', 'services.manage_own', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Service ID is invalid.' });
  const database = databaseFor(req);
  const [[service]] = await database.execute(
    'SELECT id, status FROM services WHERE id = ? AND vendor_id = ? LIMIT 1',
    [id.data, req.vendor.id]
  );
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  if (service.status !== 'archived') {
    await database.execute(
      "UPDATE services SET status = 'archived' WHERE id = ? AND vendor_id = ?",
      [id.data, req.vendor.id]
    );
  }
  return res.status(204).end();
});

getRoute('/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, description, is_active FROM service_categories ORDER BY name ASC');
  return ok(res, rows.map((row) => ({ id: Number(row.id), name: row.name, description: row.description || '', active: Boolean(row.is_active) })));
});

getRoute('/pricing', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, title, description, price, currency
     FROM services
     WHERE vendor_id = ? AND status = 'active'
     ORDER BY price ASC`,
    [req.vendor.id]
  );
  const prices = rows.map((row) => Number(row.price || 0)).filter((price) => price > 0);
  return ok(res, {
    currency: rows[0]?.currency || 'ETB',
    basePrice: prices.length ? Math.min(...prices) : 0,
    packages: rows.map((row) => ({
      id: Number(row.id),
      name: row.title,
      description: row.description || '',
      price: Number(row.price || 0),
    })),
  });
});

getRoute('/availability', async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT available_date, status, note FROM vendor_availability WHERE vendor_id = ? ORDER BY available_date ASC',
    [req.vendor.id]
  );
  return ok(res, {
    schedule: rows.map((row) => ({
      date: row.available_date,
      status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
      note: row.note || '',
    })),
    businessHours: null,
  });
});

getRoute('/booking-requests', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            e.title AS event_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
            u.full_name AS customer_name
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ? AND b.status IN ('requested', 'under_review', 'quoted')
     ORDER BY b.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    date: row.event_start_date,
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
  })));
});

getRoute('/bookings', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date, u.full_name AS customer_name
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ? AND b.status IN ('accepted', 'completed')
     ORDER BY e.start_date DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
    date: row.event_start_date,
  })));
});

getRoute('/history', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date, u.full_name AS customer_name
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ? AND b.status IN ('rejected', 'cancelled')
     ORDER BY b.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
    date: row.event_start_date,
  })));
});

getRoute('/quotations', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT q.id, q.service_description, q.amount, q.currency, q.status, q.valid_until,
            q.notes, q.created_at, u.full_name AS customer_name, e.title AS event_title
     FROM quotations q
     LEFT JOIN users u ON u.id = q.customer_id
     LEFT JOIN events e ON e.id = q.event_id
     WHERE q.vendor_id = ?
     ORDER BY q.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name || 'Customer pending',
    event: row.event_title || null,
    service: row.service_description,
    status: statusLabel(row.status),
    validUntil: row.valid_until,
    amount: Number(row.amount || 0),
    currency: row.currency,
    notes: row.notes || '',
  })));
});

getRoute('/payments', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.id, p.booking_id, p.amount, p.currency, p.provider, p.provider_reference,
            p.status, p.created_at
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     WHERE b.vendor_id = ?
     ORDER BY p.created_at DESC`,
    [req.vendor.id]
  );
  const earnings = rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingPayouts = rows.filter((row) => ['pending', 'authorized'].includes(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return ok(res, {
    earnings,
    pendingPayouts,
    fees: 0,
    net: earnings,
    transactions: rows.map((row) => ({
      id: Number(row.id),
      bookingId: Number(row.booking_id),
      date: row.created_at,
      provider: row.provider || null,
      reference: row.provider_reference || null,
      status: statusLabel(row.status),
      amount: Number(row.amount || 0),
      currency: row.currency,
    })),
  });
});

getRoute('/messages', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT m.id, m.body, m.read_at, m.created_at, u.full_name AS sender
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.recipient_id = ?
     ORDER BY m.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    sender: row.sender,
    body: row.body,
    unread: !row.read_at,
    createdAt: row.created_at,
  })));
});

getRoute('/reviews', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT r.id, r.rating, r.comment, r.status, r.created_at, u.full_name AS customer_name
     FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ?
     ORDER BY r.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    rating: Number(row.rating),
    comment: row.comment || '',
    response: null,
    status: row.status,
    createdAt: row.created_at,
  })));
});

getRoute('/notifications', async (req, res) => {
  const [rows] = await pool.execute(
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

getRoute('/reports', async (req, res) => {
  const [serviceRows, bookingRows, paymentRows] = await Promise.all([
    pool.execute('SELECT title FROM services WHERE vendor_id = ?', [req.vendor.id]),
    pool.execute(
      `SELECT b.status, b.service_description
       FROM bookings b WHERE b.vendor_id = ?`,
      [req.vendor.id]
    ),
    pool.execute(
      `SELECT DATE_FORMAT(p.created_at, '%Y-%m') AS month, SUM(p.amount) AS total
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.vendor_id = ? AND p.status = 'paid'
       GROUP BY DATE_FORMAT(p.created_at, '%Y-%m')
       ORDER BY month ASC`,
      [req.vendor.id]
    ),
  ]);
  const bookings = bookingRows[0];
  const serviceCounts = new Map();
  for (const booking of bookings) {
    serviceCounts.set(booking.service_description, (serviceCounts.get(booking.service_description) || 0) + 1);
  }
  const popularServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  return ok(res, {
    totalListings: serviceRows[0].length,
    bookingStatus: bookings.reduce((acc, booking) => {
      acc[booking.status] = (acc[booking.status] || 0) + 1;
      return acc;
    }, {}),
    earningsByDate: Object.fromEntries(paymentRows[0].map((row) => [row.month, Number(row.total || 0)])),
    popularServices,
  });
});

getRoute('/account', async (req, res) => {
  return ok(res, {
    fullName: req.platformUser.full_name,
    email: req.platformUser.email,
    phone: req.platformUser.phone,
    role: 'Vendor',
    status: req.platformUser.status,
  });
});

export default router;
