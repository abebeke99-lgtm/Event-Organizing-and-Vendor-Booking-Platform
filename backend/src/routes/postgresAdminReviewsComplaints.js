import { Router } from 'express';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { getRequestId } from '../lib/requestContext.js';
import { sanitizeAuditDetails } from '../lib/auditSanitizer.js';
import {
  complaintAttachmentParser,
  sanitizeComplaintAttachmentName,
  validateComplaintAttachment,
} from '../lib/complaintAttachments.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const reviewQuerySchema = z.object({
  ...pageFields,
  q: z.string().trim().max(120).optional(),
  status: z.enum(['published', 'hidden', 'flagged']).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  vendorId: z.coerce.number().int().positive().optional(),
  serviceId: z.coerce.number().int().positive().optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  sortBy: z.enum(['created_at', 'rating', 'vendor_name', 'service_title']).default('created_at'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
}).strict().superRefine(validateDates);
const complaintQuerySchema = z.object({
  ...pageFields,
  q: z.string().trim().max(120).optional(),
  status: z.enum(['open', 'under_review', 'resolved', 'closed']).optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  sortBy: z.enum(['created_at', 'status', 'subject', 'customer_name', 'vendor_name']).default('created_at'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
}).strict().superRefine(validateDates);
const reviewModerationSchema = z.object({
  status: z.enum(['published', 'hidden']),
  reason: z.string().trim().min(5).max(500),
}).strict();
const complaintUpdateSchema = z.object({
  status: z.enum(['open', 'under_review', 'resolved', 'closed']).optional(),
  resolution: z.string().trim().max(1000).optional(),
  reason: z.string().trim().min(5).max(500),
  assignedTo: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
}).strict().refine((value) => value.status !== undefined || value.assignedTo !== undefined, {
  message: 'Choose a status change or assignment update.',
});
const reviewFrom = `FROM reviews r
  JOIN bookings b ON b.id = r.booking_id
  JOIN events e ON e.id = b.event_id
  JOIN users customer ON customer.id = e.organizer_id
  JOIN vendor_profiles vp ON vp.id = b.vendor_id
  LEFT JOIN services s ON s.id = b.service_id`;
const complaintFrom = `FROM complaints c
  JOIN users customer ON customer.id = c.user_id
  LEFT JOIN bookings b ON b.id = c.booking_id
  LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
  LEFT JOIN users vendor_user ON vendor_user.id = vp.user_id
  LEFT JOIN users assignee ON assignee.id = c.assigned_to`;
const numericIdFields = new Set([
  'id', 'user_id', 'booking_id', 'customer_id', 'vendor_id', 'vendor_user_id',
  'service_id', 'event_id', 'assigned_to', 'actor_id', 'uploaded_by', 'attachment_count',
]);

function normalizeIds(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    numericIdFields.has(key) && value !== null && Number.isSafeInteger(Number(value)) ? Number(value) : value,
  ]));
}

