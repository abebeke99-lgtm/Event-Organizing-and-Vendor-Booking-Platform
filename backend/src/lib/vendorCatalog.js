function normalizeCategoryKey(value = '') {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function matchesCategoryName(candidate = '', target = '') {
  const first = normalizeCategoryKey(candidate);
  const second = normalizeCategoryKey(target);
  if (!first || !second) return false;
  return first === second;
}

export function normalizeVendorRecord(vendor = {}) {
  const record = { ...vendor };
  record.business_name = String(record.business_name || record.name || 'Unnamed vendor').trim();
  record.category = String(record.category || record.primaryCategory || 'General').trim();
  record.city = String(record.city || record.location || 'Remote').trim();
  record.description = String(record.description || '').trim();
  record.verified = Boolean(record.verified || record.verification_status === 'verified');
  record.rating = Number(record.rating ?? 0) || 0;
  record.reviewCount = Number(record.reviewCount ?? record.reviews_count ?? 0) || 0;
  record.bookingCount = Number(record.bookingCount ?? record.booking_count ?? 0) || 0;
  record.isFeatured = Boolean(record.isFeatured ?? record.is_featured ?? false);
  const startingPrice = record.priceFrom ?? record.starting_price ?? record.min_price;
  record.priceFrom = startingPrice === null || startingPrice === undefined || startingPrice === ''
    ? null
    : Number(startingPrice);
  if (!Number.isFinite(record.priceFrom)) record.priceFrom = null;
  record.available = record.available === true;
  record.createdAt = record.createdAt || record.created_at || null;
  record.isPublished = record.isPublished !== false && record.published !== false && record.visibility !== 'private';
  record.visibility = String(record.visibility || 'public').toLowerCase();
  record.status = String(record.status || 'active').toLowerCase();
  record.services = Array.isArray(record.services) ? record.services : [];
  record.publicServiceCount = record.services.filter((service) => service && service.published !== false && service.isPublished !== false && service.visibility !== 'private').length;
  return record;
}

export function buildVendorFilters(raw = {}) {
  const search = String(raw.search || '').trim().slice(0, 120).toLowerCase();
  const category = String(raw.category || '').trim().toLowerCase();
  const location = String(raw.location || '').trim().toLowerCase();
  const verified = raw.verified === true || raw.verified === 'true' || raw.verified === '1';
  const minRating = Number(raw.minRating ?? raw.min_rating ?? 0);
  const minPrice = Number(raw.minPrice ?? raw.min_price ?? 0);
  const maxPrice = Number(raw.maxPrice ?? raw.max_price ?? 0);
  const availableOnly = raw.availableOnly === true || raw.availableOnly === 'true' || raw.availableOnly === '1';
  const sort = String(raw.sort || 'recommended').trim().toLowerCase();
  const page = Number.isFinite(Number(raw.page)) ? Math.max(1, Number(raw.page)) : 1;
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(1, Math.min(50, Number(raw.limit))) : 12;

  return {
    search,
    category,
    location,
    verified,
    minRating: Number.isFinite(minRating) ? Math.max(0, minRating) : 0,
    minPrice: Number.isFinite(minPrice) ? Math.max(0, minPrice) : 0,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? Math.max(minPrice || 0, maxPrice) : 0,
    availableOnly,
    featured: raw.filter === 'featured',
    sort: ['recommended', 'popular', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'name-az', 'recently-added'].includes(sort) ? sort : 'recommended',
    page,
    limit,
  };
}

export function listPublicVendors(vendors = [], filters = {}) {
  const normalized = (Array.isArray(vendors) ? vendors : []).map(normalizeVendorRecord).filter((vendor) => {
    if (!vendor || vendor.isPublished === false || vendor.visibility === 'private' || vendor.visibility === 'hidden') return false;
    if (vendor.status === 'draft' || vendor.status === 'rejected' || vendor.status === 'suspended') return false;
    if (!vendor.verified) return false;
    return true;
  });

  const options = buildVendorFilters(filters);

  const filtered = normalized.filter((vendor) => {
    const serviceText = vendor.services.map((service) => [service.title, service.description].join(' ')).join(' ');
    const haystack = [vendor.business_name, vendor.category, vendor.city, vendor.description, serviceText].join(' ').toLowerCase();
    if (options.search && !haystack.includes(options.search)) return false;
    if (options.category && !matchesCategoryName(vendor.category, options.category)) return false;
    if (options.location && !vendor.city.toLowerCase().includes(options.location)) return false;
    if (options.verified && !vendor.verified) return false;
    if (options.featured && !vendor.isFeatured) return false;
    if (options.minRating && vendor.rating < options.minRating) return false;
    if (options.minPrice && (vendor.priceFrom === null || vendor.priceFrom < options.minPrice)) return false;
    if (options.maxPrice && (vendor.priceFrom === null || vendor.priceFrom > options.maxPrice)) return false;
    if (options.availableOnly && !vendor.available) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aScore = a.verified ? 1 : 0;
    const bScore = b.verified ? 1 : 0;

    switch (options.sort) {
      case 'highest-rated':
        return (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0) || (a.business_name || '').localeCompare(b.business_name || '');
      case 'most-reviewed':
        return (b.reviewCount || 0) - (a.reviewCount || 0) || (b.rating || 0) - (a.rating || 0) || a.business_name.localeCompare(b.business_name);
      case 'popular':
        return (b.bookingCount || 0) - (a.bookingCount || 0)
          || (b.reviewCount || 0) - (a.reviewCount || 0)
          || (b.rating || 0) - (a.rating || 0)
          || a.business_name.localeCompare(b.business_name);
      case 'price-low':
        return (a.priceFrom === null ? 1 : 0) - (b.priceFrom === null ? 1 : 0)
          || (a.priceFrom ?? 0) - (b.priceFrom ?? 0)
          || (b.rating || 0) - (a.rating || 0);
      case 'price-high':
        return (a.priceFrom === null ? 1 : 0) - (b.priceFrom === null ? 1 : 0)
          || (b.priceFrom ?? 0) - (a.priceFrom ?? 0)
          || (b.rating || 0) - (a.rating || 0);
      case 'recently-added':
        return (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
          || (b.rating || 0) - (a.rating || 0);
      case 'name-az':
        return (a.business_name || '').localeCompare(b.business_name || '') || (b.rating || 0) - (a.rating || 0);
      case 'recommended':
      default:
        return (bScore - aScore) || (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0) || (a.business_name || '').localeCompare(b.business_name || '');
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / options.limit));
  const page = Math.min(options.page, totalPages);
  const startIndex = (page - 1) * options.limit;
  const rows = sorted.slice(startIndex, startIndex + options.limit);

  return {
    vendors: rows,
    total: sorted.length,
    page,
    limit: options.limit,
    totalPages,
    sort: options.sort,
  };
}

export function getPublicVendorById(vendors = [], vendorId) {
  const parsedId = Number(vendorId);
  if (!Number.isInteger(parsedId)) return null;

  const record = (Array.isArray(vendors) ? vendors : []).map(normalizeVendorRecord).find((vendor) => Number(vendor.id) === parsedId);
  if (!record) return null;
  if (!record.isPublished || record.visibility === 'private' || record.visibility === 'hidden' || !record.verified) return null;
  return record;
}

export function deriveVendorSummary(vendor = {}) {
  const normalized = normalizeVendorRecord(vendor);
  return {
    businessName: normalized.business_name,
    category: normalized.category,
    city: normalized.city,
    rating: normalized.rating,
    reviewCount: normalized.reviewCount,
    verified: normalized.verified,
    publicServiceCount: normalized.publicServiceCount,
    priceFrom: normalized.priceFrom,
  };
}
