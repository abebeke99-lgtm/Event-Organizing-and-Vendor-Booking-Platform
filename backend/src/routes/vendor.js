import { Router } from 'express';

const router = Router();

const vendorData = {
  overview: {
    totalServices: 12,
    activeServices: 9,
    inactiveServices: 3,
    pendingBookings: 6,
    confirmedBookings: 18,
    upcomingDates: 7,
    pendingQuotations: 4,
    totalEarnings: 245000,
    pendingPayouts: 62000,
    averageRating: 4.8,
    unreadMessages: 3,
    notifications: 5,
  },
  profile: {
    businessName: 'Golden Horizon Catering',
    logo: '/images/logo-golden-horizon.png',
    businessType: 'Catering & Events',
    serviceLocation: 'Addis Ababa, Bahir Dar, Hawassa',
    phone: '+251 911 223 344',
    email: 'hello@goldenhorizon.et',
    address: 'Bole Road, Addis Ababa',
    serviceAreas: ['Addis Ababa', 'Bahir Dar', 'Hawassa'],
    yearsOfExperience: 9,
    hours: 'Mon-Sat 08:00-18:00',
    website: 'https://goldenhorizon.et',
    verificationStatus: 'Verified',
    description: 'Premium event catering and hospitality services for weddings, corporate celebrations, and social gatherings.',
  },
  verification: {
    status: 'Verified',
    submittedAt: '2026-09-18T10:30:00Z',
    reviewProgress: 'Approved',
    reasons: [],
    documents: [
      { name: 'Business License', status: 'Approved' },
      { name: 'Tax Registration', status: 'Approved' },
      { name: 'ID Copy', status: 'Approved' },
    ],
  },
  services: [
    { id: 1, name: 'Wedding Catering', category: 'Catering', status: 'Published', price: 48000, bookings: 5 },
    { id: 2, name: 'Corporate Lunch Package', category: 'Catering', status: 'Published', price: 32000, bookings: 7 },
    { id: 3, name: 'Dessert Bar', category: 'Bakery', status: 'Inactive', price: 18000, bookings: 2 },
    { id: 4, name: 'Event Beverage Station', category: 'Equipment Rental', status: 'Draft', price: 14000, bookings: 0 },
  ],
  categories: [
    { id: 1, name: 'Catering', description: 'Food and hospitality packages', active: true },
    { id: 2, name: 'Bakery', description: 'Desserts and pastry setup', active: true },
    { id: 3, name: 'Equipment Rental', description: 'Service equipment and staging', active: true },
  ],
  pricing: {
    currency: 'ETB',
    basePrice: 35000,
    packages: [
      { name: 'Basic', description: 'Essential buffet and service setup', price: 35000 },
      { name: 'Standard', description: 'Added premium menu and staffing', price: 48000 },
      { name: 'Premium', description: 'Luxury service with full banquet setup', price: 68000 },
    ],
  },
  availability: {
    schedule: [
      { date: '2026-11-08', status: 'Available' },
      { date: '2026-11-10', status: 'Booked' },
      { date: '2026-11-18', status: 'Available' },
    ],
    businessHours: '08:00-18:00',
  },
  requests: [
    { id: 1, customer: 'Mikias & Hanna', date: '2026-11-18', service: 'Wedding Catering', status: 'Pending' },
    { id: 2, customer: 'KM Digital', date: '2026-12-02', service: 'Corporate Lunch Package', status: 'Under Review' },
  ],
  bookings: [
    { id: 101, customer: 'Mikias & Hanna', service: 'Wedding Catering', status: 'Confirmed', amount: 48000 },
    { id: 102, customer: 'KM Digital', service: 'Corporate Lunch Package', status: 'In Progress', amount: 32000 },
  ],
  history: [
    { id: 55, service: 'Dessert Bar', status: 'Completed', amount: 18000 },
    { id: 56, service: 'Wedding Catering', status: 'Cancelled', amount: 20000 },
  ],
  quotations: [
    { id: 201, customer: 'Aster Events', status: 'Sent', validUntil: '2026-11-05', amount: 52000 },
    { id: 202, customer: 'Blue Peak Conference', status: 'Accepted', validUntil: '2026-11-12', amount: 39000 },
  ],
  payments: {
    earnings: 245000,
    pendingPayouts: 62000,
    fees: 21000,
    net: 224000,
    transactions: [
      { id: 1, date: '2026-10-15', status: 'Paid', amount: 48000 },
      { id: 2, date: '2026-10-18', status: 'Pending', amount: 31000 },
    ],
  },
  messages: [
    { id: 1, sender: 'Mikias & Hanna', body: 'Can you confirm vegetarian options for the reception?', unread: true },
    { id: 2, sender: 'KM Digital', body: 'We are finalizing meeting snacks for next month.', unread: false },
  ],
  reviews: [
    { id: 1, customer: 'Nardos', rating: 5, comment: 'Exceptional food quality and smooth coordination.', response: 'Thank you for your feedback!' },
    { id: 2, customer: 'Biniam', rating: 4, comment: 'Very professional on the event day.', response: 'We appreciate the kind words.' },
  ],
  notifications: [
    { id: 1, title: 'New booking request', read: false },
    { id: 2, title: 'Quotation accepted', read: true },
    { id: 3, title: 'Withdrawal request received', read: false },
  ],
  reports: {
    totalListings: 12,
    bookingStatus: { pending: 6, accepted: 18, completed: 22 },
    earningsByDate: { '2026-10': 52000, '2026-11': 78000 },
    popularServices: ['Wedding Catering', 'Corporate Lunch Package', 'Dessert Bar'],
  },
  account: {
    fullName: 'Selam Tadesse',
    email: 'vendor@eventflow.io',
    role: 'Vendor',
    status: 'Active',
  },
};

router.get('/overview', (req, res) => {
  res.json({ success: true, data: vendorData.overview });
});

router.get('/profile', (req, res) => {
  res.json({ success: true, data: vendorData.profile });
});

router.get('/verification', (req, res) => {
  res.json({ success: true, data: vendorData.verification });
});

router.get('/services', (req, res) => {
  res.json({ success: true, data: vendorData.services });
});

router.get('/categories', (req, res) => {
  res.json({ success: true, data: vendorData.categories });
});

router.get('/pricing', (req, res) => {
  res.json({ success: true, data: vendorData.pricing });
});

router.get('/availability', (req, res) => {
  res.json({ success: true, data: vendorData.availability });
});

router.get('/booking-requests', (req, res) => {
  res.json({ success: true, data: vendorData.requests });
});

router.get('/bookings', (req, res) => {
  res.json({ success: true, data: vendorData.bookings });
});

router.get('/history', (req, res) => {
  res.json({ success: true, data: vendorData.history });
});

router.get('/quotations', (req, res) => {
  res.json({ success: true, data: vendorData.quotations });
});

router.get('/payments', (req, res) => {
  res.json({ success: true, data: vendorData.payments });
});

router.get('/messages', (req, res) => {
  res.json({ success: true, data: vendorData.messages });
});

router.get('/reviews', (req, res) => {
  res.json({ success: true, data: vendorData.reviews });
});

router.get('/notifications', (req, res) => {
  res.json({ success: true, data: vendorData.notifications });
});

router.get('/reports', (req, res) => {
  res.json({ success: true, data: vendorData.reports });
});

router.get('/account', (req, res) => {
  res.json({ success: true, data: vendorData.account });
});

export default router;
