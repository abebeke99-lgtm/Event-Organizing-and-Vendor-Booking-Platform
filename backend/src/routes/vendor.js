import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { requirePermission } from '../middleware/rbac.js';
import { ensureVendorProfile, loadVendorProfileForUser } from '../lib/marketplace.js';
import { hashToken, writeAudit } from '../lib/security.js';
import { loadSystemSettings } from '../lib/systemSettings.js';
import { createNotification, notifyAdministrators } from '../lib/notificationService.js';
import { isStrongPassword } from '../lib/authFlow.js';
import { MAX_PROFILE_PHOTO_BYTES, validateProfilePhoto } from '../lib/profilePhoto.js';
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
const vendorMediaParser = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: MAX_PROFILE_PHOTO_BYTES,
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
  address: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(10000).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  serviceAreas: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  operatingHours: z.record(z.string(), z.string().trim().max(80)).optional(),
  website: z.string().trim().url().max(255).nullable().optional(),
  notificationPreferences: z.record(z.string(), z.boolean()).optional(),
  bookingPreferences: z.record(z.string(), z.boolean()).optional(),
}).strict();
const serviceFieldsSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(10000).optional().default(''),
  categoryId: categoryIdSchema,
  price: priceSchema,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  status: z.enum(['draft', 'active']).optional().default('draft'),
}).strict();
const servicePatchSchema = serviceFieldsSchema.partial();
const servicePackageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().default(''),
  price: z.coerce.number().finite().min(0).max(100000000),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  includedFeatures: z.array(z.string().trim().min(1).max(160)).max(30).optional().default([]),
  minimumBooking: z.coerce.number().int().min(1).max(100000).optional().default(1),
  extras: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional().default(''),
    price: z.coerce.number().finite().min(0).max(100000000),
  }).strict()).max(30).optional().default([]),
  isActive: z.boolean().optional().default(true),
}).strict();

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
  const jsonValue = (value, fallback) => {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  };
  return {
    businessName: vendor.business_name,
    categoryId: vendor.category_id === null || vendor.category_id === undefined ? null : Number(vendor.category_id),
    logo: null,
    businessType: vendor.category_name || 'Event services',
    serviceLocation: vendor.city || 'Not set',
    phone: vendor.phone || null,
    email: vendor.email,
    serviceAreas: jsonValue(vendor.service_areas, vendor.city ? [vendor.city] : []),
    yearsOfExperience: null,
    hours: jsonValue(vendor.operating_hours, {}),
    website: vendor.website || null,
    verificationStatus: vendor.verification_status,
    description: vendor.description || '',
    address: vendor.address || '',
    notificationPreferences: jsonValue(vendor.notification_preferences, {}),
    bookingPreferences: jsonValue(vendor.booking_preferences, {}),
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
  ) || (
    req.path === '/account/password' && req.method === 'POST' && vendor.verification_status !== 'suspended'
  ) || (
    req.path === '/account' && req.method === 'PATCH' && vendor.verification_status !== 'suspended'
  ) || (
    req.path === '/media' && req.method === 'POST' && !req.query.serviceId
      && ['logo', 'cover', 'portfolio'].includes(req.query.type) && vendor.verification_status !== 'suspended'
  );
  if (vendor.verification_status !== 'verified' && !allowedWhileUnverified) {
    return res.status(403).json({ error: `Vendor access is unavailable while the account is ${vendor.verification_status.replaceAll('_', ' ')}.` });
  }
  next();
}));

