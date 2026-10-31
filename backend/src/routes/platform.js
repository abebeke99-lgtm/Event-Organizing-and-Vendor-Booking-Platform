import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { inTransaction, pool } from '../db.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { createUserSession, hashToken, writeAudit } from '../lib/security.js';
import { calculateDashboardSummary, createBookingSnapshot } from '../lib/bookingRules.js';
import { getPublicEvents, listPublicEvents, mapDatabaseEvent, sanitizeText } from '../lib/eventCatalog.js';
import { getPublicServiceById, listPublicServices } from '../lib/serviceCatalog.js';
import { getPublicVendorById, listPublicVendors } from '../lib/vendorCatalog.js';
import { createEventSchema, dateTimeSchema, toMysqlDateTime } from '../lib/eventInput.js';
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
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SAME_SITE || 'strict',
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

const publicEventSelect = `
  SELECT e.id, e.title, e.event_type, e.description, e.notes, e.city, e.venue, e.cover_image_url,
         e.gallery_images, e.start_date, e.end_date, e.budget, e.capacity, e.status,
         e.published_at, e.created_at, u.full_name AS organizer_name,
         t.starting_price,
         COALESCE(t.available_quantity, 0) AS available_quantity
  FROM events e
  JOIN users u ON u.id = e.organizer_id
  LEFT JOIN (
    SELECT tt.event_id,
           MIN(CASE WHEN tt.capacity - tt.sold_quantity - COALESCE(reserved.quantity, 0) > 0 THEN tt.price END) AS starting_price,
           SUM(GREATEST(tt.capacity - tt.sold_quantity - COALESCE(reserved.quantity, 0), 0)) AS available_quantity
    FROM event_ticket_types tt
    LEFT JOIN (
      SELECT ticket_type_id, SUM(quantity) AS quantity
      FROM event_ticket_bookings
      WHERE booking_status = 'pending_payment'
        AND created_at >= NOW() - INTERVAL 15 MINUTE
      GROUP BY ticket_type_id
    ) reserved ON reserved.ticket_type_id = tt.id
    WHERE tt.status = 'active'
      AND (tt.sales_start IS NULL OR tt.sales_start <= NOW())
      AND (tt.sales_end IS NULL OR tt.sales_end >= NOW())
    GROUP BY tt.event_id
  ) t ON t.event_id = e.id`;

const publicEventWhere = `WHERE e.start_date >= NOW() AND e.status IN ('active', 'published', 'upcoming', 'open')`;
const dateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
const publicEventsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  status: z.enum(['upcoming', 'available', 'free', 'paid']).optional(),
  sort: z.enum(['upcoming', 'earliest', 'latest', 'alphabetical', 'recent', 'price_asc', 'price_desc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).superRefine((query, context) => {
  if (query.startDate && query.endDate && query.endDate < query.startDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after start date.' });
  }
  if (query.minPrice !== undefined && query.maxPrice !== undefined && query.maxPrice < query.minPrice) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price.' });
  }
});

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
  const [rows] = await pool.query(`${publicEventSelect} ${publicEventWhere} ORDER BY e.start_date ASC LIMIT 48`);
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
  const [eventRows] = await pool.query(
    `${publicEventSelect} ${publicEventWhere} AND LOWER(e.event_type) = LOWER(?) ORDER BY e.start_date ASC`,
    [category.name]
  );
  const events = eventRows.map(mapDatabaseEvent);
  return res.json({ data: { ...category, vendors, services, events, eventCount: events.length } });
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
  const [[reviews], [availability]] = await Promise.all([
    pool.execute(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS customer_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = e.organizer_id
       WHERE b.vendor_id = ? AND r.status = 'published'
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [vendor.id]
    ),
    pool.execute(
      `SELECT available_date, status
       FROM vendor_availability
       WHERE vendor_id = ? AND available_date >= CURDATE()
       ORDER BY available_date ASC
       LIMIT 30`,
      [vendor.id]
    ),
  ]);
  return res.json({
    data: {
      ...vendor,
      reviews: reviews[0].map((review) => ({
        rating: Number(review.rating),
        comment: review.comment || '',
        customerName: review.customer_name || 'Customer',
        createdAt: review.created_at,
      })),
      availability: availability.map((entry) => ({
        date: entry.available_date,
        status: entry.status,
      })),
    },
  });
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
  const [[reviews], [availability]] = await Promise.all([
    pool.execute(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS customer_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = e.organizer_id
       WHERE b.service_id = ? AND r.status = 'published'
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [service.id]
    ),
    pool.execute(
      `SELECT available_date, status
       FROM vendor_availability
       WHERE vendor_id = ? AND available_date >= CURDATE()
       ORDER BY available_date ASC
       LIMIT 30`,
      [service.vendorId]
    ),
  ]);
  const vendor = marketplace.vendors.find((entry) => entry.id === service.vendorId);
  return res.json({
    data: {
      ...service,
      packages: vendor?.services || [],
      availability: availability.map((entry) => ({
        date: entry.available_date,
        status: entry.status,
      })),
      reviews: reviews.map((review) => ({
        rating: Number(review.rating),
        comment: review.comment || '',
        customerName: review.customer_name || 'Customer',
        createdAt: review.created_at,
      })),
    },
  });
});

