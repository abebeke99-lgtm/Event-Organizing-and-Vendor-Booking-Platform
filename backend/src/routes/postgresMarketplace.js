import { Router } from 'express';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { getPublicServiceById } from '../lib/serviceCatalog.js';
import { getPublicVendorById, listPublicVendors } from '../lib/vendorCatalog.js';
import { listPublicServices } from '../lib/serviceCatalog.js';
import { mapDatabaseEvent } from '../lib/eventCatalog.js';
import { categorySlug } from '../lib/marketplace.js';
import { loadPostgresPublicMarketplace } from '../lib/postgresMarketplace.js';
import { isValidCategoryName } from '../lib/categoryName.js';

const vendorFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  verified: z.enum(['true', 'false', '1', '0']).optional(),
  filter: z.enum(['featured']).optional(),
  availableOnly: z.enum(['true', 'false', '1', '0']).optional(),
  availableDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }).optional(),
  minRating: z.coerce.number().finite().min(0).max(5).optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  sort: z.enum(['recommended', 'popular', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'name-az', 'recently-added']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict().superRefine((filters, context) => {
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.maxPrice < filters.minPrice) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price.' });
  }
});

const serviceFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(120).optional(),
  vendor: z.string().trim().max(120).optional(),
  vendorId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  minRating: z.coerce.number().finite().min(0).max(5).optional(),
  minReviews: z.coerce.number().int().min(0).optional(),
  maxReviews: z.coerce.number().int().min(0).optional(),
  feature: z.string().trim().max(120).optional(),
  availableOnly: z.enum(['true', 'false', '1', '0']).optional(),
  availableDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }).optional(),
  ids: z.string().max(80).refine((value) => {
    const ids = value.split(',').map(Number);
    return ids.length <= 4 && ids.every((id) => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length;
  }, 'Invalid service filters.').optional(),
  sort: z.enum(['recommended', 'relevance', 'popular', 'newest', 'highest-rated', 'most-reviewed', 'rating', 'price-low', 'price-high', 'alphabetical']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict().superRefine((filters, context) => {
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.maxPrice < filters.minPrice) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price.' });
  }
  if (filters.minReviews !== undefined && filters.maxReviews !== undefined && filters.maxReviews < filters.minReviews) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxReviews'], message: 'Maximum review count must be greater than or equal to minimum review count.' });
  }
});

