export function sanitizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text.length ? text : fallback;
}

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
  return first === second || first.includes(second) || second.includes(first);
}

export function normalizeServiceRecord(service = {}) {
  const record = { ...service };
  record.id = Number(record.id ?? record.service_id ?? 0) || 0;
  record.title = sanitizeText(record.title || record.name);
  record.vendorId = Number(record.vendorId ?? record.vendor_id ?? 0) || 0;
  record.categoryId = Number(record.categoryId ?? record.category_id ?? 0) || null;
  record.vendorName = sanitizeText(record.vendorName || record.vendor_name || record.business_name || record.vendor);
  record.category = sanitizeText(record.category || record.service_category);
  record.city = sanitizeText(record.city || record.location);
  record.description = sanitizeText(record.description || record.summary || '');
  const price = record.price ?? record.base_price;
  record.price = price === null || price === undefined || price === '' ? null : Number(price);
  if (!Number.isFinite(record.price)) record.price = null;
  record.currency = sanitizeText(record.currency || 'ETB', 'ETB').toUpperCase();
  record.packages = Array.isArray(record.packages) ? record.packages.filter(Boolean) : [];
  record.features = Array.isArray(record.features) ? record.features.filter(Boolean) : [];
  record.rating = Number(record.rating ?? record.average_rating ?? 0) || 0;
  record.reviewCount = Number(record.reviewCount ?? record.reviews_count ?? 0) || 0;
  record.bookingCount = Number(record.bookingCount ?? record.booking_count ?? 0) || 0;
  record.status = String(record.status || 'active').toLowerCase();
  record.visibility = String(record.visibility || 'public').toLowerCase();
  record.published = record.published !== false && record.isPublished !== false && record.visibility !== 'private';
  return record;
}

export function buildServiceFilters(raw = {}) {
  const search = sanitizeText(raw.search, '').toLowerCase().slice(0, 120);
  const category = sanitizeText(raw.category, '').toLowerCase();
  const rawCategoryId = Number(raw.categoryId ?? raw.category_id ?? 0);
  const categoryId = Number.isInteger(rawCategoryId) && rawCategoryId > 0 ? rawCategoryId : null;
  const location = sanitizeText(raw.location, '').toLowerCase();
  const vendor = sanitizeText(raw.vendor, '').toLowerCase().slice(0, 120);
  const rawVendorId = Number(raw.vendorId ?? raw.vendor_id ?? 0);
  const vendorId = Number.isInteger(rawVendorId) && rawVendorId > 0 ? rawVendorId : null;
  const minPrice = Number.isFinite(Number(raw.minPrice)) ? Math.max(0, Number(raw.minPrice)) : 0;
  const maxPrice = Number.isFinite(Number(raw.maxPrice)) ? Math.max(minPrice, Number(raw.maxPrice)) : 0;
  const minRating = Number.isFinite(Number(raw.minRating)) ? Math.max(0, Number(raw.minRating)) : 0;
  const minReviews = Number.isFinite(Number(raw.minReviews)) ? Math.max(0, Number(raw.minReviews)) : 0;
  const maxReviews = Number.isFinite(Number(raw.maxReviews)) ? Math.max(minReviews, Number(raw.maxReviews)) : 0;
  const hasMaxReviews = raw.maxReviews !== undefined && raw.maxReviews !== null && String(raw.maxReviews).trim() !== '';
  const feature = sanitizeText(raw.feature, '').toLowerCase().slice(0, 120);
  const availableOnly = raw.availableOnly === true || raw.availableOnly === 'true' || raw.availableOnly === '1';
  const sort = sanitizeText(raw.sort, 'recommended').toLowerCase();
  const page = Number.isFinite(Number(raw.page)) ? Math.max(1, Number(raw.page)) : 1;
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(1, Math.min(50, Number(raw.limit))) : 6;

  return {
    search,
    category,
    categoryId,
    location,
    vendor,
    vendorId,
    minPrice,
    maxPrice,
    minRating,
    minReviews,
    maxReviews,
    hasMaxReviews,
    feature,
    availableOnly,
    sort: ['recommended', 'relevance', 'popular', 'newest', 'highest-rated', 'rating', 'price-low', 'price-high', 'alphabetical'].includes(sort) ? sort : 'recommended',
    page,
    limit,
  };
}

