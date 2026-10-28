import { Router } from 'express';
import { summarizeCustomerOverview, ensureCustomerOwnership, isDuplicateFavorite } from '../lib/customerDashboard.js';

const router = Router();

const customerData = {
  overview: {
    totalBookings: 6,
    pendingBookings: 2,
    confirmedBookings: 3,
    upcomingEvents: 2,
    completedBookings: 1,
    pendingQuotations: 2,
    outstandingPayments: 1,
    unreadMessages: 3,
    unreadNotifications: 4,
  },
  vendors: [
    { id: 1, name: 'Aster Floral Studio', city: 'Addis Ababa', category: 'Decoration', rating: 4.9, verified: true, priceFrom: 18000 },
    { id: 2, name: 'Golden Horizon Catering', city: 'Bahir Dar', category: 'Catering', rating: 4.8, verified: true, priceFrom: 26000 },
    { id: 3, name: 'Ethiopia Lens Studio', city: 'Hawassa', category: 'Photography', rating: 4.7, verified: true, priceFrom: 22000 },
    { id: 4, name: 'CitySound Events', city: 'Addis Ababa', category: 'Music & DJs', rating: 4.6, verified: false, priceFrom: 15000 },
  ],
  services: [
    { id: 1, title: 'Luxury Wedding Venue', vendorId: 1, category: 'Wedding Venues', price: 90000, currency: 'ETB', rating: 4.9, city: 'Addis Ababa', description: 'Premium venue with banquet hall and bridal suite.' },
    { id: 2, title: 'Premium Catering Package', vendorId: 2, category: 'Catering', price: 56000, currency: 'ETB', rating: 4.8, city: 'Bahir Dar', description: 'Full-service dining package for celebrations and corporate events.' },
    { id: 3, title: 'Wedding Photography Bundle', vendorId: 3, category: 'Photography', price: 42000, currency: 'ETB', rating: 4.7, city: 'Hawassa', description: 'Event photo coverage, editing, and digital gallery.' },
    { id: 4, title: 'Event Decoration Set', vendorId: 1, category: 'Decoration', price: 31000, currency: 'ETB', rating: 4.9, city: 'Addis Ababa', description: 'Floral styling, backdrops, and ceremony décor.' },
  ],
  categories: [
    { id: 1, name: 'Wedding Venues', description: 'Ceremony and reception spaces', active: true },
    { id: 2, name: 'Catering', description: 'Food and hospitality services', active: true },
    { id: 3, name: 'Photography', description: 'Wedding and event coverage', active: true },
    { id: 4, name: 'Decoration', description: 'Floral and styling packages', active: true },
    { id: 5, name: 'Music & DJs', description: 'Live music and DJ services', active: true },
  ],
  events: [
    { id: 1, customerId: 4, title: 'Mikias & Hanna Wedding', type: 'Wedding', date: '2026-11-18T16:00:00Z', location: 'Addis Ababa', guestCount: 220, budget: 240000, status: 'planned' },
    { id: 2, customerId: 4, title: 'Annual Conference', type: 'Conference', date: '2026-11-30T09:00:00Z', location: 'Bahir Dar', guestCount: 180, budget: 160000, status: 'planned' },
    { id: 3, customerId: 4, title: 'Family Birthday', type: 'Birthday', date: '2026-10-05T18:00:00Z', location: 'Hawassa', guestCount: 80, budget: 65000, status: 'completed' },
  ],
  bookings: [
    { id: 1, customerId: 4, serviceTitle: 'Luxury Wedding Venue', vendorId: 1, status: 'pending', quotedAmount: 90000, currency: 'ETB', eventDate: '2026-11-18', reference: 'BK-20261118-001' },
    { id: 2, customerId: 4, serviceTitle: 'Premium Catering Package', vendorId: 2, status: 'confirmed', quotedAmount: 56000, currency: 'ETB', eventDate: '2026-11-18', reference: 'BK-20261118-002' },
    { id: 3, customerId: 4, serviceTitle: 'Wedding Photography Bundle', vendorId: 3, status: 'completed', quotedAmount: 42000, currency: 'ETB', eventDate: '2026-10-05', reference: 'BK-20261005-003' },
    { id: 4, customerId: 4, serviceTitle: 'Event Decoration Set', vendorId: 1, status: 'cancelled', quotedAmount: 31000, currency: 'ETB', eventDate: '2026-11-18', reference: 'BK-20261118-004' },
  ],
  favorites: [
    { id: 1, customerId: 4, vendorId: 1, name: 'Aster Floral Studio', city: 'Addis Ababa' },
    { id: 2, customerId: 4, vendorId: 2, name: 'Golden Horizon Catering', city: 'Bahir Dar' },
  ],
  quotations: [
    { id: 1, customerId: 4, vendorId: 2, service: 'Premium Catering Package', status: 'Sent', amount: 56000, validUntil: '2026-11-05' },
    { id: 2, customerId: 4, vendorId: 3, service: 'Wedding Photography Bundle', status: 'Revision Requested', amount: 42000, validUntil: '2026-11-10' },
    { id: 3, customerId: 4, vendorId: 1, service: 'Event Decoration Set', status: 'Accepted', amount: 31000, validUntil: '2026-11-02' },
  ],
  payments: [
    { id: 1, customerId: 4, bookingId: 2, amount: 56000, currency: 'ETB', status: 'pending', provider: 'CBE', reference: 'PAY-20261118-0001' },
    { id: 2, customerId: 4, bookingId: 3, amount: 42000, currency: 'ETB', status: 'successful', provider: 'Telebirr', reference: 'PAY-20261005-0002' },
  ],
  messages: [
    { id: 1, customerId: 4, vendorId: 2, sender: 'Golden Horizon Catering', body: 'We can add a custom dessert station for your event.', read: false, createdAt: '2026-10-20T09:30:00Z' },
    { id: 2, customerId: 4, vendorId: 1, sender: 'Aster Floral Studio', body: 'Your venue styling proposal is ready for review.', read: true, createdAt: '2026-10-19T14:00:00Z' },
  ],
  reviews: [
    { id: 1, customerId: 4, bookingId: 3, vendorId: 3, rating: 5, comment: 'Excellent photography and a smooth experience.', status: 'published', createdAt: '2026-10-15T00:00:00Z' },
  ],
  notifications: [
    { id: 1, customerId: 4, title: 'Booking update', message: 'Your catering booking has moved to confirmed status.', read: false, createdAt: '2026-10-21T10:00:00Z' },
    { id: 2, customerId: 4, title: 'Quotation response', message: 'Golden Horizon sent a revised catering proposal.', read: true, createdAt: '2026-10-20T09:40:00Z' },
  ],
  profile: {
    fullName: 'Marta Desta',
    email: 'customer@eventflow.io',
    phone: '+251 911 112 233',
    city: 'Addis Ababa',
    role: 'Customer',
    lastLogin: '2026-10-27T08:40:00Z',
    notificationPreferences: { email: true, sms: true, app: true },
  },
};

