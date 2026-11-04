export const publicEventStatuses = new Set(['active', 'published', 'upcoming', 'open', 'booked', 'in_progress']);

export function normalizeEventDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

export function sanitizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text.length ? text : fallback;
}

export function resolveEventCategoryFilter(value, categories = []) {
  const category = sanitizeText(value, '');
  if (!category || /^\d+$/.test(category)) return category;
  const normalized = category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const match = categories.find((item) => {
    const name = sanitizeText(item?.name, '').toLowerCase();
    const slug = name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return name === category.toLowerCase() || slug === normalized;
  });
  return match ? String(match.id) : category;
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
    freeAvailableQuantity: row.free_available_quantity === null || row.free_available_quantity === undefined ? null : Number(row.free_available_quantity),
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    isFeatured: Boolean(row.is_featured),
    popularityCount: Number(row.popularity_count || 0),
  };
}

export function getPublicEvents(events = []) {
  return (events || []).filter((event) => {
    const status = String(event?.status || '').toLowerCase();
    const visibility = String(event?.visibility || 'public').toLowerCase();
    const published = event?.isPublished !== false && event?.published !== false;
    if (event?.deleted || event?.archived) return false;
    if (visibility === 'private' || visibility === 'hidden') return false;
    if (status === 'completed') return published && Boolean(event?.publishedAt || event?.published_at);
    return published && publicEventStatuses.has(status);
  });
}

export function buildEventFilters(raw = {}) {
  const search = sanitizeText(raw.search, '').slice(0, 120).toLowerCase();
  const category = sanitizeText(raw.category, '').toLowerCase();
  const location = sanitizeText(raw.location, '').toLowerCase();
  const startDate = sanitizeText(raw.startDate, '');
  const endDate = sanitizeText(raw.endDate, '');
  const sort = sanitizeText(raw.sort, raw.filter === 'upcoming' ? 'upcoming' : 'date_earliest').toLowerCase();
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
    status: sanitizeText(raw.status || (['upcoming', 'featured'].includes(String(raw.filter || '').toLowerCase()) ? '' : raw.filter), '').toLowerCase(),
    filter: sanitizeText(raw.filter, '').toLowerCase(),
    datePreset: sanitizeText(raw.datePreset, '').toLowerCase(),
    priceFilter: sanitizeText(raw.priceFilter, '').toLowerCase(),
    sort: [
      'upcoming', 'earliest', 'latest', 'alphabetical', 'recent',
      'newest', 'oldest', 'date_earliest', 'date_latest', 'title_asc', 'title_desc',
      'price_asc', 'price_desc', 'popular',
    ].includes(sort) ? sort : 'date_earliest',
    page,
    limit,
  };
}

