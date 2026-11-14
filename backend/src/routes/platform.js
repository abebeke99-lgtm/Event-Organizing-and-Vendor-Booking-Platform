import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { createAuthRateLimiter } from '../middleware/authRateLimit.js';
import { z } from 'zod';
import { pool } from '../db.js';
import { optionalPlatformUser, requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getProfilePhoto, profilePhotoUploadParser, removeProfilePhoto, saveProfilePhoto } from '../lib/profilePhoto.js';
import { createUserSession, hashToken, writeAudit } from '../lib/security.js';
import { getCookieOptions } from '../lib/cookieOptions.js';
import { createNotification, notifyAdministrators } from '../lib/notificationService.js';
import {
  MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES,
  sanitizeVendorDocumentName,
  validateVendorVerificationDocument,
  VENDOR_VERIFICATION_DOCUMENT_TYPES,
} from '../lib/vendorVerificationDocuments.js';
import { loadSystemSettings } from '../lib/systemSettings.js';
import { isValidCategoryName } from '../lib/categoryName.js';
import { calculateDashboardSummary, createBookingSnapshot } from '../lib/bookingRules.js';
import { buildPublicEventCategoriesQuery, buildPublicEventListingQuery, getPublicEvents, mapDatabaseEvent, resolveEventCategoryFilter, sanitizeText } from '../lib/eventCatalog.js';
import { publicEventFrom, publicEventOwnerFrom, publicEventSelect, publicEventWhere, upcomingPublicEventWhere } from '../lib/publicEventSql.js';
import { getPublicServiceById, listPublicServices } from '../lib/serviceCatalog.js';
import { getPublicVendorById, listPublicVendors } from '../lib/vendorCatalog.js';
import { createEventSchema, dateTimeSchema, toMysqlDateTime } from '../lib/eventInput.js';
import { partialEventSchema } from '../lib/eventInput.js';
import { isEventOpenForBookings } from '../lib/adminEvents.js';
import {
  checkBookingDateAvailability,
  lockBookingVendor,
  releaseBookingDate,
  reserveBookingDate,
} from '../lib/bookingAvailability.js';
import {
  categorySlug,
  ensureVendorProfile as ensureVendorProfileRecord,
  loadPublicMarketplace,
  mapBookingRecord,
} from '../lib/marketplace.js';

const router = Router();
const profilePhotoParser = profilePhotoUploadParser(express);
const vendorVerificationDocumentParser = express.raw({
  type: [...VENDOR_VERIFICATION_DOCUMENT_TYPES],
  limit: MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES,
});
const databaseFor = (req) => req.app?.locals?.database || pool;
async function inDatabaseTransaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function notifyBookingParties(database, booking, actorId, status, reason = '') {
  const title = status === 'accepted'
    ? 'Booking confirmed'
    : status === 'cancelled'
      ? 'Booking cancelled'
      : status === 'rejected'
        ? 'Booking declined'
        : `Booking ${status.replaceAll('_', ' ')}`;
  const message = `${title}: ${booking.event_title || `Booking #${booking.id}`} with ${booking.vendor_name || 'your vendor'}.${reason ? ` Reason: ${reason}` : ''}`;
  for (const userId of new Set([Number(booking.customer_id), Number(booking.vendor_user_id)])) {
    if (userId && userId !== Number(actorId)) {
      await createNotification(database, {
        userId,
        title,
        message,
        type: 'booking',
        relatedType: 'booking',
        relatedId: booking.id,
        idempotencyKey: status === 'rescheduled' ? null : `booking:${booking.id}:${status}:${userId}`,
        actorId,
      });
    }
  }
}
const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const sessionCheckLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  skipSuccessfulRequests: true,
  message: 'Too many session checks. Please try again later.',
});
const registrationLimiter = createAuthRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: 'Too many registration attempts. Please try again later.',
});
export const platformLoginLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many sign-in attempts. Please try again later.',
});
const passwordRecoveryLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many password recovery requests. Please try again later.',
});

function setPlatformCookie(res, token) {
  res.cookie('platform_session', token, getCookieOptions({
    maxAge: 8 * 60 * 60 * 1000,
  }));
}

const bookingSelect = `
  SELECT b.id, b.event_id, b.vendor_id, b.service_description, b.quoted_amount, b.currency,
         b.status, b.moderation_reason, b.created_at,
         e.title AS event_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS event_start_date,
         cu.full_name AS customer_name,
         vp.business_name AS vendor_name
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  JOIN users cu ON cu.id = e.organizer_id
  JOIN vendor_profiles vp ON vp.id = b.vendor_id`;

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
  datePreset: z.enum(['upcoming', 'today', 'tomorrow', 'this_week', 'this_weekend', 'this_month', 'next_month']).optional(),
  priceFilter: z.enum(['free', 'paid']).optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  status: z.enum(['all', 'upcoming', 'ongoing', 'past', 'available', 'free', 'paid']).optional(),
  filter: z.enum(['all', 'upcoming', 'ongoing', 'past', 'available', 'free', 'paid', 'featured']).optional(),
  sort: z.enum([
    'upcoming', 'earliest', 'latest', 'alphabetical', 'recent',
    'newest', 'oldest', 'date_earliest', 'date_latest', 'title_asc', 'title_desc',
    'price_asc', 'price_desc', 'popular',
  ]).optional(),
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
  const [rows] = await pool.query(`${publicEventSelect} ${upcomingPublicEventWhere} ORDER BY e.start_date ASC LIMIT 48`);
  return rows.map(mapDatabaseEvent);
}

