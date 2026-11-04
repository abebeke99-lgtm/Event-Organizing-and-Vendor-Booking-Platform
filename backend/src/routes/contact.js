import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { inTransaction, pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { writeAudit } from '../lib/security.js';
import { isNotificationEmailConfigured, sendNotificationEmail } from '../lib/notificationService.js';

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

function sanitizeContactText(value) {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function sanitizeContactLine(value) {
  return sanitizeContactText(value).replace(/\s+/g, ' ').trim();
}

export const publicContactSchema = z.object({
  full_name: z.string().transform(sanitizeContactLine).pipe(z.string().min(2).max(160)),
  email: z.string().transform(sanitizeContactLine).pipe(z.string().email().max(254)),
  phone: z.string().transform(sanitizeContactLine)
    .pipe(z.string().max(40).regex(/^[+\d().\-\s]*$/))
    .optional().or(z.literal('')),
  subject: z.string().transform(sanitizeContactLine).pipe(z.string().min(4).max(200)),
  message: z.string().transform((value) => sanitizeContactText(value).trim()).pipe(z.string().min(20).max(2500)),
  inquiry_type: z.enum(inquiryTypes).optional().default('general_inquiry'),
}).strict();

function buildContactSettings(rows = []) {
  const values = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  const parsedSocials = values.social_links ? JSON.parse(values.social_links) : [];
  if (!Array.isArray(parsedSocials)) throw new TypeError('The social links setting must be a JSON array.');

  return {
    email: sanitizeContactLine(values.support_email || ''),
    phone: sanitizeContactLine(values.support_phone || ''),
    address: sanitizeContactLine(values.support_address || ''),
    hours: sanitizeContactLine(values.support_hours || ''),
    socials: parsedSocials.filter((social) => (
      social && typeof social.label === 'string' && typeof social.url === 'string'
      && /^https?:\/\//i.test(social.url)
    )).map(({ label, url }) => ({ label: sanitizeContactLine(label), url: url.trim() })),
  };
}

async function getContactSettings(database) {
  const [rows] = await database.execute(
    'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?, ?, ?, ?)',
    ['support_email', 'support_phone', 'support_address', 'support_hours', 'social_links']
  );
  return buildContactSettings(rows);
}

function logContactEmailFailure(kind, error) {
  const code = /^[a-z\d_]{1,60}$/i.test(error?.code || '') ? error.code : 'DELIVERY_FAILED';
  console.error(`Contact ${kind} email delivery failed: ${code}`);
}

async function sendEmail(services, message, kind) {
  try {
    await (services.emailSender || sendNotificationEmail)(message);
    return 'sent';
  } catch (error) {
    logContactEmailFailure(kind, error);
    return 'failed';
  }
}

async function getEmailConfiguration(services) {
  try {
    return Boolean(await (services.emailConfigured || isNotificationEmailConfigured)());
  } catch (error) {
    logContactEmailFailure('configuration check', error);
    return null;
  }
}

publicRouter.get('/', asyncHandler(async (req, res) => {
  const database = req.app.locals.database || pool;
  const settings = await getContactSettings(database);
  res.json({
    success: true,
    data: {
      contact: settings,
      faq: [
        {
          question: 'How do I create an EventHub account?',
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
          question: 'How do I become an EventHub vendor?',
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

  const database = req.app.locals.database || pool;
  const reference = `EH-${randomBytes(12).toString('hex').toUpperCase()}`;
  await database.execute(
    'INSERT INTO contact_messages (reference_id, user_id, full_name, email, phone, subject, inquiry_type, message, status) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)',
    [
      reference,
      parsed.data.full_name,
      parsed.data.email.toLowerCase(),
      parsed.data.phone?.trim() || null,
      parsed.data.subject,
      parsed.data.inquiry_type,
      parsed.data.message,
      'new',
    ]
  );

  const services = req.app.locals.notificationServices || {};
  const isEmailConfigured = await getEmailConfiguration(services);
  let administratorEmail = isEmailConfigured === false ? 'not_configured' : 'failed';
  let customerEmail = isEmailConfigured === false ? 'not_configured' : 'failed';

  if (isEmailConfigured) {
    try {
      const [administrators] = await database.execute(
        `SELECT DISTINCT u.email FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
           AND u.email IS NOT NULL AND u.email <> ''`
      );
      if (!administrators.length) {
        administratorEmail = 'no_recipients';
      } else {
        const deliveries = await Promise.all(administrators.map(({ email }) => sendEmail(services, {
          email,
          title: `New EventHub contact message ${reference}`,
          message: [
            `Reference: ${reference}`,
            `From: ${parsed.data.full_name} (${parsed.data.email})`,
            parsed.data.phone ? `Phone: ${parsed.data.phone}` : null,
            `Subject: ${parsed.data.subject}`,
            '',
            parsed.data.message,
          ].filter((line) => line !== null).join('\n'),
        }, 'administrator notification')));
        administratorEmail = deliveries.every((delivery) => delivery === 'sent')
          ? 'sent'
          : deliveries.some((delivery) => delivery === 'sent') ? 'partial' : 'failed';
      }
    } catch (error) {
      administratorEmail = 'failed';
      logContactEmailFailure('administrator notification', error);
    }

    customerEmail = await sendEmail(services, {
      email: parsed.data.email.toLowerCase(),
      title: 'We received your EventHub message',
      message: `Hello ${parsed.data.full_name},\n\nYour message has been saved. Your reference is ${reference}.\n\nEventHub Support`,
    }, 'customer confirmation');
  } else if (isEmailConfigured === null) {
    administratorEmail = 'failed';
    customerEmail = 'failed';
  }

  res.status(201).json({
    success: true,
    data: {
      reference,
      status: 'new',
      email: { administrator: administratorEmail, customer: customerEmail },
    },
  });
}));

adminRouter.get('/', asyncHandler(async (req, res) => {
  const parsedFilters = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(),
    status: z.enum(contactStatuses).optional(),
    inquiry_type: z.enum(inquiryTypes).optional(),
    archived: z.enum(['active', 'archived', 'all']).default('active'),
  }).safeParse(req.query);
  if (!parsedFilters.success) {
    return res.status(400).json({ success: false, error: 'Invalid contact message filters.' });
  }
  const { page, pageSize, q, status, inquiry_type: inquiryType, archived } = parsedFilters.data;
  const offset = (page - 1) * pageSize;
  const values = [];
  const clauses = archived === 'all' ? [] : [`m.archived_at IS ${archived === 'archived' ? 'NOT ' : ''}NULL`];

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
  const database = req.app.locals.database || pool;
  const [[countRow]] = await database.execute(`SELECT COUNT(*) AS total FROM contact_messages m${where}`, values);
  const [rows] = await database.execute(
    `SELECT m.id, m.reference_id, m.full_name, m.email, m.phone, m.subject, m.inquiry_type, m.message,
            m.status, m.admin_reply, m.reviewed_at, m.read_at,
            CASE WHEN m.read_at IS NULL THEN 'unread' ELSE 'read' END AS read_status,
            m.created_at, m.updated_at, m.archived_at,
            u.full_name AS user_name
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
    admin_reply: z.string().transform((value) => sanitizeContactText(value).trim()).pipe(z.string().max(2000)).optional().or(z.literal('')),
  }).strict().safeParse(req.body || {});

  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return res.status(400).json({ success: false, error: 'A valid message ID and status are required.' });
  }

  const database = req.app.locals.database || pool;
  const [messages] = await database.execute(
    'SELECT full_name, email, subject, admin_reply FROM contact_messages WHERE id = ?',
    [id]
  );
  const message = messages[0];
  if (!message) {
    return res.status(404).json({ success: false, error: 'Contact message not found.' });
  }
  const reply = parsed.data.admin_reply === undefined ? message.admin_reply : parsed.data.admin_reply || null;
  await database.execute(
    `UPDATE contact_messages
     SET status = ?, admin_reply = ?, reviewed_by = ?, reviewed_at = NOW(),
         read_at = IF(? = 'new', NULL, COALESCE(read_at, NOW()))
     WHERE id = ?`,
    [parsed.data.status, reply, req.admin?.id || null, parsed.data.status, id]
  );

  let emailStatus = 'not_requested';
  if (reply && reply !== message.admin_reply) {
    const services = req.app.locals.notificationServices || {};
    const configured = await getEmailConfiguration(services);
    emailStatus = configured === true
      ? await sendEmail(services, {
        email: message.email,
        title: `Re: ${message.subject}`,
        message: `Hello ${message.full_name},\n\n${reply}\n\nEventHub Support`,
      }, 'administrator reply')
      : configured === false ? 'not_configured' : 'failed';
  }

  return res.json({
    success: true,
    data: { id, status: parsed.data.status, email: emailStatus },
  });
}));

adminRouter.patch('/:id/read', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({ read: z.boolean() }).strict().safeParse(req.body || {});
  if (!id.success || !parsed.success) {
    return res.status(400).json({ success: false, error: 'A valid message ID and read state are required.' });
  }

  const database = req.app.locals.database || pool;
  const [messages] = await database.execute('SELECT id FROM contact_messages WHERE id = ?', [id.data]);
  if (!messages.length) {
    return res.status(404).json({ success: false, error: 'Contact message not found.' });
  }

  await database.execute(
    'UPDATE contact_messages SET read_at = ? WHERE id = ?',
    [parsed.data.read ? new Date() : null, id.data]
  );
  return res.json({ success: true, data: { id: id.data, read: parsed.data.read } });
}));

adminRouter.patch('/:id/archive', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({ archived: z.boolean() }).strict().safeParse(req.body || {});
  if (!id.success || !parsed.success) {
    return res.status(400).json({ success: false, error: 'A valid message ID and archive state are required.' });
  }

  const database = req.app.locals.database || pool;
  const [messages] = await database.execute('SELECT id FROM contact_messages WHERE id = ?', [id.data]);
  if (!messages.length) {
    return res.status(404).json({ success: false, error: 'Contact message not found.' });
  }

  await database.execute(
    'UPDATE contact_messages SET archived_at = ? WHERE id = ?',
    [parsed.data.archived ? new Date() : null, id.data]
  );
  await writeAudit(database, {
    actorId: req.admin.id,
    action: parsed.data.archived ? 'contact_message.archived' : 'contact_message.restored',
    entityType: 'contact_message',
    entityId: id.data,
    ip: req.ip,
  });
  return res.json({ success: true, data: { id: id.data, archived: parsed.data.archived } });
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
