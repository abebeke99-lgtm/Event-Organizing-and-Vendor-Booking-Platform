import { isPublicCategoryName } from './categoryName.js';
import { mapService, mapVendor, normalizeKey } from './marketplace.js';

function parseJson(value) {
  if (!value) return [];
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export async function loadPostgresPublicServices(database) {
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
       AND (s.category_id IS NULL OR sc.id IS NOT NULL)
     ORDER BY s.id ASC`,
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
  const servicesList = services || await loadPostgresPublicServices(database);
  const ids = result.rows.map((row) => Number(row.id));
  const mediaResult = ids.length
    ? await database.query(
      `SELECT id, vendor_id, media_type, original_name FROM vendor_media
       WHERE service_id IS NULL AND media_type IN ('logo', 'cover', 'portfolio')
         AND vendor_id = ANY($1::bigint[]) ORDER BY created_at DESC, id DESC`,
      [ids],
    )
    : { rows: [] };
  const servicesByVendor = new Map();
  for (const service of servicesList) {
    servicesByVendor.set(service.vendorId, [...(servicesByVendor.get(service.vendorId) || []), service]);
  }
  const mediaByVendor = new Map();
  for (const media of mediaResult.rows) {
    const id = Number(media.vendor_id);
    mediaByVendor.set(id, [...(mediaByVendor.get(id) || []), media]);
  }
  return result.rows.map((row) => mapVendor(
    {
      ...row,
      category: isPublicCategoryName(row.category) ? row.category : null,
    },
    servicesByVendor.get(Number(row.id)) || [],
    mediaByVendor.get(Number(row.id)) || [],
  ));
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
