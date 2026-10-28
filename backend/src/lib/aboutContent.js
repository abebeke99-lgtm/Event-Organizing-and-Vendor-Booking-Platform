export function normalizeText(value, fallback = '') {
  const text = String(value ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function normalizeAboutRecord(record = {}) {
  const heroHeading = normalizeText(record.hero_heading, 'About EventHub');
  const heroSubtitle = normalizeText(record.hero_subtitle, 'Your trusted platform for planning and organizing memorable events.');
  const introduction = normalizeText(record.introduction, 'EventHub helps customers discover ready-to-book event services and connect with the right vendors for their plans.');
  const mission = normalizeText(record.mission, 'Simplify event planning by helping customers discover relevant vendors and service categories with confidence.');
  const vision = normalizeText(record.vision, 'Make service discovery and coordination more accessible, practical, and reliable for every event experience.');

  const cleanArray = (value, fallback = []) => Array.isArray(value) ? value
    .map((entry) => ({
      title: normalizeText(entry?.title, 'Value'),
      description: normalizeText(entry?.description, 'A platform value for reliable event planning.'),
      icon: normalizeText(entry?.icon, ''),
    }))
    .filter((entry) => entry.title || entry.description) : fallback;

  const values = cleanArray(record.values, [
    { title: 'Trust and Transparency', description: 'Clear service information and direct coordination.', icon: 'shield' },
    { title: 'Quality Service', description: 'Access to vetted and relevant service providers.', icon: 'sparkles' },
    { title: 'Customer Satisfaction', description: 'A faster, organized journey from discovery to booking.', icon: 'star' },
  ]);

  const benefits = cleanArray(record.benefits, [
    'Easier vendor discovery',
    'Visible category-based browsing',
    'Convenient quotation requests',
    'A centralized event-service experience',
  ]).map((entry) => (typeof entry === 'string' ? { title: entry, description: entry } : entry));

  const steps = cleanArray(record.steps, [
    { title: 'Explore categories', description: 'Browse categories and service groups.' },
    { title: 'Find vendors', description: 'Compare service providers and package details.' },
    { title: 'Request quotations', description: 'Submit enquiry and booking requests through the platform.' },
  ]);

  return {
    page_title: normalizeText(record.page_title, 'About EventHub'),
    hero_heading: heroHeading,
    hero_subtitle: heroSubtitle,
    introduction,
    mission,
    vision,
    values,
    benefits,
    steps,
    is_published: Boolean(record.is_published ?? true),
    language: normalizeText(record.language, 'en').toLowerCase().startsWith('am') ? 'am' : 'en',
    updated_at: record.updated_at || new Date().toISOString(),
  };
}

export function getAboutStatistics(catalog = {}) {
  const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  const vendors = Array.isArray(catalog.vendors) ? catalog.vendors : [];
  const services = Array.isArray(catalog.services) ? catalog.services : [];
  const bookings = Array.isArray(catalog.bookings) ? catalog.bookings : [];

  const categoryCount = categories.filter((entry) => entry && entry.isActive !== false && entry.is_active !== false).length;
  const vendorCount = vendors.filter((vendor) => vendor && vendor.verified === true && vendor.visibility !== 'private' && vendor.visibility !== 'hidden' && vendor.status === 'active' && vendor.isPublished !== false).length;
  const serviceCount = services.filter((service) => service && service.published !== false && service.visibility !== 'private' && service.visibility !== 'hidden' && service.status !== 'draft').length;
  const completedBookingCount = bookings.filter((booking) => booking && String(booking.status || '').toLowerCase() === 'completed').length;

  return {
    categoryCount,
    vendorCount,
    serviceCount,
    completedBookingCount,
  };
}

export function buildAboutPagePayload(content = {}, catalog = {}) {
  const normalized = normalizeAboutRecord(content);
  const categoryList = Array.isArray(catalog.categories) ? catalog.categories
    .filter((entry) => entry && entry.isActive !== false && entry.is_active !== false)
    .map((entry) => ({
      id: entry.id,
      name: normalizeText(entry.name, 'Category'),
      slug: normalizeText(entry.slug || entry.name, 'category'),
      description: normalizeText(entry.description, 'Category details.'),
      image: normalizeText(entry.image, 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80'),
    })) : [];

  const base = {
    ...normalized,
    hero: {
      heading: normalized.hero_heading,
      subtitle: normalized.hero_subtitle,
    },
    categories: categoryList,
    statistics: getAboutStatistics(catalog),
  };

  return base;
}