router.get('/events', async (req, res) => {
  const parsed = publicEventsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid event filters.' });
  const [rows] = await pool.query(`${publicEventSelect} ${publicEventWhere} ORDER BY e.start_date ASC`);
  const events = rows.map(mapDatabaseEvent);
  const result = listPublicEvents(events, parsed.data);
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

router.get('/events/:id/related', async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return res.status(400).json({ error: 'Invalid event id.' });
  const [currentRows] = await pool.execute(
    `SELECT event_type, city FROM events
     WHERE id = ? AND start_date >= NOW() AND status IN ('active', 'published', 'upcoming', 'open')
     LIMIT 1`,
    [eventId]
  );
  if (!currentRows.length) return res.status(404).json({ error: 'Event not found.' });
  const [rows] = await pool.execute(
    `${publicEventSelect}
     ${publicEventWhere} AND e.id <> ?
       AND (LOWER(e.event_type) = LOWER(?) OR LOWER(COALESCE(e.city, '')) = LOWER(COALESCE(?, '')))
     ORDER BY CASE WHEN LOWER(e.event_type) = LOWER(?) THEN 0 ELSE 1 END, e.start_date ASC
     LIMIT 6`,
    [eventId, currentRows[0].event_type, currentRows[0].city, currentRows[0].event_type]
  );
  return res.json({ data: rows.map(mapDatabaseEvent) });
});

router.get('/events/:id/tickets', async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return res.status(400).json({ error: 'Invalid event id.' });
  const [eventRows] = await pool.execute(
    `SELECT id FROM events
     WHERE id = ? AND start_date >= NOW() AND status IN ('active', 'published', 'upcoming', 'open')
     LIMIT 1`,
    [eventId]
  );
  if (!eventRows.length) return res.status(404).json({ error: 'Event not found.' });
  const [rows] = await pool.execute(
    `SELECT tt.id, tt.name, tt.description, tt.price, tt.capacity,
            GREATEST(tt.capacity - tt.sold_quantity - COALESCE(reserved.quantity, 0), 0) AS available_quantity,
            tt.sales_start, tt.sales_end, tt.status
     FROM event_ticket_types tt
     LEFT JOIN (
       SELECT ticket_type_id, SUM(quantity) AS quantity
       FROM event_ticket_bookings
       WHERE booking_status = 'pending_payment'
         AND created_at >= NOW() - INTERVAL 15 MINUTE
       GROUP BY ticket_type_id
     ) reserved ON reserved.ticket_type_id = tt.id
     WHERE tt.event_id = ? AND tt.status = 'active'
       AND (tt.sales_start IS NULL OR tt.sales_start <= NOW())
       AND (tt.sales_end IS NULL OR tt.sales_end >= NOW())
     ORDER BY tt.price ASC, tt.id ASC`,
    [eventId]
  );
  return res.json({
    data: rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description || '',
      price: Number(row.price),
      capacity: Number(row.capacity),
      availableQuantity: Number(row.available_quantity),
      salesStart: row.sales_start,
      salesEnd: row.sales_end,
    })),
  });
});

router.get('/events/:id/tickets/manage', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'organizer') return res.status(403).json({ error: 'Organizer access is required.' });
  const [events] = await pool.execute('SELECT id, organizer_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
  if (!events.length) return res.status(404).json({ error: 'Event not found.' });
  if (Number(events[0].organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only manage tickets for your own events.' });
  }
  const [rows] = await pool.execute(
    `SELECT id, name, description, price, capacity, sold_quantity, sales_start, sales_end, status
     FROM event_ticket_types WHERE event_id = ? ORDER BY price ASC, id ASC`,
    [req.params.id]
  );
  return res.json({ data: rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || '',
    price: Number(row.price),
    capacity: Number(row.capacity),
    soldQuantity: Number(row.sold_quantity),
    availableQuantity: Math.max(0, Number(row.capacity) - Number(row.sold_quantity)),
    salesStart: row.sales_start,
    salesEnd: row.sales_end,
    status: row.status,
  })) });
});

