import { Router } from 'express';
import { pool } from '../db.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { ensureVendorProfile } from '../lib/marketplace.js';

const router = Router();

const statusLabel = (status) => ({
  requested: 'Pending',
  under_review: 'Under Review',
  quoted: 'Quoted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  draft: 'Draft',
  active: 'Published',
  archived: 'Inactive',
}[status] || status);

function ok(res, data) {
  return res.json({ success: true, data });
}

router.use(requirePlatformUser);
router.use(async (req, res, next) => {
  if (req.platformUser.role !== 'vendor') {
    return res.status(403).json({ error: 'Vendor access is required.' });
  }
  const vendor = await ensureVendorProfile(req.platformUser.id, req.platformUser.full_name);
  if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
  req.vendor = vendor;
  next();
});

router.get('/overview', async (req, res) => {
  const userId = req.platformUser.id;
  const vendorId = req.vendor.id;
  const [serviceRows, bookingRows, quotationRows, paymentRows, messageRows, availabilityRows, ratingRows, notificationRows] = await Promise.all([
    pool.execute('SELECT id, status FROM services WHERE vendor_id = ?', [vendorId]),
    pool.execute('SELECT id, status FROM bookings WHERE vendor_id = ?', [vendorId]),
    pool.execute('SELECT id, status FROM quotations WHERE vendor_id = ?', [vendorId]),
    pool.execute(
      `SELECT p.status, p.amount
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.vendor_id = ?`,
      [vendorId]
    ),
    pool.execute('SELECT id, read_at FROM messages WHERE recipient_id = ?', [userId]),
    pool.execute("SELECT id FROM vendor_availability WHERE vendor_id = ? AND status = 'available' AND available_date >= CURDATE()", [vendorId]),
    pool.execute(
      `SELECT r.rating FROM reviews r JOIN bookings b ON b.id = r.booking_id
       WHERE b.vendor_id = ? AND r.status = 'published'`,
      [vendorId]
    ),
    pool.execute("SELECT id FROM notifications WHERE user_id = ? AND status <> 'read'", [userId]),
  ]);

  const services = serviceRows[0];
  const bookings = bookingRows[0];
  const quotations = quotationRows[0];
  const payments = paymentRows[0];
  const messages = messageRows[0];
  const ratings = ratingRows[0].map((row) => Number(row.rating || 0));
  const activeStatuses = new Set(['active']);
  const pendingStatuses = new Set(['requested', 'under_review', 'quoted']);
  const confirmedStatuses = new Set(['accepted', 'completed']);

  return ok(res, {
    totalServices: services.length,
    activeServices: services.filter((service) => activeStatuses.has(service.status)).length,
    inactiveServices: services.filter((service) => !activeStatuses.has(service.status)).length,
    pendingBookings: bookings.filter((booking) => pendingStatuses.has(booking.status)).length,
    confirmedBookings: bookings.filter((booking) => confirmedStatuses.has(booking.status)).length,
    upcomingDates: availabilityRows[0].length,
    pendingQuotations: quotations.filter((quote) => ['draft', 'sent', 'revision_requested'].includes(quote.status)).length,
    totalEarnings: payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    pendingPayouts: payments.filter((payment) => ['pending', 'authorized'].includes(payment.status)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    averageRating: ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : 0,
    unreadMessages: messages.filter((message) => !message.read_at).length,
    notifications: notificationRows[0].length,
  });
});

router.get('/profile', async (req, res) => {
  const vendor = req.vendor;
  return ok(res, {
    businessName: vendor.business_name,
    logo: null,
    businessType: vendor.category_name || 'Event services',
    serviceLocation: vendor.city || 'Not set',
    phone: vendor.phone || null,
    email: vendor.email,
    address: null,
    serviceAreas: vendor.city ? [vendor.city] : [],
    yearsOfExperience: null,
    hours: null,
    website: null,
    verificationStatus: vendor.verification_status,
    description: vendor.description || '',
  });
});

router.get('/verification', async (req, res) => {
  const vendor = req.vendor;
  return ok(res, {
    status: vendor.verification_status,
    submittedAt: vendor.created_at,
    reviewProgress: vendor.verification_status === 'verified' ? 'Approved' : vendor.verification_status === 'rejected' ? 'Rejected' : 'Under review',
    reasons: vendor.verification_reason ? [vendor.verification_reason] : [],
    documents: [],
  });
});

router.get('/services', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT s.id, s.title, s.description, s.price, s.currency, s.status, s.created_at,
            COALESCE(sc.name, 'General') AS category,
            (SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.id) AS booking_count
     FROM services s
     LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.vendor_id = ?
     ORDER BY s.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    name: row.title,
    title: row.title,
    description: row.description || '',
    category: row.category,
    status: statusLabel(row.status),
    price: Number(row.price || 0),
    currency: row.currency,
    bookings: Number(row.booking_count || 0),
  })));
});

router.get('/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, description, is_active FROM service_categories ORDER BY name ASC');
  return ok(res, rows.map((row) => ({ id: Number(row.id), name: row.name, description: row.description || '', active: Boolean(row.is_active) })));
});

