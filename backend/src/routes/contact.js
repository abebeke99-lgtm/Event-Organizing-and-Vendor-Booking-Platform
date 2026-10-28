import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db.js';

const router = Router();
const inquiryTypes = ['general_inquiry', 'technical_support', 'vendor_support', 'booking_assistance', 'partnership', 'feedback', 'other'];

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many contact submissions. Please try again in a few minutes.' },
});

const publicContactSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  subject: z.string().trim().min(4).max(200),
  message: z.string().trim().min(20).max(2500),
  inquiry_type: z.enum(['general_inquiry', 'technical_support', 'vendor_support', 'booking_assistance', 'partnership', 'feedback', 'other']).default('general_inquiry'),
  user_id: z.coerce.number().int().positive().optional().nullable(),
}).strict();

function buildContactSettings(rows = []) {
  const values = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  const email = values.support_email?.trim();
  const phone = values.support_phone?.trim();
  const address = values.support_address?.trim();
  const hours = values.support_hours?.trim();
  const social = (() => {
    try {
      if (!values.social_links) return [];
      const parsed = JSON.parse(values.social_links);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  })();

  return {
    email: email || '',
    phone: phone || '',
    address: address || '',
    hours: hours || '',
    socials: social,
  };
}

async function getContactSettings() {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?, ?, ?, ?)', [
    'support_email',
    'support_phone',
    'support_address',
    'support_hours',
    'social_links',
  ]);
  return buildContactSettings(rows);
}

router.get('/', async (req, res, next) => {
  try {
    const isAdminRequest = req.baseUrl.includes('/admin/contact');
    if (isAdminRequest) {
      const page = Number(req.query.page || 1);
      const pageSize = Number(req.query.pageSize || 20);
      const q = String(req.query.q || '').trim();
      const status = String(req.query.status || '').trim();
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

      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM contact_messages m${where}`, values);
      const [rows] = await pool.execute(
        `SELECT m.*, u.full_name AS user_name
         FROM contact_messages m
         LEFT JOIN users u ON u.id = m.user_id
         ${where}
         ORDER BY m.created_at DESC
         LIMIT ? OFFSET ?`,
        [...values, Number(pageSize), Number(offset)]
      );

      return res.json({
        success: true,
        data: rows,
        pagination: { page, pageSize, total: Number(countRow.total) },
      });
    }

    const settings = await getContactSettings();
    res.json({
      success: true,
      data: {
        contact: settings,
        faq: [
          {
            question: 'How quickly will I receive a response?',
            answer: 'Most messages are reviewed within one business day, and urgent support requests are prioritized by the team.',
          },
          {
            question: 'Can I ask for vendor assistance?',
            answer: 'Yes. Please use the vendor support inquiry type and include the relevant booking or service details.',
          },
          {
            question: 'Do I need an account to contact EventHub?',
            answer: 'No. You can send a message as a guest, and account holders can prefill their contact details automatically.',
          },
        ],
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  if (!req.baseUrl.includes('/admin/contact')) {
    return res.status(403).json({ success: false, error: 'Contact administration is restricted to authenticated administrators.' });
  }

  const id = Number(req.params.id);
  const parsed = z.object({
    status: z.enum(['new', 'reviewed', 'replied', 'closed']),
    admin_reply: z.string().trim().max(2000).optional().or(z.literal('')),
  }).strict().safeParse(req.body);

  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return res.status(400).json({ success: false, error: 'A valid message ID and status are required.' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE contact_messages SET status = ?, admin_reply = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [parsed.data.status, parsed.data.admin_reply || null, req.admin?.id || null, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, error: 'Contact message not found.' });
    }

    res.json({ success: true, data: { id, status: parsed.data.status } });
  } catch (error) {
    next(error);
  }
});

router.post('/', contactLimiter, async (req, res, next) => {
  const parsed = publicContactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Please review the highlighted fields and try again.',
      details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }

  try {
    const payload = {
      ...parsed.data,
      phone: parsed.data.phone?.trim() || null,
      email: parsed.data.email.trim().toLowerCase(),
      subject: parsed.data.subject.trim(),
      inquiry_type: parsed.data.inquiry_type || 'general_inquiry',
      user_id: req.user?.id || parsed.data.user_id || null,
    };

    const [result] = await pool.execute(
      'INSERT INTO contact_messages (user_id, full_name, email, phone, subject, inquiry_type, message, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [payload.user_id, payload.full_name, payload.email, payload.phone, payload.subject, payload.inquiry_type, payload.message, 'new']
    );

    const reference = `EH-${String(result.insertId).padStart(6, '0')}`;
    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        reference,
        status: 'new',
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