export function listPublicServices(services = [], filters = {}) {
  const normalized = (Array.isArray(services) ? services : []).map(normalizeServiceRecord).filter((service) => {
    if (!service || !service.id || !service.title || !service.vendorId || !service.vendorName) return false;
    if (service.visibility === 'private' || service.visibility === 'hidden') return false;
    if (service.status !== 'active') return false;
    if (service.published === false) return false;
    return true;
  });

  const options = buildServiceFilters(filters);

  const filtered = normalized.filter((service) => {
    const packageText = service.packages.flatMap((item) => [
      item.name,
      item.description,
      ...(Array.isArray(item.includedFeatures) ? item.includedFeatures : []),
      ...(Array.isArray(item.extras) ? item.extras.flatMap((extra) => [extra.name, extra.description]) : []),
    ]);
    const featureText = Array.isArray(service.features) ? service.features : [];
    const featureHaystack = [...packageText, ...featureText].join(' ').toLowerCase();
    const haystack = [service.title, service.category, service.description, service.vendorName, service.city, ...packageText, ...featureText]
      .join(' ')
      .toLowerCase();
    if (options.search && !haystack.includes(options.search)) return false;
    if (options.feature && !featureHaystack.includes(options.feature)) return false;
    if (options.categoryId && Number(service.categoryId) !== options.categoryId) return false;
    if (options.category && !matchesCategoryName(service.category, options.category)) return false;
    if (options.location && !service.city.toLowerCase().includes(options.location)) return false;
    if (options.vendor && !service.vendorName.toLowerCase().includes(options.vendor)) return false;
    if (options.vendorId && Number(service.vendorId) !== Number(options.vendorId)) return false;
    if (options.minPrice && (service.price === null || service.price < options.minPrice)) return false;
    if (options.maxPrice && (service.price === null || service.price > options.maxPrice)) return false;
    if (options.minRating && service.rating < options.minRating) return false;
    if (options.minReviews && service.reviewCount < options.minReviews) return false;
    if (options.hasMaxReviews && service.reviewCount > options.maxReviews) return false;
    if (options.availableOnly && service.available !== true) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (options.sort) {
      case 'relevance': {
        const score = (service) => {
          if (!options.search) return 0;
          const query = options.search;
          return (service.title.toLowerCase().includes(query) ? 8 : 0)
            + (service.category.toLowerCase().includes(query) ? 4 : 0)
            + (service.vendorName.toLowerCase().includes(query) ? 3 : 0)
            + (service.description.toLowerCase().includes(query) ? 2 : 0)
            + (service.city.toLowerCase().includes(query) ? 1 : 0);
        };
        return score(b) - score(a)
          || (b.rating || 0) - (a.rating || 0)
          || (b.reviewCount || 0) - (a.reviewCount || 0)
          || a.title.localeCompare(b.title);
      }
      case 'popular':
        return (b.bookingCount || 0) - (a.bookingCount || 0)
          || (b.reviewCount || 0) - (a.reviewCount || 0)
          || (b.rating || 0) - (a.rating || 0)
          || a.title.localeCompare(b.title);
      case 'most-reviewed':
        return (b.reviewCount || 0) - (a.reviewCount || 0)
          || (b.rating || 0) - (a.rating || 0)
          || a.title.localeCompare(b.title);
      case 'newest':
        return (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
          || a.title.localeCompare(b.title);
      case 'highest-rated':
      case 'rating':
        return (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0) || a.title.localeCompare(b.title);
      case 'price-low':
        return (a.price === null ? 1 : 0) - (b.price === null ? 1 : 0)
          || (a.price ?? 0) - (b.price ?? 0)
          || (b.rating || 0) - (a.rating || 0);
      case 'price-high':
        return (a.price === null ? 1 : 0) - (b.price === null ? 1 : 0)
          || (b.price ?? 0) - (a.price ?? 0)
          || (b.rating || 0) - (a.rating || 0);
      case 'alphabetical':
        return a.title.localeCompare(b.title) || (b.rating || 0) - (a.rating || 0);
      case 'recommended':
      default:
        return (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0) || a.title.localeCompare(b.title);
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / options.limit));
  const page = Math.min(options.page, totalPages);
  const startIndex = (page - 1) * options.limit;
  const rows = sorted.slice(startIndex, startIndex + options.limit);

  return {
    services: rows,
    total: sorted.length,
    page,
    limit: options.limit,
    totalPages,
    sort: options.sort,
  };
}

export function getPublicServiceById(services = [], serviceId) {
  const parsedId = Number(serviceId);
  if (!Number.isInteger(parsedId)) return null;
  const record = (Array.isArray(services) ? services : [])
    .map(normalizeServiceRecord)
    .find((service) => Number(service.id) === parsedId);
  if (!record) return null;
  if (record.visibility === 'private' || record.visibility === 'hidden' || record.status !== 'active' || record.published === false) return null;
  return record;
}