getRoute('/overview', async (req, res) => {
  const userId = req.platformUser.id;
  const vendorId = req.vendor.id;
  const database = databaseFor(req);
  const [serviceRows, bookingRows, quotationRows, paymentRows, messageRows, availabilityRows, ratingRows, notificationRows] = await Promise.all([
    database.execute('SELECT id, status FROM services WHERE vendor_id = ?', [vendorId]),
    database.execute(
      `SELECT b.id, b.status, e.organizer_id, e.start_date
       FROM bookings b JOIN events e ON e.id = b.event_id WHERE b.vendor_id = ?`,
      [vendorId],
    ),
    database.execute('SELECT id, status FROM quotations WHERE vendor_id = ?', [vendorId]),
    database.execute(
      `SELECT p.status, p.amount
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.vendor_id = ?`,
      [vendorId]
    ),
    database.execute('SELECT id, read_at FROM messages WHERE recipient_id = ?', [userId]),
    database.execute("SELECT id FROM vendor_availability WHERE vendor_id = ? AND status = 'available' AND available_date >= CURDATE()", [vendorId]),
    database.execute(
      `SELECT r.rating FROM reviews r JOIN bookings b ON b.id = r.booking_id
       WHERE b.vendor_id = ? AND r.status = 'published'`,
      [vendorId]
    ),
    database.execute("SELECT id FROM notifications WHERE user_id = ? AND status <> 'read'", [userId]),
  ]);

  const services = serviceRows[0];
  const bookings = bookingRows[0];
  const quotations = quotationRows[0];
  const payments = paymentRows[0];
  const messages = messageRows[0];
  const ratings = ratingRows[0].map((row) => Number(row.rating || 0));
  const activeStatuses = new Set(['active']);
  const pendingStatuses = new Set(['requested', 'under_review', 'quoted']);
  const confirmedStatuses = new Set(['accepted', 'confirmed', 'in_progress']);

  return ok(res, {
    totalServices: services.length,
    activeServices: services.filter((service) => activeStatuses.has(service.status)).length,
    inactiveServices: services.filter((service) => !activeStatuses.has(service.status)).length,
    pendingBookings: bookings.filter((booking) => pendingStatuses.has(booking.status)).length,
    confirmedBookings: bookings.filter((booking) => confirmedStatuses.has(booking.status)).length,
    completedBookings: bookings.filter((booking) => booking.status === 'completed').length,
    totalBookings: bookings.length,
    totalCustomers: new Set(bookings.map((booking) => Number(booking.organizer_id))).size,
    upcomingBookings: bookings.filter((booking) => confirmedStatuses.has(booking.status)
      && new Date(String(booking.start_date).replace(' ', 'T')) >= new Date()).length,
    upcomingDates: availabilityRows[0].length,
    pendingQuotations: quotations.filter((quote) => ['draft', 'sent', 'revision_requested'].includes(quote.status)).length,
    totalEarnings: payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    pendingPayouts: payments.filter((payment) => ['pending', 'authorized'].includes(payment.status)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    averageRating: ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : 0,
    unreadMessages: messages.filter((message) => !message.read_at).length,
    notifications: notificationRows[0].length,
    unreadNotifications: notificationRows[0].length,
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
    address: 'address',
    description: 'description',
    serviceAreas: 'service_areas',
    operatingHours: 'operating_hours',
    website: 'website',
    notificationPreferences: 'notification_preferences',
    bookingPreferences: 'booking_preferences',
  };
  const fields = Object.keys(profileFields).filter((field) => parsed.data[field] !== undefined);

  await runTransaction(database, async (connection) => {
    if (fields.length) {
      await connection.execute(
        `UPDATE vendor_profiles SET ${fields.map((field) => `${profileFields[field]} = ?`).join(', ')} WHERE user_id = ?`,
        [...fields.map((field) => ['serviceAreas', 'operatingHours', 'notificationPreferences', 'bookingPreferences'].includes(field)
          ? JSON.stringify(parsed.data[field])
          : parsed.data[field]), req.platformUser.id]
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
    documents: documents.map((document) => ({
      ...document,
      downloadUrl: `/api/vendor/verification/documents/${Number(document.id)}`,
    })),
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

getRoute('/verification/documents/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Document ID is invalid.' });
  const [[document]] = await databaseFor(req).execute(
    `SELECT content, content_type, file_size
     FROM vendor_verification_documents WHERE id = ? AND vendor_id = ?`,
    [id.data, req.vendor.id],
  );
  if (!document) return res.status(404).json({ error: 'Verification document not found.' });
  res.set({
    'Content-Type': document.content_type,
    'Content-Length': document.file_size,
    'Content-Disposition': 'attachment',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(document.content);
});

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

getPermissionRoute('/services/:id/history', 'services.manage_own', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Service ID is invalid.' });
  const database = databaseFor(req);
  const [[service]] = await database.execute(
    'SELECT id FROM services WHERE id = ? AND vendor_id = ? LIMIT 1',
    [id.data, req.vendor.id],
  );
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  const [rows] = await database.execute(
    `SELECT id, action, details, created_at
     FROM audit_logs
     WHERE entity_type = 'service' AND entity_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    [String(id.data)],
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {},
    createdAt: row.created_at,
  })));
});

postPermissionRoute('/services', 'services.manage_own', async (req, res) => {
  const parsed = serviceFieldsSchema.safeParse(req.body || {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const database = databaseFor(req);
  const settings = await loadSystemSettings(database, ['platform_currency']);
  const currency = parsed.data.currency || settings.platform_currency;
  if (!await validateCategory(database, parsed.data.categoryId)) {
    return res.status(400).json({ error: 'Select an active service category.' });
  }
  if (parsed.data.status === 'active' && req.vendor.verification_status !== 'verified') {
    return res.status(409).json({ error: 'Vendor verification is required before publishing a service.' });
  }

  const result = await runTransaction(database, async (connection) => {
    const [created] = await connection.execute(
      `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.vendor.id, parsed.data.categoryId ?? null, parsed.data.title, parsed.data.description, parsed.data.price ?? null, currency, parsed.data.status],
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'service.created',
      entityType: 'service',
      entityId: Number(created.insertId),
      details: { title: parsed.data.title, status: parsed.data.status },
      ip: req.ip,
    });
    return created;
  });
  return res.status(201).json({
    success: true,
    data: {
      id: Number(result.insertId),
      vendorId: Number(req.vendor.id),
      title: parsed.data.title,
      description: parsed.data.description,
      categoryId: parsed.data.categoryId ?? null,
      price: parsed.data.price ?? null,
      currency,
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
  await runTransaction(database, async (connection) => {
    await connection.execute(
      `UPDATE services SET ${fields.map((field) => `${columns[field]} = ?`).join(', ')} WHERE id = ? AND vendor_id = ?`,
      [...fields.map((field) => parsed.data[field] === undefined ? null : parsed.data[field]), id.data, req.vendor.id],
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'service.updated',
      entityType: 'service',
      entityId: id.data,
      details: {
        fields,
        previousStatus: service.status,
        status: parsed.data.status || service.status,
      },
      ip: req.ip,
    });
  });
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
    await runTransaction(database, async (connection) => {
      await connection.execute(
        "UPDATE services SET status = 'archived' WHERE id = ? AND vendor_id = ?",
        [id.data, req.vendor.id],
      );
      await writeAudit(connection, {
        actorId: req.platformUser.id,
        action: 'service.archived',
        entityType: 'service',
        entityId: id.data,
        details: { previousStatus: service.status, status: 'archived' },
        ip: req.ip,
      });
    });
  }
  return res.status(204).end();
});

getRoute('/services/:serviceId/packages', async (req, res) => {
  const serviceId = z.coerce.number().int().positive().safeParse(req.params.serviceId);
  if (!serviceId.success) return res.status(400).json({ error: 'Service ID is invalid.' });
  const database = databaseFor(req);
  const [[service]] = await database.execute(
    'SELECT id FROM services WHERE id = ? AND vendor_id = ? LIMIT 1',
    [serviceId.data, req.vendor.id],
  );
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  const [rows] = await database.execute(
    `SELECT id, name, description, price, currency, included_features, extras,
            minimum_booking, is_active, created_at, updated_at
     FROM service_packages WHERE service_id = ? ORDER BY price, id`,
    [serviceId.data],
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    serviceId: serviceId.data,
    name: row.name,
    description: row.description || '',
    price: Number(row.price),
    currency: row.currency,
    includedFeatures: typeof row.included_features === 'string' ? JSON.parse(row.included_features) : row.included_features || [],
    extras: typeof row.extras === 'string' ? JSON.parse(row.extras) : row.extras || [],
    minimumBooking: Number(row.minimum_booking),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })));
});