router.get('/overview', (req, res) => {
  const summary = summarizeCustomerOverview({
    events: customerData.events,
    bookings: customerData.bookings,
    quotations: customerData.quotations,
    payments: customerData.payments,
    messages: customerData.messages,
    notifications: customerData.notifications,
  });

  res.json({ success: true, data: { ...summary, featuredVendors: customerData.vendors.slice(0, 3) } });
});

router.get('/vendors', (req, res) => {
  res.json({ success: true, data: customerData.vendors });
});

router.get('/services', (req, res) => {
  res.json({ success: true, data: customerData.services });
});

router.get('/categories', (req, res) => {
  res.json({ success: true, data: customerData.categories });
});

router.get('/events', (req, res) => {
  res.json({ success: true, data: customerData.events.filter((event) => Number(event.customerId) === 4) });
});

router.get('/bookings', (req, res) => {
  res.json({ success: true, data: customerData.bookings.filter((booking) => Number(booking.customerId) === 4) });
});

router.get('/history', (req, res) => {
  res.json({ success: true, data: customerData.bookings.filter((booking) => Number(booking.customerId) === 4).filter((booking) => ['completed', 'cancelled', 'rejected'].includes(String(booking.status || '').toLowerCase())) });
});

router.get('/favorites', (req, res) => {
  res.json({ success: true, data: customerData.favorites.filter((favorite) => Number(favorite.customerId) === 4) });
});

router.get('/quotations', (req, res) => {
  res.json({ success: true, data: customerData.quotations.filter((quotation) => Number(quotation.customerId) === 4) });
});

router.get('/payments', (req, res) => {
  res.json({ success: true, data: customerData.payments.filter((payment) => Number(payment.customerId) === 4) });
});

