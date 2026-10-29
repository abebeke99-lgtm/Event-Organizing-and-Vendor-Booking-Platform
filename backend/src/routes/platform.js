import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { inTransaction, pool } from '../db.js';
import { calculateDashboardSummary, createBookingSnapshot, validateBookingTransition } from '../lib/bookingRules.js';
import { buildRoleRedirect, safeAuthError } from '../lib/authFlow.js';
import { getPublicCategories, listPublicEvents, mapDatabaseEvent } from '../lib/eventCatalog.js';
import { parseEventPackageRequest } from '../lib/eventPackageRequests.js';
import { hashToken, createUserSession, writeAudit } from '../lib/security.js';
import { isPublicRole, hashPassword, parsePublicLogin, parsePublicRegistration, verifyPassword } from '../lib/platformAuth.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { getPublicServiceById, listPublicServices } from '../lib/serviceCatalog.js';
import { getPublicVendorById, listPublicVendors } from '../lib/vendorCatalog.js';

const router = Router();
const platformCookieOptions = () => {
  const production = process.env.NODE_ENV === 'production';
  const sameSite = production ? 'none' : (process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'strict');
  return { httpOnly: true, secure: production || process.env.COOKIE_SECURE === 'true', sameSite, path: '/', maxAge: 8 * 60 * 60 * 1000 };
};

function buildCategorySummary() {
  return platform.categories.map((category) => {
    const categoryName = String(category.name || '').toLowerCase();
    const vendors = listPublicVendors(platform.vendors, { category: categoryName, limit: 50 }).vendors;
    const services = listPublicServices(platform.services, { category: categoryName, limit: 50 }).services;
    return { ...category, vendorCount: vendors.length, serviceCount: services.length };
  });
}
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many sign-in attempts. Please try again later.' } });
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many registrations. Please try again later.' } });

