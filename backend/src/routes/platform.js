import { Router } from 'express';
import { calculateDashboardSummary, createBookingSnapshot, validateBookingTransition } from '../lib/bookingRules.js';
import { buildRoleRedirect, createSecureToken, hashToken, isStrongPassword, normalizeEmail, safeAuthError } from '../lib/authFlow.js';
import { getPublicCategories, getPublicEventById, listPublicEvents } from '../lib/eventCatalog.js';
import { getPublicServiceById, listPublicServices } from '../lib/serviceCatalog.js';
import { getPublicVendorById, listPublicVendors } from '../lib/vendorCatalog.js';

const router = Router();

const platform = {
  users: [
    { id: 1, name: 'Aster Bekele', email: 'admin@eventflow.io', role: 'admin', password: 'admin1234', emailVerified: true, status: 'active' },
    { id: 2, name: 'Selam Tadesse', email: 'organizer@eventflow.io', role: 'organizer', password: 'organizer123', emailVerified: true, status: 'active' },
    { id: 3, name: 'Kebede Events', email: 'vendor@eventflow.io', role: 'vendor', password: 'vendor1234', emailVerified: true, status: 'active' },
    { id: 4, name: 'Marta Desta', email: 'customer@eventflow.io', role: 'customer', password: 'customer123', emailVerified: true, status: 'active' },
  ],
  resetTokens: new Map(),
  verificationTokens: new Map(),
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

router.get('/overview', (req, res) => {
  const summary = calculateDashboardSummary({
    users: platform.users.length,
    vendors: platform.vendors.length,
    events: platform.events.length,
    bookings: platform.bookings,
  });

  res.json({
    success: true,
    data: {
      ...summary,
      categories: platform.categories.length,
      featuredVendors: platform.vendors,
      featuredServices: platform.services,
    },
  });
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

router.get('/events', (req, res) => {
  const result = listPublicEvents(platform.events, req.query);
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
});

router.get('/events/:id', (req, res) => {
  const event = getPublicEventById(platform.events, req.params.id);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found.' });
  }

  res.json({ success: true, data: event });
});

router.get('/bookings', (req, res) => {
  res.json({
    success: true,
    data: platform.bookings.map((booking) => createBookingSnapshot(booking)),
  });
});

router.post('/register', (req, res) => {
  const { name, email, password, role = 'customer' } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = String(role || 'customer').trim().toLowerCase();

  if (normalizedRole === 'admin') {
    return res.status(403).json({ success: false, message: 'Administrator accounts must be created through an authorized administrative process.' });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({ success: false, message: 'Password must be at least 12 characters and include uppercase, lowercase, and a number.' });
  }

  const existingUser = platform.users.find((user) => normalizeEmail(user.email) === normalizedEmail);
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'A user already exists with that email address.' });
  }

  const newUser = {
    id: platform.users.length + 1,
    name: String(name).trim(),
    email: normalizedEmail,
    password: String(password),
    role: normalizedRole,
    status: 'active',
    emailVerified: false,
  };

  platform.users.push(newUser);
  const token = createSecureToken();
  const tokenHash = hashToken(token);
  platform.verificationTokens.set(tokenHash, { email: normalizedEmail, expiresAt: Date.now() + 1000 * 60 * 60 * 24, used: false });

  res.status(201).json({
    success: true,
    data: {
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
      requiresVerification: true,
      verificationToken: token,
    },
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const user = platform.users.find((entry) => normalizeEmail(entry.email) === normalizedEmail && entry.password === String(password || ''));

  if (!user) {
    return res.status(401).json({ success: false, message: safeAuthError() });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ success: false, message: 'This account is currently locked or unavailable.' });
  }

  if (user.emailVerified === false) {
    return res.status(403).json({ success: false, message: 'Please verify your email address before continuing.' });
  }

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      redirectTo: buildRoleRedirect(user.role),
    },
  });
});

router.post('/forgot-password', (req, res) => {
  const email = normalizeEmail(req.body?.email || '');
  if (!email) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
  }

  const user = platform.users.find((entry) => normalizeEmail(entry.email) === email);
  if (!user) {
    return res.json({ success: true, message: 'If an account matches the provided information, password reset instructions will be sent if recovery is available.' });
  }

  const token = createSecureToken();
  const tokenHash = hashToken(token);
  platform.resetTokens.set(tokenHash, { email, expiresAt: Date.now() + 1000 * 60 * 30, used: false });

  res.json({ success: true, message: 'If an account matches the provided information, password reset instructions will be sent if recovery is available.', tokenPreview: token.slice(0, 8) });
});

router.post('/reset-password', (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token) {
    return res.status(400).json({ success: false, message: 'A reset token is required.' });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({ success: false, message: 'Password must be at least 12 characters and include uppercase, lowercase, and a number.' });
  }

  const tokenHash = hashToken(token);
  const record = platform.resetTokens.get(tokenHash);
  if (!record || record.used || record.expiresAt < Date.now()) {
    return res.status(400).json({ success: false, message: 'The reset link is invalid or has expired. Please request a new password reset email.' });
  }

  const user = platform.users.find((entry) => normalizeEmail(entry.email) === normalizeEmail(record.email));
  if (!user) {
    return res.status(400).json({ success: false, message: 'The reset request is no longer valid.' });
  }

  user.password = password;
  record.used = true;
  platform.resetTokens.delete(tokenHash);

  res.json({ success: true, message: 'Your password has been reset successfully. You can sign in with the new password.' });
});

router.post('/verify-email', (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) {
    return res.status(400).json({ success: false, message: 'A verification token is required.' });
  }

  const tokenHash = hashToken(token);
  const record = platform.verificationTokens.get(tokenHash);
  if (!record || record.used || record.expiresAt < Date.now()) {
    return res.status(400).json({ success: false, message: 'The verification link is invalid or has expired.' });
  }

  const user = platform.users.find((entry) => normalizeEmail(entry.email) === normalizeEmail(record.email));
  if (!user) {
    return res.status(400).json({ success: false, message: 'The verification record is no longer valid.' });
  }

  user.emailVerified = true;
  record.used = true;
  platform.verificationTokens.delete(tokenHash);

  res.json({ success: true, message: 'Your email address has been verified successfully.' });
});

router.post('/resend-verification', (req, res) => {
  const email = normalizeEmail(req.body?.email || '');
  if (!email) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
  }

  const user = platform.users.find((entry) => normalizeEmail(entry.email) === email);
  if (!user || user.emailVerified) {
    return res.json({ success: true, message: 'If a verification request is needed, a fresh email will be issued if the account is active.' });
  }

  const token = createSecureToken();
  const tokenHash = hashToken(token);
  platform.verificationTokens.set(tokenHash, { email, expiresAt: Date.now() + 1000 * 60 * 60 * 24, used: false });

  res.json({ success: true, message: 'If a verification request is needed, a fresh email will be issued if the account is active.', tokenPreview: token.slice(0, 8) });
});

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