export function createPostgresMarketplaceRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/categories', async (req, res, next) => {
    const scope = req.query.scope;
    if (scope !== undefined && scope !== 'services') {
      return res.status(400).json({ error: 'Category scope must be services when provided.' });
    }
    const parsed = z.object({
      page: z.coerce.number().int().min(1).max(100000).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }).safeParse({ page: req.query.page, limit: req.query.limit });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid category pagination.' });
    }
    try {
      const serviceScope = scope === 'services';
      const search = String(req.query.search || '').trim().toLowerCase();
      const values = [];
      const filters = [];
      if (serviceScope) filters.push('sc.service_menu_order IS NOT NULL');
      if (search) {
        values.push(`%${search}%`);
        filters.push(`(LOWER(COALESCE(sc.service_menu_name, sc.name)) LIKE $${values.length}
          OR LOWER(COALESCE(sc.description, '')) LIKE $${values.length})`);
      }
      const rows = await database.query(
        `SELECT sc.id, ${serviceScope ? 'COALESCE(sc.service_menu_name, sc.name)' : 'sc.name'} AS name,
                sc.name AS database_name, sc.description, sc.display_order, sc.image_mime,
                ${serviceScope ? 'sc.service_menu_order,' : ''}
                COUNT(DISTINCT CASE WHEN vp.verification_status = 'verified' AND u.status = 'active'
                  THEN vp.id END) AS vendor_count,
                COUNT(DISTINCT CASE WHEN vp.verification_status = 'verified' AND u.status = 'active'
                  AND s.status = 'active' AND s.category_id = sc.id THEN s.id END) AS service_count
         FROM service_categories sc
         LEFT JOIN vendor_profiles vp ON vp.category_id = sc.id
         LEFT JOIN users u ON u.id = vp.user_id
         LEFT JOIN services s ON s.vendor_id = vp.id
         WHERE sc.is_active = TRUE ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
         GROUP BY sc.id
         ORDER BY ${serviceScope ? 'sc.service_menu_order ASC' : 'name ASC'}, sc.name ASC`,
        values,
      );
      const categories = rows.rows.filter((row) => isValidCategoryName(row.name)).map((row) => {
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
      if (req.query.page === undefined && req.query.limit === undefined) {
        return res.json({ categories, data: categories });
      }
      const limit = parsed.data.limit || 12;
      const total = categories.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(parsed.data.page || 1, totalPages);
      const pageRows = categories.slice((page - 1) * limit, page * limit);
      return res.json({
        categories: pageRows,
        data: pageRows,
        pagination: { page, limit, total, totalPages },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/categories/:id/image', async (req, res, next) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'A valid category ID is required.' });
    try {
      const result = await database.query(
        'SELECT image, image_mime FROM service_categories WHERE id = $1 AND is_active = TRUE',
        [id.data],
      );
      const category = result.rows[0];
      if (!category?.image) return res.status(404).json({ error: 'Category image not found.' });
      res.set({
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Type': category.image_mime,
        'Content-Disposition': 'inline',
      });
      return res.send(category.image);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/vendors', async (req, res, next) => {
    const parsed = vendorFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid vendor filters.' });
    try {
      const marketplace = await loadPostgresPublicMarketplace(database);
      let vendors = marketplace.vendors;
      if (parsed.data.availableDate) {
        const available = await database.query(
          `SELECT va.vendor_id
           FROM vendor_availability va
           WHERE va.available_date = $1::date AND va.status = 'available'
             AND NOT EXISTS (
               SELECT 1 FROM bookings b
               JOIN events e ON e.id = b.event_id
               WHERE b.vendor_id = va.vendor_id
                 AND b.status IN ('accepted', 'confirmed', 'in_progress')
                 AND COALESCE(b.scheduled_date::date, e.start_date::date) = va.available_date
             )`,
          [parsed.data.availableDate],
        );
        const availableVendorIds = new Set(available.rows.map((row) => Number(row.vendor_id)));
        vendors = vendors
          .filter((vendor) => availableVendorIds.has(Number(vendor.id)))
          .map((vendor) => ({ ...vendor, available: true }));
      }
      const result = listPublicVendors(vendors, parsed.data);
      return res.json({
        data: result.vendors,
        pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/services', async (req, res, next) => {
    const parsed = serviceFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid service filters.' });
    try {
      const marketplace = await loadPostgresPublicMarketplace(database);
      if (parsed.data.availableDate) {
        const available = await database.query(
          `SELECT DISTINCT va.vendor_id
           FROM vendor_availability va
           WHERE va.available_date = $1::date AND va.status = 'available'
             AND NOT EXISTS (
               SELECT 1 FROM bookings b
               JOIN events e ON e.id = b.event_id
               WHERE b.vendor_id = va.vendor_id
                 AND b.status IN ('accepted', 'confirmed', 'in_progress')
                 AND COALESCE(b.scheduled_date::date, e.start_date::date) = va.available_date
             )`,
          [parsed.data.availableDate],
        );
        const availableVendorIds = new Set(available.rows.map((row) => Number(row.vendor_id)));
        marketplace.services = marketplace.services.map((service) => ({
          ...service,
          available: availableVendorIds.has(Number(service.vendorId)),
        }));
      }
      let categoryId;
      if (parsed.data.category !== undefined) {
        const key = categorySlug(parsed.data.category);
        const category = marketplace.categories.find((entry) => String(entry.id) === parsed.data.category
          || categorySlug(entry.name) === key || categorySlug(entry.serviceMenuName) === key);
        if (!category) return res.status(400).json({ error: 'The selected service category is unavailable.' });
        categoryId = category.id;
      }
      const ids = parsed.data.ids?.split(',').map(Number);
      const sourceServices = ids
        ? marketplace.services.filter((service) => ids.includes(Number(service.id)))
        : marketplace.services;
      const result = listPublicServices(sourceServices, {
        ...parsed.data,
        categoryId,
        availableOnly: parsed.data.availableDate ? true : parsed.data.availableOnly,
      });
      return res.json({
        data: result.services,
        pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/vendors/:id', async (req, res, next) => {
    const id = z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value))).safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid vendor ID.' });
    try {
      const marketplace = await loadPostgresPublicMarketplace(database);
      const vendor = getPublicVendorById(marketplace.vendors, Number(id.data));
      if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
      const [reviews, ratings, availability] = await Promise.all([
        database.query(
          `SELECT r.rating, r.comment, r.created_at FROM reviews r
           JOIN bookings b ON b.id = r.booking_id
           WHERE b.vendor_id = $1 AND r.status = 'published'
           ORDER BY r.created_at DESC LIMIT 20`,
          [vendor.id],
        ),
        database.query(
          `SELECT r.rating, COUNT(*) AS total FROM reviews r
           JOIN bookings b ON b.id = r.booking_id
           WHERE b.vendor_id = $1 AND r.status = 'published' GROUP BY r.rating`,
          [vendor.id],
        ),
        database.query(
          `SELECT available_date, status FROM vendor_availability
           WHERE vendor_id = $1 AND available_date >= CURRENT_DATE
           ORDER BY available_date ASC LIMIT 30`,
          [vendor.id],
        ),
      ]);
      return res.json({
        data: {
          ...vendor,
          ratingDistribution: Object.fromEntries([1, 2, 3, 4, 5].map((rating) => [
            rating,
            Number(ratings.rows.find((row) => Number(row.rating) === rating)?.total || 0),
          ])),
          reviews: reviews.rows.map((review) => ({
            rating: Number(review.rating),
            comment: review.comment || '',
            customerName: 'Customer',
            createdAt: review.created_at,
          })),
          availability: availability.rows.map((entry) => ({ date: entry.available_date, status: entry.status })),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/vendors/:vendorId/media/:mediaId', async (req, res, next) => {
    const vendorId = z.coerce.number().int().positive().safeParse(req.params.vendorId);
    const mediaId = z.coerce.number().int().positive().safeParse(req.params.mediaId);
    if (!vendorId.success || !mediaId.success) return res.status(400).json({ error: 'Vendor image ID is invalid.' });
    try {
      const result = await database.query(
        `SELECT m.content, m.content_type, m.file_size
         FROM vendor_media m
         JOIN vendor_profiles vp ON vp.id = m.vendor_id
         JOIN users u ON u.id = vp.user_id AND u.status = 'active'
         WHERE m.id = $1 AND m.vendor_id = $2 AND m.service_id IS NULL
           AND m.media_type IN ('logo', 'cover', 'portfolio') AND vp.verification_status = 'verified'
         LIMIT 1`,
        [mediaId.data, vendorId.data],
      );
      const media = result.rows[0];
      if (!media) return res.status(404).json({ error: 'Vendor image not found.' });
      res.set({
        'Content-Type': media.content_type,
        'Content-Length': media.file_size,
        'Cache-Control': 'public, max-age=1800',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      return res.send(media.content);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/services/:serviceId/media/:mediaId', async (req, res, next) => {
    const serviceId = z.coerce.number().int().positive().safeParse(req.params.serviceId);
    const mediaId = z.coerce.number().int().positive().safeParse(req.params.mediaId);
    if (!serviceId.success || !mediaId.success) return res.status(400).json({ error: 'Service image ID is invalid.' });
    try {
      const result = await database.query(
        `SELECT m.content, m.content_type, m.file_size
         FROM vendor_media m
         JOIN services s ON s.id = m.service_id
         JOIN vendor_profiles vp ON vp.id = m.vendor_id
         JOIN users u ON u.id = vp.user_id AND u.status = 'active'
         WHERE m.id = $1 AND m.service_id = $2 AND m.media_type = 'service'
           AND s.status = 'active' AND vp.verification_status = 'verified'
         LIMIT 1`,
        [mediaId.data, serviceId.data],
      );
      const media = result.rows[0];
      if (!media) return res.status(404).json({ error: 'Service image not found.' });
      res.set({
        'Content-Type': media.content_type,
        'Content-Length': media.file_size,
        'Cache-Control': 'public, max-age=1800',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      return res.send(media.content);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/services/:id', async (req, res, next) => {
    const id = z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value))).safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid service ID.' });
    try {
      const marketplace = await loadPostgresPublicMarketplace(database);
      const service = getPublicServiceById(marketplace.services, id.data);
      if (!service) return res.status(404).json({ error: 'Service not found.' });
      const [reviews, availability] = await Promise.all([
        database.query(
          `SELECT r.rating, r.comment, r.created_at FROM reviews r
           JOIN bookings b ON b.id = r.booking_id
           WHERE b.service_id = $1 AND r.status = 'published'
           ORDER BY r.created_at DESC LIMIT 20`,
          [service.id],
        ),
        database.query(
          `SELECT va.available_date,
             CASE WHEN va.status = 'available' AND NOT EXISTS (
               SELECT 1 FROM bookings b JOIN events e ON e.id = b.event_id
               WHERE b.vendor_id = va.vendor_id AND b.status IN ('accepted', 'confirmed', 'in_progress')
                 AND COALESCE(b.scheduled_date::date, e.start_date::date) = va.available_date
             ) THEN 'available'
             WHEN va.status = 'available' THEN 'unavailable' ELSE va.status END AS status
           FROM vendor_availability va
           WHERE va.vendor_id = $1 AND va.available_date >= CURRENT_DATE
           ORDER BY va.available_date ASC LIMIT 30`,
          [service.vendorId],
        ),
      ]);
      const vendor = marketplace.vendors.find((entry) => entry.id === service.vendorId);
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
          relatedServices: marketplace.services.filter((entry) => service.categoryId !== null
            && entry.id !== service.id && entry.categoryId === service.categoryId).slice(0, 4),
          availability: availability.rows.map((entry) => ({ date: entry.available_date, status: entry.status })),
          reviews: reviews.rows.map((review) => ({
            rating: Number(review.rating),
            comment: review.comment || '',
            customerName: 'Customer',
            createdAt: review.created_at,
          })),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/categories/:slug', async (req, res, next) => {
    try {
      const marketplace = await loadPostgresPublicMarketplace(database);
      const category = marketplace.categories.find((entry) => entry.slug === String(req.params.slug).toLowerCase());
      if (!category) return res.status(404).json({ error: 'Category not found.' });
      const events = await database.query(
        `SELECT e.id, e.title, e.event_type, e.description, e.notes, e.city, e.venue,
                e.cover_image_url, e.gallery_images, e.start_date, e.end_date, e.budget,
                e.capacity, e.status, e.published_at, e.created_at, e.is_featured,
                u.full_name AS organizer_name
         FROM events e JOIN users u ON u.id = e.organizer_id
         WHERE LOWER(e.event_type) = LOWER($1)
           AND (e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
             OR (e.status = 'completed' AND e.published_at IS NOT NULL))
         ORDER BY e.start_date ASC`,
        [category.name],
      );
      return res.json({
        data: {
          ...category,
          vendors: marketplace.vendors.filter((vendor) => categorySlug(vendor.category) === category.slug),
          services: marketplace.services.filter((service) => Number(service.categoryId) === category.id),
          events: events.rows.map(mapDatabaseEvent),
          eventCount: events.rowCount,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