router.get('/events/mine', requirePlatformUser, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, organizer_id, title, event_type, description, city, venue, cover_image_url,
            gallery_images, start_date, end_date, budget, guest_count, capacity, notes, status,
            published_at, created_at
     FROM events
     WHERE organizer_id = ?
     ORDER BY start_date DESC`,
    [req.platformUser.id]
  );
  return res.json({
    data: rows.map((row) => ({
      ...mapDatabaseEvent(row),
      notes: row.notes || '',
      guestCount: row.guest_count === null ? null : Number(row.guest_count),
    })),
  });
});

router.post('/events', requirePlatformUser, async (req, res) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Only customers and organizers can create events.' });
  }

  const parsed = createEventSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid event details.' });
  }

  const event = parsed.data;
  const eventId = await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO events (
         organizer_id, title, event_type, description, city, venue, cover_image_url, gallery_images,
         start_date, end_date, budget, guest_count, capacity, notes, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        req.platformUser.id,
        event.title,
        event.type,
        event.description || null,
        event.city || null,
        event.venue || null,
        event.coverImageUrl || null,
        JSON.stringify(event.galleryImages || []),
        toMysqlDateTime(event.startDate),
        toMysqlDateTime(event.endDate),
        event.budget,
        event.guestCount,
        event.capacity,
        event.notes || null,
      ]
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'event.created',
      entityType: 'event',
      entityId: result.insertId,
      details: { title: event.title, status: 'draft' },
      ip: req.ip,
    });
    return result.insertId;
  });

  return res.status(201).json({
    data: {
      id: Number(eventId),
      title: event.title,
      type: event.type,
      category: event.type.toLowerCase(),
      location: event.city || null,
      venue: event.venue || null,
      description: event.description || '',
      coverImage: event.coverImageUrl || null,
      galleryImages: event.galleryImages || [],
      startDate: toMysqlDateTime(event.startDate),
      endDate: toMysqlDateTime(event.endDate),
      budget: event.budget,
      guestCount: event.guestCount,
      capacity: event.capacity,
      notes: event.notes,
      status: 'draft',
    },
  });
});

router.get('/events/:id', async (req, res) => {
  const [rows] = await pool.execute(
    `${publicEventSelect}
     ${publicEventWhere} AND e.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Event not found.' });
  return res.json({ data: mapDatabaseEvent(rows[0]) });
});

router.post('/events/:id/contact', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'customer') return res.status(403).json({ error: 'Customer access is required.' });
  const parsed = z.object({
    message: z.string().trim().min(10).max(2000),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a message for the organizer.' });
  const [events] = await pool.execute(
    `SELECT id, organizer_id, title FROM events
     WHERE id = ? AND start_date >= NOW() AND status IN ('active', 'published', 'upcoming', 'open')
     LIMIT 1`,
    [req.params.id]
  );
  const event = events[0];
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (Number(event.organizer_id) === Number(req.platformUser.id)) {
    return res.status(409).json({ error: 'You cannot contact yourself about your own event.' });
  }
  const messageId = await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO messages (sender_id, recipient_id, subject, body)
       VALUES (?, ?, ?, ?)`,
      [
        req.platformUser.id,
        event.organizer_id,
        `Question about ${event.title}`.slice(0, 180),
        parsed.data.message,
      ]
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'event.organizer_contacted',
      entityType: 'event',
      entityId: event.id,
      details: { messageId: Number(result.insertId) },
      ip: req.ip,
    });
    return Number(result.insertId);
  });
  return res.status(201).json({ data: { id: messageId, eventId: Number(event.id), status: 'sent' } });
});

router.patch('/events/:id', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'organizer') {
    return res.status(403).json({ error: 'Only event organizers can edit events.' });
  }
  const parsed = createEventSchema.partial().safeParse(req.body || {});
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Provide valid event changes.' });
  }
  const [rows] = await pool.execute(
    `SELECT id, organizer_id, title, event_type, description, city, venue, cover_image_url,
            gallery_images, start_date, end_date, budget, guest_count, capacity, notes, status
     FROM events WHERE id = ? LIMIT 1`,
    [req.params.id]
  );
  const current = rows[0];
  if (!current) return res.status(404).json({ error: 'Event not found.' });
  if (Number(current.organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only edit your own events.' });
  }

  const value = parsed.data;
  const changes = {
    title: value.title,
    event_type: value.type,
    description: value.description,
    city: value.city,
    venue: value.venue,
    cover_image_url: value.coverImageUrl,
    gallery_images: value.galleryImages === undefined ? undefined : JSON.stringify(value.galleryImages),
    start_date: value.startDate === undefined ? undefined : toMysqlDateTime(value.startDate),
    end_date: value.endDate === undefined ? undefined : toMysqlDateTime(value.endDate),
    budget: value.budget,
    guest_count: value.guestCount,
    capacity: value.capacity,
    notes: value.notes,
  };
  const nextStartDate = value.startDate || String(current.start_date).replace(' ', 'T').slice(0, 16);
  const nextEndDate = value.endDate === undefined
    ? current.end_date && String(current.end_date).replace(' ', 'T').slice(0, 16)
    : value.endDate;
  if (nextEndDate && Date.parse(nextEndDate) <= Date.parse(nextStartDate)) {
    return res.status(400).json({ error: 'Event end date must be after its start date.' });
  }
  const fields = Object.entries(changes).filter(([, fieldValue]) => fieldValue !== undefined);
  const assignments = fields.map(([field]) => `\`${field}\` = ?`).join(', ');
  const updateResult = await inTransaction(async (connection) => {
    const [lockedRows] = await connection.execute(
      'SELECT id, organizer_id, capacity FROM events WHERE id = ? FOR UPDATE',
      [current.id]
    );
    const lockedEvent = lockedRows[0];
    if (!lockedEvent || Number(lockedEvent.organizer_id) !== Number(req.platformUser.id)) {
      return { status: 404, error: 'Event not found.' };
    }
    if (value.capacity !== undefined && value.capacity !== null) {
      const [inventoryRows] = await connection.execute(
        `SELECT COALESCE(SUM(tt.sold_quantity), 0) AS sold,
                COALESCE(SUM(reserved.quantity), 0) AS reserved
         FROM event_ticket_types tt
         LEFT JOIN (
           SELECT ticket_type_id, SUM(quantity) AS quantity
           FROM event_ticket_bookings
           WHERE booking_status = 'pending_payment'
             AND created_at >= NOW() - INTERVAL 15 MINUTE
           GROUP BY ticket_type_id
         ) reserved ON reserved.ticket_type_id = tt.id
         WHERE tt.event_id = ? AND tt.status = 'active'`,
        [current.id]
      );
      if (Number(inventoryRows[0].sold) + Number(inventoryRows[0].reserved) > value.capacity) {
        return { status: 409, error: 'Event capacity cannot be lower than tickets sold or reserved.' };
      }
    }
    await connection.execute(
      `UPDATE events SET ${assignments} WHERE id = ?`,
      [...fields.map(([, fieldValue]) => fieldValue), current.id]
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'event.updated',
      entityType: 'event',
      entityId: current.id,
      details: { fields: fields.map(([field]) => field) },
      ip: req.ip,
    });
    return { status: 200 };
  });
  if (updateResult.error) return res.status(updateResult.status).json({ error: updateResult.error });
  return res.json({ data: { id: Number(current.id), ...value, status: current.status } });
});

