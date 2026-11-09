import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { requirePermission } from '../middleware/rbac.js';
import { hashToken } from '../lib/security.js';
import { isStrongPassword } from '../lib/authFlow.js';
import { MAX_PROFILE_PHOTO_BYTES, validateProfilePhoto } from '../lib/profilePhoto.js';
import {
  MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES,
  sanitizeVendorDocumentName,
  validateVendorVerificationDocument,
  VENDOR_VERIFICATION_DOCUMENT_TYPES,
} from '../lib/vendorVerificationDocuments.js';

const verificationUpload = express.raw({
  type: [...VENDOR_VERIFICATION_DOCUMENT_TYPES],
  limit: MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES,
});
const mediaUpload = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: MAX_PROFILE_PHOTO_BYTES,
});

const profilePatchSchema = z.object({
  businessName: z.string().trim().min(2).max(160).optional(),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
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
const validPrice = z.number().finite().min(0).max(9999999999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Prices may have at most two decimal places.');
const serviceSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(10000).optional().default(''),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  price: validPrice.nullable().optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  status: z.enum(['draft', 'active']).optional().default('draft'),
}).strict();
const packageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().default(''),
  price: validPrice,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  includedFeatures: z.array(z.string().trim().min(1).max(160)).max(30).optional().default([]),
  minimumBooking: z.coerce.number().int().min(1).max(100000).optional().default(1),
  extras: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional().default(''),
    price: validPrice,
  }).strict()).max(30).optional().default([]),
  isActive: z.boolean().optional().default(true),
}).strict();

const statusLabels = {
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
};
const labelStatus = (value) => statusLabels[value] || value;
const parseId = (value) => z.coerce.number().int().positive().safeParse(value);
const respond = (res, data) => res.json({ success: true, data });

function wrapAsyncRoutes(router) {
  for (const method of ['get', 'post', 'patch', 'delete']) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) => register(
      path,
      ...handlers.map((handler) => asyncHandler(handler)),
    );
  }
}