router.get('/messages', (req, res) => {
  res.json({ success: true, data: customerData.messages.filter((message) => Number(message.customerId) === 4) });
});

router.get('/reviews', (req, res) => {
  res.json({ success: true, data: customerData.reviews.filter((review) => Number(review.customerId) === 4) });
});

router.get('/notifications', (req, res) => {
  res.json({ success: true, data: customerData.notifications.filter((notification) => Number(notification.customerId) === 4) });
});

router.get('/profile', (req, res) => {
  res.json({ success: true, data: customerData.profile });
});

router.post('/favorites', (req, res) => {
  const { vendorId } = req.body || {};
  const parsedVendorId = Number(vendorId);

  if (!parsedVendorId) {
    return res.status(400).json({ success: false, message: 'A valid vendor ID is required.' });
  }

  if (isDuplicateFavorite(customerData.favorites, parsedVendorId)) {
    return res.status(409).json({ success: false, message: 'This vendor is already saved to your favorites.' });
  }

  const vendor = customerData.vendors.find((entry) => Number(entry.id) === parsedVendorId);
  const record = { id: customerData.favorites.length + 1, customerId: 4, vendorId: parsedVendorId, name: vendor?.name || 'Saved vendor', city: vendor?.city || 'Unknown city' };
  customerData.favorites.unshift(record);
  res.status(201).json({ success: true, data: record });
});

router.delete('/favorites/:vendorId', (req, res) => {
  const vendorId = Number(req.params.vendorId);
  const initialLength = customerData.favorites.length;

  customerData.favorites = customerData.favorites.filter((favorite) => Number(favorite.customerId) === 4 && Number(favorite.vendorId) !== vendorId);

  if (customerData.favorites.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Saved vendor not found.' });
  }

  res.json({ success: true, message: 'Saved vendor removed.' });
});

router.post('/events', (req, res) => {
  const { title, type, date, location, guestCount, budget } = req.body || {};
  if (!title || !type || !date || !location || !guestCount || !budget) {
    return res.status(400).json({ success: false, message: 'Event title, type, date, location, guest count, and budget are required.' });
  }

  const event = {
    id: customerData.events.length + 1,
    customerId: 4,
    title: String(title).trim(),
    type: String(type).trim(),
    date: new Date(date).toISOString(),
    location: String(location).trim(),
    guestCount: Number(guestCount),
    budget: Number(budget),
    status: 'planned',
  };

  customerData.events.unshift(event);
  res.status(201).json({ success: true, data: event });
});

router.patch('/events/:id', (req, res) => {
  const eventId = Number(req.params.id);
  const event = customerData.events.find((entry) => Number(entry.id) === eventId && Number(entry.customerId) === 4);

  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found or not owned by this customer.' });
  }

  Object.assign(event, req.body || {});
  res.json({ success: true, data: event });
});

router.post('/quotations', (req, res) => {
  const { vendorId, service, eventId, amount, notes } = req.body || {};
  if (!vendorId || !service || !eventId || !amount) {
    return res.status(400).json({ success: false, message: 'Vendor, service, event, and amount are required.' });
  }

  const quotation = {
    id: customerData.quotations.length + 1,
    customerId: 4,
    vendorId: Number(vendorId),
    service: String(service).trim(),
    eventId: Number(eventId),
    status: 'Sent',
    amount: Number(amount),
    notes: String(notes || ''),
    validUntil: '2026-12-05',
  };

  customerData.quotations.unshift(quotation);
  res.status(201).json({ success: true, data: quotation });
});

router.patch('/quotations/:id', (req, res) => {
  const quotationId = Number(req.params.id);
  const quotation = customerData.quotations.find((entry) => Number(entry.id) === quotationId && Number(entry.customerId) === 4);

  if (!quotation) {
    return res.status(404).json({ success: false, message: 'Quotation not found or not owned by this customer.' });
  }

  Object.assign(quotation, req.body || {});
  res.json({ success: true, data: quotation });
});

router.get('/ownership-check/:recordId', (req, res) => {
  const recordCustomerId = Number(req.query.customerId || 4);
  try {
    ensureCustomerOwnership(recordCustomerId, 4);
    res.json({ success: true, message: 'Customer ownership confirmed.' });
  } catch (error) {
    res.status(403).json({ success: false, message: error.message });
  }
});

export default router;
