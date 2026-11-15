import { isPublicCategoryName } from './categoryName.js';
import { mapService, mapVendor, normalizeKey } from './marketplace.js';
import { buildVendorFilters, normalizeCategoryKey } from './vendorCatalog.js';

function parseJson(value) {
  if (!value) return [];
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export async function loadPostgresPublicServices(database, vendorIds) {
  if (Array.isArray(vendorIds) && vendorIds.length === 0) return [];
  const vendorFilter = Array.isArray(vendorIds) ? ' AND s.vendor_id = ANY($1::bigint[])' : '';
  const result = await database.query(
    `SELECT s.id, s.vendor_id, s.category_id, s.title, s.description, s.price, s.created_at,
            COALESCE(NULLIF(TRIM(s.currency), ''), 'ETB') AS currency, s.status,
            vp.business_name, vp.city, vp.verification_status,
            COALESCE(sc.service_menu_name, sc.name) AS category,
            (SELECT COUNT(*) FROM bookings b
             WHERE b.service_id = s.id AND b.status NOT IN ('cancelled', 'rejected')) AS booking_count,
            COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r
              JOIN bookings b ON b.id = r.booking_id
              WHERE b.service_id = s.id AND r.status = 'published'), 0) AS rating,
            (SELECT COUNT(*) FROM reviews r
              JOIN bookings b ON b.id = r.booking_id
              WHERE b.service_id = s.id AND r.status = 'published') AS review_count
     FROM services s
     JOIN vendor_profiles vp ON vp.id = s.vendor_id
     JOIN users u ON u.id = vp.user_id AND u.status = 'active'
     LEFT JOIN service_categories sc ON sc.id = s.category_id AND sc.is_active = TRUE
     WHERE s.status = 'active' AND vp.verification_status = 'verified'
       AND (s.category_id IS NULL OR sc.id IS NOT NULL)${vendorFilter}
     ORDER BY s.id ASC`,
    Array.isArray(vendorIds) ? [vendorIds] : [],
  );
  const services = result.rows.filter((row) => row.verification_status === 'verified').map((row) => (
    mapService({
      ...row,
      category: isPublicCategoryName(row.category) ? row.category : null,
    })
  ));
  if (!services.length) return services;

  const ids = services.map((service) => service.id);
  const [packageResult, mediaResult, availabilityResult] = await Promise.all([
    database.query(
      `SELECT p.id, p.service_id, p.name, p.description, p.price,
              COALESCE(NULLIF(TRIM(p.currency), ''), 'ETB') AS currency,
              p.included_features, p.extras, p.minimum_booking
       FROM service_packages p
       JOIN services s ON s.id = p.service_id
       JOIN vendor_profiles vp ON vp.id = s.vendor_id
       JOIN users u ON u.id = vp.user_id AND u.status = 'active'
       WHERE p.is_active = TRUE AND s.status = 'active'
         AND vp.verification_status = 'verified' AND p.service_id = ANY($1::bigint[])
       ORDER BY p.price, p.id`,
      [ids],
    ),
    database.query(
      `SELECT id, service_id, original_name FROM vendor_media
       WHERE media_type = 'service' AND service_id = ANY($1::bigint[])
       ORDER BY created_at DESC, id DESC`,
      [ids],
    ),
    database.query(
      `SELECT DISTINCT va.vendor_id
       FROM vendor_availability va
       WHERE va.status = 'available' AND va.available_date >= CURRENT_DATE
         AND va.vendor_id = ANY($1::bigint[])
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           JOIN events e ON e.id = b.event_id
           WHERE b.vendor_id = va.vendor_id
             AND b.status IN ('accepted', 'confirmed', 'in_progress')
             AND COALESCE(b.scheduled_date::date, e.start_date::date) = va.available_date
         )`,
      [[...new Set(services.map((service) => service.vendorId))]],
    ),
  ]);
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const row of packageResult.rows) {
    const service = byId.get(Number(row.service_id));
    if (!service) continue;
    service.packages.push({
      id: Number(row.id),
      name: row.name,
      description: row.description || '',
      price: Number(row.price),
      currency: String(row.currency || 'ETB').toUpperCase(),
      includedFeatures: parseJson(row.included_features),
      extras: parseJson(row.extras),
      minimumBooking: Number(row.minimum_booking),
    });
  }
  for (const row of mediaResult.rows) {
    const service = byId.get(Number(row.service_id));
    if (service) {
      service.images.push({
        id: Number(row.id),
        name: row.original_name,
        url: `/api/platform/services/${service.id}/media/${Number(row.id)}`,
      });
    }
  }
  const availableVendors = new Set(availabilityResult.rows.map((row) => Number(row.vendor_id)));
  for (const service of services) service.available = availableVendors.has(service.vendorId);
  return services;
}