getRoute('/packages', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT p.id, p.service_id, p.name, p.description, p.price, p.currency,
            p.included_features, p.extras, p.minimum_booking, p.is_active, s.title AS service_title
     FROM service_packages p JOIN services s ON s.id = p.service_id
     WHERE s.vendor_id = ? ORDER BY s.title, p.price, p.id`,
    [req.vendor.id],
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    serviceId: Number(row.service_id),
    serviceTitle: row.service_title,
    name: row.name,
    description: row.description || '',
    price: Number(row.price),
    currency: row.currency,
    includedFeatures: typeof row.included_features === 'string' ? JSON.parse(row.included_features) : row.included_features || [],
    extras: typeof row.extras === 'string' ? JSON.parse(row.extras) : row.extras || [],
    minimumBooking: Number(row.minimum_booking),
    isActive: Boolean(row.is_active),
  })));
});

postPermissionRoute('/services/:serviceId/packages', 'services.manage_own', async (req, res) => {
  const serviceId = z.coerce.number().int().positive().safeParse(req.params.serviceId);
  const parsed = servicePackageSchema.safeParse(req.body || {});
  if (!serviceId.success || !parsed.success) return parsed.success
    ? res.status(400).json({ error: 'Service ID is invalid.' })
    : sendValidationError(res, parsed.error);
  const database = databaseFor(req);
  const [[service]] = await database.execute(
    'SELECT id, currency FROM services WHERE id = ? AND vendor_id = ? LIMIT 1',
    [serviceId.data, req.vendor.id],
  );
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  const settings = await loadSystemSettings(database, ['platform_currency']);
  const [result] = await database.execute(
    `INSERT INTO service_packages
       (service_id, name, description, price, currency, included_features, extras, minimum_booking, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [serviceId.data, parsed.data.name, parsed.data.description || null, parsed.data.price,
      parsed.data.currency || service.currency || settings.platform_currency,
      JSON.stringify(parsed.data.includedFeatures), JSON.stringify(parsed.data.extras),
      parsed.data.minimumBooking, parsed.data.isActive],
  );
  await writeAudit(database, {
    actorId: req.platformUser.id,
    action: 'vendor.service_package_created',
    entityType: 'service',
    entityId: serviceId.data,
    details: { packageId: Number(result.insertId), name: parsed.data.name },
    ip: req.ip,
  });
  res.status(201).json({ data: { id: Number(result.insertId), serviceId: serviceId.data, ...parsed.data, currency: parsed.data.currency || service.currency || settings.platform_currency } });
});