export function buildPublicEventListingQuery(raw = {}) {
  const options = buildEventFilters(raw);
  const conditions = ["e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress') OR (e.status = 'completed' AND e.published_at IS NOT NULL)"];
  const params = [];

  if (options.search) {
    const search = `%${options.search.replace(/[!%_]/g, '!$&')}%`;
    conditions.push(`(
      LOWER(e.title) LIKE LOWER(?) ESCAPE '!'
      OR LOWER(COALESCE(e.description, e.notes, '')) LIKE LOWER(?) ESCAPE '!'
      OR LOWER(e.event_type) LIKE LOWER(?) ESCAPE '!'
      OR LOWER(COALESCE(e.city, '')) LIKE LOWER(?) ESCAPE '!'
      OR LOWER(COALESCE(e.venue, '')) LIKE LOWER(?) ESCAPE '!'
      OR LOWER(u.full_name) LIKE LOWER(?) ESCAPE '!'
    )`);
    params.push(search, search, search, search, search, search);
  }
  if (options.category) {
    if (/^\d+$/.test(options.category) && Number.isSafeInteger(Number(options.category))) {
      conditions.push(`EXISTS (
        SELECT 1 FROM service_categories sc
        WHERE sc.id = ? AND sc.is_active = TRUE
          AND LOWER(TRIM(e.event_type)) = LOWER(TRIM(sc.name))
      )`);
      params.push(Number(options.category));
    } else {
      conditions.push('LOWER(e.event_type) = LOWER(?)');
      params.push(options.category);
    }
  }
  if (options.filter === 'featured') conditions.push('e.is_featured = TRUE');
  if (options.location) {
    const location = `%${options.location.replace(/[!%_]/g, '!$&')}%`;
    conditions.push("(LOWER(COALESCE(e.city, '')) LIKE LOWER(?) ESCAPE '!' OR LOWER(COALESCE(e.venue, '')) LIKE LOWER(?) ESCAPE '!')");
    params.push(location, location);
  }
  if (options.filter === 'upcoming' || options.status === 'upcoming' || options.filter === 'free') {
    conditions.push("e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')");
    conditions.push('e.start_date > NOW()');
  }
  if (options.startDate) {
    conditions.push('e.start_date >= ?');
    params.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push('e.start_date < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(options.endDate);
  }
  if (options.minPrice !== null) {
    conditions.push('t.starting_price >= ?');
    params.push(options.minPrice);
  }
  if (options.maxPrice !== null) {
    conditions.push('t.starting_price <= ?');
    params.push(options.maxPrice);
  }

  const datePresetConditions = {
    upcoming: 'e.start_date > NOW()',
    today: 'e.start_date >= CURDATE() AND e.start_date < DATE_ADD(CURDATE(), INTERVAL 1 DAY)',
    tomorrow: 'e.start_date >= DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND e.start_date < DATE_ADD(CURDATE(), INTERVAL 2 DAY)',
    this_week: `e.start_date >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
      AND e.start_date < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)`,
    this_weekend: `e.start_date >= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 5 DAY)
      AND e.start_date < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)`,
    this_month: 'e.start_date >= DATE_FORMAT(CURDATE(), \'%Y-%m-01\') AND e.start_date < DATE_ADD(LAST_DAY(CURDATE()), INTERVAL 1 DAY)',
    next_month: `e.start_date >= DATE_ADD(LAST_DAY(CURDATE()), INTERVAL 1 DAY)
      AND e.start_date < DATE_ADD(LAST_DAY(DATE_ADD(CURDATE(), INTERVAL 1 MONTH)), INTERVAL 1 DAY)`,
  };
  if (options.datePreset && datePresetConditions[options.datePreset]) {
    conditions.push(datePresetConditions[options.datePreset]);
  }

  const priceFilter = options.priceFilter || (['free', 'paid'].includes(options.status) ? options.status : '');
  if (priceFilter === 'free' || options.filter === 'free') conditions.push('t.starting_price = 0');
  if (priceFilter === 'paid') conditions.push('t.starting_price > 0');

  switch (options.status) {
    case 'upcoming':
      break;
    case 'ongoing':
      conditions.push('e.start_date <= NOW() AND e.end_date >= NOW()');
      break;
    case 'past':
      conditions.push('(e.end_date < NOW() OR (e.end_date IS NULL AND e.start_date < NOW()))');
      break;
    case 'free':
    case 'paid':
      break;
    case 'available':
      conditions.push('COALESCE(t.available_quantity, 0) > 0');
      break;
    case 'all':
    case '':
      break;
    default:
      conditions.push('1 = 0');
  }

  const sortColumns = {
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
      WHERE etb.event_id = e.id AND etb.booking_status = 'confirmed'), 0) DESC,
      e.start_date ASC, e.id ASC`,
  };

  return {
    where: `WHERE (${conditions[0]})${conditions.length > 1 ? ` AND ${conditions.slice(1).join(' AND ')}` : ''}`,
    params,
    orderBy: sortColumns[options.sort],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    requiresTicketData: options.minPrice !== null
      || options.maxPrice !== null
      || ['free', 'paid', 'available'].includes(options.status)
      || options.filter === 'free'
      || ['free', 'paid'].includes(options.priceFilter),
  };
}

export function buildPublicEventCategoriesQuery() {
  return `SELECT sc.id, sc.name, sc.description, sc.display_order, sc.image_mime,
      COUNT(e.id) AS total
    FROM service_categories sc
    LEFT JOIN events e ON LOWER(TRIM(e.event_type)) = LOWER(TRIM(sc.name))
      AND (e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
        OR (e.status = 'completed' AND e.published_at IS NOT NULL))
    WHERE sc.is_active = TRUE AND LOWER(sc.name) IN (
      'wedding', 'birthday', 'graduation', 'conference', 'corporate events',
      'concerts & music', 'festivals', 'religious events', 'cultural events',
      'workshops & training', 'sports events', 'exhibitions'
    )
    GROUP BY sc.id, sc.name, sc.description, sc.display_order, sc.image_mime
    ORDER BY FIELD(LOWER(sc.name),
      'wedding', 'birthday', 'graduation', 'conference', 'corporate events',
      'concerts & music', 'festivals', 'religious events', 'cultural events',
      'workshops & training', 'sports events', 'exhibitions'
    ), sc.id ASC`;
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
    const isFreeFilter = options.filter === 'free' || options.priceFilter === 'free' || options.status === 'free';
    const isUpcomingFilter = options.filter === 'upcoming' || options.status === 'upcoming';

    if (options.filter === 'featured' && event?.isFeatured !== true && event?.is_featured !== true) return false;

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
    const end = normalizeEventDate(event?.endDate || event?.end_date);
    const now = new Date();
    if ((isUpcomingFilter || isFreeFilter) && !publicEventStatuses.has(status)) return false;
    if (isFreeFilter && (price !== 0 || !start || start <= now)) return false;
    if (isUpcomingFilter && (!start || start <= now)) return false;
    if (options.status === 'ongoing' && (!start || !end || start > now || end < now)) return false;
    if (options.status === 'past' && (!start || (end && end >= now) || (!end && start >= now))) return false;
    if (options.status === 'available' && Number(event?.availableQuantity ?? 0) <= 0) return false;
    if (options.status === 'free' && price !== 0) return false;
    if (options.status === 'paid' && (price === null || price <= 0)) return false;
    if (options.priceFilter === 'paid' && (price === null || price <= 0)) return false;
    if (options.status && !['upcoming', 'available', 'free', 'paid'].includes(options.status) && status !== options.status) return false;

    return true;
  });

  const sorted = [...total].sort((a, b) => {
    const aStart = normalizeEventDate(a?.startDate || a?.start_date) ?? new Date(0);
    const bStart = normalizeEventDate(b?.startDate || b?.start_date) ?? new Date(0);

    switch (options.sort) {
      case 'latest':
      case 'date_latest':
        return bStart.getTime() - aStart.getTime();
      case 'alphabetical':
      case 'title_asc':
        return sanitizeText(a?.title, '').localeCompare(sanitizeText(b?.title, '')) || aStart.getTime() - bStart.getTime();
      case 'recent':
      case 'newest':
        return (normalizeEventDate(b?.createdAt || b?.created_at) ?? new Date(0)).getTime()
          - (normalizeEventDate(a?.createdAt || a?.created_at) ?? new Date(0)).getTime();
      case 'popular':
        return Number(b?.popularityCount ?? b?.popularity_count ?? 0) - Number(a?.popularityCount ?? a?.popularity_count ?? 0)
          || aStart.getTime() - bStart.getTime();
      case 'oldest':
        return (normalizeEventDate(a?.createdAt || a?.created_at) ?? new Date(0)).getTime()
          - (normalizeEventDate(b?.createdAt || b?.created_at) ?? new Date(0)).getTime();
      case 'title_desc':
        return sanitizeText(b?.title, '').localeCompare(sanitizeText(a?.title, '')) || aStart.getTime() - bStart.getTime();
      case 'price_asc':
        return (a?.startingPrice == null ? 1 : 0) - (b?.startingPrice == null ? 1 : 0)
          || Number(a?.startingPrice ?? 0) - Number(b?.startingPrice ?? 0)
          || aStart.getTime() - bStart.getTime();
      case 'price_desc':
        return (a?.startingPrice == null ? 1 : 0) - (b?.startingPrice == null ? 1 : 0)
          || Number(b?.startingPrice ?? 0) - Number(a?.startingPrice ?? 0)
          || aStart.getTime() - bStart.getTime();
      case 'earliest':
      case 'date_earliest':
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