router.get('/pricing', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, title, description, price, currency
     FROM services
     WHERE vendor_id = ? AND status = 'active'
     ORDER BY price ASC`,
    [req.vendor.id]
  );
  const prices = rows.map((row) => Number(row.price || 0)).filter((price) => price > 0);
  return ok(res, {
    currency: rows[0]?.currency || 'ETB',
    basePrice: prices.length ? Math.min(...prices) : 0,
    packages: rows.map((row) => ({
      id: Number(row.id),
      name: row.title,
      description: row.description || '',
      price: Number(row.price || 0),
    })),
  });
});

router.get('/availability', async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT available_date, status, note FROM vendor_availability WHERE vendor_id = ? ORDER BY available_date ASC',
    [req.vendor.id]
  );
  return ok(res, {
    schedule: rows.map((row) => ({
      date: row.available_date,
      status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
      note: row.note || '',
    })),
    businessHours: null,
  });
});

router.get('/booking-requests', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            e.title AS event_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
            u.full_name AS customer_name
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ? AND b.status IN ('requested', 'under_review', 'quoted')
     ORDER BY b.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    date: row.event_start_date,
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
  })));
});

router.get('/bookings', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date, u.full_name AS customer_name
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ? AND b.status IN ('accepted', 'completed')
     ORDER BY e.start_date DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
    date: row.event_start_date,
  })));
});

router.get('/history', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
            DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date, u.full_name AS customer_name
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ? AND b.status IN ('rejected', 'cancelled')
     ORDER BY b.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    service: row.service_description,
    status: statusLabel(row.status),
    amount: Number(row.quoted_amount || 0),
    currency: row.currency,
    date: row.event_start_date,
  })));
});

router.get('/quotations', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT q.id, q.service_description, q.amount, q.currency, q.status, q.valid_until,
            q.created_at, u.full_name AS customer_name, e.title AS event_title
     FROM quotations q
     LEFT JOIN users u ON u.id = q.customer_id
     LEFT JOIN events e ON e.id = q.event_id
     WHERE q.vendor_id = ?
     ORDER BY q.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name || 'Customer pending',
    event: row.event_title || null,
    service: row.service_description,
    status: statusLabel(row.status),
    validUntil: row.valid_until,
    amount: Number(row.amount || 0),
    currency: row.currency,
  })));
});

router.get('/payments', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.id, p.booking_id, p.amount, p.currency, p.provider, p.provider_reference,
            p.status, p.created_at
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     WHERE b.vendor_id = ?
     ORDER BY p.created_at DESC`,
    [req.vendor.id]
  );
  const earnings = rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingPayouts = rows.filter((row) => ['pending', 'authorized'].includes(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return ok(res, {
    earnings,
    pendingPayouts,
    fees: 0,
    net: earnings,
    transactions: rows.map((row) => ({
      id: Number(row.id),
      bookingId: Number(row.booking_id),
      date: row.created_at,
      provider: row.provider || null,
      reference: row.provider_reference || null,
      status: statusLabel(row.status),
      amount: Number(row.amount || 0),
      currency: row.currency,
    })),
  });
});

router.get('/messages', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT m.id, m.body, m.read_at, m.created_at, u.full_name AS sender
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.recipient_id = ?
     ORDER BY m.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    sender: row.sender,
    body: row.body,
    unread: !row.read_at,
    createdAt: row.created_at,
  })));
});

router.get('/reviews', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT r.id, r.rating, r.comment, r.status, r.created_at, u.full_name AS customer_name
     FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN users u ON u.id = e.organizer_id
     WHERE b.vendor_id = ?
     ORDER BY r.created_at DESC`,
    [req.vendor.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    customer: row.customer_name,
    rating: Number(row.rating),
    comment: row.comment || '',
    response: null,
    status: row.status,
    createdAt: row.created_at,
  })));
});

router.get('/notifications', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, title, message, status, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    message: row.message,
    read: row.status === 'read',
    createdAt: row.created_at,
  })));
});

router.get('/reports', async (req, res) => {
  const [serviceRows, bookingRows, paymentRows] = await Promise.all([
    pool.execute('SELECT title FROM services WHERE vendor_id = ?', [req.vendor.id]),
    pool.execute(
      `SELECT b.status, b.service_description
       FROM bookings b WHERE b.vendor_id = ?`,
      [req.vendor.id]
    ),
    pool.execute(
      `SELECT DATE_FORMAT(p.created_at, '%Y-%m') AS month, SUM(p.amount) AS total
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.vendor_id = ? AND p.status = 'paid'
       GROUP BY DATE_FORMAT(p.created_at, '%Y-%m')
       ORDER BY month ASC`,
      [req.vendor.id]
    ),
  ]);
  const bookings = bookingRows[0];
  const serviceCounts = new Map();
  for (const booking of bookings) {
    serviceCounts.set(booking.service_description, (serviceCounts.get(booking.service_description) || 0) + 1);
  }
  const popularServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  return ok(res, {
    totalListings: serviceRows[0].length,
    bookingStatus: bookings.reduce((acc, booking) => {
      acc[booking.status] = (acc[booking.status] || 0) + 1;
      return acc;
    }, {}),
    earningsByDate: Object.fromEntries(paymentRows[0].map((row) => [row.month, Number(row.total || 0)])),
    popularServices,
  });
});

router.get('/account', async (req, res) => {
  return ok(res, {
    fullName: req.platformUser.full_name,
    email: req.platformUser.email,
    phone: req.platformUser.phone,
    role: 'Vendor',
    status: req.platformUser.status,
  });
});

export default router;