router.patch('/events/:id/publish', requirePlatformUser, async (req, res) => {
  const [rows] = await pool.execute('SELECT id, organizer_id, status FROM events WHERE id = ? LIMIT 1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (req.platformUser.role !== 'organizer'
    || Number(event.organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only publish your own events.' });
  }
  if (event.status === 'cancelled' || event.status === 'completed') {
    return res.status(409).json({ error: 'This event cannot be published.' });
  }
  await inTransaction(async (connection) => {
    await connection.execute(
      `UPDATE events SET status = 'active', published_at = COALESCE(published_at, NOW()) WHERE id = ?`,
      [event.id]
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'event.published',
      entityType: 'event',
      entityId: event.id,
      details: { previousStatus: event.status },
      ip: req.ip,
    });
  });
  return res.json({ data: { id: Number(event.id), status: 'active' } });
});

router.patch('/events/:id/cancel', requirePlatformUser, async (req, res) => {
  const [rows] = await pool.execute('SELECT id, organizer_id, status FROM events WHERE id = ? LIMIT 1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (req.platformUser.role !== 'organizer'
    || Number(event.organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only cancel your own events.' });
  }
  if (event.status === 'completed') return res.status(409).json({ error: 'Completed events cannot be cancelled.' });
  await inTransaction(async (connection) => {
    await connection.execute(`UPDATE events SET status = 'cancelled' WHERE id = ?`, [event.id]);
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'event.cancelled',
      entityType: 'event',
      entityId: event.id,
      details: { previousStatus: event.status },
      ip: req.ip,
    });
  });
  return res.json({ data: { id: Number(event.id), status: 'cancelled' } });
});

const optionalTicketDate = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  dateTimeSchema.nullable(),
);

const ticketTypeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().default(''),
  price: z.coerce.number().finite().min(0).max(100000000),
  capacity: z.coerce.number().int().positive().max(1000000),
  salesStart: optionalTicketDate.optional(),
  salesEnd: optionalTicketDate.optional(),
  status: z.enum(['active', 'inactive']).optional().default('active'),
}).superRefine((ticket, context) => {
  if (ticket.salesStart && ticket.salesEnd && Date.parse(ticket.salesEnd) <= Date.parse(ticket.salesStart)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['salesEnd'], message: 'Ticket sales must end after sales start.' });
  }
});

router.post('/events/:id/tickets', requirePlatformUser, async (req, res) => {
  const parsed = ticketTypeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid ticket type.' });
  const [events] = await pool.execute(
    `SELECT id, organizer_id, status, start_date > NOW() AS is_future FROM events WHERE id = ? LIMIT 1`,
    [req.params.id]
  );
  const event = events[0];
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (req.platformUser.role !== 'organizer'
    || Number(event.organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only manage tickets for your own events.' });
  }
  if (!Number(event.is_future) || ['cancelled', 'completed'].includes(event.status)) {
    return res.status(409).json({ error: 'Tickets cannot be added to a past or closed event.' });
  }
  const ticket = parsed.data;
  const ticketId = await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO event_ticket_types
         (event_id, name, description, price, capacity, sales_start, sales_end, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        ticket.name,
        ticket.description || null,
        ticket.price,
        ticket.capacity,
        ticket.salesStart ? toMysqlDateTime(ticket.salesStart) : null,
        ticket.salesEnd ? toMysqlDateTime(ticket.salesEnd) : null,
        ticket.status,
      ]
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'event.ticket_type.created',
      entityType: 'event_ticket_type',
      entityId: result.insertId,
      details: { eventId: event.id, name: ticket.name, capacity: ticket.capacity, price: ticket.price },
      ip: req.ip,
    });
    return Number(result.insertId);
  });
  return res.status(201).json({ data: { id: ticketId, ...ticket } });
});

