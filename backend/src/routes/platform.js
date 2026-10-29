import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { inTransaction, pool } from '../db.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { createUserSession, hashToken, writeAudit } from '../lib/security.js';
import { calculateDashboardSummary, createBookingSnapshot } from '../lib/bookingRules.js';
import { getPublicEvents, listPublicEvents, mapDatabaseEvent, sanitizeText } from '../lib/eventCatalog.js';
import { getPublicServiceById, listPublicServices } from '../lib/serviceCatalog.js';
import { getPublicVendorById, listPublicVendors } from '../lib/vendorCatalog.js';
import {
  ensureVendorProfile as ensureVendorProfileRecord,
  loadPublicMarketplace,
  mapBookingRecord,
} from '../lib/marketplace.js';

const router = Router();
const emailSchema = z.string().trim().email().max(190);

function setPlatformCookie(res, token) {
  res.cookie('platform_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

const bookingSelect = `
  SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount, b.currency,
         b.status, b.moderation_reason, b.created_at, b.updated_at,
         e.title AS event_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
         cu.full_name AS customer_name,
         vp.business_name AS vendor_name
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  JOIN users cu ON cu.id = e.organizer_id
  JOIN vendor_profiles vp ON vp.id = b.vendor_id`;

async function loadOwnedBookings(user) {
  if (user.role === 'vendor') {
    const vendor = await ensureVendorProfileRecord(user.id, user.full_name);
    const [rows] = await pool.execute(`${bookingSelect} WHERE b.vendor_id = ? ORDER BY b.created_at DESC`, [vendor.id]);
    return rows;
  }
  const [rows] = await pool.execute(`${bookingSelect} WHERE e.organizer_id = ? ORDER BY b.created_at DESC`, [user.id]);
  return rows;
}

router.get('/overview', async (req, res) => {
  const [userRows, vendorRows, eventRows, bookingRows, marketplace] = await Promise.all([
    pool.query("SELECT COUNT(*) AS total FROM users WHERE status = 'active'"),
    pool.query("SELECT COUNT(*) AS total FROM vendor_profiles WHERE verification_status = 'verified'"),
    pool.query("SELECT COUNT(*) AS total FROM events WHERE status <> 'cancelled'"),
    pool.query('SELECT status FROM bookings'),
    loadPublicMarketplace(),
  ]);

  return res.json({
    data: calculateDashboardSummary({
      users: userRows[0][0]?.total,
      vendors: vendorRows[0][0]?.total,
      events: eventRows[0][0]?.total,
      bookings: bookingRows[0],
    }),
    featuredVendors: listPublicVendors(marketplace.vendors, { limit: 6 }).vendors,
    featuredServices: listPublicServices(marketplace.services, { limit: 6 }).services,
    categories: marketplace.categories,
    recentEvents: getPublicEvents(await listAllPublicEvents()),
  });
});

async function listAllPublicEvents() {
  const [rows] = await pool.query(
    `SELECT id, title, event_type, city, start_date, end_date, budget, status
     FROM events
     WHERE start_date >= CURDATE() AND status IN ('active', 'published', 'upcoming', 'open')
     ORDER BY start_date ASC
     LIMIT 48`
  );
  return rows.map(mapDatabaseEvent);
}

router.get('/categories', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  const search = sanitizeText(req.query.search, '').toLowerCase();
  const categories = search
    ? marketplace.categories.filter((category) => `${category.name} ${category.description}`.toLowerCase().includes(search))
    : marketplace.categories;
  return res.json({ data: categories });
});

router.get('/categories/:slug', async (req, res) => {
  const slug = sanitizeText(req.params.slug, '').toLowerCase();
  const marketplace = await loadPublicMarketplace();
  const category = marketplace.categories.find((item) => item.slug === slug);
  if (!category) return res.status(404).json({ error: 'Category not found.' });

  const key = category.slug;
  const vendors = marketplace.vendors.filter((vendor) => sanitizeText(vendor.category, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') === key);
  const services = marketplace.services.filter((service) => sanitizeText(service.category, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') === key);
  return res.json({ data: { ...category, vendors, services } });
});

router.get('/vendors', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  const result = listPublicVendors(marketplace.vendors, {
    search: req.query.search,
    category: req.query.category,
    location: req.query.location,
    sort: req.query.sort,
    page: req.query.page,
    limit: req.query.limit,
  });
  return res.json({
    data: result.vendors,
    pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
  });
});

router.get('/vendors/:id', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  const vendor = getPublicVendorById(marketplace.vendors, req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
  return res.json({ data: vendor });
});

router.get('/services', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  const result = listPublicServices(marketplace.services, {
    search: req.query.search,
    category: req.query.category,
    location: req.query.location,
    sort: req.query.sort,
    page: req.query.page,
    limit: req.query.limit,
  });
  return res.json({
    data: result.services,
    pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
  });
});

router.get('/services/:id', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  const service = getPublicServiceById(marketplace.services, req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  return res.json({ data: service });
});

router.get('/events', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, title, event_type, city, start_date, end_date, budget, status
     FROM events
     WHERE start_date >= CURDATE() AND status IN ('active', 'published', 'upcoming', 'open')
     ORDER BY start_date ASC`
  );
  const events = rows.map(mapDatabaseEvent);
  const result = listPublicEvents(events, req.query);
  return res.json({
    data: result.events,
    pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
  });
});

router.get('/events/featured', async (req, res) => {
  const events = await listAllPublicEvents();
  return res.json({ data: events.slice(0, 6) });
});

router.get('/events/categories', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT event_type, COUNT(*) AS total
     FROM events
     WHERE start_date >= CURDATE() AND status IN ('active', 'published', 'upcoming', 'open')
     GROUP BY event_type
     ORDER BY event_type ASC`
  );
  return res.json({
    data: rows.map((row) => ({
      id: row.event_type,
      name: row.event_type,
      slug: String(row.event_type || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      total: Number(row.total),
    })),
  });
});

router.get('/events/mine', requirePlatformUser, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, title, event_type, city, start_date, end_date, budget, guest_count, notes, status
     FROM events
     WHERE organizer_id = ?
     ORDER BY start_date DESC`,
    [req.platformUser.id]
  );
  return res.json({
    data: rows.map((row) => ({
      ...mapDatabaseEvent(row),
      guestCount: row.guest_count === null ? null : Number(row.guest_count),
      notes: row.notes || '',
    })),
  });
});

router.get('/events/:id', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, title, event_type, city, start_date, end_date, budget, status
     FROM events
     WHERE id = ? AND start_date >= CURDATE() AND status IN ('active', 'published', 'upcoming', 'open')`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Event not found.' });
  return res.json({ data: mapDatabaseEvent(rows[0]) });
});

router.get('/bookings', requirePlatformUser, async (req, res) => {
  const rows = await loadOwnedBookings(req.platformUser);
  return res.json({ data: rows.map(mapBookingRecord) });
});

router.post('/bookings', requirePlatformUser, async (req, res) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Only customers and organizers can create bookings.' });
  }

  const schema = z.object({
    eventId: z.coerce.number().int().positive(),
    serviceId: z.coerce.number().int().positive(),
    notes: z.string().trim().max(500).optional().default(''),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid booking request.' });

  const [eventRows] = await pool.execute('SELECT id, organizer_id, status FROM events WHERE id = ? LIMIT 1', [parsed.data.eventId]);
  const event = eventRows[0];
  if (!event || event.organizer_id !== req.platformUser.id) return res.status(404).json({ error: 'Event not found.' });
  if (['cancelled', 'completed'].includes(event.status)) return res.status(409).json({ error: 'This event is not accepting bookings.' });

  const [serviceRows] = await pool.execute(
    `SELECT s.id, s.vendor_id, s.title, s.price, s.currency
     FROM services s
     JOIN vendor_profiles vp ON vp.id = s.vendor_id
     WHERE s.id = ? AND s.status = 'active' AND vp.verification_status = 'verified'
     LIMIT 1`,
    [parsed.data.serviceId]
  );
  const service = serviceRows[0];
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  if (Number(service.price) <= 0) return res.status(409).json({ error: 'This service requires a custom quote.' });

  const bookingId = await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO bookings (event_id, vendor_id, service_id, service_description, quoted_amount, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, 'requested')`,
      [
        event.id,
        service.vendor_id,
        service.id,
        parsed.data.notes ? `${service.title} - ${parsed.data.notes}`.slice(0, 255) : service.title,
        service.price,
        service.currency || 'ETB',
      ]
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'booking.requested',
      entityType: 'booking',
      entityId: result.insertId,
      details: { eventId: event.id, serviceId: service.id, vendorId: service.vendor_id },
      ip: req.ip,
    });
    return result.insertId;
  });

  return res.status(201).json({
    data: {
      ...createBookingSnapshot({
        id: bookingId,
        status: 'requested',
        quotedAmount: service.price,
        currency: service.currency,
        serviceTitle: service.title,
      }),
      reference: `BK-${String(bookingId).padStart(6, '0')}`,
      eventId: event.id,
      vendorId: service.vendor_id,
    },
  });
});

router.patch('/bookings/:id/status', requirePlatformUser, async (req, res) => {
  const schema = z.object({
    status: z.enum(['under_review', 'quoted', 'accepted', 'rejected', 'cancelled', 'completed']),
    reason: z.string().trim().max(500).optional().default(''),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid booking status.' });

  const [rows] = await pool.execute(
    `SELECT b.id, b.status, b.vendor_id, e.organizer_id, vp.user_id AS vendor_user_id
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE b.id = ? LIMIT 1`,
    [req.params.id]
  );
  const booking = rows[0];
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const userId = req.platformUser.id;
  const isVendor = booking.vendor_user_id === userId;
  const isOrganizer = booking.organizer_id === userId;
  if (!isVendor && !isOrganizer) return res.status(403).json({ error: 'Access denied.' });

  const nextStatus = parsed.data.status;
  const vendorTransitions = {
    requested: ['under_review', 'accepted', 'rejected'],
    under_review: ['quoted', 'accepted', 'rejected'],
    quoted: ['accepted', 'rejected'],
    accepted: ['completed'],
  };
  const customerTransitions = {
    requested: ['cancelled'],
    under_review: ['cancelled'],
    quoted: ['cancelled'],
    accepted: ['cancelled'],
  };
  const allowed = (isVendor ? vendorTransitions[booking.status] : customerTransitions[booking.status]) || [];
  if (!allowed.includes(nextStatus)) {
    return res.status(409).json({ error: `Cannot change booking from ${booking.status} to ${nextStatus}.` });
  }

  await inTransaction(async (connection) => {
    await connection.execute('UPDATE bookings SET status = ?, moderation_reason = ? WHERE id = ?', [
      nextStatus,
      parsed.data.reason || null,
      booking.id,
    ]);
    await writeAudit(connection, {
      actorId: userId,
      action: `booking.${nextStatus}`,
      entityType: 'booking',
      entityId: booking.id,
      details: { previousStatus: booking.status, reason: parsed.data.reason || null },
      ip: req.ip,
    });
  });

  return res.json({ data: { id: Number(booking.id), status: nextStatus } });
});

router.post(['/event-package-requests', '/package-requests'], async (req, res) => {
  const optionalText = (max) => z.string().trim().max(max).nullish();
  const schema = z.object({
    event_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    event_title: z.string().trim().min(2).max(180),
    event_type: optionalText(80),
    requested_date: z.string().trim().max(40).nullish(),
    requested_location: optionalText(120),
    requester_name: z.string().trim().min(2).max(160),
    requester_email: emailSchema,
    service_category: optionalText(80),
    guest_count: z.union([z.coerce.number().int().positive().max(100000), z.null()]).optional(),
    budget: z.union([z.coerce.number().nonnegative().max(100000000), z.null()]).optional(),
    notes: z.string().trim().max(2000).nullish(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' });

  const eventId = parsed.data.event_id || null;
  if (eventId) {
    const [events] = await pool.execute('SELECT id FROM events WHERE id = ? LIMIT 1', [eventId]);
    if (!events.length) return res.status(404).json({ error: 'Event not found.' });
  }

  const requestedDate = parsed.data.requested_date ? new Date(parsed.data.requested_date) : null;
  if (requestedDate && Number.isNaN(requestedDate.getTime())) {
    return res.status(400).json({ error: 'Enter a valid requested date.' });
  }

  const [result] = await pool.execute(
    `INSERT INTO event_package_requests (
       event_id, event_title, event_type, requested_date, requested_location, requester_name,
       requester_email, service_category, guest_count, budget, notes, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [
      eventId,
      parsed.data.event_title,
      parsed.data.event_type || null,
      requestedDate,
      parsed.data.requested_location || null,
      parsed.data.requester_name,
      parsed.data.requester_email.toLowerCase(),
      parsed.data.service_category || null,
      parsed.data.guest_count ?? null,
      parsed.data.budget ?? null,
      parsed.data.notes || null,
    ]
  );

  return res.status(201).json({ data: { id: result.insertId, status: 'new' } });
});

router.post(['/quotes', '/service-quote-requests'], async (req, res) => {
  const schema = z.object({
    serviceId: z.coerce.number().int().positive(),
    requesterName: z.string().trim().min(2).max(160),
    requesterEmail: emailSchema,
    eventDate: z.string().trim().max(30).optional().default(''),
    guestCount: z.coerce.number().int().positive().max(100000).optional(),
    budget: z.coerce.number().nonnegative().max(100000000).optional(),
    notes: z.string().trim().max(2000).optional().default(''),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quote request.' });

  const [serviceRows] = await pool.execute(
    `SELECT s.id, s.title, s.price, s.currency, sc.name AS category
     FROM services s
     JOIN vendor_profiles vp ON vp.id = s.vendor_id
     LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.id = ? AND s.status = 'active' AND vp.verification_status = 'verified'
     LIMIT 1`,
    [parsed.data.serviceId]
  );
  const service = serviceRows[0];
  if (!service) return res.status(404).json({ error: 'Service not found.' });

  const requestedDate = parsed.data.eventDate ? new Date(parsed.data.eventDate) : null;
  if (requestedDate && Number.isNaN(requestedDate.getTime())) {
    return res.status(400).json({ error: 'Enter a valid event date.' });
  }

  const [result] = await pool.execute(
    `INSERT INTO event_package_requests (
       event_id, event_title, event_type, requested_date, requested_location, requester_name,
       requester_email, service_category, guest_count, budget, notes, status
     ) VALUES (NULL, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, 'new')`,
    [
      service.title,
      requestedDate,
      parsed.data.requesterName,
      parsed.data.requesterEmail.toLowerCase(),
      service.category || null,
      parsed.data.guestCount ?? null,
      parsed.data.budget ?? null,
      parsed.data.notes || null,
    ]
  );

  return res.status(201).json({
    data: {
      id: result.insertId,
      status: 'new',
      serviceId: service.id,
      serviceTitle: service.title,
    },
  });
});

router.post('/register', async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(120),
    email: emailSchema,
    password: z.string().min(8).max(128),
    role: z.enum(['customer', 'organizer', 'vendor']).default('customer'),
    phone: z.string().trim().max(30).optional().default(''),
    city: z.string().trim().max(120).optional().default(''),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration.' });

  const normalizedEmail = parsed.data.email.toLowerCase();
  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
  if (existing.length) return res.status(409).json({ error: 'An account with this email already exists.' });

  const roleName = parsed.data.role === 'vendor' ? 'Vendor' : parsed.data.role === 'organizer' ? 'Organizer' : 'Customer';
  const [roleRows] = await pool.execute('SELECT id FROM roles WHERE name = ? AND is_active = TRUE LIMIT 1', [roleName]);
  if (!roleRows.length) return res.status(500).json({ error: 'Registration role is unavailable.' });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const created = await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO users (full_name, email, phone, password_hash, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [parsed.data.name, normalizedEmail, parsed.data.phone || null, passwordHash]
    );
    await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [result.insertId, roleRows[0].id]);
    const { token } = await createUserSession(connection, result.insertId);
    if (parsed.data.role === 'vendor') {
      await ensureVendorProfileRecord(result.insertId, parsed.data.name, connection);
    }
    await writeAudit(connection, {
      actorId: result.insertId,
      action: 'auth.register',
      entityType: 'user',
      entityId: result.insertId,
      details: { role: roleName, city: parsed.data.city || null },
      ip: req.ip,
    });
    return { id: result.insertId, token };
  });

  setPlatformCookie(res, created.token);
  return res.status(201).json({
    data: {
      user: { id: created.id, name: parsed.data.name, email: normalizedEmail, role: parsed.data.role },
    },
  });
});

