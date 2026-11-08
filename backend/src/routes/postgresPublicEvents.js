import { Router } from 'express';
import { z } from 'zod';
import { buildEventFilters, mapDatabaseEvent } from '../lib/eventCatalog.js';
import { isValidCategoryName } from '../lib/categoryName.js';

const publicStatuses = `e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
  OR (e.status = 'completed' AND e.published_at IS NOT NULL)`;
const eventFrom = `FROM events e
  JOIN users u ON u.id = e.organizer_id
  LEFT JOIN (
    SELECT tt.event_id,
           MIN(CASE WHEN (tt.sales_start IS NULL OR tt.sales_start <= NOW())
                    AND (tt.sales_end IS NULL OR tt.sales_end >= NOW()) THEN tt.price END) AS starting_price,
           SUM(CASE WHEN (tt.sales_start IS NULL OR tt.sales_start <= NOW())
                    AND (tt.sales_end IS NULL OR tt.sales_end >= NOW())
                    THEN GREATEST(tt.capacity - tt.sold_quantity - COALESCE(reserved.quantity, 0), 0)
                    ELSE 0 END) AS available_quantity,
           SUM(CASE WHEN tt.price = 0
                    AND (tt.sales_start IS NULL OR tt.sales_start <= NOW())
                    AND (tt.sales_end IS NULL OR tt.sales_end >= NOW())
                    THEN GREATEST(tt.capacity - tt.sold_quantity - COALESCE(reserved.quantity, 0), 0)
                    ELSE 0 END) AS free_available_quantity
    FROM event_ticket_types tt
    LEFT JOIN (
      SELECT ticket_type_id, SUM(quantity) AS quantity
      FROM event_ticket_bookings
      WHERE booking_status = 'pending_payment'
        AND created_at >= NOW() - INTERVAL '15 minutes'
      GROUP BY ticket_type_id
    ) reserved ON reserved.ticket_type_id = tt.id
    WHERE tt.status = 'active'
    GROUP BY tt.event_id
  ) t ON t.event_id = e.id`;
const eventSelect = `SELECT e.id, e.title, e.event_type, e.description, e.notes, e.city, e.venue,
  e.cover_image_url, e.gallery_images, e.start_date, e.end_date, e.budget, e.capacity, e.status,
  e.published_at, e.created_at, u.full_name AS organizer_name, e.is_featured,
  COALESCE((SELECT SUM(etb.quantity) FROM event_ticket_bookings etb
    WHERE etb.event_id = e.id AND etb.booking_status = 'confirmed'), 0) AS popularity_count,
  t.starting_price, COALESCE(t.available_quantity, 0) AS available_quantity,
  COALESCE(t.free_available_quantity, 0) AS free_available_quantity
  ${eventFrom}`;