router.patch('/events/:id/tickets/:ticketId', requirePlatformUser, async (req, res) => {
  const parsed = ticketTypeSchema.partial().safeParse(req.body || {});
  if (!parsed.success || !Object.keys(parsed.data || {}).length) {
    return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Provide valid ticket changes.' });
  }
  const [events] = await pool.execute('SELECT id, organizer_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
  if (!events.length) return res.status(404).json({ error: 'Event not found.' });
  if (req.platformUser.role !== 'organizer'
    || Number(events[0].organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only manage tickets for your own events.' });
  }
  const changes = parsed.data;
  const columns = {
    name: changes.name,
    description: changes.description || null,
    price: changes.price,
    capacity: changes.capacity,
    sales_start: changes.salesStart === undefined ? undefined : changes.salesStart ? toMysqlDateTime(changes.salesStart) : null,
    sales_end: changes.salesEnd === undefined ? undefined : changes.salesEnd ? toMysqlDateTime(changes.salesEnd) : null,
    status: changes.status,
  };
  const fields = Object.entries(columns).filter(([, value]) => value !== undefined);
  const updateResult = await inTransaction(async (connection) => {
    const [tickets] = await connection.execute(
      `SELECT id, capacity, sold_quantity, sales_start, sales_end
       FROM event_ticket_types WHERE id = ? AND event_id = ? FOR UPDATE`,
      [req.params.ticketId, req.params.id]
    );
    const current = tickets[0];
    if (!current) return { status: 404, error: 'Ticket type not found.' };
    const nextCapacity = changes.capacity === undefined ? Number(current.capacity) : changes.capacity;
    const [reservedRows] = await connection.execute(
      `SELECT COALESCE(SUM(quantity), 0) AS quantity
       FROM event_ticket_bookings
       WHERE ticket_type_id = ? AND booking_status = 'pending_payment'
         AND created_at >= NOW() - INTERVAL 15 MINUTE`,
      [current.id]
    );
    if (nextCapacity < Number(current.sold_quantity) + Number(reservedRows[0].quantity)) {
      return { status: 409, error: 'Capacity cannot be lower than tickets sold or reserved.' };
    }
    const nextSalesStart = changes.salesStart === undefined
      ? current.sales_start
      : changes.salesStart ? toMysqlDateTime(changes.salesStart) : null;
    const nextSalesEnd = changes.salesEnd === undefined
      ? current.sales_end
      : changes.salesEnd ? toMysqlDateTime(changes.salesEnd) : null;
    if (nextSalesStart && nextSalesEnd && new Date(nextSalesEnd) <= new Date(nextSalesStart)) {
      return { status: 400, error: 'Ticket sales must end after sales start.' };
    }
    await connection.execute(
      `UPDATE event_ticket_types SET ${fields.map(([name]) => `\`${name}\` = ?`).join(', ')} WHERE id = ?`,
      [...fields.map(([, value]) => value), current.id]
    );
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'event.ticket_type.updated',
      entityType: 'event_ticket_type',
      entityId: current.id,
      details: { eventId: Number(req.params.id), fields: fields.map(([field]) => field) },
      ip: req.ip,
    });
    return { status: 200, id: Number(current.id) };
  });
  if (updateResult.error) return res.status(updateResult.status).json({ error: updateResult.error });
  return res.json({ data: { id: updateResult.id, ...changes } });
});

router.get('/ticket-bookings/mine', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'customer') return res.status(403).json({ error: 'Customer access is required.' });
  const [rows] = await pool.execute(
    `SELECT b.id, b.booking_reference, b.quantity, b.unit_price, b.total_amount,
            b.payment_status, b.booking_status, b.created_at, b.event_id,
            e.title AS event_title, e.start_date, e.city, e.venue, tt.name AS ticket_name
     FROM event_ticket_bookings b
     JOIN events e ON e.id = b.event_id
     JOIN event_ticket_types tt ON tt.id = b.ticket_type_id
     WHERE b.customer_id = ?
     ORDER BY b.created_at DESC`,
    [req.platformUser.id]
  );
  return res.json({ data: rows.map(mapTicketBooking) });
});

router.get('/ticket-bookings/:id', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'customer') return res.status(403).json({ error: 'Customer access is required.' });
  const [rows] = await pool.execute(
    `SELECT b.id, b.booking_reference, b.quantity, b.unit_price, b.total_amount,
            b.payment_status, b.booking_status, b.created_at, b.event_id,
            e.title AS event_title, e.start_date, e.city, e.venue, tt.name AS ticket_name
     FROM event_ticket_bookings b
     JOIN events e ON e.id = b.event_id
     JOIN event_ticket_types tt ON tt.id = b.ticket_type_id
     WHERE b.id = ? AND b.customer_id = ? LIMIT 1`,
    [req.params.id, req.platformUser.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Booking not found.' });
  return res.json({ data: mapTicketBooking(rows[0]) });
});

function mapTicketBooking(row) {
  return {
    id: Number(row.id),
    reference: row.booking_reference,
    eventId: Number(row.event_id),
    eventTitle: row.event_title,
    startDate: row.start_date,
    location: row.city || row.venue || null,
    ticketName: row.ticket_name,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    totalAmount: Number(row.total_amount),
    paymentStatus: row.payment_status,
    bookingStatus: row.booking_status,
    createdAt: row.created_at,
  };
}

router.post('/ticket-bookings', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'customer') return res.status(403).json({ error: 'Customer access is required.' });
  const parsed = z.object({
    eventId: z.coerce.number().int().positive(),
    ticketTypeId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(10),
    idempotencyKey: z.string().uuid().optional(),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid ticket booking.' });
  const { eventId, ticketTypeId, quantity, idempotencyKey } = parsed.data;
  try {
    const bookingId = await inTransaction(async (connection) => {
      if (idempotencyKey) {
        const [existing] = await connection.execute(
          `SELECT id, customer_id FROM event_ticket_bookings WHERE idempotency_key = ? LIMIT 1`,
          [idempotencyKey]
        );
        if (existing.length) {
          if (Number(existing[0].customer_id) !== Number(req.platformUser.id)) {
            const error = new Error('Booking key already used.');
            error.status = 409;
            throw error;
          }
          return Number(existing[0].id);
        }
      }
      const [events] = await connection.execute(
        `SELECT id, status, start_date, capacity, start_date > NOW() AS is_future FROM events WHERE id = ? FOR UPDATE`,
        [eventId]
      );
      const event = events[0];
      if (!event) {
        const error = new Error('Event not found.');
        error.status = 404;
        throw error;
      }
      if (!['active', 'published', 'upcoming', 'open'].includes(String(event.status).toLowerCase())
        || !Number(event.is_future)) {
        const error = new Error('This event is not accepting ticket bookings.');
        error.status = 409;
        throw error;
      }
      const [tickets] = await connection.execute(
        `SELECT id, name, price, capacity, sold_quantity
         FROM event_ticket_types
         WHERE id = ? AND event_id = ? AND status = 'active'
           AND (sales_start IS NULL OR sales_start <= NOW())
           AND (sales_end IS NULL OR sales_end >= NOW())
         FOR UPDATE`,
        [ticketTypeId, eventId]
      );
      const ticket = tickets[0];
      if (!ticket) {
        const error = new Error('Ticket type is unavailable.');
        error.status = 404;
        throw error;
      }
      const [reservedRows] = await connection.execute(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity
         FROM event_ticket_bookings
         WHERE ticket_type_id = ? AND booking_status = 'pending_payment'
           AND created_at >= NOW() - INTERVAL 15 MINUTE`,
        [ticketTypeId]
      );
      const available = Number(ticket.capacity) - Number(ticket.sold_quantity) - Number(reservedRows[0].quantity);
      if (available < quantity) {
        const error = new Error('Not enough tickets are available.');
        error.status = 409;
        throw error;
      }
      if (event.capacity !== null) {
        const [eventReservedRows] = await connection.execute(
          `SELECT COALESCE(SUM(tt.sold_quantity), 0) AS sold,
                  COALESCE(SUM(reserved.quantity), 0) AS reserved
           FROM event_ticket_types tt
           LEFT JOIN (
             SELECT ticket_type_id, SUM(quantity) AS quantity
             FROM event_ticket_bookings
             WHERE booking_status = 'pending_payment'
               AND created_at >= NOW() - INTERVAL 15 MINUTE
             GROUP BY ticket_type_id
           ) reserved ON reserved.ticket_type_id = tt.id
           WHERE tt.event_id = ? AND tt.status = 'active'`,
          [eventId]
        );
        if (Number(eventReservedRows[0].sold) + Number(eventReservedRows[0].reserved) + quantity > Number(event.capacity)) {
          const error = new Error('The event capacity has been reached.');
          error.status = 409;
          throw error;
        }
      }
      const unitPrice = Number(ticket.price);
      const totalAmount = Number((unitPrice * quantity).toFixed(2));
      const reference = `EVT-${randomBytes(6).toString('hex').toUpperCase()}`;
      const [result] = await connection.execute(
        `INSERT INTO event_ticket_bookings
           (booking_reference, idempotency_key, event_id, ticket_type_id, customer_id,
            quantity, unit_price, total_amount, payment_status, booking_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending_payment')`,
        [reference, idempotencyKey || null, eventId, ticketTypeId, req.platformUser.id, quantity, unitPrice, totalAmount]
      );
      return Number(result.insertId);
    });
    const [rows] = await pool.execute(
      `SELECT b.id, b.booking_reference, b.quantity, b.unit_price, b.total_amount,
              b.payment_status, b.booking_status, b.created_at, b.event_id,
              e.title AS event_title, e.start_date, e.city, e.venue, tt.name AS ticket_name
       FROM event_ticket_bookings b
       JOIN events e ON e.id = b.event_id
       JOIN event_ticket_types tt ON tt.id = b.ticket_type_id
       WHERE b.id = ? AND b.customer_id = ? LIMIT 1`,
      [bookingId, req.platformUser.id]
    );
    return res.status(201).json({ data: mapTicketBooking(rows[0]) });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' && idempotencyKey) {
      const [rows] = await pool.execute(
        `SELECT id, customer_id FROM event_ticket_bookings WHERE idempotency_key = ? LIMIT 1`,
        [idempotencyKey]
      );
      if (rows.length && Number(rows[0].customer_id) === Number(req.platformUser.id)) {
        const [bookingRows] = await pool.execute(
          `SELECT b.id, b.booking_reference, b.quantity, b.unit_price, b.total_amount,
                  b.payment_status, b.booking_status, b.created_at, b.event_id,
                  e.title AS event_title, e.start_date, e.city, e.venue, tt.name AS ticket_name
           FROM event_ticket_bookings b
           JOIN events e ON e.id = b.event_id
           JOIN event_ticket_types tt ON tt.id = b.ticket_type_id
           WHERE b.id = ? LIMIT 1`,
          [rows[0].id]
        );
        return res.status(201).json({ data: mapTicketBooking(bookingRows[0]) });
      }
    }
    if (Number.isInteger(error?.status)) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.patch('/ticket-bookings/:id/cancel', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'customer') return res.status(403).json({ error: 'Customer access is required.' });
  const [rows] = await pool.execute(
    `SELECT id, booking_status, payment_status FROM event_ticket_bookings
     WHERE id = ? AND customer_id = ? LIMIT 1`,
    [req.params.id, req.platformUser.id]
  );
  const booking = rows[0];
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.booking_status !== 'pending_payment' || booking.payment_status !== 'pending') {
    return res.status(409).json({ error: 'Only unpaid pending bookings can be cancelled online.' });
  }
  await pool.execute(
    `UPDATE event_ticket_bookings SET booking_status = 'cancelled' WHERE id = ? AND customer_id = ?`,
    [booking.id, req.platformUser.id]
  );
  return res.json({ data: { id: Number(booking.id), bookingStatus: 'cancelled' } });
});