function validationError(res, error) {
  return res.status(400).json({
    error: 'Invalid request data.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status, expose: true });
}

async function loadVendor(database, userId) {
  const result = await database.query(
    `SELECT vp.id, vp.user_id, vp.business_name, vp.category_id, vp.city, vp.address,
            vp.service_areas, vp.operating_hours, vp.website, vp.notification_preferences,
            vp.booking_preferences, vp.description, vp.verification_status,
            vp.verification_reason, vp.verified_at, vp.created_at,
            sc.name AS category_name, u.full_name, u.email, u.phone, u.status
     FROM vendor_profiles vp
     JOIN users u ON u.id = vp.user_id
     LEFT JOIN service_categories sc ON sc.id = vp.category_id
     WHERE vp.user_id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

function profileResponse(vendor) {
  return {
    businessName: vendor.business_name,
    categoryId: vendor.category_id === null ? null : Number(vendor.category_id),
    logo: null,
    businessType: vendor.category_name || 'Event services',
    serviceLocation: vendor.city || 'Not set',
    phone: vendor.phone || null,
    email: vendor.email,
    serviceAreas: vendor.service_areas || (vendor.city ? [vendor.city] : []),
    yearsOfExperience: null,
    hours: vendor.operating_hours || {},
    website: vendor.website || null,
    verificationStatus: vendor.verification_status,
    description: vendor.description || '',
    address: vendor.address || '',
    notificationPreferences: vendor.notification_preferences || {},
    bookingPreferences: vendor.booking_preferences || {},
  };
}

async function writeAudit(database, req, { actorId, action, entityType, entityId, details }) {
  await database.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [actorId, action, entityType, String(entityId), JSON.stringify(details || {}), req.ip || null],
  );
}

async function notify(database, { userId, title, message, type, relatedType, relatedId, actorId }) {
  if (!userId || Number(userId) === Number(actorId)) return;
  const result = await database.query(
    `INSERT INTO notifications
       (user_id, title, message, notification_type, related_entity_type, related_entity_id,
        idempotency_key, delivery_channel, delivery_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_app', 'delivered')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [userId, title, message, type, relatedType, String(relatedId), `vendor:${type}:${relatedId}:${actorId}:${Date.now()}`],
  );
  if (result.rows[0]) {
    await database.query(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES ($1, $2, 'created', $3::jsonb)`,
      [result.rows[0].id, actorId, JSON.stringify({ source: type, channel: 'in_app' })],
    );
  }
}

export function createPostgresVendorRouter({ database }) {
  const router = Router();
  wrapAsyncRoutes(router);

  router.use(requirePlatformUser);
  router.use(async (req, res, next) => {
    if (req.platformUser.role !== 'vendor') return res.status(403).json({ error: 'Vendor access is required.' });
    try {
      const vendor = await loadVendor(database, req.platformUser.id);
      if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
      req.vendor = vendor;
      if (vendor.verification_status !== 'verified' && req.method !== 'GET') {
        const canUpdateProfile = req.path === '/profile' && req.method === 'PATCH'
          && vendor.verification_status !== 'suspended';
        const canUpdateAccount = req.path === '/account' && req.method === 'PATCH'
          && vendor.verification_status !== 'suspended';
        const canChangePassword = req.path === '/account/password' && req.method === 'POST'
          && vendor.verification_status !== 'suspended';
        const canUploadVerification = req.path === '/verification/documents' && req.method === 'POST'
          && ['pending', 'under_review', 'information_requested'].includes(vendor.verification_status);
        const canUploadBusinessMedia = req.path === '/media' && req.method === 'POST'
          && !req.query.serviceId && ['logo', 'cover', 'portfolio'].includes(req.query.type)
          && vendor.verification_status !== 'suspended';
        if (!canUpdateProfile && !canUpdateAccount && !canChangePassword
          && !canUploadVerification && !canUploadBusinessMedia) {
          return res.status(403).json({
            error: `Vendor access is unavailable while the account is ${vendor.verification_status.replaceAll('_', ' ')}.`,
          });
        }
      }
      return next();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/overview', async (req, res) => {
    const vendorId = req.vendor.id;
    const userId = req.platformUser.id;
    const result = await database.query(
      `SELECT
         (SELECT COUNT(*) FROM services WHERE vendor_id = $1) AS total_services,
         (SELECT COUNT(*) FROM services WHERE vendor_id = $1 AND status = 'active') AS active_services,
         (SELECT COUNT(*) FROM services WHERE vendor_id = $1 AND status <> 'active') AS inactive_services,
         (SELECT COUNT(*) FROM bookings b
          WHERE b.vendor_id = $1 AND b.status IN ('requested', 'under_review', 'quoted')) AS pending_bookings,
         (SELECT COUNT(*) FROM bookings b
          WHERE b.vendor_id = $1 AND b.status IN ('accepted', 'confirmed', 'in_progress')) AS confirmed_bookings,
         (SELECT COUNT(*) FROM bookings WHERE vendor_id = $1 AND status = 'completed') AS completed_bookings,
         (SELECT COUNT(*) FROM bookings WHERE vendor_id = $1) AS total_bookings,
         (SELECT COUNT(DISTINCT e.organizer_id)
          FROM bookings b JOIN events e ON e.id = b.event_id WHERE b.vendor_id = $1) AS total_customers,
         (SELECT COUNT(*) FROM bookings b JOIN events e ON e.id = b.event_id
          WHERE b.vendor_id = $1 AND b.status IN ('accepted', 'confirmed', 'in_progress')
            AND e.start_date >= NOW()) AS upcoming_bookings,
         (SELECT COUNT(*) FROM vendor_availability
          WHERE vendor_id = $1 AND status = 'available' AND available_date >= CURRENT_DATE) AS upcoming_dates,
         (SELECT COUNT(*) FROM quotations
          WHERE vendor_id = $1 AND status IN ('draft', 'sent', 'revision_requested')) AS pending_quotations,
         COALESCE((SELECT SUM(p.amount) FROM payments p
          JOIN bookings b ON b.id = p.booking_id
          WHERE b.vendor_id = $1 AND p.status = 'paid'), 0) AS total_earnings,
         COALESCE((SELECT SUM(p.amount) FROM payments p
          JOIN bookings b ON b.id = p.booking_id
          WHERE b.vendor_id = $1 AND p.status IN ('pending', 'authorized')), 0) AS pending_payouts,
         COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 2)
          FROM reviews r JOIN bookings b ON b.id = r.booking_id
          WHERE b.vendor_id = $1 AND r.status = 'published'), 0) AS average_rating,
         (SELECT COUNT(*) FROM messages WHERE recipient_id = $2 AND read_at IS NULL) AS unread_messages,
         (SELECT COUNT(*) FROM notifications WHERE user_id = $2 AND status <> 'read') AS unread_notifications`,
      [vendorId, userId],
    );
    const summary = result.rows[0];
    if (!summary) throw new Error('PostgreSQL vendor overview query returned no result.');
    return respond(res, {
      totalServices: Number(summary.total_services),
      activeServices: Number(summary.active_services),
      inactiveServices: Number(summary.inactive_services),
      pendingBookings: Number(summary.pending_bookings),
      confirmedBookings: Number(summary.confirmed_bookings),
      completedBookings: Number(summary.completed_bookings),
      totalBookings: Number(summary.total_bookings),
      totalCustomers: Number(summary.total_customers),
      upcomingBookings: Number(summary.upcoming_bookings),
      upcomingDates: Number(summary.upcoming_dates),
      pendingQuotations: Number(summary.pending_quotations),
      totalEarnings: Number(summary.total_earnings),
      pendingPayouts: Number(summary.pending_payouts),
      averageRating: Number(summary.average_rating),
      unreadMessages: Number(summary.unread_messages),
      notifications: Number(summary.unread_notifications),
      unreadNotifications: Number(summary.unread_notifications),
    });
  });

  router.get('/profile', (req, res) => respond(res, profileResponse(req.vendor)));
  router.patch('/profile', async (req, res) => {
    const parsed = profilePatchSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed.error);
    const fields = {
      businessName: ['business_name', false],
      categoryId: ['category_id', false],
      city: ['city', false],
      address: ['address', false],
      description: ['description', false],
      serviceAreas: ['service_areas', true],
      operatingHours: ['operating_hours', true],
      website: ['website', false],
      notificationPreferences: ['notification_preferences', true],
      bookingPreferences: ['booking_preferences', true],
    };
    const selected = Object.keys(fields).filter((key) => parsed.data[key] !== undefined);
    if (!selected.length && parsed.data.phone === undefined) {
      return res.status(400).json({ error: 'Provide at least one profile field to update.' });
    }
    if (parsed.data.categoryId !== undefined && parsed.data.categoryId !== null) {
      const category = await database.query(
        'SELECT id FROM service_categories WHERE id = $1 AND is_active = TRUE',
        [parsed.data.categoryId],
      );
      if (!category.rows.length) return res.status(400).json({ error: 'Select an active service category.' });
    }
    await database.inTransaction(async (tx) => {
      if (selected.length) {
        const values = selected.map((key) => fields[key][1] ? JSON.stringify(parsed.data[key]) : parsed.data[key]);
        const assignments = selected.map((key, index) => `${fields[key][0]} = $${index + 1}${fields[key][1] ? '::jsonb' : ''}`);
        values.push(req.platformUser.id);
        await tx.query(
          `UPDATE vendor_profiles SET ${assignments.join(', ')} WHERE user_id = $${values.length}`,
          values,
        );
      }
      if (parsed.data.phone !== undefined) {
        await tx.query('UPDATE users SET phone = $1 WHERE id = $2', [parsed.data.phone, req.platformUser.id]);
      }
    });
    const vendor = await loadVendor(database, req.platformUser.id);
    return respond(res, profileResponse(vendor));
  });

  router.get('/verification', async (req, res) => {
    const [documents, history] = await Promise.all([
      database.query(
        `SELECT id, original_name, content_type, file_size, created_at
         FROM vendor_verification_documents WHERE vendor_id = $1 ORDER BY created_at DESC`,
        [req.vendor.id],
      ),
      database.query(
        `SELECT from_status, to_status, reason, created_at
         FROM vendor_verification_history WHERE vendor_id = $1 ORDER BY created_at DESC`,
        [req.vendor.id],
      ),
    ]);
    return respond(res, {
      status: req.vendor.verification_status,
      submittedAt: req.vendor.created_at,
      reviewProgress: req.vendor.verification_status.replaceAll('_', ' '),
      reasons: req.vendor.verification_reason ? [req.vendor.verification_reason] : [],
      documents: documents.rows.map((document) => ({
        ...document,
        downloadUrl: `/api/vendor/verification/documents/${Number(document.id)}`,
      })),
      history: history.rows,
    });
  });

  router.post('/verification/documents', verificationUpload, async (req, res) => {
    const contentType = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const invalid = validateVendorVerificationDocument(req.body, contentType);
    if (invalid) return res.status(400).json({ error: invalid });
    if (!['pending', 'under_review', 'information_requested'].includes(req.vendor.verification_status)) {
      return res.status(409).json({ error: 'Documents cannot be added for this vendor status.' });
    }
    const name = sanitizeVendorDocumentName(req.query.filename);
    const documentId = await database.inTransaction(async (tx) => {
      await tx.query('SELECT id FROM vendor_profiles WHERE id = $1 FOR UPDATE', [req.vendor.id]);
      const count = await tx.query(
        'SELECT COUNT(*)::integer AS total FROM vendor_verification_documents WHERE vendor_id = $1',
        [req.vendor.id],
      );
      if (count.rows[0].total >= 10) {
        throw httpError('A vendor application may contain at most 10 documents.', 400);
      }
      const saved = await tx.query(
        `INSERT INTO vendor_verification_documents
           (vendor_id, uploaded_by, original_name, content_type, file_size, content)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.vendor.id, req.platformUser.id, name, contentType, req.body.length, req.body],
      );
      const id = saved.rows[0].id;
      await writeAudit(tx, req, {
        actorId: req.platformUser.id,
        action: 'vendor.document_submitted',
        entityType: 'vendor',
        entityId: req.vendor.id,
        details: { documentId: id, name, contentType, fileSize: req.body.length },
      });
      return id;
    });
    return res.status(201).json({
      data: { id: Number(documentId), original_name: name, content_type: contentType, file_size: req.body.length },
    });
  });

  router.get('/verification/documents/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Document ID is invalid.' });
    const result = await database.query(
      `SELECT content, content_type, file_size
       FROM vendor_verification_documents WHERE id = $1 AND vendor_id = $2`,
      [id.data, req.vendor.id],
    );
    const document = result.rows[0];
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

  router.get('/services', requirePermission('services.manage_own'), async (req, res) => {
    const result = await database.query(
      `SELECT s.id, s.title, s.description, s.price, s.currency, s.status, s.created_at,
              COALESCE(sc.name, 'General') AS category,
              (SELECT COUNT(*)::integer FROM bookings b WHERE b.service_id = s.id) AS booking_count
       FROM services s LEFT JOIN service_categories sc ON sc.id = s.category_id
       WHERE s.vendor_id = $1 ORDER BY s.created_at DESC`,
      [req.vendor.id],
    );
    return respond(res, result.rows.map((row) => ({
      id: Number(row.id), name: row.title, title: row.title, description: row.description || '',
      category: row.category, status: labelStatus(row.status), price: Number(row.price || 0),
      currency: row.currency, bookings: Number(row.booking_count || 0),
    })));
  });

  router.post('/services', requirePermission('services.manage_own'), async (req, res) => {
    const parsed = serviceSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed.error);
    if (parsed.data.categoryId != null) {
      const category = await database.query('SELECT id FROM service_categories WHERE id = $1 AND is_active = TRUE', [parsed.data.categoryId]);
      if (!category.rows.length) return res.status(400).json({ error: 'Select an active service category.' });
    }
    if (parsed.data.status === 'active' && req.vendor.verification_status !== 'verified') {
      return res.status(409).json({ error: 'Vendor verification is required before publishing a service.' });
    }
    const setting = await database.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'platform_currency'",
    );
    const currency = parsed.data.currency || setting.rows[0]?.setting_value || 'ETB';
    const id = await database.inTransaction(async (tx) => {
      const created = await tx.query(
        `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.vendor.id, parsed.data.categoryId ?? null, parsed.data.title, parsed.data.description,
          parsed.data.price ?? null, currency, parsed.data.status],
      );
      const serviceId = Number(created.rows[0].id);
      await writeAudit(tx, req, {
        actorId: req.platformUser.id,
        action: 'service.created',
        entityType: 'service',
        entityId: serviceId,
        details: { title: parsed.data.title, status: parsed.data.status },
      });
      return serviceId;
    });
    return res.status(201).json({ success: true, data: {
      id, vendorId: Number(req.vendor.id), title: parsed.data.title, description: parsed.data.description,
      categoryId: parsed.data.categoryId ?? null, price: parsed.data.price ?? null,
      currency, status: labelStatus(parsed.data.status),
    } });
  });

  router.patch('/services/:id', requirePermission('services.manage_own'), async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = serviceSchema.partial().safeParse(req.body || {});
    if (!id.success || !parsed.success) return id.success ? validationError(res, parsed.error) : res.status(400).json({ error: 'Service ID is invalid.' });
    const keys = Object.keys(parsed.data);
    if (!keys.length) return res.status(400).json({ error: 'Provide at least one service field to update.' });
    const service = await database.query('SELECT id, status FROM services WHERE id = $1 AND vendor_id = $2', [id.data, req.vendor.id]);
    if (!service.rows[0]) return res.status(404).json({ error: 'Service not found.' });
    if (parsed.data.categoryId != null) {
      const category = await database.query('SELECT id FROM service_categories WHERE id = $1 AND is_active = TRUE', [parsed.data.categoryId]);
      if (!category.rows.length) return res.status(400).json({ error: 'Select an active service category.' });
    }
    if (parsed.data.status === 'active' && req.vendor.verification_status !== 'verified') {
      return res.status(409).json({ error: 'Vendor verification is required before publishing a service.' });
    }
    const columns = { title: 'title', description: 'description', categoryId: 'category_id', price: 'price', currency: 'currency', status: 'status' };
    const values = keys.map((key) => parsed.data[key]);
    const assignments = keys.map((key, index) => `${columns[key]} = $${index + 1}`);
    values.push(id.data, req.vendor.id);
    await database.inTransaction(async (tx) => {
      await tx.query(`UPDATE services SET ${assignments.join(', ')} WHERE id = $${values.length - 1} AND vendor_id = $${values.length}`, values);
      await writeAudit(tx, req, {
        actorId: req.platformUser.id, action: 'service.updated', entityType: 'service', entityId: id.data,
        details: { fields: keys, status: parsed.data.status || service.rows[0].status },
      });
    });
    return respond(res, { id: id.data, status: labelStatus(parsed.data.status || service.rows[0].status) });
  });

  router.delete('/services/:id', requirePermission('services.manage_own'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Service ID is invalid.' });
    const found = await database.inTransaction(async (tx) => {
      const changed = await tx.query(
        `UPDATE services SET status = 'archived'
         WHERE id = $1 AND vendor_id = $2 AND status <> 'archived' RETURNING id`,
        [id.data, req.vendor.id],
      );
      if (changed.rows.length) {
        await writeAudit(tx, req, {
          actorId: req.platformUser.id, action: 'service.archived', entityType: 'service', entityId: id.data, details: {},
        });
        return true;
      }
      const owned = await tx.query('SELECT id FROM services WHERE id = $1 AND vendor_id = $2', [id.data, req.vendor.id]);
      return owned.rows.length > 0;
    });
    if (!found) return res.status(404).json({ error: 'Service not found.' });
    return res.status(204).end();
  });

  router.get('/services/:serviceId/packages', async (req, res) => {
    const serviceId = parseId(req.params.serviceId);
    if (!serviceId.success) return res.status(400).json({ error: 'Service ID is invalid.' });
    const result = await database.query(
      `SELECT p.id, p.service_id, p.name, p.description, p.price, p.currency,
              p.included_features, p.extras, p.minimum_booking, p.is_active
       FROM service_packages p JOIN services s ON s.id = p.service_id
       WHERE p.service_id = $1 AND s.vendor_id = $2 ORDER BY p.price, p.id`,
      [serviceId.data, req.vendor.id],
    );
    return respond(res, result.rows.map(mapPackage));
  });

  router.get('/packages', async (req, res) => {
    const result = await database.query(
      `SELECT p.id, p.service_id, p.name, p.description, p.price, p.currency,
              p.included_features, p.extras, p.minimum_booking, p.is_active
       FROM service_packages p JOIN services s ON s.id = p.service_id
       WHERE s.vendor_id = $1 ORDER BY p.price, p.id`,
      [req.vendor.id],
    );
    return respond(res, result.rows.map(mapPackage));
  });

  router.post('/services/:serviceId/packages', requirePermission('services.manage_own'), async (req, res) => {
    const serviceId = parseId(req.params.serviceId);
    const parsed = packageSchema.safeParse(req.body || {});
    if (!serviceId.success || !parsed.success) return serviceId.success ? validationError(res, parsed.error) : res.status(400).json({ error: 'Service ID is invalid.' });
    const owned = await database.query('SELECT id FROM services WHERE id = $1 AND vendor_id = $2', [serviceId.data, req.vendor.id]);
    if (!owned.rows.length) return res.status(404).json({ error: 'Service not found.' });
    const setting = await database.query("SELECT setting_value FROM system_settings WHERE setting_key = 'platform_currency'");
    const currency = parsed.data.currency || setting.rows[0]?.setting_value || 'ETB';
    const created = await database.query(
      `INSERT INTO service_packages
         (service_id, name, description, price, currency, included_features, extras, minimum_booking, is_active)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9) RETURNING id`,
      [serviceId.data, parsed.data.name, parsed.data.description, parsed.data.price, currency,
        JSON.stringify(parsed.data.includedFeatures), JSON.stringify(parsed.data.extras),
        parsed.data.minimumBooking, parsed.data.isActive],
    );
    return res.status(201).json({ data: { id: Number(created.rows[0].id), serviceId: serviceId.data, ...parsed.data, currency } });
  });

  router.patch('/services/:serviceId/packages/:packageId', requirePermission('services.manage_own'), async (req, res) => {
    const serviceId = parseId(req.params.serviceId);
    const packageId = parseId(req.params.packageId);
    const parsed = packageSchema.partial().safeParse(req.body || {});
    if (!serviceId.success || !packageId.success || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? 'Package ID is invalid.' : parsed.error.issues[0]?.message });
    }
    if (!Object.keys(parsed.data).length) return res.status(400).json({ error: 'Provide at least one package change.' });
    const columns = {
      name: 'name', description: 'description', price: 'price', currency: 'currency',
      includedFeatures: 'included_features', extras: 'extras', minimumBooking: 'minimum_booking', isActive: 'is_active',
    };
    const keys = Object.keys(parsed.data);
    const values = keys.map((key) => ['includedFeatures', 'extras'].includes(key) ? JSON.stringify(parsed.data[key]) : parsed.data[key]);
    const assignments = keys.map((key, index) => `${columns[key]} = $${index + 1}${['includedFeatures', 'extras'].includes(key) ? '::jsonb' : ''}`);
    values.push(packageId.data, serviceId.data, req.vendor.id);
    const result = await database.query(
      `UPDATE service_packages p SET ${assignments.join(', ')}
       FROM services s
       WHERE p.id = $${values.length - 2} AND p.service_id = $${values.length - 1}
         AND s.id = p.service_id AND s.vendor_id = $${values.length} RETURNING p.id`,
      values,
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Service package not found.' });
    return respond(res, { id: packageId.data, serviceId: serviceId.data, ...parsed.data });
  });

  router.delete('/services/:serviceId/packages/:packageId', requirePermission('services.manage_own'), async (req, res) => {
    const serviceId = parseId(req.params.serviceId);
    const packageId = parseId(req.params.packageId);
    if (!serviceId.success || !packageId.success) return res.status(400).json({ error: 'Package ID is invalid.' });
    const result = await database.query(
      `DELETE FROM service_packages p USING services s
       WHERE p.id = $1 AND p.service_id = $2 AND s.id = p.service_id AND s.vendor_id = $3
       RETURNING p.id`,
      [packageId.data, serviceId.data, req.vendor.id],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Service package not found.' });
    return res.status(204).end();
  });

  router.get('/media', async (req, res) => {
    const serviceId = req.query.serviceId ? parseId(req.query.serviceId) : null;
    if (serviceId && !serviceId.success) return res.status(400).json({ error: 'Service ID is invalid.' });
    const values = [req.vendor.id];
    const filter = serviceId ? ' AND service_id = $2' : '';
    if (serviceId) values.push(serviceId.data);
    const result = await database.query(
      `SELECT id, service_id, media_type, original_name, content_type, file_size, created_at
       FROM vendor_media WHERE vendor_id = $1${filter} ORDER BY created_at DESC, id DESC`,
      values,
    );
    return respond(res, result.rows.map((row) => ({
      id: Number(row.id), serviceId: row.service_id === null ? null : Number(row.service_id),
      type: row.media_type, name: row.original_name, contentType: row.content_type,
      fileSize: Number(row.file_size), createdAt: row.created_at,
    })));
  });

  router.post('/media', mediaUpload, async (req, res) => {
    const parsed = z.object({
      type: z.enum(['logo', 'cover', 'portfolio', 'service']),
      serviceId: z.coerce.number().int().positive().optional(),
      filename: z.string().trim().min(1).max(180).optional(),
    }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Image upload details are invalid.' });
    if ((parsed.data.type === 'service') !== Boolean(parsed.data.serviceId)) {
      return res.status(400).json({ error: 'Select a service for service images only.' });
    }
    const mimeType = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const validation = validateProfilePhoto(mimeType, req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    if (parsed.data.serviceId) {
      const service = await database.query('SELECT id FROM services WHERE id = $1 AND vendor_id = $2', [parsed.data.serviceId, req.vendor.id]);
      if (!service.rows.length) return res.status(404).json({ error: 'Service not found.' });
    }
    const name = (parsed.data.filename || `${parsed.data.type}-image`).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180);
    const mediaId = await database.inTransaction(async (tx) => {
      const result = await tx.query(
        `INSERT INTO vendor_media
           (vendor_id, service_id, media_type, original_name, content_type, file_size, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.vendor.id, parsed.data.serviceId || null, parsed.data.type, name, mimeType, req.body.length, req.body],
      );
      const id = result.rows[0].id;
      await writeAudit(tx, req, {
        actorId: req.platformUser.id,
        action: 'vendor.media_uploaded',
        entityType: parsed.data.serviceId ? 'service' : 'vendor',
        entityId: parsed.data.serviceId || req.vendor.id,
        details: { mediaId: id, type: parsed.data.type, fileSize: req.body.length },
      });
      return Number(id);
    });
    return res.status(201).json({ data: {
      id: mediaId, serviceId: parsed.data.serviceId || null,
      type: parsed.data.type, name, contentType: mimeType, fileSize: req.body.length,
    } });
  });

  router.get('/media/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Media ID is invalid.' });
    const result = await database.query(
      'SELECT content, content_type, file_size FROM vendor_media WHERE id = $1 AND vendor_id = $2',
      [id.data, req.vendor.id],
    );
    const media = result.rows[0];
    if (!media) return res.status(404).json({ error: 'Image not found.' });
    res.set({
      'Content-Type': media.content_type, 'Content-Length': media.file_size,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    });
    return res.send(media.content);
  });

  router.delete('/media/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Media ID is invalid.' });
    const result = await database.query(
      'DELETE FROM vendor_media WHERE id = $1 AND vendor_id = $2 RETURNING id',
      [id.data, req.vendor.id],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Image not found.' });
    return res.status(204).end();
  });

  router.get('/categories', async (_req, res) => {
    const result = await database.query(
      'SELECT id, name, description, is_active FROM service_categories WHERE is_active = TRUE ORDER BY display_order, name',
    );
    return respond(res, result.rows.map((row) => ({
      id: Number(row.id), name: row.name, description: row.description || '', active: Boolean(row.is_active),
    })));
  });

  router.get('/pricing', async (req, res) => {
    const result = await database.query(
      `SELECT p.id, p.service_id, p.name, p.description, p.price, p.currency,
              p.included_features, p.extras, p.minimum_booking, p.is_active, s.title AS service_title
       FROM service_packages p JOIN services s ON s.id = p.service_id
       WHERE s.vendor_id = $1 ORDER BY p.price, p.id`,
      [req.vendor.id],
    );
    const setting = await database.query("SELECT setting_value FROM system_settings WHERE setting_key = 'platform_currency'");
    const prices = result.rows.map((row) => Number(row.price)).filter((price) => price > 0);
    return respond(res, {
      currency: result.rows[0]?.currency || setting.rows[0]?.setting_value || 'ETB',
      basePrice: prices.length ? Math.min(...prices) : 0,
      packages: result.rows.map(mapPackage),
    });
  });

  router.get('/history', async (req, res) => {
    const result = await database.query(
      `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
              e.title AS event_title, TO_CHAR(e.start_date, 'YYYY-MM-DD') AS event_start_date,
              u.full_name AS customer_name,
              (SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status
       FROM bookings b JOIN events e ON e.id = b.event_id JOIN users u ON u.id = e.organizer_id
       WHERE b.vendor_id = $1 AND b.status IN ('completed', 'rejected', 'cancelled')
       ORDER BY b.created_at DESC`,
      [req.vendor.id],
    );
    return respond(res, result.rows.map((row) => ({
      id: Number(row.id), customer: row.customer_name, event: row.event_title,
      service: row.service_description, status: labelStatus(row.status),
      amount: Number(row.quoted_amount || 0), currency: row.currency,
      date: row.event_start_date, paymentStatus: row.payment_status || 'unpaid',
    })));
  });

  router.get('/tasks', async (req, res) => {
    const result = await database.query(
      `SELECT t.id, t.event_id, t.booking_id, t.title, t.details, t.due_at, t.status,
              t.created_at, t.updated_at, e.title AS event_title, b.service_description,
              organizer.full_name AS organizer_name
       FROM event_vendor_tasks t JOIN bookings b ON b.id = t.booking_id
       JOIN events e ON e.id = t.event_id JOIN users organizer ON organizer.id = e.organizer_id
       WHERE b.vendor_id = $1 ORDER BY t.due_at NULLS LAST, t.id DESC`,
      [req.vendor.id],
    );
    return respond(res, result.rows.map((row) => ({
      ...row, id: Number(row.id), eventId: Number(row.event_id), bookingId: Number(row.booking_id),
    })));
  });

  router.patch('/tasks/:id/status', async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = z.object({ status: z.enum(['in_progress', 'completed', 'blocked']) }).strict().safeParse(req.body || {});
    if (!id.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Task status is invalid.' });
    const task = await database.query(
      `SELECT t.id, t.title, t.status, e.id AS event_id, e.title AS event_title, e.organizer_id
       FROM event_vendor_tasks t JOIN bookings b ON b.id = t.booking_id
       JOIN events e ON e.id = t.event_id
       WHERE t.id = $1 AND b.vendor_id = $2`,
      [id.data, req.vendor.id],
    );
    if (!task.rows[0]) return res.status(404).json({ error: 'Vendor task not found.' });
    const row = task.rows[0];
    if (row.status === parsed.data.status) return res.json({ data: { id: id.data, status: row.status } });
    await database.inTransaction(async (tx) => {
      await tx.query('UPDATE event_vendor_tasks SET status = $1 WHERE id = $2', [parsed.data.status, id.data]);
      await notify(tx, {
        userId: row.organizer_id, title: 'Vendor task updated',
        message: `${row.event_title}: ${row.title} is ${parsed.data.status.replaceAll('_', ' ')}.`,
        type: 'event', relatedType: 'event', relatedId: row.event_id, actorId: req.platformUser.id,
      });
      await writeAudit(tx, req, {
        actorId: req.platformUser.id, action: 'vendor.task_status_updated',
        entityType: 'event', entityId: row.event_id,
        details: { taskId: id.data, previousStatus: row.status, status: parsed.data.status },
      });
    });
    return res.json({ data: { id: id.data, status: parsed.data.status } });
  });

  router.get('/payments', async (req, res) => {
    const [payments, refunds] = await Promise.all([
      database.query(
        `SELECT p.id, p.booking_id, p.amount, p.currency, p.provider, p.provider_reference, p.status, p.created_at
         FROM payments p JOIN bookings b ON b.id = p.booking_id
         WHERE b.vendor_id = $1 ORDER BY p.created_at DESC`,
        [req.vendor.id],
      ),
      database.query(
        `SELECT rr.id, rr.payment_id, rr.amount, rr.currency, rr.reason, rr.status,
                rr.decision_reason, rr.created_at, rr.decided_at
         FROM refund_requests rr JOIN payments p ON p.id = rr.payment_id
         JOIN bookings b ON b.id = p.booking_id WHERE b.vendor_id = $1 ORDER BY rr.created_at DESC`,
        [req.vendor.id],
      ),
    ]);
    const rows = payments.rows;
    const earnings = rows.filter((row) => row.status === 'paid').reduce((total, row) => total + Number(row.amount || 0), 0);
    const pending = rows.filter((row) => ['pending', 'authorized'].includes(row.status)).reduce((total, row) => total + Number(row.amount || 0), 0);
    return respond(res, {
      earnings, pendingPayouts: pending, fees: 0, net: earnings,
      transactions: rows.map((row) => ({
        id: Number(row.id), bookingId: Number(row.booking_id), date: row.created_at,
        provider: row.provider || null, reference: row.provider_reference || null,
        status: labelStatus(row.status), amount: Number(row.amount || 0), currency: row.currency,
      })),
      refunds: refunds.rows.map((row) => ({
        id: Number(row.id), paymentId: Number(row.payment_id), amount: Number(row.amount),
        currency: row.currency, reason: row.reason, status: row.status,
        decisionReason: row.decision_reason || null, createdAt: row.created_at, decidedAt: row.decided_at,
      })),
    });
  });

  router.get('/messages', async (req, res) => {
    const result = await database.query(
      `SELECT m.id, m.booking_id, m.sender_id, m.recipient_id, m.body, m.read_at, m.created_at,
              u.full_name AS sender, e.id AS event_id, e.title AS event_title
       FROM messages m JOIN users u ON u.id = m.sender_id
       JOIN bookings b ON b.id = m.booking_id JOIN events e ON e.id = b.event_id
       WHERE b.vendor_id = $1 AND (m.recipient_id = $2 OR m.sender_id = $2)
       ORDER BY m.created_at DESC`,
      [req.vendor.id, req.platformUser.id],
    );
    return respond(res, result.rows.map((row) => ({
      id: Number(row.id), bookingId: Number(row.booking_id), senderId: Number(row.sender_id),
      recipientId: Number(row.recipient_id), sender: row.sender, eventId: Number(row.event_id),
      event: row.event_title, body: row.body, unread: !row.read_at, createdAt: row.created_at,
    })));
  });

  router.post('/messages', async (req, res) => {
    const parsed = z.object({
      bookingId: z.coerce.number().int().positive(),
      body: z.string().trim().min(1).max(4000),
    }).strict().safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed.error);
    const booking = await database.query(
      `SELECT b.id, e.organizer_id, e.title AS event_title FROM bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.id = $1 AND b.vendor_id = $2 AND b.status NOT IN ('cancelled', 'rejected')`,
      [parsed.data.bookingId, req.vendor.id],
    );
    if (!booking.rows[0]) return res.status(404).json({ error: 'Active booking not found.' });
    const record = booking.rows[0];
    const result = await database.inTransaction(async (tx) => {
      const saved = await tx.query(
        `INSERT INTO messages (sender_id, recipient_id, booking_id, subject, body)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [req.platformUser.id, record.organizer_id, record.id, `Update: ${record.event_title}`.slice(0, 180), parsed.data.body],
      );
      await notify(tx, {
        userId: record.organizer_id, title: 'New vendor message',
        message: `New message about ${record.event_title}.`, type: 'booking',
        relatedType: 'booking', relatedId: record.id, actorId: req.platformUser.id,
      });
      await writeAudit(tx, req, {
        actorId: req.platformUser.id, action: 'vendor.message_sent', entityType: 'booking',
        entityId: record.id, details: { messageId: saved.rows[0].id },
      });
      return saved.rows[0].id;
    });
    return res.status(201).json({ data: { id: Number(result), bookingId: Number(record.id), event: record.event_title } });
  });

  router.post('/messages/:id/read', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'A valid message ID is required.' });
    const updated = await database.query(
      `UPDATE messages m SET read_at = COALESCE(m.read_at, NOW())
       FROM bookings b
       WHERE m.id = $1 AND m.recipient_id = $2 AND m.booking_id = b.id AND b.vendor_id = $3
       RETURNING m.id`,
      [id.data, req.platformUser.id, req.vendor.id],
    );
    if (!updated.rows.length) return res.status(404).json({ error: 'Message not found.' });
    return res.json({ data: { id: id.data, read: true } });
  });

  router.get('/reviews', async (req, res) => {
    const result = await database.query(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at, u.full_name AS customer_name
       FROM reviews r JOIN bookings b ON b.id = r.booking_id
       JOIN events e ON e.id = b.event_id JOIN users u ON u.id = e.organizer_id
       WHERE b.vendor_id = $1 ORDER BY r.created_at DESC`,
      [req.vendor.id],
    );
    return respond(res, result.rows.map((row) => ({
      id: Number(row.id), customer: row.customer_name, rating: Number(row.rating),
      comment: row.comment || '', response: null, status: row.status, createdAt: row.created_at,
    })));
  });

  router.post('/reviews/:id/report', async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).strict().safeParse(req.body || {});
    if (!id.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'A valid report reason is required.' });
    const review = await database.query(
      `SELECT r.id FROM reviews r JOIN bookings b ON b.id = r.booking_id
       WHERE r.id = $1 AND b.vendor_id = $2`,
      [id.data, req.vendor.id],
    );
    if (!review.rows.length) return res.status(404).json({ error: 'Review not found.' });
    await database.inTransaction(async (tx) => {
      await writeAudit(tx, req, {
        actorId: req.platformUser.id, action: 'vendor.review_reported', entityType: 'review',
        entityId: id.data, details: { reason: parsed.data.reason },
      });
      await notifyAdministrators(tx, req.platformUser.id, id.data);
    });
    return res.status(202).json({ data: { id: id.data, status: 'reported' } });
  });

  router.get('/notifications', async (req, res) => {
    const result = await database.query(
      `SELECT id, title, message, notification_type, related_entity_type, related_entity_id, status, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.platformUser.id],
    );
    return respond(res, result.rows.map((row) => ({
      id: Number(row.id), title: row.title, message: row.message, type: row.notification_type,
      relatedType: row.related_entity_type, relatedId: row.related_entity_id,
      read: row.status === 'read', status: row.status, createdAt: row.created_at,
    })));
  });

  router.post('/notifications/:id/read', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'A valid notification ID is required.' });
    const result = await database.inTransaction(async (tx) => {
      const changed = await tx.query(
        `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND user_id = $2 AND status <> 'read' RETURNING id`,
        [id.data, req.platformUser.id],
      );
      if (changed.rows.length) {
        await tx.query(
          `INSERT INTO notification_history (notification_id, actor_id, action)
           VALUES ($1, $2, 'read')`,
          [id.data, req.platformUser.id],
        );
        return true;
      }
      const existing = await tx.query('SELECT id FROM notifications WHERE id = $1 AND user_id = $2', [id.data, req.platformUser.id]);
      return existing.rows.length > 0;
    });
    if (!result) return res.status(404).json({ error: 'Notification not found.' });
    return res.json({ data: { id: id.data, read: true } });
  });

  router.post('/notifications/read-all', async (req, res) => {
    const count = await database.inTransaction(async (tx) => {
      const result = await tx.query(
        `WITH changed AS (
           UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
           WHERE user_id = $1 AND status <> 'read' RETURNING id
         ), history AS (
           INSERT INTO notification_history (notification_id, actor_id, action)
           SELECT id, $1, 'read' FROM changed RETURNING notification_id
         )
         SELECT COUNT(*)::integer AS changed FROM changed`,
        [req.platformUser.id],
      );
      return result.rows[0].changed;
    });
    return res.json({ data: { changed: count } });
  });

  router.get('/reports', async (req, res) => {
    const parsed = z.object({
      serviceId: z.coerce.number().int().positive().optional(),
      status: z.enum(['requested', 'under_review', 'quoted', 'accepted', 'completed', 'rejected', 'cancelled']).optional(),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).strict().safeParse(req.query);
    if (!parsed.success || (parsed.data.dateFrom && !isValidDate(parsed.data.dateFrom))
      || (parsed.data.dateTo && !isValidDate(parsed.data.dateTo))
      || (parsed.data.dateFrom && parsed.data.dateTo && parsed.data.dateFrom > parsed.data.dateTo)) {
      return res.status(400).json({ error: 'Report filters are invalid.' });
    }
    if (parsed.data.serviceId) {
      const service = await database.query('SELECT id FROM services WHERE id = $1 AND vendor_id = $2', [parsed.data.serviceId, req.vendor.id]);
      if (!service.rows.length) return res.status(404).json({ error: 'Service not found.' });
    }
    const bookingValues = [req.vendor.id];
    const bookingFilters = ['b.vendor_id = $1'];
    const paymentValues = [req.vendor.id];
    const paymentFilters = ['b.vendor_id = $1', "p.status = 'paid'"];
    if (parsed.data.serviceId) {
      bookingValues.push(parsed.data.serviceId);
      paymentValues.push(parsed.data.serviceId);
      bookingFilters.push(`b.service_id = $${bookingValues.length}`);
      paymentFilters.push(`b.service_id = $${paymentValues.length}`);
    }
    if (parsed.data.status) {
      bookingValues.push(parsed.data.status);
      bookingFilters.push(`b.status = $${bookingValues.length}`);
    }
    if (parsed.data.dateFrom) {
      bookingValues.push(parsed.data.dateFrom);
      paymentValues.push(parsed.data.dateFrom);
      bookingFilters.push(`e.start_date >= $${bookingValues.length}::date`);
      paymentFilters.push(`p.created_at >= $${paymentValues.length}::date`);
    }
    if (parsed.data.dateTo) {
      bookingValues.push(parsed.data.dateTo);
      paymentValues.push(parsed.data.dateTo);
      bookingFilters.push(`e.start_date < ($${bookingValues.length}::date + INTERVAL '1 day')`);
      paymentFilters.push(`p.created_at < ($${paymentValues.length}::date + INTERVAL '1 day')`);
    }
    const [services, bookings, earnings] = await Promise.all([
      database.query('SELECT id, title FROM services WHERE vendor_id = $1', [req.vendor.id]),
      database.query(
        `SELECT b.status, b.service_description
         FROM bookings b JOIN events e ON e.id = b.event_id WHERE ${bookingFilters.join(' AND ')}`,
        bookingValues,
      ),
      database.query(
        `SELECT TO_CHAR(p.created_at, 'YYYY-MM') AS month, SUM(p.amount) AS total
         FROM payments p JOIN bookings b ON b.id = p.booking_id
         WHERE ${paymentFilters.join(' AND ')}
         GROUP BY TO_CHAR(p.created_at, 'YYYY-MM') ORDER BY month`,
        paymentValues,
      ),
    ]);
    const counts = new Map();
    for (const booking of bookings.rows) {
      counts.set(booking.service_description, (counts.get(booking.service_description) || 0) + 1);
    }
    return respond(res, {
      totalListings: services.rows.length,
      bookingStatus: bookings.rows.reduce((result, booking) => {
        result[booking.status] = (result[booking.status] || 0) + 1;
        return result;
      }, {}),
      earningsByDate: Object.fromEntries(earnings.rows.map((row) => [row.month, Number(row.total || 0)])),
      popularServices: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name),
    });
  });

  router.get('/account', (req, res) => respond(res, {
    fullName: req.platformUser.full_name,
    email: req.platformUser.email,
    phone: req.platformUser.phone,
    role: 'Vendor',
    status: req.platformUser.status,
  }));

  router.patch('/account', async (req, res) => {
    const parsed = z.object({
      fullName: z.string().trim().min(2).max(160),
      phone: z.string().trim().max(40).optional().default(''),
    }).strict().safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed.error);
    await database.inTransaction(async (tx) => {
      await tx.query(
        'UPDATE users SET full_name = $1, phone = $2 WHERE id = $3',
        [parsed.data.fullName, parsed.data.phone || null, req.platformUser.id],
      );
      await writeAudit(tx, req, {
        actorId: req.platformUser.id, action: 'vendor.account_updated', entityType: 'user',
        entityId: req.platformUser.id, details: { fields: ['full_name', 'phone'] },
      });
    });
    return res.json({ data: {
      fullName: parsed.data.fullName, email: req.platformUser.email,
      phone: parsed.data.phone || null, role: 'Vendor',
    } });
  });

  router.post('/account/password', async (req, res) => {
    const parsed = z.object({
      currentPassword: z.string().min(1).max(256),
      newPassword: z.string().min(12).max(16).refine(isStrongPassword),
    }).strict().safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Provide your current password and a 12–16 character new password with uppercase, lowercase, and a number.' });
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return res.status(400).json({ error: 'Choose a new password different from your current password.' });
    }
    const tokenHash = hashToken(req.cookies.platform_session);
    await database.inTransaction(async (tx) => {
      const account = await tx.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [req.platformUser.id]);
      if (!account.rows[0] || !await bcrypt.compare(parsed.data.currentPassword, account.rows[0].password_hash)) {
        throw httpError('The current password is incorrect.', 400);
      }
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
      await tx.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.platformUser.id]);
      await tx.query('DELETE FROM user_sessions WHERE user_id = $1 AND token_hash <> $2', [req.platformUser.id, tokenHash]);
      await writeAudit(tx, req, {
        actorId: req.platformUser.id, action: 'vendor.password_changed', entityType: 'user',
        entityId: req.platformUser.id, details: { otherSessionsInvalidated: true },
      });
    });
    return res.json({ message: 'Password changed. Other account sessions have been signed out.' });
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof express.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Uploaded file exceeds the maximum permitted size.' });
    }
    if (Number.isInteger(error.status)) return res.status(error.status).json({ error: error.expose ? error.message : 'The request could not be completed.' });
    return next(error);
  });
  return router;
}

function mapPackage(row) {
  return {
    id: Number(row.id), serviceId: Number(row.service_id), name: row.name,
    description: row.description || '', price: Number(row.price || 0), currency: row.currency,
    includedFeatures: row.included_features || [], extras: row.extras || [],
    minimumBooking: Number(row.minimum_booking), isActive: Boolean(row.is_active),
  };
}

function isValidDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function notifyAdministrators(database, actorId, reviewId) {
  const admins = await database.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE`,
  );
  for (const admin of admins.rows) {
    const inserted = await database.query(
      `INSERT INTO notifications
         (user_id, title, message, notification_type, related_entity_type, related_entity_id,
          idempotency_key, delivery_channel, delivery_status)
       VALUES ($1, 'Vendor reported a review', $2, 'review', 'review', $3, $4, 'in_app', 'delivered')
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [admin.id, `Review #${reviewId} was reported for administrator review.`, String(reviewId),
        `vendor-review-report:${reviewId}:${actorId}`],
    );
    if (inserted.rows[0]) {
      await database.query(
        `INSERT INTO notification_history (notification_id, actor_id, action, details)
         VALUES ($1, $2, 'created', $3::jsonb)`,
        [inserted.rows[0].id, actorId, JSON.stringify({ source: 'vendor_review_report', channel: 'in_app' })],
      );
    }
  }
}
