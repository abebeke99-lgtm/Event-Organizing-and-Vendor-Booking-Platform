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
  const page = Number.isFinite(Number(raw.page)) ? Math.max(1, Number(raw.page)) : 1;
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(1, Math.min(50, Number(raw.limit))) : 12;

  return {
    search,
    category,
    location,
    startDate,
    endDate,
    sort: ['upcoming', 'earliest', 'latest', 'alphabetical', 'recent'].includes(sort) ? sort : 'upcoming',
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
    const start = normalizeEventDate(event?.startDate || event?.start_date);

    if (options.search && ![title, description, eventLocation].some((value) => value.includes(options.search))) {
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
      if (endBoundary && start && start > endBoundary) {
        return false;
      }
    }

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