router.get('/bookings', requirePlatformUser, async (req, res) => {
  const rows = await loadOwnedBookings(req.platformUser);
  return res.json({ data: rows.map(mapBookingRecord) });
});

router.get('/vendor-application', requirePlatformUser, async (req, res) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Vendor applications are available to customer and organizer accounts.' });
  }
  const [rows] = await pool.execute(
    `SELECT vp.id, vp.business_name, vp.category_id, sc.name AS category_name,
            vp.city, vp.description, vp.verification_status, vp.verification_reason,
            vp.verified_at, vp.created_at
     FROM vendor_profiles vp
     LEFT JOIN service_categories sc ON sc.id = vp.category_id
     WHERE vp.user_id = ?
     LIMIT 1`,
    [req.platformUser.id]
  );
  return res.json({ success: true, data: rows[0] || null });
});

router.post('/vendor-application', requirePlatformUser, async (req, res) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Vendor applications are available to customer and organizer accounts.' });
  }
  const parsed = z.object({
    businessName: z.string().trim().min(2).max(160),
    categoryId: z.preprocess(
      (value) => value === '' || value === null || value === undefined ? null : Number(value),
      z.number().int().positive().nullable()
    ),
    city: z.string().trim().max(120),
    description: z.string().trim().max(1500),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid vendor application.' });
  }

  const application = await inTransaction(async (connection) => {
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.platformUser.id]);
    if (parsed.data.categoryId !== null) {
      const [categoryRows] = await connection.execute(
        'SELECT id FROM service_categories WHERE id = ? AND is_active = TRUE LIMIT 1',
        [parsed.data.categoryId]
      );
      if (!categoryRows.length) return { error: 'Choose an active service category.', status: 400 };
    }

    const [existingRows] = await connection.execute(
      'SELECT id, verification_status FROM vendor_profiles WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [req.platformUser.id]
    );
    const existing = existingRows[0];
    if (existing?.verification_status === 'pending') {
      return { error: 'A vendor application is already pending review.', status: 409 };
    }
    if (existing?.verification_status === 'verified') {
      return { error: 'This account already has an approved vendor profile.', status: 409 };
    }

    if (existing) {
      await connection.execute(
        `UPDATE vendor_profiles
         SET business_name = ?, category_id = ?, city = ?, description = ?,
             verification_status = 'pending', verification_reason = NULL, verified_at = NULL
         WHERE id = ?`,
        [parsed.data.businessName, parsed.data.categoryId, parsed.data.city || null, parsed.data.description || null, existing.id]
      );
      return { id: existing.id, verificationStatus: 'pending', created: false };
    }

    const [result] = await connection.execute(
      `INSERT INTO vendor_profiles (
         user_id, business_name, category_id, city, description, verification_status
       ) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [req.platformUser.id, parsed.data.businessName, parsed.data.categoryId, parsed.data.city || null, parsed.data.description || null]
    );
    return { id: result.insertId, verificationStatus: 'pending', created: true };
  });

  if (application.error) {
    return res.status(application.status).json({ error: application.error });
  }
  return res.status(application.created ? 201 : 200).json({
    success: true,
    data: application,
    message: 'Your vendor application has been submitted for review.',
  });
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

router.post(['/quotes', '/service-quote-requests'], requirePlatformUser, async (req, res) => {
  const schema = z.object({
    serviceId: z.coerce.number().int().positive(),
    eventId: z.coerce.number().int().positive().optional(),
    guestCount: z.coerce.number().int().positive().max(100000).optional(),
    budget: z.coerce.number().nonnegative().max(100000000).optional(),
    notes: z.string().trim().max(2000).optional().default(''),
  }).strict();
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Customer or organizer access is required.' });
  }
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quote request.' });

  const [serviceRows] = await pool.execute(
    `SELECT s.id, s.title, s.price, s.currency, s.vendor_id
     FROM services s
     JOIN vendor_profiles vp ON vp.id = s.vendor_id
     WHERE s.id = ? AND s.status = 'active' AND vp.verification_status = 'verified'
     LIMIT 1`,
    [parsed.data.serviceId]
  );
  const service = serviceRows[0];
  if (!service) return res.status(404).json({ error: 'Service not found.' });

  if (parsed.data.eventId) {
    const [events] = await pool.execute(
      'SELECT id FROM events WHERE id = ? AND organizer_id = ? LIMIT 1',
      [parsed.data.eventId, req.platformUser.id]
    );
    if (!events.length) return res.status(404).json({ error: 'Event not found.' });
  }

  const [result] = await pool.execute(
    `INSERT INTO quotations (
       vendor_id, customer_id, event_id, service_description, amount, currency, status, notes
     ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [
      service.vendor_id,
      req.platformUser.id,
      parsed.data.eventId || null,
      service.title,
      0,
      service.currency || 'ETB',
      [
        parsed.data.guestCount ? `Guest count: ${parsed.data.guestCount}` : '',
        parsed.data.budget !== undefined ? `Budget: ${parsed.data.budget}` : '',
        parsed.data.notes,
      ].filter(Boolean).join('\n') || null,
    ]
  );

  return res.status(201).json({
    data: {
      id: result.insertId,
      status: 'draft',
      serviceId: service.id,
      serviceTitle: service.title,
    },
  });
});