const platform = {
  vendors: [
    {
      id: 1,
      business_name: 'Aster Floral Studio',
      name: 'Aster Floral Studio',
      city: 'Addis Ababa',
      category: 'Decoration',
      description: 'Luxury floral design, venue styling, and ceremony decor for weddings and private celebrations.',
      rating: 4.9,
      reviewCount: 24,
      verified: true,
      priceFrom: 18000,
      status: 'active',
      visibility: 'public',
      isPublished: true,
      services: [
        { id: 1, title: 'Luxury Wedding Styling', price: 18000, published: true, description: 'Full floral and table styling package for ceremony and reception spaces.' },
        { id: 2, title: 'Private Event Decor', price: 12000, published: true, description: 'Decor package for birthdays, private dinners, and intimate events.' },
      ],
    },
    {
      id: 2,
      business_name: 'Golden Horizon Catering',
      name: 'Golden Horizon Catering',
      city: 'Bahir Dar',
      category: 'Catering',
      description: 'Premium catering and guest hospitality services for corporate, family, and wedding events.',
      rating: 4.8,
      reviewCount: 15,
      verified: true,
      priceFrom: 26000,
      status: 'active',
      visibility: 'public',
      isPublished: true,
      services: [
        { id: 3, title: 'Premium Catering Package', price: 26000, published: true, description: 'Chef-curated menu, service staff, and guest hospitality for medium to large gatherings.' },
      ],
    },
    {
      id: 3,
      business_name: 'Ethiopia Lens Studio',
      name: 'Ethiopia Lens Studio',
      city: 'Hawassa',
      category: 'Photography',
      description: 'Modern photography coverage for weddings, launches, and lifestyle event storytelling.',
      rating: 4.7,
      reviewCount: 11,
      verified: true,
      priceFrom: 15000,
      status: 'active',
      visibility: 'public',
      isPublished: true,
      services: [
        { id: 4, title: 'Wedding Photography Bundle', price: 15000, published: true, description: 'Photography, edited gallery, and behind-the-scenes storytelling coverage.' },
      ],
    },
    {
      id: 4,
      business_name: 'CitySound Events',
      name: 'CitySound Events',
      city: 'Addis Ababa',
      category: 'Music & DJs',
      description: 'Live audio production, DJ sets, and emcee support for parties, weddings, and corporate functions.',
      rating: 4.6,
      reviewCount: 9,
      verified: false,
      priceFrom: 14000,
      status: 'active',
      visibility: 'public',
      isPublished: true,
      services: [
        { id: 5, title: 'Event DJ Set', price: 14000, published: true, description: 'Custom DJ mix and master sound setup for a major event.' },
      ],
    },
    {
      id: 5,
      business_name: 'Hidden Studio',
      name: 'Hidden Studio',
      city: 'Hawassa',
      category: 'Photography',
      description: 'Private vendor profile not intended for the public directory.',
      rating: 5,
      reviewCount: 2,
      verified: true,
      priceFrom: 30000,
      status: 'active',
      visibility: 'private',
      isPublished: false,
      services: [],
    },
  ],
  categories: [
    { id: 1, name: 'Wedding Venues', slug: 'wedding-venues', description: 'Elegant venues for ceremonies and receptions.', image: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=900&q=80', isActive: true },
    { id: 2, name: 'Catering', slug: 'catering', description: 'Food and beverage experiences for guests.', image: 'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=900&q=80', isActive: true },
    { id: 3, name: 'Photography', slug: 'photography', description: 'Visual storytelling and event coverage.', image: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80', isActive: true },
    { id: 4, name: 'Decoration', slug: 'decoration', description: 'Styling, florals, and ambient design.', image: 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80', isActive: true },
    { id: 5, name: 'Entertainment', slug: 'entertainment', description: 'Live performances, DJs, and MC services.', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=80', isActive: true },
  ],
  services: [
    { id: 1, title: 'Luxury Wedding Venue', vendorId: 1, vendorName: 'Aster Floral Studio', category: 'Wedding Venues', price: 90000, currency: 'ETB', rating: 4.9, city: 'Addis Ababa', description: 'Premium venue package with a bridal suite, ceremony staging, and reception-ready seating plan.', status: 'active', visibility: 'public', published: true },
    { id: 2, title: 'Premium Catering Package', vendorId: 2, vendorName: 'Golden Horizon Catering', category: 'Catering', price: 56000, currency: 'ETB', rating: 4.8, city: 'Bahir Dar', description: 'Full-service catering with menu planning, staffing, and guest hospitality support.', status: 'active', visibility: 'public', published: true },
    { id: 3, title: 'Wedding Photography Bundle', vendorId: 3, vendorName: 'Ethiopia Lens Studio', category: 'Photography', price: 42000, currency: 'ETB', rating: 4.7, city: 'Hawassa', description: 'Wedding photo coverage with edited gallery delivery and highlight storytelling.', status: 'active', visibility: 'public', published: true },
    { id: 4, title: 'Event Decoration Set', vendorId: 1, vendorName: 'Aster Floral Studio', category: 'Decoration', price: 31000, currency: 'ETB', rating: 4.9, city: 'Addis Ababa', description: 'Floral styling pack for intimate ceremonies, family dinners, and modern social events.', status: 'active', visibility: 'public', published: true },
    { id: 5, title: 'Private Gala Styling', vendorId: 1, vendorName: 'Aster Floral Studio', category: 'Decoration', price: 45000, currency: 'ETB', rating: 4.8, city: 'Addis Ababa', description: 'Luxury styling and private event setup for milestone gatherings.', status: 'draft', visibility: 'public', published: true },
  ],
  events: [
    { id: 1, title: 'Mikias & Hanna Wedding', type: 'Wedding', category: 'wedding', description: 'A picturesque destination wedding with custom floral styling, catering, photography, and live entertainment.', location: 'Addis Ababa', startDate: '2026-11-18T18:00:00', endDate: '2026-11-19T00:00:00', organizer: 'Selam Tadesse', budget: 240000, status: 'active', visibility: 'public', published: true },
    { id: 2, title: 'Annual Conference', type: 'Conference', category: 'conference', description: 'An executive conference focused on innovation, networking, and speaker sessions across business sectors.', location: 'Bahir Dar', startDate: '2026-11-30T09:00:00', endDate: '2026-11-30T18:00:00', organizer: 'Selam Tadesse', budget: 160000, status: 'active', visibility: 'public', published: true },
    { id: 3, title: 'City Lights Gala', type: 'Gala', category: 'social', description: 'A black-tie gala to celebrate community impact, partners, and cultural performances.', location: 'Hawassa', startDate: '2026-12-08T19:30:00', endDate: '2026-12-09T01:30:00', organizer: 'Selam Tadesse', budget: 220000, status: 'active', visibility: 'public', published: true },
    { id: 4, title: 'Startup Summit', type: 'Conference', category: 'conference', description: 'A founder-focused summit featuring investor panels, startup showcases, and product demos.', location: 'Addis Ababa', startDate: '2026-12-05T09:00:00', endDate: '2026-12-05T17:00:00', organizer: 'Selam Tadesse', budget: 185000, status: 'active', visibility: 'public', published: true },
    { id: 5, title: 'Private Gala Dinner', type: 'Dinner', category: 'private', description: 'Invite-only private dinner for a family milestone and premium brand networking.', location: 'Hawassa', startDate: '2026-10-30T19:00:00', endDate: '2026-10-30T22:00:00', organizer: 'Marta Desta', budget: 98000, status: 'draft', visibility: 'private', published: true },
    { id: 6, title: 'Art & Culture Expo', type: 'Exhibition', category: 'exhibition', description: 'A public exhibition including local artists, crafts, food, and cultural installations.', location: 'Dire Dawa', startDate: '2026-08-15T08:00:00', endDate: '2026-08-17T18:00:00', organizer: 'Marta Desta', budget: 135000, status: 'active', visibility: 'public', published: false },
  ],
  bookings: [
    { id: 1, serviceTitle: 'Luxury Wedding Venue', status: 'pending', quotedAmount: 90000, currency: 'ETB' },
    { id: 2, serviceTitle: 'Premium Catering Package', status: 'confirmed', quotedAmount: 56000, currency: 'ETB' },
    { id: 3, serviceTitle: 'Wedding Photography Bundle', status: 'completed', quotedAmount: 42000, currency: 'ETB' },
    { id: 4, serviceTitle: 'Event Decoration Set', status: 'cancelled', quotedAmount: 31000, currency: 'ETB' },
  ],
};

router.get('/overview', async (req, res, next) => {
  try {
    const [[userCount]] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE status = \'active\'');
    const summary = calculateDashboardSummary({
      users: Number(userCount.total),
      vendors: platform.vendors.length,
      events: platform.events.length,
      bookings: platform.bookings,
    });
    res.json({ success: true, data: { ...summary, categories: platform.categories.length, featuredVendors: platform.vendors, featuredServices: platform.services } });
  } catch (error) {
    next(error);
  }
});

router.get('/categories', (req, res) => {
  const categories = buildCategorySummary();
  const search = String(req.query.search || '').trim().toLowerCase();
  const filtered = categories.filter((category) => {
    if (!search) return true;
    return `${category.name} ${category.description}`.toLowerCase().includes(search);
  });

  res.json({ success: true, data: filtered });
});

router.get('/categories/:slug', (req, res) => {
  const category = platform.categories.find((entry) => entry.slug === req.params.slug || entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === req.params.slug.toLowerCase());
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found.' });
  }

  const categoryVendors = platform.vendors.filter((vendor) => {
    const sameCategory = vendor.category && category.name && vendor.category.toLowerCase() === category.name.toLowerCase();
    return sameCategory && vendor.status === 'active' && vendor.isPublished !== false && vendor.visibility !== 'private' && vendor.visibility !== 'hidden' && vendor.verified;
  });

  const categoryServices = platform.services.filter((service) => {
    const sameCategory = service.category && category.name && service.category.toLowerCase() === category.name.toLowerCase();
    return sameCategory && service.published !== false && service.visibility !== 'private' && service.visibility !== 'hidden' && service.status !== 'draft';
  });

  res.json({
    success: true,
    data: {
      ...category,
      image: category.image || 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80',
      vendorCount: categoryVendors.length,
      serviceCount: categoryServices.length,
      vendors: categoryVendors,
      services: categoryServices,
    },
  });
});

router.get('/vendors', (req, res) => {
  const result = listPublicVendors(platform.vendors, req.query);
  res.json({
    success: true,
    data: result.vendors,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      sort: result.sort,
    },
  });
});

router.get('/vendors/:id', (req, res) => {
  const vendor = getPublicVendorById(platform.vendors, req.params.id);
  if (!vendor) {
    return res.status(404).json({ success: false, message: 'Vendor not found.' });
  }

  res.json({ success: true, data: vendor });
});

router.get('/services', (req, res) => {
  const result = listPublicServices(platform.services, req.query);
  res.json({
    success: true,
    data: result.services,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      sort: result.sort,
    },
  });
});

