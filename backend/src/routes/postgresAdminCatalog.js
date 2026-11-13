import express from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { auditSeverityForAction, sanitizeAuditDetails } from '../lib/security.js';
import { validateProfilePhoto } from '../lib/profilePhoto.js';
import { getRequestId } from '../lib/requestContext.js';
import { requirePermission } from '../middleware/rbac.js';

const vendorStatuses = ['pending', 'under_review', 'information_requested', 'verified', 'rejected', 'suspended'];
const idSchema = z.coerce.number().int().positive();
const vendorListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  q: z.string().trim().max(120).optional(),
  status: z.enum(vendorStatuses).optional(),
}).strict();
const vendorStatusSchema = z.object({
  status: z.enum(['under_review', 'verified', 'rejected', 'information_requested', 'suspended']),
  reason: z.string().trim().min(5).max(1000),
}).strict();
const categoryListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', '1', '0']).optional(),
  sortBy: z.enum(['id', 'name', 'display_order', 'service_count', 'is_active', 'created_at']).default('display_order'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
}).strict();
const categoryFieldsSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  display_order: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();
const categoryStatusSchema = z.object({ is_active: z.boolean() }).strict();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const categoryImageParser = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: 5 * 1024 * 1024,
});

function sendValidationError(res, error) {
  return res.status(400).json({
    error: 'Invalid request data.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

function statusError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function writeAudit(executor, { actorId, action, entityType, entityId, details, ip }) {
  await executor.query(
    `INSERT INTO audit_logs
       (actor_id, action, entity_type, entity_id, details, ip_address, request_id, outcome, severity)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'success', $8)`,
    [
      actorId,
      action,
      entityType,
      entityId === null || entityId === undefined ? null : String(entityId),
      JSON.stringify(sanitizeAuditDetails(details)),
      ip || null,
      getRequestId(),
      auditSeverityForAction(action),
    ],
  );
}

async function assertCategoryNameAvailable(executor, name, categoryId = null) {
  await executor.query('SELECT pg_advisory_xact_lock(hashtext(LOWER(BTRIM($1)))::bigint)', [name]);
  const result = await executor.query(
    `SELECT id FROM service_categories
     WHERE LOWER(BTRIM(name)) = LOWER(BTRIM($1)) AND ($2::bigint IS NULL OR id <> $2)
     LIMIT 1`,
    [name, categoryId],
  );
  if (result.rows[0]) throw statusError('A category with this name already exists.', 409);
}

async function notifyVendor(transaction, { userId, vendorId, actorId, historyId, status, reason }) {
  const messages = {
    under_review: ['Vendor application under review', 'Your vendor application is now under review.'],
    verified: ['Vendor application approved', 'Your vendor application has been approved.'],
    rejected: ['Vendor application update', `Your vendor application was not approved: ${reason}`],
    information_requested: ['More information requested', `Please provide additional information for your vendor application: ${reason}`],
    suspended: ['Vendor account suspended', `Your vendor account has been suspended: ${reason}`],
  }[status];
  if (!messages) return;

  const inserted = await transaction.query(
    `INSERT INTO notifications
       (user_id, title, message, notification_type, related_entity_type, related_entity_id,
        idempotency_key, delivery_channel, delivery_status)
     VALUES ($1, $2, $3, 'vendor_verification', 'vendor', $4, $5, 'in_app', 'delivered')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [userId, messages[0], messages[1], String(vendorId), `vendor-status:${vendorId}:${historyId}`],
  );
  if (inserted.rows[0]) {
    await transaction.query(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES ($1, $2, 'created', $3::jsonb)`,
      [inserted.rows[0].id, actorId, JSON.stringify({ source: 'vendor_verification', channel: 'in_app' })],
    );
  }
}

async function updateVendorVerification(database, { vendorId, actorId, status, reason, ip }) {
  return database.inTransaction(async (transaction) => {
    const result = await transaction.query(
      'SELECT id, user_id, verification_status FROM vendor_profiles WHERE id = $1 FOR UPDATE',
      [vendorId],
    );
    const vendor = result.rows[0];
    if (!vendor) throw statusError('Vendor application not found.', 404);
    if (Number(vendor.user_id) === Number(actorId)) {
      throw statusError('Administrators cannot review their own vendor applications.', 403);
    }

    const allowedTransitions = {
      pending: ['under_review'],
      under_review: ['verified', 'rejected', 'information_requested'],
      information_requested: ['under_review'],
      verified: ['suspended'],
      suspended: ['verified'],
      rejected: [],
    };
    if (!(allowedTransitions[vendor.verification_status] || []).includes(status)) {
      throw statusError(`Cannot change vendor application from ${vendor.verification_status} to ${status}.`, 409);
    }

    await transaction.query(
      `UPDATE vendor_profiles
       SET verification_status = $1, verification_reason = $3,
           verified_at = CASE WHEN $2::text = 'verified' THEN NOW()
                              WHEN $2::text = 'rejected' THEN NULL ELSE verified_at END
       WHERE id = $4`,
      [status, status, reason, vendorId],
    );
    const history = await transaction.query(
      `INSERT INTO vendor_verification_history (vendor_id, actor_id, from_status, to_status, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [vendorId, actorId, vendor.verification_status, status, reason],
    );
    await notifyVendor(transaction, {
      userId: vendor.user_id,
      vendorId,
      actorId,
      historyId: history.rows[0].id,
      status,
      reason,
    });
    await writeAudit(transaction, {
      actorId,
      action: `vendor.${status}`,
      entityType: 'vendor',
      entityId: vendorId,
      details: { from: vendor.verification_status, to: status, reason },
      ip,
    });
    return { id: vendorId, verification_status: status, previous_status: vendor.verification_status };
  });
}

export function createPostgresAdminCatalogRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/vendor-verification', requirePermission('vendors.verify'), async (req, res, next) => {
    const parsed = vendorListSchema.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { page, pageSize, q, status } = parsed.data;
    const clauses = [];
    const values = [];
    if (status) {
      values.push(status);
      clauses.push(`vp.verification_status = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      const search = `$${values.length}`;
      values.push(q);
      const idSearch = `$${values.length}`;
      clauses.push(`(vp.business_name ILIKE ${search} OR u.full_name ILIKE ${search}
        OR u.email ILIKE ${search} OR COALESCE(u.phone, '') ILIKE ${search} OR vp.id::text = ${idSearch})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
      const [count, rows, statusRows] = await Promise.all([
        database.query(
          `SELECT COUNT(*) AS total FROM vendor_profiles vp JOIN users u ON u.id = vp.user_id ${where}`,
          values,
        ),
        database.query(
          `SELECT vp.id, vp.user_id, vp.business_name, vp.category_id, sc.name AS category_name,
                  vp.city, vp.description, vp.verification_status, vp.is_featured, vp.verification_reason,
                  vp.verified_at, vp.created_at, u.full_name AS owner_name, u.email, u.phone,
                  (SELECT COUNT(*) FROM vendor_verification_documents d WHERE d.vendor_id = vp.id)::int AS document_count
           FROM vendor_profiles vp
           JOIN users u ON u.id = vp.user_id
           LEFT JOIN service_categories sc ON sc.id = vp.category_id
           ${where}
           ORDER BY vp.created_at DESC, vp.id DESC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, pageSize, (page - 1) * pageSize],
        ),
        database.query(
          'SELECT verification_status, COUNT(*)::int AS total FROM vendor_profiles GROUP BY verification_status',
        ),
      ]);
      const counts = Object.fromEntries(vendorStatuses.map((key) => [key, 0]));
      for (const row of statusRows.rows) counts[row.verification_status] = Number(row.total);
      const total = Number(count.rows[0]?.total || 0);
      return res.json({
        data: rows.rows.map((row) => ({
          ...row,
          id: Number(row.id),
          user_id: Number(row.user_id),
          document_count: Number(row.document_count),
        })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
        counts,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/vendor-verification/:id', requirePermission('vendors.verify'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Vendor application ID is invalid.' });
    try {
      const result = await database.query(
        `SELECT vp.id, vp.user_id, vp.business_name, vp.category_id, sc.name AS category_name,
                vp.city, vp.description, vp.verification_status, vp.is_featured, vp.verification_reason,
                vp.verified_at, vp.created_at, u.full_name AS owner_name, u.email, u.phone
         FROM vendor_profiles vp
         JOIN users u ON u.id = vp.user_id
         LEFT JOIN service_categories sc ON sc.id = vp.category_id
         WHERE vp.id = $1`,
        [id.data],
      );
      const vendor = result.rows[0];
      if (!vendor) return res.status(404).json({ error: 'Vendor application not found.' });
      const [documents, history] = await Promise.all([
        database.query(
          `SELECT id, original_name, content_type, file_size, created_at
           FROM vendor_verification_documents WHERE vendor_id = $1 ORDER BY created_at DESC, id DESC`,
          [id.data],
        ),
        database.query(
          `SELECT h.id, h.from_status, h.to_status, h.reason, h.created_at, u.full_name AS actor_name
           FROM vendor_verification_history h
           LEFT JOIN users u ON u.id = h.actor_id
           WHERE h.vendor_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
          [id.data],
        ),
      ]);
      return res.json({ data: { ...vendor, documents: documents.rows, history: history.rows } });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/vendor-verification/:id/documents/:documentId', requirePermission('vendors.verify'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const documentId = idSchema.safeParse(req.params.documentId);
    if (!id.success || !documentId.success) {
      return res.status(400).json({ error: 'Vendor document ID is invalid.' });
    }
    try {
      const result = await database.query(
        `SELECT original_name, content_type, content
         FROM vendor_verification_documents WHERE id = $1 AND vendor_id = $2`,
        [documentId.data, id.data],
      );
      const document = result.rows[0];
      if (!document) return res.status(404).json({ error: 'Vendor verification document not found.' });
      const safeName = String(document.original_name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180) || 'verification-document';
      res.set({
        'Content-Type': document.content_type,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(document.content);
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/vendor-verification/:id/status', requirePermission('vendors.verify'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = vendorStatusSchema.safeParse(req.body || {});
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: 'Provide a valid status and a verification reason of at least 5 characters.' });
    }
    try {
      const result = await updateVendorVerification(database, {
        vendorId: id.data,
        actorId: req.admin.id,
        status: parsed.data.status,
        reason: parsed.data.reason,
        ip: req.ip,
      });
      return res.json({ data: result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.patch('/vendors/:id/featured', requirePermission('vendors.verify'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = z.object({ is_featured: z.boolean() }).strict().safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'Provide a valid vendor ID and featured status.' });
    try {
      const result = await database.inTransaction(async (transaction) => {
        const selected = await transaction.query(
          'SELECT id, verification_status, is_featured FROM vendor_profiles WHERE id = $1 FOR UPDATE',
          [id.data],
        );
        const vendor = selected.rows[0];
        if (!vendor) throw statusError('Vendor not found.', 404);
        if (parsed.data.is_featured && vendor.verification_status !== 'verified') {
          throw statusError('Only verified vendors can be featured.', 409);
        }
        await transaction.query('UPDATE vendor_profiles SET is_featured = $1 WHERE id = $2', [parsed.data.is_featured, id.data]);
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: parsed.data.is_featured ? 'vendor.featured' : 'vendor.unfeatured',
          entityType: 'vendor',
          entityId: id.data,
          details: { is_featured: parsed.data.is_featured },
          ip: req.ip,
        });
        return { id: id.data, is_featured: parsed.data.is_featured };
      });
      return res.json({ data: result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.get('/categories/:id/image', requirePermission('categories.view'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'A valid category ID is required.' });
    try {
      const result = await database.query(
        'SELECT image, image_mime FROM service_categories WHERE id = $1',
        [id.data],
      );
      const category = result.rows[0];
      if (!category?.image) return res.status(404).json({ error: 'Category image not found.' });
      res.set({
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Type': category.image_mime,
        'Content-Disposition': 'inline',
      });
      return res.send(category.image);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/categories/:id/history', requirePermission('categories.view'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = pageSchema.safeParse(req.query);
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'Category or pagination filters are invalid.' });
    const { page, pageSize } = parsed.data;
    try {
      const [count, rows] = await Promise.all([
        database.query(
          `SELECT COUNT(*) AS total FROM audit_logs
           WHERE entity_id = $1 AND entity_type IN ('service_category', 'categories')`,
          [String(id.data)],
        ),
        database.query(
          `SELECT id, actor_id, action, entity_type, entity_id, details, created_at
           FROM audit_logs
           WHERE entity_id = $1 AND entity_type IN ('service_category', 'categories')
           ORDER BY id DESC LIMIT $2 OFFSET $3`,
          [String(id.data), pageSize, (page - 1) * pageSize],
        ),
      ]);
      return res.json({
        data: rows.rows,
        pagination: { page, pageSize, total: Number(count.rows[0]?.total || 0) },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/categories', requirePermission('categories.view'), async (req, res, next) => {
    const parsed = categoryListSchema.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { page, pageSize, q, status, sortBy, sortDirection } = parsed.data;
    const conditions = [];
    const values = [];
    if (q) {
      values.push(`%${q}%`);
      conditions.push(`(sc.name ILIKE $${values.length} OR COALESCE(sc.description, '') ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status === 'active' || status === '1');
      conditions.push(`sc.is_active = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderColumns = {
      id: 'sc.id',
      name: 'sc.name',
      display_order: 'sc.display_order',
      service_count: 'service_count',
      is_active: 'sc.is_active',
      created_at: 'sc.created_at',
    };
    try {
      const [count, rows] = await Promise.all([
        database.query(`SELECT COUNT(*) AS total FROM service_categories sc ${where}`, values),
        database.query(
          `SELECT sc.id, sc.name, sc.description, sc.display_order, sc.image_mime, sc.is_active,
                  sc.created_at, sc.updated_at, COUNT(DISTINCT s.id)::int AS service_count
           FROM service_categories sc
           LEFT JOIN services s ON s.category_id = sc.id
           ${where}
           GROUP BY sc.id
           ORDER BY ${orderColumns[sortBy]} ${sortDirection.toUpperCase()}, sc.id ASC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, pageSize, (page - 1) * pageSize],
        ),
      ]);
      const total = Number(count.rows[0]?.total || 0);
      return res.json({
        data: rows.rows.map((row) => ({
          ...row,
          id: Number(row.id),
          display_order: Number(row.display_order),
          service_count: Number(row.service_count),
          is_active: Boolean(row.is_active),
          image: row.image_mime ? `/api/admin/categories/${Number(row.id)}/image` : null,
        })),
        pagination: { page, pageSize, total },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/categories', requirePermission('categories.create'), async (req, res, next) => {
    const parsed = categoryFieldsSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { name, description = null, display_order: displayOrder = 0 } = parsed.data;
    try {
      const id = await database.inTransaction(async (transaction) => {
        await assertCategoryNameAvailable(transaction, name);
        const created = await transaction.query(
          `INSERT INTO service_categories (name, description, display_order)
           VALUES ($1, $2, $3) RETURNING id`,
          [name, description || null, displayOrder],
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'service_category.created',
          entityType: 'service_category',
          entityId: created.rows[0].id,
          details: { name, description: description || null, display_order: displayOrder },
          ip: req.ip,
        });
        return Number(created.rows[0].id);
      });
      return res.status(201).json({ data: { id } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') return res.status(409).json({ error: 'A category with this name already exists.' });
      return next(error);
    }
  });

  router.patch('/categories/:id/status', requirePermission('categories.edit'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = categoryStatusSchema.safeParse(req.body || {});
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'Category ID or status is invalid.' });
    try {
      await database.inTransaction(async (transaction) => {
        const selected = await transaction.query(
          'SELECT id, name, is_active FROM service_categories WHERE id = $1 FOR UPDATE',
          [id.data],
        );
        const category = selected.rows[0];
        if (!category) throw statusError('Category not found.', 404);
        const from = Boolean(category.is_active);
        if (from === parsed.data.is_active) return;
        const usage = await transaction.query(
          'SELECT COUNT(*)::int AS service_count FROM services WHERE category_id = $1',
          [id.data],
        );
        await transaction.query(
          'UPDATE service_categories SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [parsed.data.is_active, id.data],
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'service_category.status_changed',
          entityType: 'service_category',
          entityId: id.data,
          details: {
            name: category.name,
            from,
            to: parsed.data.is_active,
            service_count: Number(usage.rows[0]?.service_count || 0),
          },
          ip: req.ip,
        });
      });
      return res.json({ data: { id: id.data, is_active: parsed.data.is_active } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.patch('/categories/:id', requirePermission('categories.edit'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = categoryFieldsSchema.partial().safeParse(req.body || {});
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'Category ID or update data is invalid.' });
    const fields = Object.keys(parsed.data);
    if (!fields.length) return res.status(400).json({ error: 'Provide at least one editable category field.' });
    try {
      await database.inTransaction(async (transaction) => {
        const selected = await transaction.query(
          'SELECT id, name, description, display_order FROM service_categories WHERE id = $1 FOR UPDATE',
          [id.data],
        );
        const category = selected.rows[0];
        if (!category) throw statusError('Category not found.', 404);
        if (parsed.data.name !== undefined) await assertCategoryNameAvailable(transaction, parsed.data.name, id.data);
        const before = Object.fromEntries(fields.map((field) => [field, category[field]]));
        const after = Object.fromEntries(fields.map((field) => [
          field,
          field === 'description' ? (parsed.data[field] || null) : parsed.data[field],
        ]));
        const setClauses = fields.map((field, index) => `${field} = $${index + 1}`);
        setClauses.push('updated_at = CURRENT_TIMESTAMP');
        await transaction.query(
          `UPDATE service_categories SET ${setClauses.join(', ')} WHERE id = $${fields.length + 1}`,
          [...fields.map((field) => after[field]), id.data],
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'service_category.updated',
          entityType: 'service_category',
          entityId: id.data,
          details: { before, after },
          ip: req.ip,
        });
      });
      return res.json({ data: { id: id.data } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') return res.status(409).json({ error: 'A category with this name already exists.' });
      return next(error);
    }
  });

  router.delete('/categories/:id/image', requirePermission('categories.edit'), async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'A valid category ID is required.' });
    try {
      await database.inTransaction(async (transaction) => {
        const selected = await transaction.query(
          'SELECT id, name, image_mime FROM service_categories WHERE id = $1 FOR UPDATE',
          [id.data],
        );
        const category = selected.rows[0];
        if (!category) throw statusError('Category not found.', 404);
        if (!category.image_mime) return;
        await transaction.query(
          'UPDATE service_categories SET image = NULL, image_mime = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [id.data],
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'service_category.image_removed',
          entityType: 'service_category',
          entityId: id.data,
          details: { name: category.name, from: category.image_mime, to: null },
          ip: req.ip,
        });
      });
      return res.status(204).end();
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.put('/categories/:id/image', requirePermission('categories.edit'), categoryImageParser, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.id);
    const mimeType = req.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    const validation = validateProfilePhoto(mimeType, req.body);
    if (!id.success) return res.status(400).json({ error: 'A valid category ID is required.' });
    if (!validation.valid) return res.status(400).json({ error: validation.error.replace('Profile photos', 'Category images') });
    try {
      await database.inTransaction(async (transaction) => {
        const selected = await transaction.query(
          'SELECT id, name, image_mime FROM service_categories WHERE id = $1 FOR UPDATE',
          [id.data],
        );
        const category = selected.rows[0];
        if (!category) throw statusError('Category not found.', 404);
        await transaction.query(
          `UPDATE service_categories
           SET image = $1, image_mime = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
          [req.body, mimeType, id.data],
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'service_category.image_updated',
          entityType: 'service_category',
          entityId: id.data,
          details: { name: category.name, from: category.image_mime, to: mimeType, bytes: req.body.length },
          ip: req.ip,
        });
      });
      return res.json({ data: { id: id.data, image: `/api/platform/categories/${id.data}/image` } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}