function validateDates(query, context) {
  for (const key of ['dateFrom', 'dateTo']) {
    if (!query[key]) continue;
    const parsed = new Date(`${query[key]}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== query[key]) {
      context.addIssue({ code: 'custom', path: [key], message: `Enter a valid ${key === 'dateFrom' ? 'start' : 'end'} date.` });
    }
  }
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after start date.' });
  }
}

function invalidRequest(res, error) {
  return res.status(400).json({
    error: 'Invalid request data.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

function filtersFor(query, type) {
  const clauses = [];
  const values = [];
  const add = (clause, ...params) => {
    let index = values.length;
    clauses.push(clause.replaceAll('$n', () => `$${++index}`));
    values.push(...params);
  };
  if (query.q) {
    const term = `%${query.q}%`;
    if (type === 'review') {
      const reviewId = query.q.match(/^RV-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      const bookingId = query.q.match(/^BK-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      add(`(r.id = $n OR r.comment ILIKE $n OR customer.full_name ILIKE $n
        OR customer.email ILIKE $n OR vp.business_name ILIKE $n OR s.title ILIKE $n OR b.id = $n
        OR 'RV-' || LPAD(r.id::text, 6, '0') = $n OR 'BK-' || LPAD(b.id::text, 6, '0') = $n)`,
      reviewId, term, term, term, term, term, bookingId, query.q, query.q);
    } else {
      const complaintId = query.q.match(/^CMP-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      const bookingId = query.q.match(/^BK-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      add(`(c.id = $n OR c.id::text ILIKE $n OR c.subject ILIKE $n OR c.details ILIKE $n
        OR customer.full_name ILIKE $n OR customer.email ILIKE $n OR vp.business_name ILIKE $n
        OR b.id::text = $n OR b.id = $n OR 'BK-' || LPAD(b.id::text, 6, '0') = $n)`,
      complaintId, term, term, term, term, term, term, bookingId, bookingId, query.q);
    }
  }
  if (query.status) {
    values.push(query.status);
    clauses.push(`${type === 'review' ? 'r' : 'c'}.status = $${values.length}`);
  }
  if (type === 'review') {
    for (const [field, column] of [['rating', 'r.rating'], ['vendorId', 'b.vendor_id'], ['serviceId', 'b.service_id']]) {
      if (query[field] === undefined) continue;
      values.push(query[field]);
      clauses.push(`${column} = $${values.length}`);
    }
  }
  const dateColumn = type === 'review' ? 'r.created_at' : 'c.created_at';
  if (query.dateFrom) {
    values.push(query.dateFrom);
    clauses.push(`${dateColumn} >= ($${values.length}::date::timestamp AT TIME ZONE 'UTC')`);
  }
  if (query.dateTo) {
    values.push(query.dateTo);
    clauses.push(`${dateColumn} < (($${values.length}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

async function writeAudit(transaction, req, { action, entityId, details }) {
  await transaction.query(
    `INSERT INTO audit_logs
       (actor_id, action, entity_type, entity_id, details, ip_address, request_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      req.admin.id, action, action.split('.')[0], String(entityId),
      JSON.stringify(sanitizeAuditDetails(details)), req.ip || null, getRequestId(),
    ],
  );
}

async function createNotification(transaction, { userId, title, message, relatedId, actorId }) {
  const inserted = await transaction.query(
    `INSERT INTO notifications
       (user_id, title, message, notification_type, related_entity_type, related_entity_id,
        delivery_channel, delivery_status)
     VALUES ($1, $2, $3, 'complaint', 'complaint', $4, 'in_app', 'delivered')
     RETURNING id`,
    [userId, title, message, String(relatedId)],
  );
  const notificationId = inserted.rows[0]?.id;
  if (notificationId) {
    await transaction.query(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES ($1, $2, 'created', $3::jsonb)`,
      [notificationId, actorId, JSON.stringify({ source: 'complaint', channel: 'in_app' })],
    );
  }
}

export function createPostgresAdminReviewsComplaintsRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/reviews/vendors', requirePermission('reviews.moderate'), asyncHandler(async (_req, res) => {
    const rows = await database.query(
      `SELECT DISTINCT vp.id, vp.business_name
       FROM vendor_profiles vp JOIN bookings b ON b.vendor_id = vp.id
       JOIN reviews r ON r.booking_id = b.id ORDER BY vp.business_name`,
    );
    return res.json({ data: rows.rows.map(normalizeIds) });
  }));

  router.get('/reviews/services', requirePermission('reviews.moderate'), asyncHandler(async (req, res) => {
    const vendorId = req.query.vendorId ? idSchema.safeParse(req.query.vendorId) : null;
    if (vendorId && !vendorId.success) return res.status(400).json({ error: 'Vendor ID is invalid.' });
    const rows = await database.query(
      `SELECT DISTINCT s.id, s.title FROM services s
       JOIN bookings b ON b.service_id = s.id JOIN reviews r ON r.booking_id = b.id
       ${vendorId ? 'WHERE b.vendor_id = $1' : ''} ORDER BY s.title`,
      vendorId ? [vendorId.data] : [],
    );
    return res.json({ data: rows.rows.map(normalizeIds) });
  }));

  router.get('/reviews', requirePermission('reviews.moderate'), asyncHandler(async (req, res) => {
    const parsed = reviewQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalidRequest(res, parsed.error);
    const { page, pageSize, sortBy, sortDirection } = parsed.data;
    const { where, values } = filtersFor(parsed.data, 'review');
    const ordering = {
      created_at: 'r.created_at', rating: 'r.rating',
      vendor_name: 'vp.business_name', service_title: 's.title',
    }[sortBy];
    const count = await database.query(`SELECT COUNT(*) AS total ${reviewFrom} ${where}`, values);
    const rows = await database.query(
      `SELECT r.id, r.booking_id, r.rating, r.comment, r.status, r.created_at,
              customer.id AS customer_id, customer.full_name AS customer_name, customer.email AS customer_email,
              b.vendor_id, vp.business_name AS vendor_name, b.service_id, s.title AS service_title,
              e.id AS event_id, e.title AS event_title
       ${reviewFrom} ${where}
       ORDER BY ${ordering} ${sortDirection.toUpperCase()}, r.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    return res.json({ data: rows.rows.map(normalizeIds), pagination: { page, pageSize, total: Number(count.rows[0]?.total || 0) } });
  }));

  router.get('/reviews/:id', requirePermission('reviews.moderate'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Review ID is invalid.' });
    const review = await database.query(
      `SELECT r.id, r.booking_id, r.rating, r.comment, r.status, r.created_at,
              customer.id AS customer_id, customer.full_name AS customer_name, customer.email AS customer_email,
              b.vendor_id, vp.business_name AS vendor_name, b.service_id, s.title AS service_title,
              e.id AS event_id, e.title AS event_title
       ${reviewFrom} WHERE r.id = $1`,
      [id.data],
    );
    if (!review.rows[0]) return res.status(404).json({ error: 'Review not found.' });
    const history = await database.query(
      `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.from_status,
              h.to_status, h.reason, h.created_at
       FROM review_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.review_id = $1 ORDER BY h.id DESC`,
      [id.data],
    );
    return res.json({ data: { ...normalizeIds(review.rows[0]), history: history.rows.map(normalizeIds) } });
  }));

  router.patch('/reviews/:id/moderation', requirePermission('reviews.moderate'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = reviewModerationSchema.safeParse(req.body || {});
    if (!id.success) return res.status(400).json({ error: 'Review ID is invalid.' });
    if (!parsed.success) return invalidRequest(res, parsed.error);
    const updated = await database.inTransaction(async (transaction) => {
      const review = await transaction.query(
        'SELECT id, booking_id, status FROM reviews WHERE id = $1 FOR UPDATE',
        [id.data],
      );
      if (!review.rows[0]) throw Object.assign(new Error('Review not found.'), { status: 404 });
      if (review.rows[0].status === parsed.data.status) {
        throw Object.assign(new Error('The review is already in that moderation state.'), { status: 409 });
      }
      if (!['published', 'hidden', 'flagged'].includes(review.rows[0].status)) {
        throw Object.assign(new Error('This review cannot be moderated from its current state.'), { status: 409 });
      }
      await transaction.query('UPDATE reviews SET status = $1 WHERE id = $2', [parsed.data.status, id.data]);
      await transaction.query(
        `INSERT INTO review_history (review_id, actor_id, action, from_status, to_status, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id.data, req.admin.id, parsed.data.status === 'hidden' ? 'hidden' : 'restored',
          review.rows[0].status, parsed.data.status, parsed.data.reason],
      );
      await writeAudit(transaction, req, {
        action: `review.${parsed.data.status}`,
        entityId: id.data,
        details: {
          bookingId: Number(review.rows[0].booking_id), from: review.rows[0].status,
          to: parsed.data.status, reason: parsed.data.reason,
        },
      });
      return { id: id.data, status: parsed.data.status };
    });
    return res.json({ data: updated });
  }));

  router.get('/complaints/assignees', requirePermission('complaints.manage'), asyncHandler(async (_req, res) => {
    const rows = await database.query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
       ORDER BY u.full_name`,
    );
    return res.json({ data: rows.rows.map(normalizeIds) });
  }));

  router.get('/complaints', requirePermission('complaints.manage'), asyncHandler(async (req, res) => {
    const parsed = complaintQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalidRequest(res, parsed.error);
    const { page, pageSize, sortBy, sortDirection } = parsed.data;
    const { where, values } = filtersFor(parsed.data, 'complaint');
    const ordering = {
      created_at: 'c.created_at', status: 'c.status', subject: 'c.subject',
      customer_name: 'customer.full_name', vendor_name: 'vp.business_name',
    }[sortBy];
    const count = await database.query(`SELECT COUNT(*) AS total ${complaintFrom} ${where}`, values);
    const rows = await database.query(
      `SELECT c.id, c.user_id, c.booking_id, c.subject, c.details, c.status, c.resolution,
              c.assigned_to, c.created_at, customer.full_name AS customer_name,
              customer.email AS customer_email, b.vendor_id, vp.business_name AS vendor_name,
              vendor_user.id AS vendor_user_id, assignee.full_name AS assignee_name,
              (SELECT COUNT(*) FROM complaint_attachments ca WHERE ca.complaint_id = c.id) AS attachment_count
       ${complaintFrom} ${where}
       ORDER BY ${ordering} ${sortDirection.toUpperCase()}, c.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    return res.json({ data: rows.rows.map(normalizeIds), pagination: { page, pageSize, total: Number(count.rows[0]?.total || 0) } });
  }));

  router.get('/complaints/:id', requirePermission('complaints.manage'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
    const result = await database.query(
      `SELECT c.id, c.user_id, c.booking_id, c.subject, c.details, c.status, c.resolution,
              c.assigned_to, c.created_at, customer.full_name AS customer_name,
              customer.email AS customer_email, b.vendor_id, vp.business_name AS vendor_name,
              vendor_user.id AS vendor_user_id, assignee.full_name AS assignee_name, e.title AS event_title
       ${complaintFrom}
       LEFT JOIN events e ON e.id = b.event_id WHERE c.id = $1`,
      [id.data],
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Complaint not found.' });
    const [attachments, history] = await Promise.all([
      database.query(
        `SELECT id, original_name, content_type, file_size, sha256, uploaded_by, created_at
         FROM complaint_attachments WHERE complaint_id = $1 ORDER BY id DESC`,
        [id.data],
      ),
      database.query(
        `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.from_status,
                h.to_status, h.reason, h.details, h.created_at
         FROM complaint_history h LEFT JOIN users u ON u.id = h.actor_id
         WHERE h.complaint_id = $1 ORDER BY h.id DESC`,
        [id.data],
      ),
    ]);
    return res.json({
      data: {
        ...normalizeIds(result.rows[0]), reference: `CMP-${String(id.data).padStart(6, '0')}`,
        attachments: attachments.rows.map(normalizeIds), history: history.rows.map(normalizeIds),
      },
    });
  }));

  router.patch('/complaints/:id', requirePermission('complaints.manage'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = complaintUpdateSchema.safeParse(req.body || {});
    if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
    if (!parsed.success) return invalidRequest(res, parsed.error);
    if (parsed.data.status === 'resolved' && (!parsed.data.resolution || parsed.data.resolution.length < 5)) {
      return res.status(400).json({ error: 'Resolution notes of at least five characters are required to resolve a complaint.' });
    }
    const result = await database.inTransaction(async (transaction) => {
      const selected = await transaction.query(
        `SELECT c.id, c.user_id, c.status, c.resolution, c.assigned_to, c.booking_id,
                customer.full_name AS customer_name, vp.business_name AS vendor_name,
                vendor_user.id AS vendor_user_id
         FROM complaints c JOIN users customer ON customer.id = c.user_id
         LEFT JOIN bookings b ON b.id = c.booking_id
         LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
         LEFT JOIN users vendor_user ON vendor_user.id = vp.user_id
         WHERE c.id = $1 FOR UPDATE OF c`,
        [id.data],
      );
      const complaint = selected.rows[0];
      if (!complaint) throw Object.assign(new Error('Complaint not found.'), { status: 404 });
      const nextStatus = parsed.data.status || complaint.status;
      const transitions = {
        open: ['under_review', 'resolved', 'closed'],
        under_review: ['open', 'resolved', 'closed'],
        resolved: ['under_review', 'closed'],
        closed: ['under_review'],
      };
      if (nextStatus !== complaint.status && !(transitions[complaint.status] || []).includes(nextStatus)) {
        throw Object.assign(new Error(`Cannot change complaint from ${complaint.status} to ${nextStatus}.`), { status: 409 });
      }
      let assignee = complaint.assigned_to;
      if (parsed.data.assignedTo !== undefined) {
        assignee = null;
        if (parsed.data.assignedTo !== null) {
          const staff = await transaction.query(
            `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE u.id = $1 AND u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
             LIMIT 1`,
            [parsed.data.assignedTo],
          );
          if (!staff.rows[0]) {
            throw Object.assign(new Error('Assign complaints only to active administrator staff.'), { status: 400 });
          }
          assignee = Number(staff.rows[0].id);
        }
      }
      const resolution = parsed.data.resolution ?? complaint.resolution;
      await transaction.query(
        'UPDATE complaints SET status = $1, resolution = $2, assigned_to = $3 WHERE id = $4',
        [nextStatus, resolution, assignee, id.data],
      );
      const action = nextStatus !== complaint.status ? 'status_changed'
        : parsed.data.assignedTo !== undefined && String(assignee) !== String(complaint.assigned_to)
          ? 'assigned' : 'updated';
      const details = {
        previousAssignee: complaint.assigned_to,
        assignedTo: assignee,
        previousResolution: complaint.resolution,
        resolution,
        resolutionChanged: parsed.data.resolution !== undefined && parsed.data.resolution !== complaint.resolution,
      };
      await transaction.query(
        `INSERT INTO complaint_history (complaint_id, actor_id, action, from_status, to_status, reason, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [id.data, req.admin.id, action, complaint.status, nextStatus, parsed.data.reason, JSON.stringify(details)],
      );
      await writeAudit(transaction, req, {
        action: `complaint.${action}`,
        entityId: id.data,
        details: { from: complaint.status, to: nextStatus, ...details, reason: parsed.data.reason },
      });
      if (nextStatus !== complaint.status) {
        const title = `Complaint ${nextStatus.replaceAll('_', ' ')}`;
        const message = `Your complaint CMP-${String(id.data).padStart(6, '0')} is now ${nextStatus.replaceAll('_', ' ')}.${resolution ? ` Resolution: ${resolution}` : ''}`;
        for (const userId of new Set([Number(complaint.user_id), Number(complaint.vendor_user_id)])) {
          if (userId && userId !== Number(req.admin.id)) {
            await createNotification(transaction, { userId, title, message, relatedId: id.data, actorId: req.admin.id });
          }
        }
      }
      if (assignee && String(assignee) !== String(complaint.assigned_to)) {
        await createNotification(transaction, {
          userId: assignee, title: 'Complaint assigned',
          message: `Complaint CMP-${String(id.data).padStart(6, '0')} has been assigned to you.`,
          relatedId: id.data, actorId: req.admin.id,
        });
      }
      return { id: id.data, status: nextStatus, assigned_to: assignee };
    });
    return res.json({ data: result });
  }));

  router.post('/complaints/:id/attachments', requirePermission('complaints.manage'), complaintAttachmentParser, asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
    const buffer = req.body;
    const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (!Buffer.isBuffer(buffer)) return res.status(415).json({ error: 'Upload a PDF, JPEG, PNG, or WebP attachment.' });
    const validation = validateComplaintAttachment(buffer, contentType);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const created = await database.inTransaction(async (transaction) => {
      const complaint = await transaction.query('SELECT id, status FROM complaints WHERE id = $1 FOR UPDATE', [id.data]);
      if (!complaint.rows[0]) throw Object.assign(new Error('Complaint not found.'), { status: 404 });
      const inserted = await transaction.query(
        `INSERT INTO complaint_attachments
         (complaint_id, uploaded_by, original_name, content_type, file_size, sha256, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [id.data, req.admin.id, sanitizeComplaintAttachmentName(req.query.filename),
          contentType, validation.fileSize, validation.sha256, buffer],
      );
      await transaction.query(
        `INSERT INTO complaint_history (complaint_id, actor_id, action, from_status, to_status, details)
         VALUES ($1, $2, 'attachment_added', $3, $3, $4::jsonb)`,
        [id.data, req.admin.id, complaint.rows[0].status, JSON.stringify({ attachmentId: inserted.rows[0].id })],
      );
      await writeAudit(transaction, req, {
        action: 'complaint.attachment_added', entityId: id.data,
        details: { attachmentId: inserted.rows[0].id, fileName: sanitizeComplaintAttachmentName(req.query.filename), fileSize: validation.fileSize },
      });
      return inserted.rows[0].id;
    });
    return res.status(201).json({ data: { id: Number(created) } });
  }));

  router.get('/complaints/:id/attachments/:attachmentId', requirePermission('complaints.manage'), asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const attachmentId = idSchema.safeParse(req.params.attachmentId);
    if (!id.success || !attachmentId.success) return res.status(400).json({ error: 'Attachment ID is invalid.' });
    const result = await database.query(
      `SELECT original_name, content_type, file_size, file_data
       FROM complaint_attachments WHERE id = $1 AND complaint_id = $2`,
      [attachmentId.data, id.data],
    );
    const file = result.rows[0];
    if (!file) return res.status(404).json({ error: 'Attachment not found.' });
    res.set({
      'Content-Type': file.content_type,
      'Content-Length': file.file_size,
      'Content-Disposition': `attachment; filename="${sanitizeComplaintAttachmentName(file.original_name)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(file.file_data);
  }));

  return router;
}