router.get('/services/:id', (req, res) => {
  const service = getPublicServiceById(platform.services, req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }

  res.json({ success: true, data: service });
});

router.post('/service-quote-requests', (req, res) => {
  const { serviceId, serviceTitle, vendorId, vendorName, eventDate, guestCount, budget, notes } = req.body || {};

  if (!serviceId || !serviceTitle || !vendorId) {
    return res.status(400).json({ success: false, message: 'Service and vendor details are required.' });
  }

  const record = {
    id: Date.now(),
    serviceId: Number(serviceId),
    serviceTitle: String(serviceTitle).trim(),
    vendorId: Number(vendorId),
    vendorName: String(vendorName || 'Vendor').trim(),
    eventDate: String(eventDate || '').trim(),
    guestCount: Number(guestCount || 0) || 0,
    budget: Number(budget || 0) || 0,
    notes: String(notes || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  if (!platform.quoteRequests) {
    platform.quoteRequests = [];
  }

  platform.quoteRequests.unshift(record);
  res.status(201).json({ success: true, data: record, message: 'Quote request submitted successfully.' });
});

const upcomingEventsQuery = `SELECT id, title, event_type, city,
  DATE_FORMAT(start_date, '%Y-%m-%dT%H:%i:%s') AS start_date,
  DATE_FORMAT(end_date, '%Y-%m-%dT%H:%i:%s') AS end_date,
  budget, status FROM events
  WHERE status = 'active' AND start_date >= UTC_TIMESTAMP()`;

router.get('/events/featured', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`${upcomingEventsQuery} ORDER BY start_date ASC, id ASC LIMIT 1`);
    res.json({ success: true, data: rows[0] ? mapDatabaseEvent(rows[0]) : null });
  } catch (error) {
    next(error);
  }
});

