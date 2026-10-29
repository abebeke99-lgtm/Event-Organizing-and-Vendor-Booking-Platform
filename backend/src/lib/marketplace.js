import { pool } from '../db.js';

const categoryImages = {
  'wedding-venues': 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=900&q=80',
  catering: 'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=900&q=80',
  photography: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80',
  decoration: 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80',
  entertainment: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=80',
};
const defaultCategoryImage = categoryImages.decoration;

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

function mapVendor(row, services = []) {
  return {
    id: toNumber(row.id),
    userId: toNumber(row.user_id),
    business_name: String(row.business_name || '').trim(),
    name: String(row.business_name || '').trim(),
    category: String(row.category || 'General').trim(),
    city: String(row.city || '').trim(),
    description: String(row.description || '').trim(),
    verified: row.verification_status === 'verified',
    rating: toNumber(row.rating),
    reviewCount: toNumber(row.review_count),
    priceFrom: toNumber(row.min_price),
    status: 'active',
    visibility: 'public',
    isPublished: true,
    services,
  };
}

function mapService(row) {
  return {
    id: toNumber(row.id),
    title: String(row.title || '').trim(),
    vendorId: toNumber(row.vendor_id),
    vendorName: String(row.business_name || '').trim(),
    category: String(row.category || 'General').trim(),
    city: String(row.city || '').trim(),
    description: String(row.description || '').trim(),
    price: toNumber(row.price),
    currency: String(row.currency || 'ETB').trim().toUpperCase(),
    rating: toNumber(row.rating),
    reviewCount: toNumber(row.review_count),
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

export async function loadPublicServices(db = pool) {
  const [rows] = await db.query(`
    SELECT s.id, s.vendor_id, s.title, s.description, s.price, s.currency, s.status,
           vp.business_name, vp.city, vp.verification_status,
           sc.name AS category,
           ${vendorRatingSelect}
    FROM services s
    JOIN vendor_profiles vp ON vp.id = s.vendor_id
    LEFT JOIN service_categories sc ON sc.id = s.category_id
    WHERE s.status = 'active' AND vp.verification_status = 'verified'
    ORDER BY s.id ASC`);

  return rows
    .filter((row) => row.verification_status === 'verified')
    .map(mapService);
}

export async function loadPublicVendors(db = pool, providedServices = null) {
  const [rows] = await db.query(`
    SELECT vp.id, vp.user_id, vp.business_name, vp.city, vp.description, vp.verification_status,
           sc.name AS category,
           COALESCE((
             SELECT MIN(s.price)
             FROM services s
             WHERE s.vendor_id = vp.id AND s.status = 'active'
           ), 0) AS min_price,
           ${vendorRatingSelect}
    FROM vendor_profiles vp
    LEFT JOIN service_categories sc ON sc.id = vp.category_id
    WHERE vp.verification_status = 'verified'
    ORDER BY vp.id ASC`);

  const services = providedServices || await loadPublicServices(db);
  const servicesByVendor = new Map();
  for (const service of services) {
    if (!servicesByVendor.has(service.vendorId)) servicesByVendor.set(service.vendorId, []);
    servicesByVendor.get(service.vendorId).push(service);
  }

  return rows.map((row) => mapVendor(row, servicesByVendor.get(toNumber(row.id)) || []));
}

export async function loadPublicCategories(db = pool, providedVendors = null, providedServices = null) {
  const [rows] = await db.query(
    'SELECT id, name, description, is_active FROM service_categories WHERE is_active = TRUE ORDER BY name ASC'
  );
  const vendors = providedVendors || await loadPublicVendors(db);
  const services = providedServices || await loadPublicServices(db);

  return rows.map((row) => {
    const key = normalizeKey(row.name);
    const vendorCount = vendors.filter((vendor) => normalizeKey(vendor.category) === key).length;
    const serviceCount = services.filter((service) => normalizeKey(service.category) === key).length;
    const slug = categorySlug(row.name);
    return {
      id: toNumber(row.id),
      name: String(row.name || '').trim(),
      slug,
      description: String(row.description || '').trim(),
      image: categoryImages[slug] || defaultCategoryImage,
      isActive: Boolean(row.is_active),
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
    `SELECT vp.id, vp.user_id, vp.business_name, vp.city, vp.description, vp.verification_status,
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