patchPermissionRoute('/services/:serviceId/packages/:packageId', 'services.manage_own', async (req, res) => {
  const serviceId = z.coerce.number().int().positive().safeParse(req.params.serviceId);
  const packageId = z.coerce.number().int().positive().safeParse(req.params.packageId);
  const parsed = servicePackageSchema.partial().safeParse(req.body || {});
  if (!serviceId.success || !packageId.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Package details are invalid.' });
  if (!Object.keys(parsed.data).length) return res.status(400).json({ error: 'Provide at least one package change.' });
  const fields = {
    name: 'name', description: 'description', price: 'price', currency: 'currency',
    includedFeatures: 'included_features', extras: 'extras', minimumBooking: 'minimum_booking', isActive: 'is_active',
  };
  const values = Object.entries(parsed.data).map(([field, value]) => [
    fields[field], ['includedFeatures', 'extras'].includes(field) ? JSON.stringify(value) : value,
  ]);
  const [result] = await databaseFor(req).execute(
    `UPDATE service_packages SET ${values.map(([field]) => `${field} = ?`).join(', ')}
     WHERE id = ? AND service_id = ? AND service_id IN (SELECT id FROM services WHERE vendor_id = ?)`,
    [...values.map(([, value]) => value), packageId.data, serviceId.data, req.vendor.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Service package not found.' });
  res.json({ data: { id: packageId.data, serviceId: serviceId.data, ...parsed.data } });
});

deletePermissionRoute('/services/:serviceId/packages/:packageId', 'services.manage_own', async (req, res) => {
  const serviceId = z.coerce.number().int().positive().safeParse(req.params.serviceId);
  const packageId = z.coerce.number().int().positive().safeParse(req.params.packageId);
  if (!serviceId.success || !packageId.success) return res.status(400).json({ error: 'Package ID is invalid.' });
  const [result] = await databaseFor(req).execute(
    `DELETE p FROM service_packages p JOIN services s ON s.id = p.service_id
     WHERE p.id = ? AND p.service_id = ? AND s.vendor_id = ?`,
    [packageId.data, serviceId.data, req.vendor.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Service package not found.' });
  res.status(204).end();
});

getRoute('/media', async (req, res) => {
  const serviceId = req.query.serviceId ? z.coerce.number().int().positive().safeParse(req.query.serviceId) : null;
  if (serviceId && !serviceId.success) return res.status(400).json({ error: 'Service ID is invalid.' });
  const values = [req.vendor.id];
  const serviceFilter = serviceId ? ' AND service_id = ?' : '';
  if (serviceId) values.push(serviceId.data);
  const [rows] = await databaseFor(req).execute(
    `SELECT id, service_id, media_type, original_name, content_type, file_size, created_at
     FROM vendor_media WHERE vendor_id = ?${serviceFilter} ORDER BY created_at DESC, id DESC`,
    values,
  );
  res.json({ data: rows.map((row) => ({
    id: Number(row.id),
    serviceId: row.service_id === null ? null : Number(row.service_id),
    type: row.media_type,
    name: row.original_name,
    contentType: row.content_type,
    fileSize: Number(row.file_size),
    createdAt: row.created_at,
  })) });
});

router.post('/media', vendorMediaParser, asyncHandler(async (req, res) => {
  const parsed = z.object({
    type: z.enum(['logo', 'cover', 'portfolio', 'service']),
    serviceId: z.coerce.number().int().positive().optional(),
    filename: z.string().trim().min(1).max(180).optional(),
  }).strict().safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Image upload details are invalid.' });
  if (parsed.data.type === 'service' !== Boolean(parsed.data.serviceId)) {
    return res.status(400).json({ error: 'Select a service for service images only.' });
  }
  const contentType = String(req.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  const validation = validateProfilePhoto(contentType, req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  const database = databaseFor(req);
  if (parsed.data.serviceId) {
    const [services] = await database.execute(
      'SELECT id FROM services WHERE id = ? AND vendor_id = ?',
      [parsed.data.serviceId, req.vendor.id],
    );
    if (!services.length) return res.status(404).json({ error: 'Service not found.' });
  }
  const originalName = (parsed.data.filename || `${parsed.data.type}-image`).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180);
  const [result] = await database.execute(
    `INSERT INTO vendor_media (vendor_id, service_id, media_type, original_name, content_type, file_size, content)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.vendor.id, parsed.data.serviceId || null, parsed.data.type, originalName, contentType, req.body.length, req.body],
  );
  await writeAudit(database, {
    actorId: req.platformUser.id,
    action: 'vendor.media_uploaded',
    entityType: parsed.data.serviceId ? 'service' : 'vendor',
    entityId: parsed.data.serviceId || req.vendor.id,
    details: { mediaId: Number(result.insertId), type: parsed.data.type, fileSize: req.body.length },
    ip: req.ip,
  });
  res.status(201).json({ data: { id: Number(result.insertId), serviceId: parsed.data.serviceId || null, type: parsed.data.type, name: originalName, contentType, fileSize: req.body.length } });
}));

getRoute('/media/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Media ID is invalid.' });
  const [[media]] = await databaseFor(req).execute(
    'SELECT content, content_type, file_size FROM vendor_media WHERE id = ? AND vendor_id = ? LIMIT 1',
    [id.data, req.vendor.id],
  );
  if (!media) return res.status(404).json({ error: 'Image not found.' });
  res.set({ 'Content-Type': media.content_type, 'Content-Length': media.file_size, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(media.content);
});

deleteRoute('/media/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Media ID is invalid.' });
  const [result] = await databaseFor(req).execute('DELETE FROM vendor_media WHERE id = ? AND vendor_id = ?', [id.data, req.vendor.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Image not found.' });
  res.status(204).end();
});

getRoute('/categories', async (req, res) => {
  const [rows] = await databaseFor(req).query(
    'SELECT id, name, description, display_order, is_active FROM service_categories WHERE is_active = TRUE ORDER BY display_order ASC, name ASC',
  );
  return ok(res, rows.map((row) => ({ id: Number(row.id), name: row.name, description: row.description || '', active: Boolean(row.is_active) })));
});

getRoute('/pricing', async (req, res) => {
  const database = databaseFor(req);
  const [rows] = await database.execute(
    `SELECT p.id, p.service_id, p.name, p.description, p.price, p.currency,
            p.included_features, p.extras, p.minimum_booking, p.is_active, s.title AS service_title
     FROM service_packages p JOIN services s ON s.id = p.service_id
     WHERE s.vendor_id = ? ORDER BY p.price ASC, p.id`,
    [req.vendor.id]
  );
  const settings = await loadSystemSettings(database, ['platform_currency']);
  const prices = rows.map((row) => Number(row.price || 0)).filter((price) => price > 0);
  return ok(res, {
    currency: rows[0]?.currency || settings.platform_currency,
    basePrice: prices.length ? Math.min(...prices) : 0,
    packages: rows.map((row) => ({
      id: Number(row.id),
      serviceId: Number(row.service_id),
      serviceTitle: row.service_title,
      name: row.name,
      description: row.description || '',
      price: Number(row.price || 0),
      currency: row.currency,
      includedFeatures: typeof row.included_features === 'string' ? JSON.parse(row.included_features) : row.included_features || [],
      extras: typeof row.extras === 'string' ? JSON.parse(row.extras) : row.extras || [],
      minimumBooking: Number(row.minimum_booking),
      isActive: Boolean(row.is_active),
    })),
  });
});

getRoute('/availability', async (req, res) => {
  const database = databaseFor(req);
  const [[rows], [bookingRows]] = await Promise.all([
    database.execute(
      'SELECT available_date, status, note FROM vendor_availability WHERE vendor_id = ? ORDER BY available_date ASC',
      [req.vendor.id],
    ),
    database.execute(
      `SELECT b.id, DATE(COALESCE(b.scheduled_date, e.start_date)) AS available_date,
              e.title AS event_title, b.service_description
       FROM bookings b JOIN events e ON e.id = b.event_id
       WHERE b.vendor_id = ? AND b.status IN ('accepted', 'confirmed', 'in_progress')
       ORDER BY available_date ASC`,
      [req.vendor.id],
    ),
  ]);
  const schedule = new Map(rows.map((row) => [String(row.available_date).slice(0, 10), {
    date: String(row.available_date).slice(0, 10),
    status: row.status,
    note: row.note || '',
  }]));
  for (const booking of bookingRows) {
    const date = String(booking.available_date).slice(0, 10);
    schedule.set(date, {
      ...(schedule.get(date) || {}),
      date,
      status: 'booked',
      note: booking.event_title,
      bookingId: Number(booking.id),
      service: booking.service_description,
    });
  }
  return ok(res, {
    schedule: [...schedule.values()].sort((left, right) => left.date.localeCompare(right.date)),
    businessHours: req.vendor.operating_hours || {},
  });
});

const availabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['available', 'blocked']),
  note: z.string().trim().max(255).optional().default(''),
}).strict();

async function validateAvailabilityDate(database, vendorId, date) {
  const [rows] = await database.execute(
    `SELECT b.id FROM bookings b JOIN events e ON e.id = b.event_id
     WHERE b.vendor_id = ? AND b.status IN ('accepted', 'confirmed', 'in_progress')
       AND DATE(COALESCE(b.scheduled_date, e.start_date)) = ? LIMIT 1`,
    [vendorId, date],
  );
  return rows.length === 0;
}

postRoute('/availability', async (req, res) => {
  const parsed = availabilitySchema.safeParse(req.body || {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const date = new Date(`${parsed.data.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed.data.date) {
    return res.status(400).json({ error: 'Enter a valid calendar date.' });
  }
  if (parsed.data.date < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Past availability dates cannot be changed.' });
  const database = databaseFor(req);
  if (!await validateAvailabilityDate(database, req.vendor.id, parsed.data.date)) {
    return res.status(409).json({ error: 'A confirmed booking already reserves this date.' });
  }
  await database.execute(
    `INSERT INTO vendor_availability (vendor_id, available_date, status, note)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note)`,
    [req.vendor.id, parsed.data.date, parsed.data.status, parsed.data.note || null],
  );
  return res.status(201).json({ data: { date: parsed.data.date, status: parsed.data.status, note: parsed.data.note } });
});

patchRoute('/availability/:date', async (req, res) => {
  const parsed = availabilitySchema.safeParse({ ...req.body, date: req.params.date });
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const database = databaseFor(req);
  if (!await validateAvailabilityDate(database, req.vendor.id, parsed.data.date)) {
    return res.status(409).json({ error: 'A confirmed booking already reserves this date.' });
  }
  const [result] = await database.execute(
    'UPDATE vendor_availability SET status = ?, note = ? WHERE vendor_id = ? AND available_date = ?',
    [parsed.data.status, parsed.data.note || null, req.vendor.id, parsed.data.date],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Availability record not found.' });
  res.json({ data: { date: parsed.data.date, status: parsed.data.status, note: parsed.data.note } });
});

deleteRoute('/availability/:date', async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(req.params.date);
  if (!date.success) return res.status(400).json({ error: 'A valid availability date is required.' });
  if (!await validateAvailabilityDate(databaseFor(req), req.vendor.id, date.data)) {
    return res.status(409).json({ error: 'A confirmed booking already reserves this date.' });
  }
  const [result] = await databaseFor(req).execute(
    'DELETE FROM vendor_availability WHERE vendor_id = ? AND available_date = ?',
    [req.vendor.id, date.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Availability record not found.' });
  res.status(204).end();
});

getRoute('/booking-requests', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            e.title AS event_title, e.city, e.venue, e.guest_count, e.notes AS event_notes,
            DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
            u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
            (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status
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
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    event: row.event_title,
    date: row.event_start_date,
    eventLocation: [row.venue, row.city].filter(Boolean).join(', '),
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
    requirements: row.event_notes || '',
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
    paymentStatus: row.payment_status || 'unpaid',
  })));
});

getRoute('/bookings', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            e.title AS event_title, e.city, e.venue, e.guest_count, e.notes AS event_notes,
            DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
            u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
            (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status
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
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    event: row.event_title,
    service: row.service_description,
    eventLocation: [row.venue, row.city].filter(Boolean).join(', '),
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
    requirements: row.event_notes || '',
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
    date: row.event_start_date,
    paymentStatus: row.payment_status || 'unpaid',
  })));
});

getRoute('/history', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            e.title AS event_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
            u.full_name AS customer_name,
            (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status
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
    event: row.event_title,
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
    date: row.event_start_date,
    paymentStatus: row.payment_status || 'unpaid',
  })));
});

