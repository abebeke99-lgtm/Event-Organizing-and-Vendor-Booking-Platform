import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { inTransaction, pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { writeAudit } from '../lib/security.js';

const publicRouter = Router();
const adminRouter = Router();
const inquiryTypes = [
  'general_inquiry',
  'event_booking_support',
  'vendor_support',
  'service_request',
  'payment_billing',
  'technical_support',
  'account_assistance',
  'partnership_inquiry',
  'feedback',
  'other',
];
const contactStatuses = ['new', 'reviewed', 'in_progress', 'replied', 'resolved', 'closed'];

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many contact submissions. Please try again in a few minutes.' },
});

export const publicContactSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  subject: z.string().trim().min(4).max(200),
  message: z.string().trim().min(20).max(2500),
  inquiry_type: z.enum(inquiryTypes).optional().default('general_inquiry'),
}).strict();

function buildContactSettings(rows = []) {
  const values = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  const parsedSocials = values.social_links ? JSON.parse(values.social_links) : [];
  if (!Array.isArray(parsedSocials)) throw new TypeError('The social links setting must be a JSON array.');

  return {
    email: values.support_email?.trim() || '',
    phone: values.support_phone?.trim() || '',
    address: values.support_address?.trim() || '',
    hours: values.support_hours?.trim() || '',
    socials: parsedSocials.filter(Boolean),
  };
}

async function getContactSettings() {
  const [rows] = await pool.execute(
    'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?, ?, ?, ?)',
    ['support_email', 'support_phone', 'support_address', 'support_hours', 'social_links']
  );
  return buildContactSettings(rows);
}

publicRouter.get('/', asyncHandler(async (req, res) => {
  const settings = await getContactSettings();
  res.json({
    success: true,
    data: {
      contact: settings,
      faq: [
        {
          question: 'How do I create an EventFlow account?',
          answer: 'Choose Register in the site header and create a customer, organizer, or vendor account.',
        },
        {
          question: 'How can I find and book an event?',
          answer: 'Browse Events, open an event to review its details, and follow the booking or ticket options shown for that event.',
        },
        {
          question: 'How do I find trusted event vendors?',
          answer: 'Browse Find Vendors or Services, use the available categories and filters, and review vendor profile and verification information.',
        },
        {
          question: 'How can I request event services?',
          answer: 'Open a vendor service and submit a quote request. Sign in as a customer or organizer to submit and track service requests.',
        },
        {
          question: 'How can I contact an event organizer?',
          answer: 'Open the event details and use Contact Organizer to send your question about that event.',
        },
        {
          question: 'How can I check my booking status?',
          answer: 'Sign in and open the dashboard for your account to review your booking or request status.',
        },
        {
          question: 'Can I cancel or modify my booking?',
          answer: 'Options depend on the booking and its current status. Contact the event organizer or vendor before assuming a change or cancellation has been confirmed.',
        },
        {
          question: 'How do I become an EventFlow vendor?',
          answer: 'Register with a vendor account and complete your business profile. Vendor profiles are subject to platform verification.',
        },
        {
          question: 'How can I reset my password?',
          answer: 'Choose Forgot Password on the Login page and follow the instructions provided.',
        },
        {
          question: 'How can I contact support?',
          answer: 'Send a message using the form on this page. You can contact support without signing in.',
        },
      ],
    },
  });
}));

publicRouter.post('/', contactLimiter, asyncHandler(async (req, res) => {
  const parsed = publicContactSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Please review the highlighted fields and try again.',
      details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }

  const [result] = await pool.execute(
    'INSERT INTO contact_messages (user_id, full_name, email, phone, subject, inquiry_type, message, status) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)',
    [
      parsed.data.full_name,
      parsed.data.email.toLowerCase(),
      parsed.data.phone?.trim() || null,
      parsed.data.subject,
      parsed.data.inquiry_type,
      parsed.data.message,
      'new',
    ]
  );

  const reference = `EH-${String(result.insertId).padStart(6, '0')}`;
  res.status(201).json({
    success: true,
    data: { id: result.insertId, reference, status: 'new' },
  });
}));

adminRouter.get('/', asyncHandler(async (req, res) => {
  const parsedFilters = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(),
    status: z.enum(contactStatuses).optional(),
    inquiry_type: z.enum(inquiryTypes).optional(),
  }).safeParse(req.query);
  if (!parsedFilters.success) {
    return res.status(400).json({ success: false, error: 'Invalid contact message filters.' });
  }
  const { page, pageSize, q, status, inquiry_type: inquiryType } = parsedFilters.data;
  const offset = (page - 1) * pageSize;
  const values = [];
  const clauses = [];

  if (q) {
    clauses.push('(m.full_name LIKE ? OR m.email LIKE ? OR m.subject LIKE ? OR m.message LIKE ?)');
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    clauses.push('m.status = ?');
    values.push(status);
  }
  if (inquiryType) {
    clauses.push('m.inquiry_type = ?');
    values.push(inquiryType);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM contact_messages m${where}`, values);
  const [rows] = await pool.execute(
    `SELECT m.*, u.full_name AS user_name
     FROM contact_messages m
     LEFT JOIN users u ON u.id = m.user_id
     ${where}
     ORDER BY m.created_at DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  return res.json({
    success: true,
    data: rows,
    pagination: { page, pageSize, total: Number(countRow.total) },
  });
}));

adminRouter.patch('/:id/status', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({
    status: z.enum(contactStatuses),
    admin_reply: z.string().trim().max(2000).optional().or(z.literal('')),
  }).strict().safeParse(req.body || {});

  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return res.status(400).json({ success: false, error: 'A valid message ID and status are required.' });
  }

  const [result] = await pool.execute(
    'UPDATE contact_messages SET status = ?, admin_reply = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
    [parsed.data.status, parsed.data.admin_reply || null, req.admin?.id || null, id]
  );

  if (!result.affectedRows) {
    return res.status(404).json({ success: false, error: 'Contact message not found.' });
  }

  return res.json({ success: true, data: { id, status: parsed.data.status } });
}));

adminRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ success: false, error: 'A valid message ID is required.' });
  }

  const deleted = await inTransaction(async (connection) => {
    const [result] = await connection.execute('DELETE FROM contact_messages WHERE id = ?', [id.data]);
    if (!result.affectedRows) return false;
    await writeAudit(connection, {
      actorId: req.admin.id,
      action: 'contact_message.deleted',
      entityType: 'contact_message',
      entityId: id.data,
      ip: req.ip,
    });
    return true;
  });

  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Contact message not found.' });
  }
  return res.status(204).end();
}));

export { adminRouter };
export default publicRouter;
