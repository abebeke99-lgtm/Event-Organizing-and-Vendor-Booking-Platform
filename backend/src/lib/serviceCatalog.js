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
  record.title = sanitizeText(record.title || record.name || 'Untitled service', 'Untitled service');
  record.vendorId = Number(record.vendorId ?? record.vendor_id ?? 0) || 0;
  record.vendorName = sanitizeText(record.vendorName || record.vendor_name || record.business_name || record.vendor || 'EventHub partner');
  record.category = sanitizeText(record.category || record.service_category || 'General');
  record.city = sanitizeText(record.city || record.location || 'Addis Ababa');
  record.description = sanitizeText(record.description || record.summary || '');
  record.price = Number(record.price ?? record.base_price ?? 0) || 0;
  record.currency = sanitizeText(record.currency || 'ETB', 'ETB').toUpperCase();
  record.rating = Number(record.rating ?? record.average_rating ?? 0) || 0;
  record.reviewCount = Number(record.reviewCount ?? record.reviews_count ?? 0) || 0;
  record.status = String(record.status || 'active').toLowerCase();
  record.visibility = String(record.visibility || 'public').toLowerCase();
  record.published = record.published !== false && record.isPublished !== false && record.visibility !== 'private';
  return record;
}

export function buildServiceFilters(raw = {}) {
  const search = sanitizeText(raw.search, '').toLowerCase().slice(0, 120);
  const category = sanitizeText(raw.category, '').toLowerCase();
  const location = sanitizeText(raw.location, '').toLowerCase();
  const minPrice = Number.isFinite(Number(raw.minPrice)) ? Math.max(0, Number(raw.minPrice)) : 0;
  const maxPrice = Number.isFinite(Number(raw.maxPrice)) ? Math.max(minPrice, Number(raw.maxPrice)) : 0;
  const minRating = Number.isFinite(Number(raw.minRating)) ? Math.max(0, Number(raw.minRating)) : 0;
  const sort = sanitizeText(raw.sort, 'recommended').toLowerCase();
  const page = Number.isFinite(Number(raw.page)) ? Math.max(1, Number(raw.page)) : 1;
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(1, Math.min(50, Number(raw.limit))) : 6;

  return {
    search,
    category,
    location,
    minPrice,
    maxPrice,
    minRating,
    sort: ['recommended', 'highest-rated', 'price-low', 'price-high', 'alphabetical'].includes(sort) ? sort : 'recommended',
    page,
    limit,
  };
}

export function listPublicServices(services = [], filters = {}) {
  const normalized = (Array.isArray(services) ? services : []).map(normalizeServiceRecord).filter((service) => {
    if (!service || !service.id) return false;
    if (service.visibility === 'private' || service.visibility === 'hidden') return false;
    if (service.status === 'draft' || service.status === 'rejected' || service.status === 'cancelled') return false;
    if (service.published === false) return false;
    return true;
  });

  const options = buildServiceFilters(filters);

  const filtered = normalized.filter((service) => {
    const haystack = [service.title, service.category, service.description, service.vendorName, service.city].join(' ').toLowerCase();
    if (options.search && !haystack.includes(options.search)) return false;
    if (options.category && !matchesCategoryName(service.category, options.category)) return false;
    if (options.location && !service.city.toLowerCase().includes(options.location)) return false;
    if (options.minPrice && service.price < options.minPrice) return false;
    if (options.maxPrice && service.price > options.maxPrice) return false;
    if (options.minRating && service.rating < options.minRating) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (options.sort) {
      case 'highest-rated':
        return (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0) || a.title.localeCompare(b.title);
      case 'price-low':
        return (a.price || 0) - (b.price || 0) || (b.rating || 0) - (a.rating || 0);
      case 'price-high':
        return (b.price || 0) - (a.price || 0) || (b.rating || 0) - (a.rating || 0);
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
  if (record.visibility === 'private' || record.visibility === 'hidden' || record.status === 'draft' || record.published === false) return null;
  return record;
}