getRoute('/tasks', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT t.id, t.event_id, t.booking_id, t.title, t.details, t.due_at, t.status,
            t.created_at, t.updated_at, e.title AS event_title, b.service_description,
            organizer.full_name AS organizer_name
     FROM event_vendor_tasks t
     JOIN bookings b ON b.id = t.booking_id
     JOIN events e ON e.id = t.event_id
     JOIN users organizer ON organizer.id = e.organizer_id
     WHERE b.vendor_id = ? ORDER BY t.due_at IS NULL, t.due_at, t.id DESC`,
    [req.vendor.id],
  );
  return ok(res, rows.map((row) => ({
    ...row,
    id: Number(row.id),
    eventId: Number(row.event_id),
    bookingId: Number(row.booking_id),
  })));
});

patchRoute('/tasks/:id/status', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({ status: z.enum(['in_progress', 'completed', 'blocked']) }).strict().safeParse(req.body || {});
  if (!id.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Task status is invalid.' });
  const database = databaseFor(req);
  const [[task]] = await database.execute(
    `SELECT t.id, t.title, t.status, e.id AS event_id, e.title AS event_title, e.organizer_id
     FROM event_vendor_tasks t
     JOIN bookings b ON b.id = t.booking_id
     JOIN events e ON e.id = t.event_id
     WHERE t.id = ? AND b.vendor_id = ? LIMIT 1`,
    [id.data, req.vendor.id],
  );
  if (!task) return res.status(404).json({ error: 'Vendor task not found.' });
  if (task.status === parsed.data.status) return res.json({ data: { id: id.data, status: task.status } });
  await runTransaction(database, async (connection) => {
    await connection.execute('UPDATE event_vendor_tasks SET status = ? WHERE id = ?', [parsed.data.status, id.data]);
    await createNotification(connection, {
      userId: task.organizer_id,
      title: 'Vendor task updated',
      message: `${task.event_title}: ${task.title} is ${parsed.data.status.replaceAll('_', ' ')}.`,
      type: 'event',
      relatedType: 'event',
      relatedId: task.event_id,
      actorId: req.platformUser.id,
    });
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'vendor.task_status_updated',
      entityType: 'event',
      entityId: task.event_id,
      details: { taskId: id.data, previousStatus: task.status, status: parsed.data.status },
      ip: req.ip,
    });
  });
  res.json({ data: { id: id.data, status: parsed.data.status } });
});

getRoute('/quotations', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT q.id, q.service_id, q.service_description, q.amount, q.currency, q.status, q.valid_until,
            q.requested_event_name, q.requested_date, q.requested_location, q.guest_count, q.budget,
            q.requested_event_type, q.requested_phone, q.required_services, q.additional_requirements,
            q.request_message,
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
    serviceId: row.service_id === null ? null : Number(row.service_id),
    customer: row.customer_name || 'Customer pending',
    event: row.requested_event_name || row.event_title || null,
    eventDate: row.requested_date || null,
    eventLocation: row.requested_location || null,
    eventType: row.requested_event_type || null,
    contactPhone: row.requested_phone || null,
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
    budget: row.budget === null ? null : Number(row.budget),
    requiredServices: row.required_services || '',
    additionalRequirements: row.additional_requirements || '',
    requestMessage: row.request_message || '',
    service: row.service_description,
    status: statusLabel(row.status),
    validUntil: row.valid_until,
    amount: Number(row.amount || 0),
    currency: row.currency,
    notes: row.notes || '',
  })));
});

getRoute('/payments', async (req, res) => {
  const database = databaseFor(req);
  const [rows, refundRows] = await Promise.all([
    database.execute(
      `SELECT p.id, p.booking_id, p.amount, p.currency, p.provider, p.provider_reference,
              p.status, p.created_at
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.vendor_id = ? ORDER BY p.created_at DESC`,
      [req.vendor.id],
    ),
    database.execute(
      `SELECT rr.id, rr.payment_id, rr.amount, rr.currency, rr.reason, rr.status,
              rr.decision_reason, rr.created_at, rr.decided_at
       FROM refund_requests rr
       JOIN payments p ON p.id = rr.payment_id
       JOIN bookings b ON b.id = p.booking_id
       WHERE b.vendor_id = ? ORDER BY rr.created_at DESC`,
      [req.vendor.id],
    ),
  ]);
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
    refunds: refundRows.map((row) => ({
      id: Number(row.id),
      paymentId: Number(row.payment_id),
      amount: Number(row.amount),
      currency: row.currency,
      reason: row.reason,
      status: row.status,
      decisionReason: row.decision_reason || null,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    })),
  });
});

getRoute('/messages', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT m.id, m.booking_id, m.sender_id, m.recipient_id, m.body, m.read_at, m.created_at,
            u.full_name AS sender, e.id AS event_id, e.title AS event_title
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     JOIN bookings b ON b.id = m.booking_id
     JOIN events e ON e.id = b.event_id
     WHERE b.vendor_id = ? AND (m.recipient_id = ? OR m.sender_id = ?)
     ORDER BY m.created_at DESC`,
    [req.vendor.id, req.platformUser.id, req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    senderId: Number(row.sender_id),
    recipientId: Number(row.recipient_id),
    sender: row.sender,
    eventId: Number(row.event_id),
    event: row.event_title,
    body: row.body,
    unread: !row.read_at,
    createdAt: row.created_at,
  })));
});