async function mapPostgresPublicVendors(database, rows, services) {
  if (!rows.length) return [];
  const ids = rows.map((row) => Number(row.id));
  const [mediaResult, servicesList] = await Promise.all([
    database.query(
      `SELECT id, vendor_id, media_type, original_name FROM vendor_media
       WHERE service_id IS NULL AND media_type IN ('logo', 'cover', 'portfolio')
         AND vendor_id = ANY($1::bigint[]) ORDER BY created_at DESC, id DESC`,
      [ids],
    ),
    services === null ? loadPostgresPublicServices(database, ids) : Promise.resolve(services),
  ]);
  const servicesByVendor = new Map();
  for (const service of servicesList) {
    servicesByVendor.set(service.vendorId, [...(servicesByVendor.get(service.vendorId) || []), service]);
  }
  const mediaByVendor = new Map();
  for (const media of mediaResult.rows) {
    const id = Number(media.vendor_id);
    mediaByVendor.set(id, [...(mediaByVendor.get(id) || []), media]);
  }
  return rows.map((row) => mapVendor(
    {
      ...row,
      category: isPublicCategoryName(row.category) ? row.category : null,
    },
    servicesByVendor.get(Number(row.id)) || [],
    mediaByVendor.get(Number(row.id)) || [],
  ));
}

export async function loadPostgresPublicVendors(database, services = null) {
  const result = await database.query(
    `SELECT vp.id, vp.user_id, vp.business_name, vp.city, vp.description, vp.verification_status,
            vp.is_featured, vp.created_at, sc.name AS category,
            (SELECT MIN(s.price) FROM services s WHERE s.vendor_id = vp.id AND s.status = 'active') AS min_price,
            (SELECT COUNT(*) FROM bookings b
             WHERE b.vendor_id = vp.id AND b.status NOT IN ('cancelled', 'rejected')) AS booking_count,
            COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r
              JOIN bookings b ON b.id = r.booking_id
              WHERE b.vendor_id = vp.id AND r.status = 'published'), 0) AS rating,
            (SELECT COUNT(*) FROM reviews r
             JOIN bookings b ON b.id = r.booking_id
             WHERE b.vendor_id = vp.id AND r.status = 'published') AS review_count
     FROM vendor_profiles vp
     JOIN users u ON u.id = vp.user_id AND u.status = 'active'
     LEFT JOIN service_categories sc ON sc.id = vp.category_id AND sc.is_active = TRUE
     WHERE vp.verification_status = 'verified'
     ORDER BY vp.id ASC`,
  );
  return mapPostgresPublicVendors(database, result.rows, services);
}

const vendorSortOrders = {
  recommended: 'rating DESC, review_count DESC, LOWER(business_name) ASC, id ASC',
  'highest-rated': 'rating DESC, review_count DESC, LOWER(business_name) ASC, id ASC',
  'most-reviewed': 'review_count DESC, rating DESC, LOWER(business_name) ASC, id ASC',
  popular: 'booking_count DESC, review_count DESC, rating DESC, LOWER(business_name) ASC, id ASC',
  'price-low': 'min_price ASC NULLS LAST, rating DESC, id ASC',
  'price-high': 'min_price DESC NULLS LAST, rating DESC, id ASC',
  'name-az': 'LOWER(business_name) ASC, rating DESC, id ASC',
  'recently-added': 'created_at DESC, rating DESC, id ASC',
};

const vendorSortOrdersForPage = {
  recommended: 'paged_vendors.rating DESC, paged_vendors.review_count DESC, LOWER(paged_vendors.business_name) ASC, paged_vendors.id ASC',
  'highest-rated': 'paged_vendors.rating DESC, paged_vendors.review_count DESC, LOWER(paged_vendors.business_name) ASC, paged_vendors.id ASC',
  'most-reviewed': 'paged_vendors.review_count DESC, paged_vendors.rating DESC, LOWER(paged_vendors.business_name) ASC, paged_vendors.id ASC',
  popular: 'paged_vendors.booking_count DESC, paged_vendors.review_count DESC, paged_vendors.rating DESC, LOWER(paged_vendors.business_name) ASC, paged_vendors.id ASC',
  'price-low': 'paged_vendors.min_price ASC NULLS LAST, paged_vendors.rating DESC, paged_vendors.id ASC',
  'price-high': 'paged_vendors.min_price DESC NULLS LAST, paged_vendors.rating DESC, paged_vendors.id ASC',
  'name-az': 'LOWER(paged_vendors.business_name) ASC, paged_vendors.rating DESC, paged_vendors.id ASC',
  'recently-added': 'paged_vendors.created_at DESC, paged_vendors.rating DESC, paged_vendors.id ASC',
};