router.post('/login', async (req, res) => {
  const schema = z.object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });

  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.password_hash, u.status,
            LOWER(r.name) AS role
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.email = ? AND r.is_admin = FALSE AND r.is_active = TRUE
     ORDER BY CASE LOWER(r.name) WHEN 'customer' THEN 1 WHEN 'organizer' THEN 2 WHEN 'vendor' THEN 3 ELSE 4 END
     LIMIT 1`,
    [parsed.data.email.toLowerCase()]
  );
  const user = rows[0];
  if (!user || user.status !== 'active' || !await bcrypt.compare(parsed.data.password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  const token = await inTransaction(async (connection) => {
    const session = await createUserSession(connection, user.id);
    if (user.role === 'vendor') await ensureVendorProfileRecord(user.id, user.full_name, connection);
    await writeAudit(connection, {
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      details: { role: user.role },
      ip: req.ip,
    });
    return session.token;
  });

  setPlatformCookie(res, token);
  return res.json({
    data: {
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    },
  });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.platform_session;
  if (token) await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)]);
  res.clearCookie('platform_session', { path: '/' });
  return res.status(204).end();
});

router.get('/me', requirePlatformUser, async (req, res) => {
  const profile = req.platformUser.role === 'vendor'
    ? await ensureVendorProfileRecord(req.platformUser.id, req.platformUser.full_name)
    : null;
  return res.json({
    data: {
      user: {
        id: req.platformUser.id,
        name: req.platformUser.full_name,
        email: req.platformUser.email,
        phone: req.platformUser.phone,
        role: req.platformUser.role,
        vendorProfile: profile
          ? {
              id: Number(profile.id),
              businessName: profile.business_name,
              category: profile.category_name || null,
              city: profile.city || null,
              verificationStatus: profile.verification_status,
            }
          : null,
      },
    },
  });
});

router.post('/password-recovery', async (req, res) => {
  const parsed = emailSchema.safeParse(req.body?.email);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
  await writeAudit(pool, {
    actorId: null,
    action: 'auth.password_recovery_requested',
    entityType: 'user',
    entityId: null,
    details: { email: parsed.data.toLowerCase() },
    ip: req.ip,
  });
  return res.json({ message: 'If the account exists, recovery instructions will be sent.' });
});

export default router;