postRoute('/messages', async (req, res) => {
  const parsed = z.object({
    bookingId: z.coerce.number().int().positive(),
    body: z.string().trim().min(1).max(4000),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const database = databaseFor(req);
  const [[booking]] = await database.execute(
    `SELECT b.id, e.organizer_id, e.title AS event_title
     FROM bookings b JOIN events e ON e.id = b.event_id
     WHERE b.id = ? AND b.vendor_id = ? AND b.status NOT IN ('cancelled', 'rejected') LIMIT 1`,
    [parsed.data.bookingId, req.vendor.id],
  );
  if (!booking) return res.status(404).json({ error: 'Active booking not found.' });
  const messageId = await runTransaction(database, async (connection) => {
    const [result] = await connection.execute(
      'INSERT INTO messages (sender_id, recipient_id, booking_id, subject, body) VALUES (?, ?, ?, ?, ?)',
      [req.platformUser.id, booking.organizer_id, booking.id, `Update: ${booking.event_title}`.slice(0, 180), parsed.data.body],
    );
    await createNotification(connection, {
      userId: booking.organizer_id,
      title: 'New vendor message',
      message: `New message about ${booking.event_title}.`,
      type: 'booking',
      relatedType: 'booking',
      relatedId: booking.id,
      actorId: req.platformUser.id,
    });
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'vendor.message_sent',
      entityType: 'booking',
      entityId: booking.id,
      details: { messageId: Number(result.insertId) },
      ip: req.ip,
    });
    return Number(result.insertId);
  });
  res.status(201).json({ data: { id: messageId, bookingId: Number(booking.id), event: booking.event_title } });
});