router.get('/events/categories', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT event_type FROM events
       WHERE status = 'active' AND start_date >= UTC_TIMESTAMP() AND event_type <> ''
       ORDER BY event_type ASC`
    );
    res.json({ success: true, data: rows.map((row) => row.event_type) });
  } catch (error) {
    next(error);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`${upcomingEventsQuery} ORDER BY start_date ASC, id ASC`);
    const result = listPublicEvents(rows.map(mapDatabaseEvent), req.query);
    res.json({
      success: true,
      data: result.events,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
        sort: result.sort,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/events/:id', async (req, res, next) => {
  const eventId = Number(req.params.id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return res.status(400).json({ success: false, message: 'A valid event ID is required.' });
  try {
    const [rows] = await pool.execute(`${upcomingEventsQuery} AND id = ? LIMIT 1`, [eventId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Event not found.' });
    res.json({ success: true, data: mapDatabaseEvent(rows[0]) });
  } catch (error) {
    next(error);
  }
});

router.post('/event-package-requests', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false }), async (req, res, next) => {
  const parsed = parseEventPackageRequest(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Provide a valid event, name, email, and package request.' });

  try {
    if (parsed.data.event_id !== null) {
      const [events] = await pool.execute(
        `SELECT id FROM events WHERE id = ? AND status = 'active' AND start_date >= UTC_TIMESTAMP() LIMIT 1`,
        [parsed.data.event_id]
      );
      if (!events.length) return res.status(404).json({ success: false, error: 'This event is no longer available for package requests.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO event_package_requests (event_id, event_title, event_type, requested_date, requested_location, requester_name, requester_email, service_category, guest_count, budget, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [parsed.data.event_id, parsed.data.event_title, parsed.data.event_type || null, parsed.data.requested_date ? `${parsed.data.requested_date.replace('T', ' ')}:00` : null, parsed.data.requested_location || null, parsed.data.requester_name, parsed.data.requester_email, parsed.data.service_category || null, parsed.data.guest_count ?? null, parsed.data.budget ?? null, parsed.data.notes || null]
    );
    res.status(201).json({ success: true, data: { id: result.insertId, event_id: parsed.data.event_id, status: 'new' } });
  } catch (error) {
    next(error);
  }
});

router.get('/bookings', (req, res) => {
  res.json({
    success: true,
    data: platform.bookings.map((booking) => createBookingSnapshot(booking)),
  });
});

router.get('/me', requirePlatformUser, (req, res) => {
  res.json({ success: true, data: { user: req.platformUser } });
});

router.post('/register', registrationLimiter, async (req, res, next) => {
  const parsed = parsePublicRegistration(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Enter a valid name, email, password, and public account type.' });

  try {
    const roleName = parsed.data.role[0].toUpperCase() + parsed.data.role.slice(1);
    const [roles] = await pool.execute('SELECT id FROM roles WHERE name = ? AND is_admin = FALSE AND is_active = TRUE LIMIT 1', [roleName]);
    if (!roles.length) return res.status(503).json({ success: false, error: 'Registration is currently unavailable.' });

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await inTransaction(async (connection) => {
      const [created] = await connection.execute(
        'INSERT INTO users (full_name, email, password_hash, status) VALUES (?, ?, ?, \'active\')',
        [parsed.data.name, parsed.data.email, passwordHash]
      );
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [created.insertId, roles[0].id]);
      await writeAudit(connection, { actorId: created.insertId, action: 'auth.register', entityType: 'user', entityId: created.insertId, details: { role: parsed.data.role }, ip: req.ip });
      return { id: created.insertId, name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, status: 'active' };
    });
    res.status(201).json({ success: true, data: { user, redirectTo: buildRoleRedirect(user.role) } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'We could not create an account with those details.' });
    next(error);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  const parsed = parsePublicLogin(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Email and password are required.' });

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.password_hash, LOWER(r.name) AS role
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.email = ? AND u.status = 'active' AND r.is_admin = FALSE AND r.is_active = TRUE
         AND LOWER(r.name) IN ('customer', 'organizer', 'vendor')
       ORDER BY CASE LOWER(r.name) WHEN 'customer' THEN 1 WHEN 'organizer' THEN 2 WHEN 'vendor' THEN 3 ELSE 4 END
       LIMIT 1`,
      [parsed.data.email]
    );
    if (!rows.length || !(await verifyPassword(parsed.data.password, rows[0].password_hash))) {
      return res.status(401).json({ success: false, error: safeAuthError() });
    }

    const session = await inTransaction(async (connection) => {
      const createdSession = await createUserSession(connection, rows[0].id);
      await writeAudit(connection, { actorId: rows[0].id, action: 'auth.login', entityType: 'session', ip: req.ip });
      return createdSession;
    });
    res.cookie('platform_session', session.token, { ...platformCookieOptions(), expires: session.expiresAt });
    const user = { id: rows[0].id, full_name: rows[0].full_name, name: rows[0].full_name, email: rows[0].email, phone: rows[0].phone, role: rows[0].role, status: rows[0].status };
    res.json({ success: true, data: { user, redirectTo: buildRoleRedirect(user.role) } });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  const token = req.cookies?.platform_session;
  try {
    if (token) {
      const [sessions] = await pool.execute('SELECT user_id FROM user_sessions WHERE token_hash = ?', [hashToken(token)]);
      await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)]);
      if (sessions.length) await writeAudit(pool, { actorId: sessions[0].user_id, action: 'auth.logout', entityType: 'session', ip: req.ip });
    }
    res.clearCookie('platform_session', { ...platformCookieOptions(), maxAge: undefined });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