function vendorAvailabilitySql(datePlaceholder) {
  const dateCondition = datePlaceholder
    ? `va.available_date = ${datePlaceholder}::date`
    : 'va.available_date >= CURRENT_DATE';
  return `EXISTS (
    SELECT 1 FROM vendor_availability va
    WHERE va.vendor_id = vp.id AND va.status = 'available' AND ${dateCondition}
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        JOIN events e ON e.id = b.event_id
        WHERE b.vendor_id = va.vendor_id
          AND b.status IN ('accepted', 'confirmed', 'in_progress')
          AND COALESCE(b.scheduled_date::date, e.start_date::date) = va.available_date
      )
  )`;
}

export async function loadPostgresPublicVendorPage(database, rawFilters = {}) {
  const filters = buildVendorFilters(rawFilters);
  const conditions = [];
  const candidateConditions = [
    "vp.verification_status = 'verified'",
    "u.status = 'active'",
  ];
  const values = [];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.category) {
    const categories = await database.query(
      'SELECT id, name FROM service_categories WHERE is_active = TRUE',
    );
    const key = normalizeCategoryKey(filters.category);
    const category = key
      ? categories.rows.find((row) => (
        isPublicCategoryName(row.name) && normalizeCategoryKey(row.name) === key
      ))
      : null;
    if (!category) {
      return { vendors: [], total: 0, page: 1, limit: filters.limit, totalPages: 1 };
    }
    candidateConditions.push(`vp.category_id = ${bind(category.id)}`);
  }

  const serviceEligibility = `s.status = 'active'
    AND (s.category_id IS NULL OR service_category.id IS NOT NULL)`;
  if (filters.search) {
    const search = bind(filters.search);
    candidateConditions.push(`(
      POSITION(${search} IN LOWER(CONCAT_WS(' ', vp.business_name, sc.name, vp.city, vp.description))) > 0
      OR EXISTS (
        SELECT 1 FROM services s
        LEFT JOIN service_categories service_category
          ON service_category.id = s.category_id AND service_category.is_active = TRUE
        WHERE s.vendor_id = vp.id AND ${serviceEligibility}
          AND POSITION(${search} IN LOWER(CONCAT_WS(' ', s.title, s.description))) > 0
      )
    )`);
  }

  if (filters.featured) conditions.push('is_featured = TRUE');
  if (filters.location) conditions.push(`POSITION(${bind(filters.location)} IN LOWER(COALESCE(city, ''))) > 0`);
  if (filters.minRating) conditions.push(`rating >= ${bind(filters.minRating)}`);
  if (filters.minPrice) conditions.push(`min_price >= ${bind(filters.minPrice)}`);
  if (filters.maxPrice) conditions.push(`min_price <= ${bind(filters.maxPrice)}`);

  const availableDate = rawFilters.availableDate;
  const exactAvailability = availableDate
    ? vendorAvailabilitySql(bind(availableDate))
    : null;
  if (exactAvailability) candidateConditions.push(exactAvailability);
  if (filters.availableOnly && !availableDate) conditions.push('available = TRUE');

  const limitPlaceholder = bind(filters.limit);
  const pagePlaceholder = bind(filters.page);
  const orderBy = vendorSortOrders[filters.sort] || vendorSortOrders.recommended;
  const pageOrderBy = vendorSortOrdersForPage[filters.sort] || vendorSortOrdersForPage.recommended;
  const result = await database.query(
    `WITH vendor_candidates AS (
       SELECT vp.id, vp.user_id, vp.business_name, vp.city, vp.description,
              vp.verification_status, vp.is_featured, vp.created_at,
              sc.name AS category,
              COALESCE(public_price.price,
                (SELECT MIN(s.price) FROM services s
                 WHERE s.vendor_id = vp.id AND s.status = 'active')) AS min_price,
              (SELECT COUNT(*) FROM bookings b
               WHERE b.vendor_id = vp.id AND b.status NOT IN ('cancelled', 'rejected')) AS booking_count,
              COALESCE(review_stats.rating, 0) AS rating,
              COALESCE(review_stats.review_count, 0) AS review_count,
              (EXISTS (
                 SELECT 1 FROM services s
                 LEFT JOIN service_categories service_category
                   ON service_category.id = s.category_id AND service_category.is_active = TRUE
                 WHERE s.vendor_id = vp.id AND ${serviceEligibility}
               ) AND ${vendorAvailabilitySql(null)}) AS available
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       LEFT JOIN service_categories sc ON sc.id = vp.category_id AND sc.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT ROUND(AVG(r.rating), 1) AS rating, COUNT(*) AS review_count
         FROM reviews r
         JOIN bookings b ON b.id = r.booking_id
         WHERE b.vendor_id = vp.id AND r.status = 'published'
       ) review_stats ON TRUE
       LEFT JOIN LATERAL (
         SELECT price_options.price
         FROM (
           SELECT s.price, s.id AS service_id, 0 AS price_order
           FROM services s
           LEFT JOIN service_categories service_category
             ON service_category.id = s.category_id AND service_category.is_active = TRUE
           WHERE s.vendor_id = vp.id AND ${serviceEligibility} AND s.price IS NOT NULL
           UNION ALL
           SELECT package.price, s.id AS service_id, 1 AS price_order
           FROM services s
           JOIN service_packages package ON package.service_id = s.id AND package.is_active = TRUE
           LEFT JOIN service_categories service_category
             ON service_category.id = s.category_id AND service_category.is_active = TRUE
           WHERE s.vendor_id = vp.id AND ${serviceEligibility}
         ) price_options
         ORDER BY price_options.price ASC, price_options.service_id ASC, price_options.price_order ASC
         LIMIT 1
       ) public_price ON TRUE
       WHERE ${candidateConditions.join(' AND ')}
     ),
     filtered_vendors AS (
       SELECT * FROM vendor_candidates${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}
     ),
     page_stats AS (
       SELECT COUNT(*) AS total,
              GREATEST(CEIL(COUNT(*)::numeric / ${limitPlaceholder}::numeric)::integer, 1) AS total_pages
       FROM filtered_vendors
     ),
     page_bounds AS (
       SELECT total, total_pages, LEAST(${pagePlaceholder}::integer, total_pages) AS page
       FROM page_stats
     ),
     paged_vendors AS (
       SELECT filtered_vendors.*
       FROM filtered_vendors
       ORDER BY ${orderBy}
       LIMIT ${limitPlaceholder}
       OFFSET (SELECT (page - 1) * ${limitPlaceholder} FROM page_bounds)
     )
     SELECT page_bounds.total, page_bounds.page, page_bounds.total_pages, paged_vendors.*
     FROM page_bounds
     LEFT JOIN paged_vendors ON TRUE
     ORDER BY ${pageOrderBy}`,
    values,
  );
  const firstRow = result.rows[0];
  const total = Number(firstRow?.total || 0);
  const page = Number(firstRow?.page || 1);
  const rows = result.rows.filter((row) => row.id !== null && row.id !== undefined);
  const services = await loadPostgresPublicServices(database, rows.map((row) => Number(row.id)));
  const vendors = await mapPostgresPublicVendors(database, rows, services);
  if (availableDate) vendors.forEach((vendor) => { vendor.available = true; });
  return {
    vendors,
    total,
    page,
    limit: filters.limit,
    totalPages: Number(firstRow?.total_pages || 1),
  };
}

export async function loadPostgresPublicMarketplace(database) {
  const services = await loadPostgresPublicServices(database);
  const vendors = await loadPostgresPublicVendors(database, services);
  const result = await database.query(
    `SELECT id, name, service_menu_name, description, display_order, image_mime, is_active
     FROM service_categories WHERE is_active = TRUE ORDER BY display_order ASC, name ASC`,
  );
  const categories = result.rows.filter((row) => isPublicCategoryName(row.name)).map((row) => {
    const key = normalizeKey(row.name);
    return {
      id: Number(row.id),
      name: String(row.name || '').trim(),
      serviceMenuName: String(row.service_menu_name || '').trim() || null,
      slug: key || 'category',
      description: String(row.description || '').trim(),
      image: row.image_mime ? `/api/platform/categories/${Number(row.id)}/image` : null,
      isActive: Boolean(row.is_active),
      displayOrder: Number(row.display_order || 0),
      vendorCount: vendors.filter((vendor) => normalizeKey(vendor.category) === key).length,
      serviceCount: services.filter((service) => normalizeKey(service.category) === key).length,
    };
  });
  return { categories, vendors, services };
}