postRoute('/messages/:id/read', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid message ID is required.' });
  const [result] = await databaseFor(req).execute(
    `UPDATE messages m JOIN bookings b ON b.id = m.booking_id
     SET m.read_at = COALESCE(m.read_at, NOW())
     WHERE m.id = ? AND m.recipient_id = ? AND b.vendor_id = ?`,
    [id.data, req.platformUser.id, req.vendor.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Message not found.' });
  res.json({ data: { id: id.data, read: true } });
});

getRoute('/reviews', async (req, res) => {
  const [rows] = await databaseFor(req).execute(
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

postRoute('/reviews/:id/report', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).strict().safeParse(req.body || {});
  if (!id.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'A valid report reason is required.' });
  const database = databaseFor(req);
  const [[review]] = await database.execute(
    `SELECT r.id, b.id AS booking_id FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     WHERE r.id = ? AND b.vendor_id = ? LIMIT 1`,
    [id.data, req.vendor.id],
  );
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  await runTransaction(database, async (connection) => {
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'vendor.review_reported',
      entityType: 'review',
      entityId: id.data,
      details: { reason: parsed.data.reason },
      ip: req.ip,
    });
    await notifyAdministrators(connection, {
      title: 'Vendor reported a review',
      message: `Review #${id.data} was reported for administrator review.`,
      type: 'review',
      relatedType: 'review',
      relatedId: id.data,
      idempotencyKey: `vendor-review-report:${id.data}:${req.platformUser.id}`,
      actorId: req.platformUser.id,
    });
  });
  res.status(202).json({ data: { id: id.data, status: 'reported' } });
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
  const changed = await runTransaction(database, async (connection) => {
    const [result] = await connection.execute(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ? AND status <> 'read'`,
      [id.data, req.platformUser.id],
    );
    if (result.affectedRows) {
      await connection.execute(
        "INSERT INTO notification_history (notification_id, actor_id, action) VALUES (?, ?, 'read')",
        [id.data, req.platformUser.id],
      );
      return true;
    }
    const [rows] = await connection.execute('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [id.data, req.platformUser.id]);
    return rows.length > 0;
  });
  if (!changed) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ data: { id: id.data, read: true } });
});

postRoute('/notifications/read-all', async (req, res) => {
  const database = databaseFor(req);
  const changed = await runTransaction(database, async (connection) => {
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

getRoute('/reports', async (req, res) => {
  const parsed = z.object({
    serviceId: z.coerce.number().int().positive().optional(),
    status: z.enum(['requested', 'under_review', 'quoted', 'accepted', 'completed', 'rejected', 'cancelled']).optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict().safeParse(req.query);
  const isValidDate = (value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!parsed.success || parsed.data.dateFrom && !isValidDate(parsed.data.dateFrom)
    || parsed.data.dateTo && !isValidDate(parsed.data.dateTo)
    || parsed.data.dateFrom && parsed.data.dateTo && parsed.data.dateFrom > parsed.data.dateTo) {
    return res.status(400).json({ error: 'Report filters are invalid.' });
  }
  const database = databaseFor(req);
  if (parsed.data.serviceId) {
    const [owned] = await database.execute('SELECT id FROM services WHERE id = ? AND vendor_id = ?', [parsed.data.serviceId, req.vendor.id]);
    if (!owned.length) return res.status(404).json({ error: 'Service not found.' });
  }
  const bookingConditions = ['b.vendor_id = ?'];
  const bookingValues = [req.vendor.id];
  if (parsed.data.serviceId) {
    bookingConditions.push('b.service_id = ?');
    bookingValues.push(parsed.data.serviceId);
  }
  if (parsed.data.status) {
    bookingConditions.push('b.status = ?');
    bookingValues.push(parsed.data.status);
  }
  if (parsed.data.dateFrom) {
    bookingConditions.push('e.start_date >= ?');
    bookingValues.push(`${parsed.data.dateFrom} 00:00:00`);
  }
  if (parsed.data.dateTo) {
    bookingConditions.push('e.start_date < DATE_ADD(?, INTERVAL 1 DAY)');
    bookingValues.push(parsed.data.dateTo);
  }
  const paymentConditions = ['b.vendor_id = ?', "p.status = 'paid'"];
  const paymentValues = [req.vendor.id];
  if (parsed.data.serviceId) {
    paymentConditions.push('b.service_id = ?');
    paymentValues.push(parsed.data.serviceId);
  }
  if (parsed.data.dateFrom) {
    paymentConditions.push('p.created_at >= ?');
    paymentValues.push(`${parsed.data.dateFrom} 00:00:00`);
  }
  if (parsed.data.dateTo) {
    paymentConditions.push('p.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    paymentValues.push(parsed.data.dateTo);
  }
  const [serviceRows, bookingRows, paymentRows] = await Promise.all([
    database.execute('SELECT id, title FROM services WHERE vendor_id = ?', [req.vendor.id]),
    database.execute(
      `SELECT b.status, b.service_description
       FROM bookings b JOIN events e ON e.id = b.event_id
       WHERE ${bookingConditions.join(' AND ')}`,
      bookingValues,
    ),
    database.execute(
      `SELECT DATE_FORMAT(p.created_at, '%Y-%m') AS month, SUM(p.amount) AS total
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE ${paymentConditions.join(' AND ')}
       GROUP BY DATE_FORMAT(p.created_at, '%Y-%m') ORDER BY month ASC`,
      paymentValues,
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

patchRoute('/account', async (req, res) => {
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(40).optional().default(''),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  await databaseFor(req).execute(
    'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
    [parsed.data.fullName, parsed.data.phone || null, req.platformUser.id],
  );
  await writeAudit(databaseFor(req), {
    actorId: req.platformUser.id,
    action: 'vendor.account_updated',
    entityType: 'user',
    entityId: req.platformUser.id,
    details: { fields: ['full_name', 'phone'] },
    ip: req.ip,
  });
  res.json({ data: { fullName: parsed.data.fullName, email: req.platformUser.email, phone: parsed.data.phone || null, role: 'Vendor' } });
});

postRoute('/account/password', async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(16).refine(isStrongPassword),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Provide your current password and a 12–16 character new password with uppercase, lowercase, and a number.' });
  if (parsed.data.currentPassword === parsed.data.newPassword) return res.status(400).json({ error: 'Choose a new password different from your current password.' });
  const database = databaseFor(req);
  const currentTokenHash = hashToken(req.cookies.platform_session);
  try {
    await runTransaction(database, async (connection) => {
      const [[account]] = await connection.execute('SELECT password_hash FROM users WHERE id = ? FOR UPDATE', [req.platformUser.id]);
      if (!account || !await bcrypt.compare(parsed.data.currentPassword, account.password_hash)) {
        throw Object.assign(new Error('The current password is incorrect.'), { status: 400 });
      }
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.platformUser.id]);
      await connection.execute(
        'DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?',
        [req.platformUser.id, currentTokenHash],
      );
      await writeAudit(connection, {
        actorId: req.platformUser.id,
        action: 'vendor.password_changed',
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