const recoveryUnavailable = (req, res) => res.status(503).json({ success: false, error: 'Password recovery is unavailable because no verified email delivery service is configured.' });
router.post('/forgot-password', recoveryUnavailable);
router.post('/reset-password', recoveryUnavailable);
router.post('/verify-email', recoveryUnavailable);
router.post('/resend-verification', recoveryUnavailable);

router.post('/bookings', (req, res) => {
  const { serviceTitle, quotedAmount, currency = 'ETB', status = 'pending' } = req.body || {};
  if (!serviceTitle || Number(quotedAmount) <= 0) {
    return res.status(400).json({ success: false, message: 'Service title and a valid booking amount are required.' });
  }

  const booking = {
    id: platform.bookings.length + 1,
    serviceTitle: String(serviceTitle).trim(),
    quotedAmount: Number(quotedAmount),
    currency: String(currency).toUpperCase(),
    status: String(status).toLowerCase(),
  };

  platform.bookings.unshift(booking);
  res.status(201).json({ success: true, data: createBookingSnapshot(booking) });
});

router.patch('/bookings/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = String(req.body?.status || '').toLowerCase();
  const booking = platform.bookings.find((entry) => entry.id === id);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  if (!validateBookingTransition(booking.status, nextStatus)) {
    return res.status(409).json({ success: false, message: `The booking status cannot move from ${booking.status} to ${nextStatus}.` });
  }

  booking.status = nextStatus;
  res.json({ success: true, data: createBookingSnapshot(booking) });
});

export default router;
