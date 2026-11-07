import { pool } from '../db.js';
import { isValidCategoryName } from './categoryName.js';

export function normalizeKey(value = '') {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function categorySlug(name = '') {
  return normalizeKey(name) || 'category';
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapVendor(row, services = [], media = []) {
  const mediaUrl = (entry) => `/api/platform/vendors/${toNumber(row.id)}/media/${toNumber(entry.id)}`;
  const startingPriceOptions = services.flatMap((service) => [
    ...(service.price === null ? [] : [{ price: service.price, currency: service.currency, serviceId: service.id }]),
    ...service.packages.map((item) => ({ price: item.price, currency: item.currency, serviceId: service.id })),
  ]).sort((first, second) => first.price - second.price || first.serviceId - second.serviceId);
  const startingPrice = startingPriceOptions[0]?.price
    ?? (row.min_price === null || row.min_price === undefined ? null : toNumber(row.min_price));
  return {
    id: toNumber(row.id),
    userId: toNumber(row.user_id),
    business_name: String(row.business_name || '').trim(),
    name: String(row.business_name || '').trim(),
    category: isValidCategoryName(row.category) ? String(row.category).trim() : '',
    city: String(row.city || '').trim(),
    description: String(row.description || '').trim(),
    verified: row.verification_status === 'verified',
    rating: toNumber(row.rating),
    reviewCount: toNumber(row.review_count),
    bookingCount: toNumber(row.booking_count),
    isFeatured: Boolean(row.is_featured),
    priceFrom: startingPrice,
    currency: startingPriceOptions[0]?.currency || null,
    createdAt: row.created_at,
    available: services.some((service) => service.available === true),
    status: 'active',
    visibility: 'public',
    isPublished: true,
    services,
    logoUrl: media.find((entry) => entry.media_type === 'logo') ? mediaUrl(media.find((entry) => entry.media_type === 'logo')) : null,
    coverImageUrl: media.find((entry) => entry.media_type === 'cover') ? mediaUrl(media.find((entry) => entry.media_type === 'cover')) : null,
    portfolio: media.filter((entry) => entry.media_type === 'portfolio').map((entry) => ({
      id: toNumber(entry.id),
      name: entry.original_name,
      url: mediaUrl(entry),
    })),
  };
}

function mapService(row) {
  return {
    id: toNumber(row.id),
    title: String(row.title || '').trim(),
    vendorId: toNumber(row.vendor_id),
    categoryId: toNumber(row.category_id) || null,
    vendorName: String(row.business_name || '').trim(),
    category: isValidCategoryName(row.category) ? String(row.category).trim() : '',
    city: String(row.city || '').trim(),
    description: String(row.description || '').trim(),
    price: row.price === null || row.price === undefined ? null : toNumber(row.price),
    currency: String(row.currency || 'ETB').trim().toUpperCase(),
    rating: toNumber(row.rating),
    reviewCount: toNumber(row.review_count),
    bookingCount: toNumber(row.booking_count),
    verified: row.verification_status === 'verified',
    createdAt: row.created_at || null,
    packages: [],
    images: [],
    status: 'active',
    published: true,
    visibility: 'public',
  };
}

const vendorRatingSelect = `
  COALESCE((
    SELECT ROUND(AVG(r.rating), 1)
    FROM reviews r
    JOIN bookings b ON b.id = r.booking_id
    WHERE b.vendor_id = vp.id AND r.status = 'published'
  ), 0) AS rating,
  (
    SELECT COUNT(*)
    FROM reviews r
    JOIN bookings b ON b.id = r.booking_id
    WHERE b.vendor_id = vp.id AND r.status = 'published'
  ) AS review_count`;

const serviceRatingSelect = `
  COALESCE((
    SELECT ROUND(AVG(r.rating), 1)
    FROM reviews r
    JOIN bookings b ON b.id = r.booking_id
    WHERE b.service_id = s.id AND r.status = 'published'
  ), 0) AS rating,
  (
    SELECT COUNT(*)
    FROM reviews r
    JOIN bookings b ON b.id = r.booking_id
    WHERE b.service_id = s.id AND r.status = 'published'
  ) AS review_count`;

export async function loadPublicServices(db = pool) {
  const [rows] = await db.query(`
    SELECT s.id, s.vendor_id, s.category_id, s.title, s.description, s.price, s.created_at,
           COALESCE(NULLIF(TRIM(s.currency), ''), 'ETB') AS currency, s.status,
           vp.business_name, vp.city, vp.verification_status,
           COALESCE(sc.service_menu_name, sc.name) AS category,
           (
             SELECT COUNT(*)
             FROM bookings b
             WHERE b.service_id = s.id AND b.status NOT IN ('cancelled', 'rejected')
           ) AS booking_count,
           ${serviceRatingSelect}
    FROM services s
    JOIN vendor_profiles vp ON vp.id = s.vendor_id
    JOIN users u ON u.id = vp.user_id AND u.status = 'active'
    LEFT JOIN service_categories sc ON sc.id = s.category_id AND sc.is_active = TRUE
    WHERE s.status = 'active' AND vp.verification_status = 'verified'
      AND (s.category_id IS NULL OR sc.id IS NOT NULL)
    ORDER BY s.id ASC`);

  const services = rows
    .filter((row) => row.verification_status === 'verified')
    .map(mapService);
  if (!services.length) return services;

  const serviceIds = services.map((service) => service.id);
  const placeholders = serviceIds.map(() => '?').join(', ');
  const [packageRows] = await db.execute(
    `SELECT p.id, p.service_id, p.name, p.description, p.price,
            COALESCE(NULLIF(TRIM(p.currency), ''), 'ETB') AS currency,
            p.included_features, p.extras, p.minimum_booking
     FROM service_packages p
     JOIN services s ON s.id = p.service_id
     JOIN vendor_profiles vp ON vp.id = s.vendor_id
     JOIN users u ON u.id = vp.user_id AND u.status = 'active'
     WHERE p.is_active = TRUE AND s.status = 'active'
       AND vp.verification_status = 'verified' AND p.service_id IN (${placeholders})
     ORDER BY p.price, p.id`,
    serviceIds,
  );
  const servicesById = new Map(services.map((service) => [service.id, service]));
  for (const row of packageRows) {
    const service = servicesById.get(Number(row.service_id));
    if (!service) continue;
    const parseJson = (value) => {
      if (!value) return [];
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return []; }
    };
    service.packages.push({
      id: toNumber(row.id),
      name: row.name,
      description: row.description || '',
      price: toNumber(row.price),
      currency: String(row.currency || 'ETB').toUpperCase(),
      includedFeatures: parseJson(row.included_features),
      extras: parseJson(row.extras),
      minimumBooking: toNumber(row.minimum_booking),
    });
  }
  const [mediaRows] = await db.execute(
    `SELECT id, service_id, original_name
     FROM vendor_media WHERE media_type = 'service' AND service_id IN (${placeholders})
     ORDER BY created_at DESC, id DESC`,
    serviceIds,
  );
  for (const row of mediaRows) {
    const service = servicesById.get(Number(row.service_id));
    if (service) service.images.push({
      id: toNumber(row.id),
      name: row.original_name,
      url: `/api/platform/services/${service.id}/media/${toNumber(row.id)}`,
    });
  }
  const vendorIds = [...new Set(services.map((service) => service.vendorId))];
  if (vendorIds.length) {
    const vendorPlaceholders = vendorIds.map(() => '?').join(', ');
    const [availableVendors] = await db.execute(
      `SELECT DISTINCT va.vendor_id
       FROM vendor_availability va
       WHERE va.status = 'available' AND va.available_date >= CURDATE()
         AND va.vendor_id IN (${vendorPlaceholders})
         AND NOT EXISTS (
           SELECT 1
           FROM bookings b
           JOIN events e ON e.id = b.event_id
           WHERE b.vendor_id = va.vendor_id
             AND b.status IN ('accepted', 'confirmed', 'in_progress')
             AND DATE(COALESCE(b.scheduled_date, e.start_date)) = va.available_date
         )`,
      vendorIds,
    );
    const vendorsWithAvailability = new Set(availableVendors.map((row) => Number(row.vendor_id)));
    for (const service of services) service.available = vendorsWithAvailability.has(service.vendorId);
  }
  return services;
}

export async function loadPublicVendors(db = pool, providedServices = null) {
  const [rows] = await db.query(`
    SELECT vp.id, vp.user_id, vp.business_name, vp.city, vp.description, vp.verification_status,
           vp.is_featured, vp.created_at,
           sc.name AS category,
           (
             SELECT MIN(s.price)
             FROM services s
             WHERE s.vendor_id = vp.id AND s.status = 'active'
           ) AS min_price,
           (
             SELECT COUNT(*)
             FROM bookings b
             WHERE b.vendor_id = vp.id AND b.status NOT IN ('cancelled', 'rejected')
           ) AS booking_count,
           ${vendorRatingSelect}
    FROM vendor_profiles vp
    JOIN users u ON u.id = vp.user_id AND u.status = 'active'
    LEFT JOIN service_categories sc ON sc.id = vp.category_id AND sc.is_active = TRUE
    WHERE vp.verification_status = 'verified'
    ORDER BY vp.id ASC`);

  const services = providedServices || await loadPublicServices(db);
  const vendorIds = rows.map((row) => toNumber(row.id));
  const mediaByVendor = new Map();
  if (vendorIds.length) {
    const placeholders = vendorIds.map(() => '?').join(', ');
    const [mediaRows] = await db.execute(
      `SELECT id, vendor_id, media_type, original_name FROM vendor_media
       WHERE service_id IS NULL AND media_type IN ('logo', 'cover', 'portfolio')
         AND vendor_id IN (${placeholders}) ORDER BY created_at DESC, id DESC`,
      vendorIds,
    );
    for (const media of mediaRows) {
      const vendorId = Number(media.vendor_id);
      mediaByVendor.set(vendorId, [...(mediaByVendor.get(vendorId) || []), media]);
    }
  }
  const servicesByVendor = new Map();
  for (const service of services) {
    if (!servicesByVendor.has(service.vendorId)) servicesByVendor.set(service.vendorId, []);
    servicesByVendor.get(service.vendorId).push(service);
  }

  return rows.map((row) => mapVendor(row, servicesByVendor.get(toNumber(row.id)) || [], mediaByVendor.get(toNumber(row.id)) || []));
}

export async function loadPublicCategories(db = pool, providedVendors = null, providedServices = null) {
  const [rows] = await db.query(
    'SELECT id, name, description, display_order, image_mime, is_active FROM service_categories WHERE is_active = TRUE ORDER BY display_order ASC, name ASC'
  );
  const vendors = providedVendors || await loadPublicVendors(db);
  const services = providedServices || await loadPublicServices(db);

  return rows.filter((row) => isValidCategoryName(row.name)).map((row) => {
    const key = normalizeKey(row.name);
    const vendorCount = vendors.filter((vendor) => normalizeKey(vendor.category) === key).length;
    const serviceCount = services.filter((service) => normalizeKey(service.category) === key).length;
    const slug = categorySlug(row.name);
    return {
      id: toNumber(row.id),
      name: String(row.name || '').trim(),
      slug,
      description: String(row.description || '').trim(),
      image: row.image_mime ? `/api/platform/categories/${toNumber(row.id)}/image` : null,
      isActive: Boolean(row.is_active),
      displayOrder: Number(row.display_order || 0),
      vendorCount,
      serviceCount,
    };
  });
}

export async function loadPublicMarketplace(db = pool) {
  const services = await loadPublicServices(db);
  const vendors = await loadPublicVendors(db, services);
  const categories = await loadPublicCategories(db, vendors, services);
  return { categories, vendors, services };
}

export async function loadVendorProfileForUser(userId, db = pool) {
  const [rows] = await db.execute(
        `SELECT vp.id, vp.user_id, vp.business_name, vp.city, vp.address, vp.service_areas,
          vp.operating_hours, vp.website, vp.notification_preferences, vp.booking_preferences,
          vp.description, vp.verification_status,
            vp.verification_reason, vp.verified_at, vp.created_at, vp.category_id,
            sc.name AS category_name,
            u.full_name, u.email, u.phone, u.status
     FROM vendor_profiles vp
     JOIN users u ON u.id = vp.user_id
     LEFT JOIN service_categories sc ON sc.id = vp.category_id
     WHERE vp.user_id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

export async function ensureVendorProfile(userId, displayName, db = pool) {
  const existing = await loadVendorProfileForUser(userId, db);
  if (existing) return existing;
  await db.execute(
    'INSERT INTO vendor_profiles (user_id, business_name, verification_status) VALUES (?, ?, \'pending\')',
    [userId, String(displayName || 'New vendor').trim().slice(0, 160) || 'New vendor']
  );
  return loadVendorProfileForUser(userId, db);
}

export function mapBookingRecord(row = {}) {
  const id = toNumber(row.id);
  return {
    id,
    reference: `BK-${String(id).padStart(6, '0')}`,
    eventId: toNumber(row.event_id),
    vendorId: toNumber(row.vendor_id),
    serviceTitle: String(row.service_description || '').trim(),
    quotedAmount: toNumber(row.quoted_amount),
    amount: toNumber(row.quoted_amount),
    currency: String(row.currency || 'ETB').toUpperCase(),
    status: String(row.status || 'requested'),
    moderationReason: row.moderation_reason || null,
    eventTitle: row.event_title || null,
    eventDate: row.event_start_date || null,
    customerName: row.customer_name || null,
    vendorName: row.vendor_name || null,
    createdAt: row.created_at || null,
  };
}

export function mapNotification(row = {}) {
  return {
    id: toNumber(row.id),
    title: row.title || '',
    message: row.message || '',
    read: row.status === 'read',
    status: row.status || 'queued',
    createdAt: row.created_at || null,
  };
}
