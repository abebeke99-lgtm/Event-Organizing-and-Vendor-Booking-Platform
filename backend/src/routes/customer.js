import { Router } from 'express';
import { pool } from '../db.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { loadPublicMarketplace, mapBookingRecord } from '../lib/marketplace.js';
import { listPublicServices } from '../lib/serviceCatalog.js';
import { listPublicVendors } from '../lib/vendorCatalog.js';

const router = Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

router.use(requirePlatformUser);
router.use((req, res, next) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Customer access is required.' });
  }
  next();
});

const customerBookingSelect = `
  SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount, b.currency,
         b.status, b.moderation_reason, b.created_at,
         e.title AS event_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
         u.full_name AS customer_name, vp.business_name AS vendor_name
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  JOIN users u ON u.id = e.organizer_id
  JOIN vendor_profiles vp ON vp.id = b.vendor_id
  WHERE e.organizer_id = ?`;

router.get('/overview', async (req, res) => {
  const userId = req.platformUser.id;
  const [bookingRows, eventRows, quotationRows, paymentRows, messageRows, notificationRows] = await Promise.all([
    pool.execute('SELECT status FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = ?', [userId]),
    pool.execute("SELECT id FROM events WHERE organizer_id = ? AND start_date >= NOW() AND status <> 'cancelled'", [userId]),
    pool.execute(
      `SELECT q.status FROM quotations q
       LEFT JOIN events e ON e.id = q.event_id
       WHERE q.customer_id = ? OR e.organizer_id = ?`,
      [userId, userId]
    ),
    pool.execute(
      `SELECT p.status, p.amount FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN events e ON e.id = b.event_id
       WHERE e.organizer_id = ?`,
      [userId]
    ),
    pool.execute('SELECT id FROM messages WHERE recipient_id = ? AND read_at IS NULL', [userId]),
    pool.execute("SELECT id FROM notifications WHERE user_id = ? AND status <> 'read'", [userId]),
  ]);

  const bookings = bookingRows[0];
  const payments = paymentRows[0];
  return ok(res, {
    totalBookings: bookings.length,
    pendingBookings: bookings.filter((booking) => ['requested', 'under_review', 'quoted'].includes(booking.status)).length,
    confirmedBookings: bookings.filter((booking) => ['accepted', 'completed'].includes(booking.status)).length,
    upcomingEvents: eventRows[0].length,
    pendingQuotations: quotationRows[0].filter((quote) => ['draft', 'sent', 'revision_requested'].includes(quote.status)).length,
    unreadMessages: messageRows[0].length,
    unreadNotifications: notificationRows[0].length,
    outstandingPayments: payments
      .filter((payment) => ['pending', 'authorized'].includes(payment.status))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
  });
});

router.get('/vendors', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  const result = listPublicVendors(marketplace.vendors, req.query);
  return ok(res, result.vendors);
});

router.get('/services', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  const result = listPublicServices(marketplace.services, req.query);
  return ok(res, result.services);
});

router.get('/categories', async (req, res) => {
  const marketplace = await loadPublicMarketplace();
  return ok(res, marketplace.categories.map((category) => ({
    ...category,
    active: category.isActive,
  })));
});

router.get('/bookings', async (req, res) => {
  const [rows] = await pool.execute(`${customerBookingSelect} ORDER BY b.created_at DESC`, [req.platformUser.id]);
  return ok(res, rows.map(mapBookingRecord));
});

router.get('/history', async (req, res) => {
  const [rows] = await pool.execute(
    `${customerBookingSelect} AND b.status IN ('completed', 'cancelled', 'rejected') ORDER BY b.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map(mapBookingRecord));
});

router.get('/events', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, title, event_type, city, start_date, end_date, budget, guest_count, status
     FROM events WHERE organizer_id = ? ORDER BY start_date DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    type: row.event_type,
    city: row.city || '',
    date: row.start_date,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: row.budget === null ? null : Number(row.budget),
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
    status: row.status,
  })));
});

router.get('/favorites', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT vp.id, vp.business_name, vp.city, vp.description, vp.verification_status,
            sc.name AS category
     FROM favorites f
     JOIN vendor_profiles vp ON vp.id = f.vendor_id
     LEFT JOIN service_categories sc ON sc.id = vp.category_id
     WHERE f.user_id = ?
     ORDER BY f.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    name: row.business_name,
    business_name: row.business_name,
    category: row.category || 'General',
    city: row.city || '',
    description: row.description || '',
    verified: row.verification_status === 'verified',
  })));
});

router.get('/quotations', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT q.id, q.vendor_id, q.event_id, q.service_description, q.amount, q.currency,
            q.status, q.valid_until, q.notes, q.created_at, vp.business_name AS vendor_name,
            e.title AS event_title
     FROM quotations q
     JOIN vendor_profiles vp ON vp.id = q.vendor_id
     LEFT JOIN events e ON e.id = q.event_id
     WHERE q.customer_id = ? OR e.organizer_id = ?
     ORDER BY q.created_at DESC`,
    [req.platformUser.id, req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    vendorId: Number(row.vendor_id),
    vendorName: row.vendor_name,
    eventId: row.event_id ? Number(row.event_id) : null,
    event: row.event_title || null,
    service: row.service_description,
    status: row.status,
    amount: Number(row.amount || 0),
    currency: row.currency,
    validUntil: row.valid_until,
    notes: row.notes || '',
    createdAt: row.created_at,
  })));
});

router.get('/payments', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.id, p.booking_id, p.amount, p.currency, p.provider, p.provider_reference,
            p.status, p.created_at, b.service_description, e.title AS event_title
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN events e ON e.id = b.event_id
     WHERE e.organizer_id = ?
     ORDER BY p.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    reference: row.provider_reference || `PAY-${String(row.id).padStart(6, '0')}`,
    provider: row.provider || null,
    status: row.status,
    amount: Number(row.amount || 0),
    currency: row.currency,
    service: row.service_description,
    event: row.event_title,
    date: row.created_at,
  })));
});

router.get('/messages', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT m.id, m.subject, m.body, m.read_at, m.created_at, u.full_name AS sender
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.recipient_id = ?
     ORDER BY m.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    sender: row.sender,
    subject: row.subject || '',
    body: row.body,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  })));
});

router.get('/reviews', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT r.id, r.booking_id, r.rating, r.comment, r.status, r.created_at,
            b.vendor_id, vp.business_name AS vendor_name
     FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE e.organizer_id = ?
     ORDER BY r.created_at DESC`,
    [req.platformUser.id]
  );
  return ok(res, rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    vendorId: Number(row.vendor_id),
    vendorName: row.vendor_name,
    rating: Number(row.rating),
    comment: row.comment || '',
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

router.get('/profile', async (req, res) => {
  return ok(res, {
    fullName: req.platformUser.full_name,
    email: req.platformUser.email,
    phone: req.platformUser.phone,
    role: req.platformUser.role,
    status: req.platformUser.status,
  });
});

export default router;