router.patch('/quotations/:id/respond', requirePlatformUser, async (req, res) => {
  if (req.platformUser.role !== 'vendor') {
    return res.status(403).json({ error: 'Vendor access is required.' });
  }
  const id = Number(req.params.id);
  const parsed = z.object({
    status: z.enum(['sent', 'declined']),
    amount: z.coerce.number().finite().nonnegative().max(100000000).optional(),
    notes: z.string().trim().max(2000).optional().default(''),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  }).strict().safeParse(req.body || {});
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    return res.status(400).json({ error: 'A valid quote response is required.' });
  }
  if (parsed.data.status === 'sent' && parsed.data.amount === undefined) {
    return res.status(400).json({ error: 'Enter the quote amount before sending a response.' });
  }
  const [vendors] = await pool.execute(
    'SELECT id FROM vendor_profiles WHERE user_id = ? LIMIT 1',
    [req.platformUser.id]
  );
  if (!vendors.length) return res.status(404).json({ error: 'Vendor profile not found.' });
  const [result] = await pool.execute(
    `UPDATE quotations
     SET status = ?, amount = COALESCE(?, amount),
         notes = CONCAT_WS('\n\n', NULLIF(notes, ''), NULLIF(?, '')),
         valid_until = ?, updated_at = NOW()
     WHERE id = ? AND vendor_id = ? AND status IN ('draft', 'revision_requested')`,
    [
      parsed.data.status,
      parsed.data.amount ?? null,
      parsed.data.notes ? `Vendor response: ${parsed.data.notes}` : '',
      parsed.data.validUntil || null,
      id,
      vendors[0].id,
    ]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Open quote request not found.' });
  return res.json({
    data: {
      id,
      status: parsed.data.status,
      amount: parsed.data.amount,
      validUntil: parsed.data.validUntil || null,
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
