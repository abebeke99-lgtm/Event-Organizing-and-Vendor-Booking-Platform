import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeAudit } from '../lib/security.js';
import { createNotification } from '../lib/notificationService.js';
import {
  complaintAttachmentParser,
  sanitizeComplaintAttachmentName,
  validateComplaintAttachment,
} from '../lib/complaintAttachments.js';

const router = Router();
const databaseFor = (req) => req.app?.locals?.database || pool;
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

function validateDates(query, context) {
  for (const key of ['dateFrom', 'dateTo']) {
    if (query[key] && !isValidDate(query[key])) {
      context.addIssue({ code: 'custom', path: [key], message: `Enter a valid ${key === 'dateFrom' ? 'start' : 'end'} date.` });
    }
  }
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after start date.' });
  }
}

function isValidDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function listResponse(res, parsed, rows, total) {
  const { page, pageSize } = parsed;
  return res.json({
    data: rows,
    pagination: { page, pageSize, total: Number(total) },
  });
}

function filtersFor(query, type) {
  const clauses = [];
  const values = [];
  if (query.q) {
    const term = `%${query.q}%`;
    if (type === 'review') {
      const reviewId = query.q.match(/^RV-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      const bookingId = query.q.match(/^BK-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      clauses.push(`(r.id = ? OR r.comment LIKE ? OR customer.full_name LIKE ?
        OR customer.email LIKE ? OR vp.business_name LIKE ? OR s.title LIKE ? OR b.id = ?
        OR CONCAT('RV-', LPAD(r.id, 6, '0')) = ? OR CONCAT('BK-', LPAD(b.id, 6, '0')) = ?)`);
      values.push(reviewId, term, term, term, term, term, bookingId, query.q, query.q);
    } else {
      const complaintId = query.q.match(/^CMP-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      const bookingId = query.q.match(/^BK-(\d+)$/i)?.[1] || (/^\d+$/.test(query.q) ? query.q : '-1');
      clauses.push(`(c.id = ? OR CAST(c.id AS CHAR) LIKE ? OR c.subject LIKE ? OR c.details LIKE ?
        OR customer.full_name LIKE ? OR customer.email LIKE ? OR vp.business_name LIKE ?
        OR CAST(b.id AS CHAR) = ? OR b.id = ? OR CONCAT('BK-', LPAD(b.id, 6, '0')) = ?)`);
      values.push(complaintId, term, term, term, term, term, term, bookingId, bookingId, query.q);
    }
  }
  if (query.status) {
    clauses.push(`${type === 'review' ? 'r' : 'c'}.status = ?`);
    values.push(query.status);
  }
  if (type === 'review') {
    if (query.rating) {
      clauses.push('r.rating = ?');
      values.push(query.rating);
    }
    if (query.vendorId) {
      clauses.push('b.vendor_id = ?');
      values.push(query.vendorId);
    }
    if (query.serviceId) {
      clauses.push('b.service_id = ?');
      values.push(query.serviceId);
    }
  }
  if (query.dateFrom) {
    clauses.push(`${type === 'review' ? 'r' : 'c'}.created_at >= ?`);
    values.push(`${query.dateFrom} 00:00:00`);
  }
  if (query.dateTo) {
    clauses.push(`${type === 'review' ? 'r' : 'c'}.created_at < DATE_ADD(?, INTERVAL 1 DAY)`);
    values.push(`${query.dateTo} 00:00:00`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

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

function sendError(res, error) {
  if (error?.name === 'ZodError') {
    return res.status(400).json({
      error: 'Invalid request data.',
      details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  if (error?.status) return res.status(error.status).json({ error: error.message });
  throw error;
}

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

router.get('/reviews/vendors', requirePermission('reviews.moderate'), async (req, res, next) => {
  try {
    const [rows] = await databaseFor(req).execute(
      `SELECT DISTINCT vp.id, vp.business_name
       FROM vendor_profiles vp JOIN bookings b ON b.vendor_id = vp.id
       JOIN reviews r ON r.booking_id = b.id ORDER BY vp.business_name`,
    );
    return res.json({ data: rows });
  } catch (error) { return next(error); }
});

router.get('/reviews/services', requirePermission('reviews.moderate'), async (req, res, next) => {
  const vendorId = req.query.vendorId ? idSchema.safeParse(req.query.vendorId) : null;
  if (vendorId && !vendorId.success) return res.status(400).json({ error: 'Vendor ID is invalid.' });
  try {
    const [rows] = await databaseFor(req).execute(
      `SELECT DISTINCT s.id, s.title FROM services s
       JOIN bookings b ON b.service_id = s.id JOIN reviews r ON r.booking_id = b.id
       ${vendorId ? 'WHERE b.vendor_id = ?' : ''} ORDER BY s.title`,
      vendorId ? [vendorId.data] : [],
    );
    return res.json({ data: rows });
  } catch (error) { return next(error); }
});

router.get('/reviews', requirePermission('reviews.moderate'), async (req, res, next) => {
  const parsed = reviewQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);
  const database = databaseFor(req);
  const { where, values } = filtersFor(parsed.data, 'review');
  const ordering = {
    created_at: 'r.created_at',
    rating: 'r.rating',
    vendor_name: 'vp.business_name',
    service_title: 's.title',
  };
  try {
    const [[count]] = await database.execute(`SELECT COUNT(*) AS total ${reviewFrom} ${where}`, values);
    const [rows] = await database.execute(
      `SELECT r.id, r.booking_id, r.rating, r.comment, r.status, r.created_at,
              customer.id AS customer_id, customer.full_name AS customer_name, customer.email AS customer_email,
              b.vendor_id, vp.business_name AS vendor_name, b.service_id, s.title AS service_title,
              e.id AS event_id, e.title AS event_title
       ${reviewFrom} ${where}
       ORDER BY ${ordering[parsed.data.sortBy]} ${parsed.data.sortDirection.toUpperCase()}, r.id DESC
       LIMIT ? OFFSET ?`,
      [...values, parsed.data.pageSize, (parsed.data.page - 1) * parsed.data.pageSize],
    );
    return listResponse(res, parsed.data, rows, count.total);
  } catch (error) { return next(error); }
});

router.get('/reviews/:id', requirePermission('reviews.moderate'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Review ID is invalid.' });
  try {
    const database = databaseFor(req);
    const [[review]] = await database.execute(
      `SELECT r.id, r.booking_id, r.rating, r.comment, r.status, r.created_at,
              customer.id AS customer_id, customer.full_name AS customer_name, customer.email AS customer_email,
              b.vendor_id, vp.business_name AS vendor_name, b.service_id, s.title AS service_title,
              e.id AS event_id, e.title AS event_title
       ${reviewFrom} WHERE r.id = ?`,
      [id.data],
    );
    if (!review) return res.status(404).json({ error: 'Review not found.' });
    const [history] = await database.execute(
      `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.from_status,
              h.to_status, h.reason, h.created_at
       FROM review_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.review_id = ? ORDER BY h.id DESC`,
      [id.data],
    );
    return res.json({ data: { ...review, history } });
  } catch (error) { return next(error); }
});

router.patch('/reviews/:id/moderation', requirePermission('reviews.moderate'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = reviewModerationSchema.safeParse(req.body || {});
  if (!id.success) return res.status(400).json({ error: 'Review ID is invalid.' });
  if (!parsed.success) return sendError(res, parsed.error);
  const database = databaseFor(req);
  try {
    const updated = await transaction(database, async (db) => {
      const [[review]] = await db.execute(
        'SELECT id, booking_id, status FROM reviews WHERE id = ? FOR UPDATE',
        [id.data],
      );
      if (!review) throw Object.assign(new Error('Review not found.'), { status: 404 });
      if (review.status === parsed.data.status) {
        throw Object.assign(new Error('The review is already in that moderation state.'), { status: 409 });
      }
      if (!['published', 'hidden', 'flagged'].includes(review.status)) {
        throw Object.assign(new Error('This review cannot be moderated from its current state.'), { status: 409 });
      }
      await db.execute('UPDATE reviews SET status = ? WHERE id = ?', [parsed.data.status, id.data]);
      await db.execute(
        `INSERT INTO review_history (review_id, actor_id, action, from_status, to_status, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id.data, req.admin.id, parsed.data.status === 'hidden' ? 'hidden' : 'restored', review.status, parsed.data.status, parsed.data.reason],
      );
      await writeAudit(db, {
        actorId: req.admin.id,
        action: `review.${parsed.data.status}`,
        entityType: 'review',
        entityId: id.data,
        details: { bookingId: Number(review.booking_id), from: review.status, to: parsed.data.status, reason: parsed.data.reason },
        ip: req.ip,
      });
      return { id: id.data, status: parsed.data.status };
    });
    return res.json({ data: updated });
  } catch (error) {
    try { return sendError(res, error); } catch (unhandled) { return next(unhandled); }
  }
});

router.get('/complaints/assignees', requirePermission('complaints.manage'), async (req, res, next) => {
  try {
    const [rows] = await databaseFor(req).execute(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
       ORDER BY u.full_name`,
    );
    return res.json({ data: rows });
  } catch (error) { return next(error); }
});

router.get('/complaints', requirePermission('complaints.manage'), async (req, res, next) => {
  const parsed = complaintQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);
  const database = databaseFor(req);
  const { where, values } = filtersFor(parsed.data, 'complaint');
  const ordering = {
    created_at: 'c.created_at',
    status: 'c.status',
    subject: 'c.subject',
    customer_name: 'customer.full_name',
    vendor_name: 'vp.business_name',
  };
  try {
    const [[count]] = await database.execute(`SELECT COUNT(*) AS total ${complaintFrom} ${where}`, values);
    const [rows] = await database.execute(
      `SELECT c.id, c.user_id, c.booking_id, c.subject, c.details, c.status, c.resolution,
              c.assigned_to, c.created_at, customer.full_name AS customer_name, customer.email AS customer_email,
              b.vendor_id, vp.business_name AS vendor_name, vendor_user.id AS vendor_user_id,
              assignee.full_name AS assignee_name,
              (SELECT COUNT(*) FROM complaint_attachments ca WHERE ca.complaint_id = c.id) AS attachment_count
       ${complaintFrom} ${where}
       ORDER BY ${ordering[parsed.data.sortBy]} ${parsed.data.sortDirection.toUpperCase()}, c.id DESC
       LIMIT ? OFFSET ?`,
      [...values, parsed.data.pageSize, (parsed.data.page - 1) * parsed.data.pageSize],
    );
    return listResponse(res, parsed.data, rows, count.total);
  } catch (error) { return next(error); }
});

router.get('/complaints/:id', requirePermission('complaints.manage'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
  const database = databaseFor(req);
  try {
    const [[complaint]] = await database.execute(
      `SELECT c.id, c.user_id, c.booking_id, c.subject, c.details, c.status, c.resolution,
              c.assigned_to, c.created_at, customer.full_name AS customer_name, customer.email AS customer_email,
              b.vendor_id, vp.business_name AS vendor_name, vendor_user.id AS vendor_user_id,
              assignee.full_name AS assignee_name, e.title AS event_title
       ${complaintFrom}
       LEFT JOIN events e ON e.id = b.event_id WHERE c.id = ?`,
      [id.data],
    );
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    const [[attachments], [history]] = await Promise.all([
      database.execute(
        `SELECT id, original_name, content_type, file_size, sha256, uploaded_by, created_at
         FROM complaint_attachments WHERE complaint_id = ? ORDER BY id DESC`,
        [id.data],
      ),
      database.execute(
        `SELECT h.id, h.actor_id, u.full_name AS actor_name, h.action, h.from_status,
                h.to_status, h.reason, h.details, h.created_at
         FROM complaint_history h LEFT JOIN users u ON u.id = h.actor_id
         WHERE h.complaint_id = ? ORDER BY h.id DESC`,
        [id.data],
      ),
    ]);
    return res.json({ data: { ...complaint, reference: `CMP-${String(id.data).padStart(6, '0')}`, attachments, history } });
  } catch (error) { return next(error); }
});

router.patch('/complaints/:id', requirePermission('complaints.manage'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = complaintUpdateSchema.safeParse(req.body || {});
  if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
  if (!parsed.success) return sendError(res, parsed.error);
  if (parsed.data.status === 'resolved' && (!parsed.data.resolution || parsed.data.resolution.length < 5)) {
    return res.status(400).json({ error: 'Resolution notes of at least five characters are required to resolve a complaint.' });
  }
  const database = databaseFor(req);
  try {
    const result = await transaction(database, async (db) => {
      const [[complaint]] = await db.execute(
        `SELECT c.id, c.user_id, c.status, c.resolution, c.assigned_to, c.booking_id,
                customer.full_name AS customer_name, vp.business_name AS vendor_name,
                vendor_user.id AS vendor_user_id
         FROM complaints c JOIN users customer ON customer.id = c.user_id
         LEFT JOIN bookings b ON b.id = c.booking_id
         LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
         LEFT JOIN users vendor_user ON vendor_user.id = vp.user_id
         WHERE c.id = ? FOR UPDATE`,
        [id.data],
      );
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
      let assignee = null;
      if (parsed.data.assignedTo !== undefined && parsed.data.assignedTo !== null) {
        const [[staff]] = await db.execute(
          `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE u.id = ? AND u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
           LIMIT 1`,
          [parsed.data.assignedTo],
        );
        if (!staff) throw Object.assign(new Error('Assign complaints only to active administrator staff.'), { status: 400 });
        assignee = Number(staff.id);
      }
      const resolution = parsed.data.resolution ?? complaint.resolution;
      await db.execute(
        'UPDATE complaints SET status = ?, resolution = ?, assigned_to = ? WHERE id = ?',
        [nextStatus, resolution, parsed.data.assignedTo === undefined ? complaint.assigned_to : assignee, id.data],
      );
      const action = nextStatus !== complaint.status ? 'status_changed'
        : parsed.data.assignedTo !== undefined && Number(parsed.data.assignedTo) !== Number(complaint.assigned_to) ? 'assigned'
          : 'updated';
      const details = {
        previousAssignee: complaint.assigned_to,
        assignedTo: parsed.data.assignedTo === undefined ? complaint.assigned_to : assignee,
        previousResolution: complaint.resolution,
        resolution,
        resolutionChanged: parsed.data.resolution !== undefined && parsed.data.resolution !== complaint.resolution,
      };
      await db.execute(
        `INSERT INTO complaint_history (complaint_id, actor_id, action, from_status, to_status, reason, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id.data, req.admin.id, action, complaint.status, nextStatus, parsed.data.reason, JSON.stringify(details)],
      );
      await writeAudit(db, {
        actorId: req.admin.id,
        action: `complaint.${action}`,
        entityType: 'complaint',
        entityId: id.data,
        details: { from: complaint.status, to: nextStatus, ...details, reason: parsed.data.reason },
        ip: req.ip,
      });
      if (nextStatus !== complaint.status) {
        const title = `Complaint ${nextStatus.replaceAll('_', ' ')}`;
        const message = `Your complaint CMP-${String(id.data).padStart(6, '0')} is now ${nextStatus.replaceAll('_', ' ')}.${resolution ? ` Resolution: ${resolution}` : ''}`;
        for (const userId of new Set([Number(complaint.user_id), Number(complaint.vendor_user_id)])) {
          if (userId && userId !== Number(req.admin.id)) {
            await createNotification(db, {
              userId,
              title,
              message,
              type: 'complaint',
              relatedType: 'complaint',
              relatedId: id.data,
              actorId: req.admin.id,
            });
          }
        }
      }
      const assignedTo = parsed.data.assignedTo === undefined ? complaint.assigned_to : assignee;
      if (assignedTo && Number(assignedTo) !== Number(complaint.assigned_to)) {
        await createNotification(db, {
          userId: assignedTo,
          title: 'Complaint assigned',
          message: `Complaint CMP-${String(id.data).padStart(6, '0')} has been assigned to you.`,
          type: 'complaint',
          relatedType: 'complaint',
          relatedId: id.data,
          actorId: req.admin.id,
        });
      }
      return { id: id.data, status: nextStatus, assigned_to: parsed.data.assignedTo === undefined ? complaint.assigned_to : assignee };
    });
    return res.json({ data: result });
  } catch (error) {
    try { return sendError(res, error); } catch (unhandled) { return next(unhandled); }
  }
});

router.post('/complaints/:id/attachments', requirePermission('complaints.manage'), complaintAttachmentParser, async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Complaint ID is invalid.' });
  const buffer = req.body;
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (!Buffer.isBuffer(buffer)) return res.status(415).json({ error: 'Upload a PDF, JPEG, PNG, or WebP attachment.' });
  const validation = validateComplaintAttachment(buffer, contentType);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  const database = databaseFor(req);
  try {
    const [[complaint]] = await database.execute('SELECT id, status FROM complaints WHERE id = ?', [id.data]);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    const filename = sanitizeComplaintAttachmentName(req.query.filename);
    const [result] = await database.execute(
      `INSERT INTO complaint_attachments
       (complaint_id, uploaded_by, original_name, content_type, file_size, sha256, file_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id.data, req.admin.id, filename, contentType, validation.fileSize, validation.sha256, buffer],
    );
    await database.execute(
      `INSERT INTO complaint_history (complaint_id, actor_id, action, from_status, to_status, details)
       VALUES (?, ?, 'attachment_added', ?, ?, ?)`,
      [id.data, req.admin.id, complaint.status, complaint.status, JSON.stringify({ attachmentId: result.insertId, contentType, fileSize: validation.fileSize })],
    );
    await writeAudit(database, {
      actorId: req.admin.id,
      action: 'complaint.attachment_added',
      entityType: 'complaint',
      entityId: id.data,
      details: { attachmentId: result.insertId, contentType, fileSize: validation.fileSize },
      ip: req.ip,
    });
    return res.status(201).json({ data: { id: result.insertId, original_name: filename, content_type: contentType, file_size: validation.fileSize } });
  } catch (error) { return next(error); }
});

router.get('/complaints/:id/attachments/:attachmentId', requirePermission('complaints.manage'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const attachmentId = idSchema.safeParse(req.params.attachmentId);
  if (!id.success || !attachmentId.success) return res.status(400).json({ error: 'Attachment ID is invalid.' });
  try {
    const [[file]] = await databaseFor(req).execute(
      `SELECT original_name, content_type, file_size, file_data
       FROM complaint_attachments WHERE id = ? AND complaint_id = ?`,
      [attachmentId.data, id.data],
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
  } catch (error) { return next(error); }
});

export default router;