router.get('/categories', asyncHandler(async (req, res) => {
  const database = req.app?.locals?.database || pool;
  const scope = req.query.scope;
  if (scope !== undefined && scope !== 'services') {
    return res.status(400).json({ error: 'Category scope must be services when provided.' });
  }
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const parsedPagination = z.object({
    page: z.coerce.number().int().min(1).max(100000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }).safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!parsedPagination.success) {
    return res.status(400).json({
      error: 'Invalid category pagination.',
      details: parsedPagination.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  const serviceScope = scope === 'services';
  const search = sanitizeText(req.query.search, '').toLowerCase();
  const filters = search
    ? `AND (LOWER(${serviceScope ? 'COALESCE(sc.service_menu_name, sc.name)' : 'sc.name'}) LIKE ? OR LOWER(COALESCE(sc.description, '')) LIKE ?)`
    : '';
  const values = search ? [`%${search}%`, `%${search}%`] : [];
  const [rows] = await database.query(
    `SELECT sc.id, ${serviceScope ? 'COALESCE(sc.service_menu_name, sc.name)' : 'sc.name'} AS name,
            sc.name AS database_name, sc.description, sc.display_order, sc.image_mime,
            ${serviceScope ? 'sc.service_menu_order,' : ''}
            COUNT(DISTINCT CASE
              WHEN vp.verification_status = 'verified' AND u.status = 'active' THEN vp.id
            END) AS vendor_count,
            COUNT(DISTINCT CASE
              WHEN vp.verification_status = 'verified' AND u.status = 'active'
                AND s.status = 'active' AND s.category_id = sc.id THEN s.id
            END) AS service_count
     FROM service_categories sc
     LEFT JOIN vendor_profiles vp ON vp.category_id = sc.id
     LEFT JOIN users u ON u.id = vp.user_id
     LEFT JOIN services s ON s.vendor_id = vp.id
     WHERE sc.is_active = TRUE ${serviceScope ? 'AND sc.service_menu_order IS NOT NULL' : ''} ${filters}
     GROUP BY sc.id, sc.name, sc.service_menu_name, sc.description, sc.display_order,
              ${serviceScope ? 'sc.service_menu_order,' : ''} sc.image_mime
     ORDER BY ${serviceScope ? 'sc.service_menu_order ASC' : 'name ASC'}, sc.name ASC`,
    values,
  );
  const categories = rows.filter((row) => isValidCategoryName(row.name)).map((row) => {
    const id = Number(row.id);
    const image = row.image_mime ? `/api/platform/categories/${id}/image` : null;
    return {
      id,
      name: row.name,
      slug: categorySlug(row.name),
      description: row.description || '',
      icon: image,
      image,
      isActive: true,
      displayOrder: Number(row.display_order || 0),
      vendor_count: Number(row.vendor_count || 0),
      vendorCount: Number(row.vendor_count || 0),
      serviceCount: Number(row.service_count || 0),
      serviceMenuOrder: row.service_menu_order === undefined ? null : Number(row.service_menu_order),
    };
  });
  if (!paginationRequested) return res.json({ categories, data: categories });

  const limit = parsedPagination.data.limit || 12;
  const total = categories.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(parsedPagination.data.page || 1, totalPages);
  const pagedCategories = categories.slice((page - 1) * limit, page * limit);
  return res.json({
    categories: pagedCategories,
    data: pagedCategories,
    pagination: { page, limit, total, totalPages },
  });
}));

router.get('/categories/:id/image', async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid category ID is required.' });
  const database = req.app?.locals?.database || pool;
  const [[category]] = await database.execute(
    'SELECT image, image_mime FROM service_categories WHERE id = ? AND is_active = TRUE',
    [id.data],
  );
  if (!category?.image) return res.status(404).json({ error: 'Category image not found.' });
  res.set({
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Type': category.image_mime,
    'Content-Disposition': 'inline',
  });
  return res.send(category.image);
});

router.get('/categories/:slug', async (req, res) => {
  const slug = sanitizeText(req.params.slug, '').toLowerCase();
  const marketplace = await loadPublicMarketplace(req.app?.locals?.database || pool);
  const category = marketplace.categories.find((item) => item.slug === slug);
  if (!category) return res.status(404).json({ error: 'Category not found.' });

  const key = category.slug;
  const vendors = marketplace.vendors.filter((vendor) => sanitizeText(vendor.category, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') === key);
  const services = marketplace.services.filter((service) => sanitizeText(service.category, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') === key);
  const [eventRows] = await databaseFor(req).query(
    `${publicEventSelect} ${publicEventWhere} AND LOWER(e.event_type) = LOWER(?) ORDER BY e.start_date ASC`,
    [category.name]
  );
  const events = eventRows.map(mapDatabaseEvent);
  return res.json({ data: { ...category, vendors, services, events, eventCount: events.length } });
});

router.get('/vendors', asyncHandler(async (req, res) => {
  const vendorSortValue = z.preprocess((value) => {
    const entry = String(value ?? '').trim().toLowerCase();
    const aliases = {
      recommended: 'recommended',
      popular: 'popular',
      'highest-rated': 'highest-rated',
      highest_rated: 'highest-rated',
      'most-reviewed': 'most-reviewed',
      most_reviewed: 'most-reviewed',
      'most-bookings': 'popular',
      most_bookings: 'popular',
      'price-low': 'price-low',
      price_low: 'price-low',
      'price-high': 'price-high',
      price_high: 'price-high',
      'name-az': 'name-az',
      'recently-added': 'recently-added',
      newest: 'recently-added',
    };
    return aliases[entry] ?? entry;
  }, z.enum(['recommended', 'popular', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'name-az', 'recently-added']));

  const filtersSchema = z.object({
    search: z.string().trim().max(120).optional(),
    category: z.string().trim().max(80).optional(),
    location: z.string().trim().max(120).optional(),
    verified: z.enum(['true', 'false', '1', '0']).optional(),
    filter: z.enum(['featured']).optional(),
    available: z.preprocess((value) => value === undefined ? undefined : String(value).trim().toLowerCase(), z.enum(['true', 'false', '1', '0']).optional()),
    availableOnly: z.preprocess((value) => value === undefined ? undefined : String(value).trim().toLowerCase(), z.enum(['true', 'false', '1', '0']).optional()),
    minRating: z.coerce.number().finite().min(0).max(5).optional(),
    minPrice: z.coerce.number().finite().min(0).optional(),
    maxPrice: z.coerce.number().finite().min(0).optional(),
    sort: vendorSortValue.optional(),
    page: z.coerce.number().int().min(1).max(100000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }).strict().superRefine((filters, context) => {
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.maxPrice < filters.minPrice) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price.' });
    }
  });
  const parsedFilters = filtersSchema.safeParse(req.query);
  if (!parsedFilters.success) {
    return res.status(400).json({
      error: 'Invalid vendor filters.',
      details: parsedFilters.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  const marketplace = await loadPublicMarketplace(databaseFor(req));
  const result = listPublicVendors(marketplace.vendors, {
    ...parsedFilters.data,
  });
  return res.json({
    data: result.vendors,
    pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
  });
}));

router.get('/vendors/:vendorId/media/:mediaId', asyncHandler(async (req, res) => {
  const vendorId = z.coerce.number().int().positive().safeParse(req.params.vendorId);
  const mediaId = z.coerce.number().int().positive().safeParse(req.params.mediaId);
  if (!vendorId.success || !mediaId.success) return res.status(400).json({ error: 'Vendor image ID is invalid.' });
  const [[media]] = await databaseFor(req).execute(
    `SELECT m.content, m.content_type, m.file_size
     FROM vendor_media m
     JOIN vendor_profiles vp ON vp.id = m.vendor_id
     JOIN users u ON u.id = vp.user_id AND u.status = 'active'
     WHERE m.id = ? AND m.vendor_id = ? AND m.service_id IS NULL
       AND m.media_type IN ('logo', 'cover', 'portfolio') AND vp.verification_status = 'verified'
     LIMIT 1`,
    [mediaId.data, vendorId.data],
  );
  if (!media) return res.status(404).json({ error: 'Vendor image not found.' });
  res.set({ 'Content-Type': media.content_type, 'Content-Length': media.file_size, 'Cache-Control': 'public, max-age=1800', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(media.content);
}));

router.get('/services/:serviceId/media/:mediaId', asyncHandler(async (req, res) => {
  const serviceId = z.coerce.number().int().positive().safeParse(req.params.serviceId);
  const mediaId = z.coerce.number().int().positive().safeParse(req.params.mediaId);
  if (!serviceId.success || !mediaId.success) return res.status(400).json({ error: 'Service image ID is invalid.' });
  const [[media]] = await databaseFor(req).execute(
    `SELECT m.content, m.content_type, m.file_size
     FROM vendor_media m
     JOIN services s ON s.id = m.service_id
     JOIN vendor_profiles vp ON vp.id = m.vendor_id
     JOIN users u ON u.id = vp.user_id AND u.status = 'active'
     WHERE m.id = ? AND m.service_id = ? AND m.media_type = 'service'
       AND s.status = 'active' AND vp.verification_status = 'verified'
     LIMIT 1`,
    [mediaId.data, serviceId.data],
  );
  if (!media) return res.status(404).json({ error: 'Service image not found.' });
  res.set({ 'Content-Type': media.content_type, 'Content-Length': media.file_size, 'Cache-Control': 'public, max-age=1800', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(media.content);
}));

router.get('/vendors/:id', asyncHandler(async (req, res) => {
  const parsedId = z.string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => Number.isSafeInteger(Number(value)))
    .safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ error: 'Invalid vendor ID.' });

  const database = databaseFor(req);
  const marketplace = await loadPublicMarketplace(database);
  const vendor = getPublicVendorById(marketplace.vendors, Number(parsedId.data));
  if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
  const [[reviews], [ratingRows], [availability]] = await Promise.all([
    database.execute(
      `SELECT r.rating, r.comment, r.created_at
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       WHERE b.vendor_id = ? AND r.status = 'published'
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [vendor.id]
    ),
    database.execute(
      `SELECT r.rating, COUNT(*) AS total
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       WHERE b.vendor_id = ? AND r.status = 'published'
       GROUP BY r.rating`,
      [vendor.id]
    ),
    database.execute(
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
      ratingDistribution: Object.fromEntries([1, 2, 3, 4, 5].map((rating) => [
        rating,
        Number(ratingRows.find((row) => Number(row.rating) === rating)?.total || 0),
      ])),
      reviews: reviews.map((review) => ({
        rating: Number(review.rating),
        comment: review.comment || '',
        customerName: 'Customer',
        createdAt: review.created_at,
      })),
      availability: availability.map((entry) => ({
        date: entry.available_date,
        status: entry.status,
      })),
    },
  });
}));

router.get('/services', asyncHandler(async (req, res) => {
  const database = databaseFor(req);
  const parsedFilters = z.object({
    search: z.string().trim().max(120).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    location: z.string().trim().max(120).optional(),
    vendor: z.string().trim().max(120).optional(),
    vendorId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    minPrice: z.coerce.number().finite().min(0).optional(),
    maxPrice: z.coerce.number().finite().min(0).optional(),
    minRating: z.coerce.number().finite().min(0).max(5).optional(),
    availableOnly: z.enum(['true', 'false', '1', '0']).optional(),
    ids: z.string().max(80).refine((value) => {
      const ids = value.split(',').map(Number);
      return ids.length <= 4
        && ids.every((id) => Number.isSafeInteger(id) && id > 0)
        && new Set(ids).size === ids.length;
    }, 'Invalid service filters.').optional(),
    sort: z.enum(['recommended', 'popular', 'newest', 'highest-rated', 'rating', 'price-low', 'price-high', 'alphabetical']).optional(),
    page: z.coerce.number().int().min(1).max(100000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }).strict().superRefine((filters, context) => {
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.maxPrice < filters.minPrice) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price.' });
    }
  }).safeParse(req.query);
  if (!parsedFilters.success) {
    return res.status(400).json({
      error: 'Invalid service filters.',
      details: parsedFilters.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  let categoryId;
  if (parsedFilters.data.category !== undefined) {
    const [categories] = await database.query(
      'SELECT id, name, service_menu_name FROM service_categories WHERE is_active = TRUE',
    );
    const categoryKey = categorySlug(parsedFilters.data.category);
    const match = categories.find((category) => String(category.id) === parsedFilters.data.category)
      || categories.find((category) => categorySlug(category.name) === categoryKey
        || (category.service_menu_name && categorySlug(category.service_menu_name) === categoryKey));
    if (!match) return res.status(400).json({ error: 'The selected service category is unavailable.' });
    categoryId = Number(match.id);
  }
  const marketplace = await loadPublicMarketplace(database);
  const serviceIds = parsedFilters.data.ids?.split(',').map(Number);
  const sourceServices = serviceIds
    ? marketplace.services.filter((service) => serviceIds.includes(Number(service.id)))
    : marketplace.services;
  const result = listPublicServices(sourceServices, {
    ...parsedFilters.data,
    categoryId,
  });
  return res.json({
    data: result.services,
    pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
  });
}));

router.get('/services/:id', asyncHandler(async (req, res) => {
  const database = databaseFor(req);
  const marketplace = await loadPublicMarketplace(database);
  const service = getPublicServiceById(marketplace.services, req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  const [[reviews], [availability]] = await Promise.all([
    database.execute(
      `SELECT r.rating, r.comment, r.created_at
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       WHERE b.service_id = ? AND r.status = 'published'
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [service.id]
    ),
    database.execute(
      `SELECT va.available_date,
              CASE
                WHEN va.status = 'available' AND NOT EXISTS (
                  SELECT 1
                  FROM bookings b
                  JOIN events e ON e.id = b.event_id
                  WHERE b.vendor_id = va.vendor_id
                    AND b.status IN ('accepted', 'confirmed', 'in_progress')
                    AND DATE(COALESCE(b.scheduled_date, e.start_date)) = va.available_date
                ) THEN 'available'
                WHEN va.status = 'available' THEN 'unavailable'
                ELSE va.status
              END AS status
       FROM vendor_availability va
       WHERE va.vendor_id = ? AND va.available_date >= CURDATE()
       ORDER BY va.available_date ASC
       LIMIT 30`,
      [service.vendorId]
    ),
  ]);
  const vendor = marketplace.vendors.find((entry) => entry.id === service.vendorId);
  const relatedServices = marketplace.services
    .filter((entry) => service.categoryId !== null && entry.id !== service.id && entry.categoryId === service.categoryId)
    .slice(0, 4);
  return res.json({
    data: {
      ...service,
      vendorProfile: vendor ? {
        id: vendor.id,
        name: vendor.business_name,
        category: vendor.category,
        city: vendor.city,
        description: vendor.description,
        verified: vendor.verified,
      } : null,
      packages: service.packages || [],
      relatedServices,
      availability: availability.map((entry) => ({
        date: entry.available_date,
        status: entry.status,
      })),
      reviews: reviews.map((review) => ({
        rating: Number(review.rating),
        comment: review.comment || '',
        customerName: 'Customer',
        createdAt: review.created_at,
      })),
    },
  });
}));

router.get('/events', async (req, res) => {
  const parsed = publicEventsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid event filters.' });
  const filters = {
    ...parsed.data,
    status: parsed.data.status || (['upcoming', 'featured'].includes(parsed.data.filter) ? '' : parsed.data.filter || ''),
  };
  const database = databaseFor(req);
  if (filters.category && !/^\d+$/.test(filters.category)) {
    const [categories] = await database.query(
      'SELECT id, name FROM service_categories WHERE is_active = TRUE',
    );
    filters.category = resolveEventCategoryFilter(filters.category, categories);
  }
  const listing = buildPublicEventListingQuery(filters);
  const countFrom = listing.requiresTicketData ? publicEventFrom : publicEventOwnerFrom;
  const [countRows] = await database.query(`SELECT COUNT(*) AS total ${countFrom} ${listing.where}`, listing.params);
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / listing.limit));
  const page = Math.min(parsed.data.page || 1, totalPages);
  const pageListing = buildPublicEventListingQuery({ ...filters, page });
  const [rows] = await database.query(
    `${publicEventSelect} ${pageListing.where} ORDER BY ${pageListing.orderBy} LIMIT ? OFFSET ?`,
    [...pageListing.params, pageListing.limit, pageListing.offset],
  );
  return res.json({
    data: rows.map(mapDatabaseEvent),
    pagination: { total, page, limit: pageListing.limit, totalPages },
  });
});

router.get('/events/featured', async (req, res) => {
  const listing = buildPublicEventListingQuery({ filter: 'featured', sort: 'upcoming', limit: 6 });
  const [rows] = await databaseFor(req).query(
    `${publicEventSelect} ${listing.where} ORDER BY ${listing.orderBy} LIMIT ?`,
    [...listing.params, listing.limit],
  );
  return res.json({ data: rows.map(mapDatabaseEvent) });
});

router.get('/events/categories', asyncHandler(async (req, res) => {
  const [rows] = await databaseFor(req).query(buildPublicEventCategoriesQuery());
  return res.json({
    data: rows.filter((row) => isValidCategoryName(row.name)).map((row) => ({
      id: Number(row.id),
      name: row.name,
      slug: String(row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: row.description || '',
      image: row.image_mime ? `/api/platform/categories/${Number(row.id)}/image` : null,
      total: Number(row.total || 0),
      displayOrder: Number(row.display_order),
    })),
  });
}));

router.get('/events/popular-venues', asyncHandler(async (req, res) => {
  const parsed = z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid venue listing limit.' });
  const [rows] = await databaseFor(req).query(
    `SELECT MIN(TRIM(e.venue)) AS name, MAX(e.city) AS city,
            COUNT(DISTINCT e.id) AS event_count,
            COALESCE(SUM(popularity.attendee_count), 0) AS attendee_count,
            MAX(e.start_date) AS latest_event_date
     FROM events e
     LEFT JOIN (
       SELECT event_id, SUM(quantity) AS attendee_count
       FROM event_ticket_bookings
       WHERE booking_status = 'confirmed'
       GROUP BY event_id
     ) popularity ON popularity.event_id = e.id
     WHERE (e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
       OR (e.status = 'completed' AND e.published_at IS NOT NULL))
       AND e.venue IS NOT NULL AND TRIM(e.venue) <> ''
     GROUP BY LOWER(TRIM(e.venue)), LOWER(COALESCE(e.city, ''))
     ORDER BY attendee_count DESC, event_count DESC, name ASC
     LIMIT ?`,
    [parsed.data.limit],
  );
  return res.json({
    data: rows.map((row) => ({
      name: row.name,
      city: row.city || null,
      eventCount: Number(row.event_count || 0),
      attendeeCount: Number(row.attendee_count || 0),
      latestEventDate: row.latest_event_date || null,
    })),
  });
}));

router.get('/events/:id/related', async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return res.status(400).json({ error: 'Invalid event id.' });
  const [currentRows] = await pool.execute(
    `SELECT event_type, city FROM events
     WHERE id = ? AND (status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
       OR (status = 'completed' AND published_at IS NOT NULL))
     LIMIT 1`,
    [eventId]
  );
  if (!currentRows.length) return res.status(404).json({ error: 'Event not found.' });
  const [rows] = await pool.execute(
    `${publicEventSelect}
     ${upcomingPublicEventWhere} AND e.id <> ?
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
     WHERE id = ? AND (status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
       OR (status = 'completed' AND published_at IS NOT NULL))
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
  const [rows] = await databaseFor(req).execute(
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
  const database = databaseFor(req);
  const eventId = await inDatabaseTransaction(database, async (connection) => {
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
  if (!['organizer', 'customer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Only event owners can edit events.' });
  }
  const parsed = partialEventSchema.safeParse(req.body || {});
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Provide valid event changes.' });
  }
  const database = databaseFor(req);
  const [rows] = await database.execute(
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
  const updateResult = await inDatabaseTransaction(database, async (connection) => {
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
  const database = databaseFor(req);
  const [rows] = await database.execute('SELECT id, organizer_id, status FROM events WHERE id = ? LIMIT 1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (!['organizer', 'customer'].includes(req.platformUser.role)
    || Number(event.organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only publish your own events.' });
  }
  if (event.status === 'cancelled' || event.status === 'completed') {
    return res.status(409).json({ error: 'This event cannot be published.' });
  }
  await inDatabaseTransaction(database, async (connection) => {
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
  const database = databaseFor(req);
  const [rows] = await database.execute('SELECT id, organizer_id, status FROM events WHERE id = ? LIMIT 1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (!['organizer', 'customer'].includes(req.platformUser.role)
    || Number(event.organizer_id) !== Number(req.platformUser.id)) {
    return res.status(403).json({ error: 'You can only cancel your own events.' });
  }
  if (event.status === 'completed') return res.status(409).json({ error: 'Completed events cannot be cancelled.' });
  if (req.platformUser.role === 'customer') {
    const [[activeBookings]] = await database.execute(
      `SELECT COUNT(*) AS total FROM bookings
       WHERE event_id = ? AND status IN ('requested', 'under_review', 'quoted', 'accepted', 'confirmed', 'in_progress')`,
      [event.id],
    );
    if (Number(activeBookings?.total || 0)) {
      return res.status(409).json({ error: 'Cancel or resolve active bookings before cancelling this event.' });
    }
  }
  await inDatabaseTransaction(database, async (connection) => {
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
  const [rows] = await databaseFor(req).execute(
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
  const [rows] = await databaseFor(req).execute(
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
  const database = databaseFor(req);
  try {
    const bookingId = await inDatabaseTransaction(database, async (connection) => {
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
      if (!isEventOpenForBookings(event.status) || !Number(event.is_future)) {
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
      const isFreeRegistration = unitPrice === 0;
      if (isFreeRegistration) {
        const [existingRegistrations] = await connection.execute(
          `SELECT id FROM event_ticket_bookings
           WHERE customer_id = ? AND event_id = ? AND unit_price = 0
             AND booking_status = 'confirmed'
           LIMIT 1 FOR UPDATE`,
          [req.platformUser.id, eventId]
        );
        if (existingRegistrations.length) {
          const error = new Error('You are already registered for this free event.');
          error.status = 409;
          throw error;
        }
      }
      const reference = `EVT-${randomBytes(6).toString('hex').toUpperCase()}`;
      const [result] = await connection.execute(
        `INSERT INTO event_ticket_bookings
           (booking_reference, idempotency_key, event_id, ticket_type_id, customer_id,
            quantity, unit_price, total_amount, payment_status, booking_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reference, idempotencyKey || null, eventId, ticketTypeId, req.platformUser.id,
          quantity, unitPrice, totalAmount,
          isFreeRegistration ? 'paid' : 'pending',
          isFreeRegistration ? 'confirmed' : 'pending_payment',
        ]
      );
      if (isFreeRegistration) {
        const [inventoryUpdate] = await connection.execute(
          `UPDATE event_ticket_types
           SET sold_quantity = sold_quantity + ?
           WHERE id = ? AND event_id = ? AND sold_quantity + ? <= capacity`,
          [quantity, ticketTypeId, eventId, quantity]
        );
        if (inventoryUpdate.affectedRows !== 1) {
          const error = new Error('Not enough tickets are available.');
          error.status = 409;
          throw error;
        }
      }
      return Number(result.insertId);
    });
    const [rows] = await database.execute(
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
      const [rows] = await database.execute(
        `SELECT id, customer_id FROM event_ticket_bookings WHERE idempotency_key = ? LIMIT 1`,
        [idempotencyKey]
      );
      if (rows.length && Number(rows[0].customer_id) === Number(req.platformUser.id)) {
        const [bookingRows] = await database.execute(
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

router.patch('/ticket-bookings/:id/cancel', requirePlatformUser, asyncHandler(async (req, res) => {
  if (req.platformUser.role !== 'customer') return res.status(403).json({ error: 'Customer access is required.' });
  const database = databaseFor(req);
  const result = await inDatabaseTransaction(database, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT b.id, b.event_id, b.ticket_type_id, b.quantity, b.unit_price,
              b.booking_status, b.payment_status, e.start_date
       FROM event_ticket_bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.id = ? AND b.customer_id = ? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.platformUser.id]
    );
    const booking = rows[0];
    if (!booking) return { status: 404, error: 'Booking not found.' };
    const isPendingReservation = booking.booking_status === 'pending_payment' && booking.payment_status === 'pending';
    const isFreeRegistration = Number(booking.unit_price) === 0
      && booking.booking_status === 'confirmed'
      && booking.payment_status === 'paid'
      && new Date(booking.start_date).getTime() > Date.now();
    if (!isPendingReservation && !isFreeRegistration) {
      return { status: 409, error: 'This booking can no longer be cancelled online.' };
    }
    const [update] = await connection.execute(
      `UPDATE event_ticket_bookings SET booking_status = 'cancelled'
       WHERE id = ? AND customer_id = ? AND booking_status = ?`,
      [booking.id, req.platformUser.id, booking.booking_status]
    );
    if (update.affectedRows !== 1) return { status: 409, error: 'This booking can no longer be cancelled online.' };
    if (isFreeRegistration) {
      await connection.execute(
        `UPDATE event_ticket_types SET sold_quantity = GREATEST(0, sold_quantity - ?)
         WHERE id = ? AND event_id = ?`,
        [booking.quantity, booking.ticket_type_id, booking.event_id]
      );
    }
    return { data: { id: Number(booking.id), bookingStatus: 'cancelled' } };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json({ data: result.data });
}));

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
  const applicationSettings = await loadSystemSettings(databaseFor(req), [
    'vendor_require_category',
    'vendor_require_city',
    'vendor_require_description',
  ]);
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
  if ((applicationSettings.vendor_require_category && parsed.data.categoryId === null)
    || (applicationSettings.vendor_require_city && !parsed.data.city.trim())
    || (applicationSettings.vendor_require_description && !parsed.data.description.trim())) {
    return res.status(400).json({ error: 'Complete all business information required by the current vendor policy.' });
  }

  const application = await inDatabaseTransaction(databaseFor(req), async (connection) => {
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
    if (['under_review', 'suspended'].includes(existing?.verification_status)) {
      return { error: 'This vendor application cannot be edited in its current status.', status: 409 };
    }

    if (existing) {
      await connection.execute(
        `UPDATE vendor_profiles
         SET business_name = ?, category_id = ?, city = ?, description = ?,
             verification_status = 'pending', verification_reason = NULL, verified_at = NULL
         WHERE id = ?`,
        [parsed.data.businessName, parsed.data.categoryId, parsed.data.city || null, parsed.data.description || null, existing.id]
      );
      const [history] = await connection.execute(
        `INSERT INTO vendor_verification_history (vendor_id, actor_id, from_status, to_status, reason)
         VALUES (?, ?, ?, 'pending', ?)`,
        [existing.id, req.platformUser.id, existing.verification_status, 'Vendor application resubmitted.'],
      );
      await notifyAdministrators(connection, {
        title: 'Vendor verification request',
        message: `${parsed.data.businessName} submitted a vendor application for review.`,
        type: 'vendor_verification',
        relatedType: 'vendor',
        relatedId: existing.id,
        idempotencyKey: `vendor-application:${existing.id}:pending:${history.insertId}`,
        actorId: req.platformUser.id,
      });
      return { id: existing.id, verificationStatus: 'pending', created: false };
    }

    const [result] = await connection.execute(
      `INSERT INTO vendor_profiles (
         user_id, business_name, category_id, city, description, verification_status
       ) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [req.platformUser.id, parsed.data.businessName, parsed.data.categoryId, parsed.data.city || null, parsed.data.description || null]
    );
    const [history] = await connection.execute(
       `INSERT INTO vendor_verification_history (vendor_id, actor_id, from_status, to_status, reason)
        VALUES (?, ?, NULL, 'pending', ?)`,
       [result.insertId, req.platformUser.id, 'Vendor application submitted.'],
    );
    await notifyAdministrators(connection, {
      title: 'Vendor verification request',
      message: `${parsed.data.businessName} submitted a vendor application for review.`,
      type: 'vendor_verification',
      relatedType: 'vendor',
      relatedId: result.insertId,
      idempotencyKey: `vendor-application:${result.insertId}:pending:${history.insertId}`,
      actorId: req.platformUser.id,
    });
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

router.get('/vendor-application/documents', requirePlatformUser, async (req, res) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Vendor application documents are unavailable to this account.' });
  }
  const database = databaseFor(req);
  const [[vendor]] = await database.execute(
    'SELECT id FROM vendor_profiles WHERE user_id = ? LIMIT 1',
    [req.platformUser.id],
  );
  if (!vendor) return res.json({ data: [] });
  const [documents] = await database.execute(
    `SELECT id, original_name, content_type, file_size, created_at
     FROM vendor_verification_documents WHERE vendor_id = ? ORDER BY created_at DESC`,
    [vendor.id],
  );
  return res.json({ data: documents });
});

router.post('/vendor-application/documents', requirePlatformUser, vendorVerificationDocumentParser, async (req, res) => {
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Vendor application documents are unavailable to this account.' });
  }
  const contentType = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const validationError = validateVendorVerificationDocument(req.body, contentType);
  if (validationError) return res.status(400).json({ error: validationError });

  const database = databaseFor(req);
  const [[vendor]] = await database.execute(
    `SELECT id, verification_status FROM vendor_profiles
     WHERE user_id = ? AND verification_status IN ('pending', 'under_review', 'information_requested')
     LIMIT 1`,
    [req.platformUser.id],
  );
  if (!vendor) return res.status(409).json({ error: 'Submit an eligible vendor application before uploading documents.' });
  const [[count]] = await database.execute(
    'SELECT COUNT(*) AS total FROM vendor_verification_documents WHERE vendor_id = ?',
    [vendor.id],
  );
  if (Number(count.total) >= 10) return res.status(400).json({ error: 'A vendor application may contain at most 10 documents.' });

  const name = sanitizeVendorDocumentName(req.query.filename);
  const [result] = await database.execute(
    `INSERT INTO vendor_verification_documents
       (vendor_id, uploaded_by, original_name, content_type, file_size, content)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [vendor.id, req.platformUser.id, name, contentType, req.body.length, req.body],
  );
  await writeAudit(database, {
    actorId: req.platformUser.id,
    action: 'vendor.document_submitted',
    entityType: 'vendor',
    entityId: vendor.id,
    details: { documentId: result.insertId, name, contentType, fileSize: req.body.length },
    ip: req.ip,
  });
  return res.status(201).json({
    data: { id: result.insertId, original_name: name, content_type: contentType, file_size: req.body.length },
  });
});

router.post('/bookings', requirePlatformUser, async (req, res, next) => {
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

  const database = databaseFor(req);
  let bookingResult;
  try {
    bookingResult = await inDatabaseTransaction(database, async (connection) => {
    const [[event]] = await connection.execute(
      'SELECT id, organizer_id, status, start_date, title FROM events WHERE id = ? LIMIT 1 FOR UPDATE',
      [parsed.data.eventId],
    );
    if (!event || Number(event.organizer_id) !== Number(req.platformUser.id)) {
      throw Object.assign(new Error('Event not found.'), { status: 404 });
    }
    if (!isEventOpenForBookings(event.status)) {
      throw Object.assign(new Error('This event is not accepting bookings.'), { status: 409 });
    }

    const [[service]] = await connection.execute(
      `SELECT s.id, s.vendor_id, s.title, s.price, s.currency, vp.user_id AS vendor_user_id,
              vp.business_name AS vendor_name
       FROM services s
       JOIN vendor_profiles vp ON vp.id = s.vendor_id
       WHERE s.id = ? AND s.status = 'active' AND vp.verification_status = 'verified'
       LIMIT 1 FOR UPDATE`,
      [parsed.data.serviceId],
    );
    if (!service) throw Object.assign(new Error('Service not found.'), { status: 404 });
    if (Number(service.price) <= 0) {
      throw Object.assign(new Error('This service requires a custom quote.'), { status: 409 });
    }
    await lockBookingVendor(connection, service.vendor_id);
    const scheduledDate = event.start_date;
    if (!scheduledDate || new Date(String(scheduledDate).replace(' ', 'T')) <= new Date()) {
      throw Object.assign(new Error('The event must have a future scheduled date.'), { status: 409 });
    }
    await checkBookingDateAvailability(connection, {
      vendorId: service.vendor_id,
      bookingId: 0,
      scheduledDate,
    });
    const [[duplicate]] = await connection.execute(
      `SELECT id FROM bookings
       WHERE event_id = ? AND service_id = ?
         AND status IN ('requested', 'under_review', 'quoted', 'accepted', 'confirmed', 'in_progress')
       LIMIT 1 FOR UPDATE`,
      [event.id, service.id],
    );
    if (duplicate) {
      throw Object.assign(new Error('A booking request for this service already exists for the event.'), { status: 409 });
    }
    const [result] = await connection.execute(
      `INSERT INTO bookings (event_id, vendor_id, service_id, scheduled_date, service_description, quoted_amount, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested')`,
      [
        event.id,
        service.vendor_id,
        service.id,
        scheduledDate,
        parsed.data.notes ? `${service.title} - ${parsed.data.notes}`.slice(0, 255) : service.title,
        service.price,
        service.currency || 'ETB',
      ],
    );
    await connection.execute(
      `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, details)
       VALUES (?, ?, 'created', NULL, 'requested', ?)`,
      [result.insertId, req.platformUser.id, JSON.stringify({ eventId: event.id, serviceId: service.id })],
    );
    const booking = {
      id: result.insertId,
      customer_id: event.organizer_id,
      vendor_user_id: service.vendor_user_id,
      vendor_name: service.vendor_name,
      event_title: event.title,
    };
    await notifyBookingParties(connection, booking, req.platformUser.id, 'requested');
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'booking.requested',
      entityType: 'booking',
      entityId: result.insertId,
      details: { eventId: event.id, serviceId: service.id, vendorId: service.vendor_id },
      ip: req.ip,
    });
    return { id: result.insertId, event, service };
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
  const { id: bookingId, event, service } = bookingResult;

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

router.patch('/bookings/:id/status', requirePlatformUser, async (req, res, next) => {
  const schema = z.object({
    status: z.enum(['under_review', 'quoted', 'accepted', 'rejected', 'cancelled', 'completed']),
    reason: z.string().trim().max(500).optional().default(''),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid booking status.' });
  if (req.platformUser.role === 'vendor' && parsed.data.status === 'rejected' && parsed.data.reason.trim().length < 5) {
    return res.status(400).json({ error: 'Provide a rejection reason of at least five characters.' });
  }

  const bookingId = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!bookingId.success) return res.status(400).json({ error: 'Booking ID is invalid.' });
  const database = databaseFor(req);
  const userId = req.platformUser.id;
  const nextStatus = parsed.data.status;
  try {
    await inDatabaseTransaction(database, async (connection) => {
      const settings = await loadSystemSettings(connection, [
        'booking_cancellation_cutoff_hours',
        'booking_confirmation_workflow',
      ]);
      const [[booking]] = await connection.execute(
        `SELECT b.id, b.status, b.vendor_id, b.scheduled_date, e.start_date, e.title AS event_title,
                e.organizer_id, vp.user_id AS vendor_user_id, vp.business_name AS vendor_name,
                vp.verification_status AS vendor_verification_status
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         JOIN vendor_profiles vp ON vp.id = b.vendor_id
         WHERE b.id = ? LIMIT 1 FOR UPDATE`,
        [bookingId.data],
      );
      if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });
      await lockBookingVendor(connection, booking.vendor_id);
      const isVendor = Number(booking.vendor_user_id) === Number(userId);
      const isOrganizer = Number(booking.organizer_id) === Number(userId);
      if (!isVendor && !isOrganizer) throw Object.assign(new Error('Access denied.'), { status: 403 });
      if (isVendor && booking.vendor_verification_status !== 'verified') {
        throw Object.assign(new Error('Vendor verification is required to respond to bookings.'), { status: 403 });
      }

      const vendorTransitions = {
        requested: ['under_review', 'accepted', 'rejected'],
        under_review: ['quoted', 'accepted', 'rejected'],
        quoted: ['accepted', 'rejected'],
        accepted: ['completed'],
      };
      if (isVendor && nextStatus === 'accepted'
        && settings.booking_confirmation_workflow === 'administrator_approval') {
        throw Object.assign(new Error('Bookings require administrator approval before confirmation.'), { status: 409 });
      }
      const customerTransitions = {
        requested: ['cancelled'],
        under_review: ['cancelled'],
        quoted: ['cancelled'],
        accepted: ['cancelled'],
      };
      const allowed = (isVendor ? vendorTransitions[booking.status] : customerTransitions[booking.status]) || [];
      if (!allowed.includes(nextStatus)) {
        throw Object.assign(new Error(`Cannot change booking from ${booking.status} to ${nextStatus}.`), { status: 409 });
      }

      const scheduledDate = booking.scheduled_date || booking.start_date;
      if (isOrganizer && nextStatus === 'cancelled') {
        const [cutoffRows] = await connection.execute(
          'SELECT ? <= DATE_ADD(NOW(), INTERVAL ? HOUR) AS inside_cutoff',
          [scheduledDate, settings.booking_cancellation_cutoff_hours],
        );
        if (cutoffRows[0]?.inside_cutoff) {
          throw Object.assign(new Error('This booking is inside the configured cancellation cutoff.'), { status: 409 });
        }
      }
      if (nextStatus === 'accepted') {
        if (!scheduledDate || new Date(String(scheduledDate).replace(' ', 'T')) <= new Date()) {
          throw Object.assign(new Error('A booking cannot be confirmed after its scheduled date.'), { status: 409 });
        }
        const availability = await checkBookingDateAvailability(connection, {
          vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate,
        });
        await reserveBookingDate(connection, {
          vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate, availability,
        });
      }
      if (nextStatus === 'completed') {
        const date = scheduledDate ? new Date(String(scheduledDate).replace(' ', 'T')) : null;
        if (!date || Number.isNaN(date.getTime()) || date > new Date()) {
          throw Object.assign(new Error('A booking cannot be marked completed before its scheduled date.'), { status: 409 });
        }
      }

      await connection.execute(
        'UPDATE bookings SET status = ?, scheduled_date = COALESCE(scheduled_date, ?), moderation_reason = ? WHERE id = ?',
        [nextStatus, scheduledDate, parsed.data.reason || null, booking.id],
      );
      if (nextStatus === 'cancelled') {
        await releaseBookingDate(connection, {
          vendorId: booking.vendor_id, bookingId: booking.id, scheduledDate,
        });
      }
      await connection.execute(
        `INSERT INTO booking_history (booking_id, actor_id, action, from_status, to_status, reason)
         VALUES (?, ?, 'status_changed', ?, ?, ?)`,
        [booking.id, userId, booking.status, nextStatus, parsed.data.reason || null],
      );
      await notifyBookingParties(connection, {
        ...booking,
        customer_id: booking.organizer_id,
      }, userId, nextStatus, parsed.data.reason);
      await writeAudit(connection, {
        actorId: userId,
        action: `booking.${nextStatus}`,
        entityType: 'booking',
        entityId: booking.id,
        details: { previousStatus: booking.status, reason: parsed.data.reason || null },
        ip: req.ip,
      });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
  return res.json({ data: { id: bookingId.data, status: nextStatus } });
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

router.post(['/quotes', '/service-quote-requests'], requirePlatformUser, asyncHandler(async (req, res) => {
  const schema = z.object({
    vendorId: z.coerce.number().int().positive().optional(),
    serviceId: z.coerce.number().int().positive(),
    eventId: z.coerce.number().int().positive().optional(),
    requestKey: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).optional(),
    eventName: z.string().trim().min(2).max(180).optional(),
    eventDate: dateTimeSchema.refine((value) => new Date(value).getTime() > Date.now(), 'Event date must be in the future.'),
    eventLocation: z.string().trim().min(1).max(120),
    eventType: z.string().trim().min(2).max(80),
    contactPhone: z.string().trim().min(7).max(30).regex(/^\+?[0-9][0-9 ()-]{5,28}$/),
    guestCount: z.coerce.number().int().positive().max(100000).optional(),
    budget: z.coerce.number().nonnegative().max(100000000).optional(),
    requiredServices: z.string().trim().max(1000).optional().default(''),
    additionalRequirements: z.string().trim().max(2000).optional().default(''),
    message: z.string().trim().max(2000).optional().default(''),
    notes: z.string().trim().max(2000).optional().default(''),
  }).strict();
  if (!['customer', 'organizer'].includes(req.platformUser.role)) {
    return res.status(403).json({ error: 'Customer or organizer access is required.' });
  }
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quote request.' });
  const result = await inDatabaseTransaction(databaseFor(req), async (connection) => {
    const [serviceRows] = await connection.execute(
      `SELECT s.id, s.title, s.price, s.currency, s.vendor_id, vp.user_id AS vendor_user_id
       FROM services s
       JOIN vendor_profiles vp ON vp.id = s.vendor_id
       JOIN users vu ON vu.id = vp.user_id AND vu.status = 'active'
       WHERE s.id = ? AND s.status = 'active' AND vp.verification_status = 'verified'
       LIMIT 1`,
      [parsed.data.serviceId]
    );
    const service = serviceRows[0];
    if (!service) throw Object.assign(new Error('Service not found.'), { status: 404, expose: true });
    if (parsed.data.vendorId && Number(service.vendor_id) !== parsed.data.vendorId) {
      throw Object.assign(new Error('The selected service does not belong to this vendor.'), { status: 400, expose: true });
    }

    if (parsed.data.requestKey) {
      const [existingRows] = await connection.execute(
        `SELECT id, service_id, status, customer_id FROM quotations
         WHERE request_key = ? LIMIT 1`,
        [parsed.data.requestKey]
      );
      if (existingRows.length) {
        const existing = existingRows[0];
        if (Number(existing.customer_id) !== Number(req.platformUser.id)) {
          throw Object.assign(new Error('This request key has already been used.'), { status: 409, expose: true });
        }
        if (Number(existing.service_id) !== service.id) {
          throw Object.assign(new Error('This request key has already been used.'), { status: 409, expose: true });
        }
        return {
          duplicate: true,
          data: { id: Number(existing.id), status: existing.status, serviceId: service.id, serviceTitle: service.title },
        };
      }
    }

    if (parsed.data.eventId) {
      const [events] = await connection.execute(
        'SELECT id FROM events WHERE id = ? AND organizer_id = ? LIMIT 1',
        [parsed.data.eventId, req.platformUser.id]
      );
      if (!events.length) throw Object.assign(new Error('Event not found.'), { status: 404, expose: true });
    }

    const [created] = await connection.execute(
      `INSERT INTO quotations (
         vendor_id, customer_id, event_id, service_id, request_key, requested_event_name,
         requested_date, requested_location, guest_count, budget, requested_event_type,
         requested_phone, required_services, additional_requirements, request_message,
         service_description, amount, currency, status, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', ?)`,
      [
        service.vendor_id,
        req.platformUser.id,
        parsed.data.eventId || null,
        service.id,
        parsed.data.requestKey || null,
        parsed.data.eventName || null,
        parsed.data.eventDate ? toMysqlDateTime(parsed.data.eventDate) : null,
        parsed.data.eventLocation || null,
        parsed.data.guestCount ?? null,
        parsed.data.budget ?? null,
        parsed.data.eventType || null,
        parsed.data.contactPhone || req.platformUser.phone || null,
        parsed.data.requiredServices || null,
        parsed.data.additionalRequirements || null,
        parsed.data.message || null,
        service.title,
        service.currency || 'ETB',
        parsed.data.notes || null,
      ]
    );
    await createNotification(connection, {
      userId: service.vendor_user_id,
      title: 'New service request',
      message: `${req.platformUser.full_name || 'A customer'} requested ${service.title}${parsed.data.eventName ? ` for ${parsed.data.eventName}` : ''}.`,
      type: 'quotation',
      relatedType: 'quotation',
      relatedId: created.insertId,
      idempotencyKey: `quotation-request:${created.insertId}:${service.vendor_user_id}`,
      actorId: req.platformUser.id,
    });

    return {
      duplicate: false,
      data: { id: Number(created.insertId), status: 'draft', serviceId: service.id, serviceTitle: service.title },
    };
  });
  return res.status(result.duplicate ? 200 : 201).json({ data: result.data });
}));

router.patch('/quotations/:id/respond', requirePlatformUser, asyncHandler(async (req, res) => {
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
  const result = await inDatabaseTransaction(databaseFor(req), async (connection) => {
    const [rows] = await connection.execute(
      `SELECT q.id, q.customer_id, q.status, vp.id AS vendor_id
       FROM quotations q
       JOIN vendor_profiles vp ON vp.id = q.vendor_id
       JOIN users vu ON vu.id = vp.user_id AND vu.status = 'active'
       WHERE q.id = ? AND vp.user_id = ? AND vp.verification_status = 'verified'
       LIMIT 1 FOR UPDATE`,
      [id, req.platformUser.id],
    );
    const quote = rows[0];
    if (!quote) throw Object.assign(new Error('Open quote request not found.'), { status: 404, expose: true });
    if (!['draft', 'revision_requested'].includes(quote.status)) {
      throw Object.assign(new Error('Open quote request not found.'), { status: 404, expose: true });
    }
    await connection.execute(
      `UPDATE quotations
       SET status = ?, amount = COALESCE(?, amount),
           notes = CONCAT_WS('\n\n', NULLIF(notes, ''), NULLIF(?, '')),
           valid_until = ?, updated_at = NOW()
       WHERE id = ? AND vendor_id = ?`,
      [
        parsed.data.status,
        parsed.data.amount ?? null,
        parsed.data.notes ? `Vendor response: ${parsed.data.notes}` : '',
        parsed.data.validUntil || null,
        id,
        quote.vendor_id,
      ]
    );
    if (quote.customer_id) {
      await createNotification(connection, {
        userId: quote.customer_id,
        title: parsed.data.status === 'sent' ? 'Vendor quotation received' : 'Vendor declined request',
        message: parsed.data.status === 'sent'
          ? `A vendor responded to quotation #${id}. Review the quotation in your dashboard.`
          : `A vendor declined quotation request #${id}.`,
        type: 'quotation',
        relatedType: 'quotation',
        relatedId: id,
        actorId: req.platformUser.id,
      });
    }
    return {
      id,
      status: parsed.data.status,
      amount: parsed.data.amount,
      validUntil: parsed.data.validUntil || null,
    };
  });
  return res.json({ data: result });
}));

router.post('/register', registrationLimiter, asyncHandler(async (req, res) => {
  if (req.body && Object.hasOwn(req.body, 'role')
    && !['customer', 'organizer', 'vendor'].includes(req.body.role)) {
    return res.status(403).json({ error: 'Choose a supported account type.' });
  }
  const schema = z.object({
    name: z.string().trim().min(2).max(160),
    email: emailSchema,
    password: z.string()
      .min(8, 'Password must be at least 8 characters.')
      .max(128, 'Password must be 128 characters or fewer.')
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
        message: 'Password must use 72 UTF-8 bytes or fewer.',
      }),
    role: z.enum(['customer', 'organizer', 'vendor']).default('customer'),
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration.' });

  const database = databaseFor(req);
  const systemSettings = await loadSystemSettings(database, ['public_registration_enabled']);
  if (!systemSettings.public_registration_enabled) {
    return res.status(403).json({ error: 'Public registration is currently disabled.' });
  }
  const normalizedEmail = parsed.data.email.toLowerCase();
  const roleName = parsed.data.role;
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const preferredLanguage = req.language === 'am' ? 'am' : 'en';
  let created;
  try {
    created = await inDatabaseTransaction(database, async (connection) => {
      const [[existingEmail]] = await connection.execute(
        'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1 FOR UPDATE',
        [normalizedEmail],
      );
      if (existingEmail) throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
      const [[role]] = await connection.execute(
        'SELECT id FROM roles WHERE LOWER(name) = ? AND is_active = TRUE AND is_admin = FALSE LIMIT 1',
        [roleName],
      );
      if (!role) throw Object.assign(new Error('The selected account type is unavailable.'), { status: 503 });

      const [result] = await connection.execute(
        `INSERT INTO users (full_name, email, phone, password_hash, status, preferred_language)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [parsed.data.name, normalizedEmail, null, passwordHash, preferredLanguage],
      );
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [result.insertId, role.id]);
      if (roleName === 'vendor') {
        await ensureVendorProfileRecord(result.insertId, parsed.data.name, connection);
      }
      const { token } = await createUserSession(connection, result.insertId);
      await writeAudit(connection, {
        actorId: result.insertId,
        action: 'auth.register',
        entityType: 'user',
        entityId: result.insertId,
        details: { role: roleName },
        ip: req.ip,
      });
      await notifyAdministrators(connection, {
        title: 'New user registration',
        message: `${parsed.data.name} registered with the ${roleName} role.`,
        type: 'user_registration',
        relatedType: 'user',
        relatedId: result.insertId,
        idempotencyKey: `user-registration:${result.insertId}`,
        actorId: result.insertId,
      });
      return { id: result.insertId, token };
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email or phone number already exists.' });
    }
    throw error;
  }

  setPlatformCookie(res, created.token);
  return res.status(201).json({
    data: {
      user: { id: created.id, name: parsed.data.name, full_name: parsed.data.name, email: normalizedEmail, role: roleName, preferred_language: preferredLanguage },
    },
  });
}));

export const platformLoginHandler = asyncHandler(async (req, res) => {
  const schema = z.object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });

  const database = databaseFor(req);
  const [rows] = await database.execute(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.status,
            LOWER(r.name) AS role, r.is_admin, r.is_active AS role_is_active
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE LOWER(u.email) = ?
     ORDER BY r.is_active DESC,
       CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN 1
            WHEN LOWER(r.name) = 'organizer' THEN 2
            WHEN LOWER(r.name) = 'vendor' THEN 3
            WHEN LOWER(r.name) = 'customer' THEN 4 ELSE 5 END
     LIMIT 1`,
    [parsed.data.email]
  );
  const user = rows[0];
  if (!user || !await bcrypt.compare(parsed.data.password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.status !== 'active') {
    const message = user.status === 'pending'
      ? 'This account is pending verification. Complete account verification before signing in.'
      : 'This account is inactive. Contact support for assistance.';
    return res.status(403).json({ error: message });
  }
  if (!Number(user.role_is_active)) {
    return res.status(403).json({ error: 'This account role is inactive. Contact support for assistance.' });
  }
  const role = Number(user.is_admin) || ['admin', 'administrator'].includes(user.role)
    ? 'admin'
    : user.role;
  if (!['admin', 'organizer', 'vendor', 'customer'].includes(role)) {
    return res.status(403).json({ error: 'This account role is not permitted to sign in.' });
  }

  await database.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  const token = await inDatabaseTransaction(database, async (connection) => {
    const session = await createUserSession(connection, user.id);
    if (role === 'vendor') await ensureVendorProfileRecord(user.id, user.full_name, connection);
    await writeAudit(connection, {
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      details: { role },
      ip: req.ip,
    });
    return session.token;
  });

  setPlatformCookie(res, token);
  return res.json({
    user: {
      id: user.id,
      name: user.full_name,
      email: user.email,
      role,
    },
  });
});

router.post('/login', platformLoginLimiter, platformLoginHandler);

router.post('/logout', async (req, res) => {
  const token = req.cookies?.platform_session;
  if (token) await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)]);
  res.clearCookie('platform_session', getCookieOptions());
  return res.status(204).end();
});

router.get('/me', sessionCheckLimiter, optionalPlatformUser, asyncHandler(async (req, res) => {
  if (!req.platformUser) return res.json({ user: null });
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
        preferred_language: req.platformUser.preferred_language,
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
}));

router.patch('/preferences/language', requirePlatformUser, asyncHandler(async (req, res) => {
  const parsed = z.object({ language: z.enum(['en', 'am']) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a supported language.' });
  const database = req.app?.locals?.database || pool;
  await database.execute(
    'UPDATE users SET preferred_language = ? WHERE id = ?',
    [parsed.data.language, req.platformUser.id],
  );
  res.json({ data: { language: parsed.data.language } });
}));

router.get('/profile/photo', requirePlatformUser, asyncHandler(async (req, res) => getProfilePhoto(pool, req.platformUser.id, res)));
router.put('/profile/photo', requirePlatformUser, profilePhotoParser, asyncHandler(async (req, res) => saveProfilePhoto(pool, req.platformUser.id, req, res)));
router.delete('/profile/photo', requirePlatformUser, asyncHandler(async (req, res) => removeProfilePhoto(pool, req.platformUser.id, res)));

router.post('/password-recovery', passwordRecoveryLimiter, async (req, res) => {
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
