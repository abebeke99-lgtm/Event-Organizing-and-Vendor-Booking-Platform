export const publicEventStatuses = new Set(['active', 'published', 'upcoming', 'open']);

export function normalizeEventDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

export function sanitizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text.length ? text : fallback;
}

function mapGalleryImages(value) {
  const parsed = Array.isArray(value) ? value : typeof value === 'string' && value ? JSON.parse(value) : [];
  return Array.isArray(parsed) ? parsed.filter((image) => typeof image === 'string') : [];
}

export function mapDatabaseEvent(row) {
  return {
    id: Number(row.id),
    title: sanitizeText(row.title),
    description: sanitizeText(row.description || row.notes),
    type: sanitizeText(row.event_type),
    category: sanitizeText(row.event_type).toLowerCase(),
    location: sanitizeText(row.city) || null,
    venue: sanitizeText(row.venue) || null,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    budget: row.budget === null || row.budget === undefined ? null : Number(row.budget),
    status: sanitizeText(row.status),
    coverImage: sanitizeText(row.cover_image_url) || null,
    galleryImages: mapGalleryImages(row.gallery_images),
    capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
    organizerName: sanitizeText(row.organizer_name) || null,
    startingPrice: row.starting_price === null || row.starting_price === undefined ? null : Number(row.starting_price),
    availableQuantity: row.available_quantity === null || row.available_quantity === undefined ? null : Number(row.available_quantity),
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
  };
}

export function getPublicEvents(events = []) {
  return (events || []).filter((event) => {
    const status = String(event?.status || '').toLowerCase();
    const visibility = String(event?.visibility || 'public').toLowerCase();
    const published = event?.isPublished !== false && event?.published !== false;
    if (event?.deleted || event?.archived) return false;
    if (visibility === 'private' || visibility === 'hidden') return false;
    if (status === 'draft' || status === 'rejected' || status === 'cancelled') return false;
    return published;
  });
}

export function buildEventFilters(raw = {}) {
  const search = sanitizeText(raw.search, '').slice(0, 120).toLowerCase();
  const category = sanitizeText(raw.category, '').toLowerCase();
  const location = sanitizeText(raw.location, '').toLowerCase();
  const startDate = sanitizeText(raw.startDate, '');
  const endDate = sanitizeText(raw.endDate, '');
  const sort = sanitizeText(raw.sort, 'upcoming').toLowerCase();
  const minPrice = raw.minPrice === '' || raw.minPrice === undefined ? null : Number(raw.minPrice);
  const maxPrice = raw.maxPrice === '' || raw.maxPrice === undefined ? null : Number(raw.maxPrice);
  const page = Number.isFinite(Number(raw.page)) ? Math.max(1, Number(raw.page)) : 1;
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(1, Math.min(50, Number(raw.limit))) : 12;

  return {
    search,
    category,
    location,
    startDate,
    endDate,
    minPrice: Number.isFinite(minPrice) && minPrice >= 0 ? minPrice : null,
    maxPrice: Number.isFinite(maxPrice) && maxPrice >= 0 ? maxPrice : null,
    status: sanitizeText(raw.status, '').toLowerCase(),
    sort: ['upcoming', 'earliest', 'latest', 'alphabetical', 'recent', 'price_asc', 'price_desc'].includes(sort) ? sort : 'upcoming',
    page,
    limit,
  };
}

export function listPublicEvents(events = [], filters = {}) {
  const normalized = getPublicEvents(events);
  const options = buildEventFilters(filters);

  let total = normalized.filter((event) => {
    const title = sanitizeText(event?.title, '').toLowerCase();
    const description = sanitizeText(event?.description, '').toLowerCase();
    const eventCategory = sanitizeText(event?.category, '').toLowerCase();
    const eventLocation = sanitizeText(event?.location, '').toLowerCase();
    const venue = sanitizeText(event?.venue, '').toLowerCase();
    const organizer = sanitizeText(event?.organizerName, '').toLowerCase();
    const start = normalizeEventDate(event?.startDate || event?.start_date);
    const price = event?.startingPrice === null || event?.startingPrice === undefined
      ? null
      : Number(event.startingPrice);
    const status = sanitizeText(event?.status, '').toLowerCase();

    if (options.search && ![title, description, eventCategory, eventLocation, venue, organizer].some((value) => value.includes(options.search))) {
      return false;
    }

    if (options.category && eventCategory !== options.category) {
      return false;
    }

    if (options.location && !eventLocation.includes(options.location)) {
      return false;
    }

    if (options.startDate) {
      const startBoundary = normalizeEventDate(options.startDate);
      if (startBoundary && start && start < startBoundary) {
        return false;
      }
    }

    if (options.endDate) {
      const endBoundary = normalizeEventDate(options.endDate);
      if (endBoundary && /^\d{4}-\d{2}-\d{2}$/.test(options.endDate)) endBoundary.setHours(23, 59, 59, 999);
      if (endBoundary && start && start > endBoundary) {
        return false;
      }
    }

    if (options.minPrice !== null && (price === null || price < options.minPrice)) return false;
    if (options.maxPrice !== null && (price === null || price > options.maxPrice)) return false;
    if (options.status === 'upcoming' && start && start < new Date()) return false;
    if (options.status === 'available' && Number(event?.availableQuantity ?? 0) <= 0) return false;
    if (options.status === 'free' && price !== 0) return false;
    if (options.status === 'paid' && (price === null || price <= 0)) return false;
    if (options.status && !['upcoming', 'available', 'free', 'paid'].includes(options.status) && status !== options.status) return false;

    return true;
  });

  const sorted = [...total].sort((a, b) => {
    const aStart = normalizeEventDate(a?.startDate || a?.start_date) ?? new Date(0);
    const bStart = normalizeEventDate(b?.startDate || b?.start_date) ?? new Date(0);

    switch (options.sort) {
      case 'latest':
        return bStart.getTime() - aStart.getTime();
      case 'alphabetical':
        return sanitizeText(a?.title, '').localeCompare(sanitizeText(b?.title, '')) || aStart.getTime() - bStart.getTime();
      case 'recent':
        return (normalizeEventDate(b?.publishedAt || b?.createdAt) ?? new Date(0)).getTime() - (normalizeEventDate(a?.publishedAt || a?.createdAt) ?? new Date(0)).getTime();
      case 'price_asc':
        return Number(a?.startingPrice ?? 0) - Number(b?.startingPrice ?? 0) || aStart.getTime() - bStart.getTime();
      case 'price_desc':
        return Number(b?.startingPrice ?? 0) - Number(a?.startingPrice ?? 0) || aStart.getTime() - bStart.getTime();
      case 'earliest':
        return aStart.getTime() - bStart.getTime();
      case 'upcoming':
      default:
        return aStart.getTime() - bStart.getTime();
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / options.limit));
  const page = Math.min(options.page, totalPages);
  const startIndex = (page - 1) * options.limit;
  const rows = sorted.slice(startIndex, startIndex + options.limit);

  return {
    events: rows,
    total: sorted.length,
    page,
    limit: options.limit,
    totalPages,
    sort: options.sort,
  };
}

export function getPublicEventById(events = [], eventId) {
  const parsedId = Number(eventId);
  if (!Number.isInteger(parsedId)) return null;
  return getPublicEvents(events).find((event) => Number(event?.id) === parsedId) || null;
}

export function getPublicCategories(categories = []) {
  return (categories || []).filter((category) => !category?.hidden).map((category) => ({
    id: category?.id ?? null,
    name: sanitizeText(category?.name, 'General'),
    slug: sanitizeText(category?.slug, String(category?.name || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-')),
  }));
}