const categoryNames = [
  'wedding', 'birthday', 'graduation', 'conference', 'corporate events',
  'concerts & music', 'festivals', 'religious events', 'cultural events',
  'workshops & training', 'sports events', 'exhibitions',
];

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const eventsQuerySchema = z.object({
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
    'upcoming', 'earliest', 'latest', 'alphabetical', 'recent', 'newest', 'oldest',
    'date_earliest', 'date_latest', 'title_asc', 'title_desc', 'price_asc', 'price_desc', 'popular',
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

function buildListing(raw = {}) {
  const options = buildEventFilters(raw);
  const conditions = [`(${publicStatuses})`];
  const params = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (options.search) {
    const term = `%${options.search.replace(/[!%_]/g, '!$&')}%`;
    const marker = bind(term);
    conditions.push(`(e.title ILIKE ${marker} ESCAPE '!'
      OR COALESCE(e.description, e.notes, '') ILIKE ${marker} ESCAPE '!'
      OR e.event_type ILIKE ${marker} ESCAPE '!'
      OR COALESCE(e.city, '') ILIKE ${marker} ESCAPE '!'
      OR COALESCE(e.venue, '') ILIKE ${marker} ESCAPE '!'
      OR u.full_name ILIKE ${marker} ESCAPE '!')`);
  }
  if (options.category) {
    conditions.push(/^\d+$/.test(options.category) && Number.isSafeInteger(Number(options.category))
      ? `EXISTS (SELECT 1 FROM service_categories sc
          WHERE sc.id = ${bind(Number(options.category))} AND sc.is_active = TRUE
            AND LOWER(TRIM(e.event_type)) = LOWER(TRIM(sc.name)))`
      : `LOWER(e.event_type) = LOWER(${bind(options.category)})`);
  }
  if (options.filter === 'featured') conditions.push('e.is_featured = TRUE');
  if (options.location) {
    const marker = bind(`%${options.location.replace(/[!%_]/g, '!$&')}%`);
    conditions.push(`(COALESCE(e.city, '') ILIKE ${marker} ESCAPE '!'
      OR COALESCE(e.venue, '') ILIKE ${marker} ESCAPE '!')`);
  }
  if (options.filter === 'upcoming' || options.status === 'upcoming' || options.filter === 'free') {
    conditions.push(`e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')`);
    conditions.push('e.start_date > NOW()');
  }
  if (options.startDate) conditions.push(`e.start_date >= ${bind(options.startDate)}`);
  if (options.endDate) conditions.push(`e.start_date < (${bind(options.endDate)}::date + INTERVAL '1 day')`);
  if (options.minPrice !== null) conditions.push(`t.starting_price >= ${bind(options.minPrice)}`);
  if (options.maxPrice !== null) conditions.push(`t.starting_price <= ${bind(options.maxPrice)}`);

  const datePresets = {
    upcoming: 'e.start_date > NOW()',
    today: `e.start_date >= CURRENT_DATE AND e.start_date < CURRENT_DATE + INTERVAL '1 day'`,
    tomorrow: `e.start_date >= CURRENT_DATE + INTERVAL '1 day' AND e.start_date < CURRENT_DATE + INTERVAL '2 days'`,
    this_week: `e.start_date >= DATE_TRUNC('week', CURRENT_DATE)
      AND e.start_date < DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 week'`,
    this_weekend: `e.start_date >= DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '5 days'
      AND e.start_date < DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '7 days'`,
    this_month: `e.start_date >= DATE_TRUNC('month', CURRENT_DATE)
      AND e.start_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'`,
    next_month: `e.start_date >= DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
      AND e.start_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '2 months'`,
  };
  if (options.datePreset) conditions.push(datePresets[options.datePreset]);
  const priceFilter = options.priceFilter || (['free', 'paid'].includes(options.status) ? options.status : '');
  if (priceFilter === 'free' || options.filter === 'free') conditions.push('t.starting_price = 0');
  if (priceFilter === 'paid') conditions.push('t.starting_price > 0');
  switch (options.status) {
    case 'upcoming':
    case 'free':
    case 'paid':
    case 'all':
    case '':
      break;
    case 'ongoing':
      conditions.push('e.start_date <= NOW() AND e.end_date >= NOW()');
      break;
    case 'past':
      conditions.push('(e.end_date < NOW() OR (e.end_date IS NULL AND e.start_date < NOW()))');
      break;
    case 'available':
      conditions.push('COALESCE(t.available_quantity, 0) > 0');
      break;
    default:
      conditions.push('FALSE');
  }
  const orderBy = {
    newest: 'e.created_at DESC, e.id DESC',
    recent: 'e.created_at DESC, e.id DESC',
    oldest: 'e.created_at ASC, e.id ASC',
    date_earliest: 'e.start_date ASC, e.id ASC',
    upcoming: 'e.start_date ASC, e.id ASC',
    earliest: 'e.start_date ASC, e.id ASC',
    date_latest: 'e.start_date DESC, e.id DESC',
    latest: 'e.start_date DESC, e.id DESC',
    title_asc: 'e.title ASC, e.id ASC',
    alphabetical: 'e.title ASC, e.id ASC',
    title_desc: 'e.title DESC, e.id DESC',
    price_asc: 't.starting_price IS NULL ASC, t.starting_price ASC, e.start_date ASC, e.id ASC',
    price_desc: 't.starting_price IS NULL ASC, t.starting_price DESC, e.start_date ASC, e.id ASC',
    popular: `COALESCE((SELECT SUM(etb.quantity) FROM event_ticket_bookings etb
      WHERE etb.event_id = e.id AND etb.booking_status = 'confirmed'), 0) DESC, e.start_date ASC, e.id ASC`,
  }[options.sort];
  return {
    where: `WHERE ${conditions.join(' AND ')}`,
    params,
    orderBy,
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    requiresTicketData: options.minPrice !== null || options.maxPrice !== null
      || ['free', 'paid', 'available'].includes(options.status)
      || options.filter === 'free' || ['free', 'paid'].includes(options.priceFilter),
  };
}

export function createPostgresPublicEventsRouter({ database }) {
  const router = Router();

  router.get('/events', async (req, res, next) => {
    const parsed = eventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid event filters.' });
    }
    try {
      const filters = {
        ...parsed.data,
        status: parsed.data.status || (['upcoming', 'featured'].includes(parsed.data.filter)
          ? ''
          : parsed.data.filter || ''),
      };
      if (filters.category && !/^\d+$/.test(filters.category)) {
        const categories = await database.query('SELECT id, name FROM service_categories WHERE is_active = TRUE');
        const slug = filters.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const category = categories.rows.find((row) => row.name.toLowerCase() === filters.category.toLowerCase()
          || row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === slug);
        filters.category = category ? String(category.id) : filters.category;
      }
      const listing = buildListing(filters);
      const countFrom = listing.requiresTicketData ? eventFrom : 'FROM events e JOIN users u ON u.id = e.organizer_id';
      const count = await database.query(`SELECT COUNT(*) AS total ${countFrom} ${listing.where}`, listing.params);
      const total = Number(count.rows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / listing.limit));
      const page = Math.min(parsed.data.page || 1, totalPages);
      const pageListing = buildListing({ ...filters, page });
      const rows = await database.query(
        `${eventSelect} ${pageListing.where} ORDER BY ${pageListing.orderBy} LIMIT $${pageListing.params.length + 1} OFFSET $${pageListing.params.length + 2}`,
        [...pageListing.params, pageListing.limit, pageListing.offset],
      );
      return res.json({
        data: rows.rows.map(mapDatabaseEvent),
        pagination: { total, page, limit: pageListing.limit, totalPages },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/events/featured', async (req, res, next) => {
    try {
      const listing = buildListing({ filter: 'featured', sort: 'upcoming', limit: 6 });
      const rows = await database.query(
        `${eventSelect} ${listing.where} ORDER BY ${listing.orderBy} LIMIT $${listing.params.length + 1}`,
        [...listing.params, listing.limit],
      );
      return res.json({ data: rows.rows.map(mapDatabaseEvent) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/events/categories', async (_req, res, next) => {
    try {
      const rows = await database.query(
        `SELECT sc.id, sc.name, sc.description, sc.display_order, sc.image_mime, COUNT(e.id) AS total
         FROM service_categories sc
         LEFT JOIN events e ON LOWER(TRIM(e.event_type)) = LOWER(TRIM(sc.name))
           AND (${publicStatuses})
         WHERE sc.is_active = TRUE AND LOWER(sc.name) = ANY($1::text[])
         GROUP BY sc.id
         ORDER BY ARRAY_POSITION($1::text[], LOWER(sc.name)), sc.id ASC`,
        [categoryNames],
      );
      return res.json({
        data: rows.rows.filter((row) => isValidCategoryName(row.name)).map((row) => ({
          id: Number(row.id),
          name: row.name,
          slug: row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          description: row.description || '',
          image: row.image_mime ? `/api/platform/categories/${Number(row.id)}/image` : null,
          total: Number(row.total || 0),
          displayOrder: Number(row.display_order),
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/events/popular-venues', async (req, res, next) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) }).safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid venue listing limit.' });
    }
    try {
      const rows = await database.query(
        `SELECT MIN(TRIM(e.venue)) AS name, MAX(e.city) AS city, COUNT(DISTINCT e.id) AS event_count,
                COALESCE(SUM(popularity.attendee_count), 0) AS attendee_count, MAX(e.start_date) AS latest_event_date
         FROM events e
         LEFT JOIN (
           SELECT event_id, SUM(quantity) AS attendee_count FROM event_ticket_bookings
           WHERE booking_status = 'confirmed' GROUP BY event_id
         ) popularity ON popularity.event_id = e.id
         WHERE (${publicStatuses}) AND e.venue IS NOT NULL AND TRIM(e.venue) <> ''
         GROUP BY LOWER(TRIM(e.venue)), LOWER(COALESCE(e.city, ''))
         ORDER BY attendee_count DESC, event_count DESC, name ASC LIMIT $1`,
        [parsed.data.limit],
      );
      return res.json({
        data: rows.rows.map((row) => ({
          name: row.name,
          city: row.city || null,
          eventCount: Number(row.event_count || 0),
          attendeeCount: Number(row.attendee_count || 0),
          latestEventDate: row.latest_event_date || null,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
