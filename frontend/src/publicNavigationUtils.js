const serviceCategoryTranslationKeys = Object.freeze({
  'catering-services': 'nav.services.cateringServices',
  catering: 'nav.vendorCategories.catering',
  'photography-videography': 'nav.services.photographyVideography',
  'photography-and-videography': 'nav.services.photographyVideography',
  photography: 'nav.vendorCategories.photography',
  'decoration-florists': 'nav.services.decorationFlorists',
  'decoration-and-florists': 'nav.services.decorationFlorists',
  decoration: 'nav.vendorCategories.decoration',
  'wedding-planning': 'nav.services.weddingPlanning',
  'venue-event-spaces': 'nav.services.venueEventSpaces',
  'venue-and-event-spaces': 'nav.services.venueEventSpaces',
  'wedding-venues': 'nav.services.venueEventSpaces',
  'music-entertainment': 'nav.services.musicEntertainment',
  'music-and-entertainment': 'nav.services.musicEntertainment',
  entertainment: 'nav.services.musicEntertainment',
  'sound-lighting': 'nav.services.soundLighting',
  transportation: 'nav.services.transportation',
  'makeup-beauty': 'nav.services.makeupBeauty',
  'rental-equipment': 'nav.services.rentalEquipment',
  'cakes-bakery': 'nav.services.cakesBakery',
  'cakes-and-bakery': 'nav.services.cakesBakery',
  'printing-invitations': 'nav.services.printingInvitations',
  'printing-and-invitations': 'nav.services.printingInvitations',
  'security-services': 'nav.services.securityServices',
  'other-services': 'nav.services.otherServices',
});

const eventCategoryTranslationKeys = Object.freeze({
  wedding: 'nav.eventCategories.wedding',
  weddings: 'nav.eventCategories.wedding',
  birthday: 'nav.eventCategories.birthday',
  birthdays: 'nav.eventCategories.birthday',
  graduation: 'nav.eventCategories.graduation',
  graduations: 'nav.eventCategories.graduation',
  conference: 'nav.eventCategories.conference',
  conferences: 'nav.eventCategories.conference',
  'corporate-events': 'nav.eventCategories.corporateEvents',
  'concerts-music': 'nav.eventCategories.concertsMusic',
  festivals: 'nav.eventCategories.festivals',
  'religious-events': 'nav.eventCategories.religiousEvents',
  'cultural-events': 'nav.eventCategories.culturalEvents',
  'workshops-training': 'nav.eventCategories.workshopsTraining',
  'sports-events': 'nav.eventCategories.sportsEvents',
  exhibitions: 'nav.eventCategories.exhibitions',
});

function categoryTranslationKey(pathPrefix, slug) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  return pathPrefix === 'service' || pathPrefix === 'vendor'
    ? serviceCategoryTranslationKeys[normalizedSlug]
    : eventCategoryTranslationKeys[normalizedSlug];
}

function categoryLink(category, pathPrefix, countField) {
  const slug = category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const item = {
    key: `${pathPrefix}-${category.id || slug}`,
    label: category.name,
    translationKey: categoryTranslationKey(pathPrefix, slug),
    slug,
    path: pathPrefix === 'category'
      ? `/categories/${encodeURIComponent(slug)}`
      : pathPrefix === 'event'
        ? `/events?category=${encodeURIComponent(category.slug || slug)}`
        : pathPrefix === 'vendor'
          ? `/vendors?category=${encodeURIComponent(slug)}`
          : `/services?category=${encodeURIComponent(slug)}`,
    icon: category.icon || category.image || null,
  };
  const count = category[countField] ?? (countField === 'vendorCount'
    ? category.vendor_count
    : countField === 'serviceCount' ? category.service_count : undefined);
  if (countField && Number.isFinite(Number(count))) {
    item.count = Number(count);
  }
  const children = Array.isArray(category.children) ? category.children.map((child) => ({
    key: `${pathPrefix}-child-${child.id || child.slug}`,
    label: child.name,
    title: child.name,
    translationKey: categoryTranslationKey(pathPrefix, child.slug || child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
    path: pathPrefix === 'category'
      ? `/categories/${encodeURIComponent(child.slug || child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`
      : pathPrefix === 'event'
        ? `/events?category=${encodeURIComponent(child.slug || child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`
        : pathPrefix === 'vendor'
          ? `/vendors?category=${encodeURIComponent(child.slug || child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`
          : `/services?category=${encodeURIComponent(child.slug || child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`,
  })) : [];
  return { ...item, title: category.name, children };
}

function buildServiceNavigationItems(categories = []) {
  const allServices = { key: 'all-services', label: 'All Services', translationKey: 'nav.services.all', path: '/services', fixed: true };
  const seen = new Set();
  const serviceItems = categories
    .filter((category) => category?.isActive !== false)
    .sort((left, right) => Number(left.serviceMenuOrder || 0) - Number(right.serviceMenuOrder || 0))
    .filter((category) => {
      const key = String(category.slug || category.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((category) => ({ ...categoryLink(category, 'service', 'serviceCount'), database: true }));
  return [allServices, ...serviceItems];
}

export function buildPublicNavigationMenu(categories = [], eventCategories = [], user = null, serviceCategories = []) {
  const seenEventCategories = new Set();
  const eventItems = eventCategories
    .filter((item) => {
      const name = String(item?.name || '').trim();
      const normalizedName = name.toLocaleLowerCase();
      if (!name || seenEventCategories.has(normalizedName)) return false;
      seenEventCategories.add(normalizedName);
      return true;
    })
    .map((item) => categoryLink(item, 'event', 'total'));
  const serviceItems = buildServiceNavigationItems(serviceCategories);
  const seenVendorCategories = new Set();
  const vendorItems = categories
    .filter((item) => {
      const name = String(item?.name || '').trim();
      const slug = String(item?.slug || '').trim();
      const key = name.toLocaleLowerCase();
      if (!name || seenVendorCategories.has(key)) return false;
      seenVendorCategories.add(key);
      return true;
    })
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    .map((item) => categoryLink(item, 'vendor', 'vendorCount'));
  const menu = [
    { key: 'home', label: 'Home', translationKey: 'nav.home', path: '/' },
    { key: 'events', label: 'Events', translationKey: 'nav.events', path: '/events', children: [
      { key: 'browse-events', label: 'Browse Events', translationKey: 'nav.events.browse', path: '/events', fixed: true },
      { key: 'upcoming-events', label: 'Upcoming Events', translationKey: 'nav.events.upcoming', path: '/events?filter=upcoming' },
      { key: 'free-events', label: 'Free Events', translationKey: 'nav.events.free', path: '/events?filter=free' },
      { key: 'featured-events', label: 'Featured Events', translationKey: 'nav.events.featured', path: '/events?filter=featured' },
      { key: 'popular-events', label: 'Popular Events', translationKey: 'nav.events.popular', path: '/events?sort=popular' },
      { key: 'recent-events', label: 'Recently Added Events', translationKey: 'nav.events.recent', path: '/events?sort=newest' },
    ] },
    { key: 'vendors', label: 'Find Vendors', translationKey: 'nav.vendors', path: '/vendors', children: [
      { key: 'browse-vendors', label: 'Browse All Vendors', translationKey: 'nav.vendors.browseAll', path: '/vendors', fixed: true },
      { key: 'verified-vendors', label: 'Verified Vendors', translationKey: 'nav.vendors.verified', path: '/vendors?verified=true' },
      { key: 'popular-vendors', label: 'Popular Vendors', translationKey: 'nav.vendors.popular', path: '/vendors?sort=popular' },
      { key: 'featured-vendors', label: 'Featured Vendors', translationKey: 'nav.vendors.featured', path: '/vendors?filter=featured' },
      { key: 'recent-vendors', label: 'Newly Registered Vendors', translationKey: 'nav.vendors.newlyRegistered', path: '/vendors?sort=recently-added' },
      {
        key: 'vendor-categories',
        label: 'Vendor Categories',
        translationKey: 'nav.vendors.categories',
        path: '/vendors',
        expandable: true,
        children: vendorItems.map((item) => ({ ...item, database: true })),
      },
    ] },
    { key: 'services', label: 'Services', translationKey: 'nav.services', path: '/services', children: [
      ...serviceItems,
    ] },
    { key: 'categories', label: 'Categories', translationKey: 'nav.categories', path: '/categories', children: [
      ...eventItems.map((item) => ({ ...item, database: true })),
    ] },
    { key: 'discover', label: 'Discover', translationKey: 'nav.discover', path: '/calendar', icon: 'compass', children: [
      { key: 'discover-popular-events', label: 'Popular Events', translationKey: 'nav.discover.popularEvents', path: '/events?sort=popular', icon: 'trending-up' },
      { key: 'discover-featured-events', label: 'Featured Events', translationKey: 'nav.discover.featuredEvents', path: '/events?filter=featured', icon: 'star' },
      { key: 'discover-popular-vendors', label: 'Popular Vendors', translationKey: 'nav.discover.popularVendors', path: '/vendors?sort=popular', icon: 'store' },
      { key: 'discover-featured-vendors', label: 'Featured Vendors', translationKey: 'nav.discover.featuredVendors', path: '/vendors?filter=featured', icon: 'star' },
      { key: 'discover-popular-services', label: 'Popular Services', translationKey: 'nav.discover.popularServices', path: '/services?sort=popular', icon: 'trending-up' },
      { key: 'discover-popular-venues', label: 'Popular Venues', translationKey: 'nav.discover.popularVenues', path: '/venues', icon: 'building' },
      { key: 'discover-event-calendar', label: 'Event Calendar', translationKey: 'nav.discover.eventCalendar', description: 'Explore events by date', path: '/calendar', icon: 'calendar-days' },
      { key: 'discover-recent-events', label: 'Recently Added Events', translationKey: 'nav.discover.recentEvents', path: '/events?sort=newest', icon: 'clock' },
      { key: 'discover-recommended-events', label: 'Recommended Events', translationKey: 'nav.discover.recommendedEvents', path: '/recommendations', icon: 'sparkles' },
      { key: 'discover-explore-all', label: 'Explore All', translationKey: 'nav.discover.exploreAll', path: '/events', icon: 'compass' },
    ] },
    {
      key: 'about',
      label: 'About Us',
      translationKey: 'nav.aboutUs',
      path: '/about',
      children: [
        { key: 'about-mission-vision', label: 'Our Mission & Vision', translationKey: 'nav.about.missionVision', path: '/about/mission-vision' },
        { key: 'about-how-it-works', label: 'How EventHub Works', translationKey: 'nav.about.howItWorks', path: '/about/how-it-works' },
        { key: 'about-why-choose', label: 'Why Choose EventHub', translationKey: 'nav.about.whyChoose', path: '/about/why-choose' },
        { key: 'about-our-team', label: 'Our Team', translationKey: 'nav.about.team', path: '/about/team' },
        { key: 'about-our-partners', label: 'Our Partners', translationKey: 'nav.about.partners', path: '/about/partners' },
        { key: 'about-success-stories', label: 'Success Stories', translationKey: 'nav.about.successStories', path: '/about/success-stories' },
        { key: 'about-faqs', label: 'FAQs', translationKey: 'nav.about.faqs', path: '/about/faqs' },
      ],
    },
    { key: 'contact', label: 'Contact Us', translationKey: 'nav.contactUs', path: '/contact' },
  ];
  return menu;
}

export function routeIsActive(path, routePath) {
  if (typeof path !== 'string' || typeof routePath !== 'string') return false;
  const target = new URL(path, 'https://eventhub.invalid');
  const current = new URL(routePath, 'https://eventhub.invalid');
  if (target.pathname !== current.pathname
    && (target.pathname === '/' || !current.pathname.startsWith(`${target.pathname}/`))) return false;
  const targetParams = target.searchParams;
  const currentParams = current.searchParams;
  for (const [key, value] of targetParams) {
    if (currentParams.get(key) !== value) return false;
  }
  return true;
}

export function updateOpenMenuPath(current, path) {
  if (path === 'parent') return current.slice(0, -1);
  if (!path) return [];
  const level = Number(path.split(':')[0]);
  return current.includes(path)
    ? current
    : [...current.filter((entry) => Number(entry.split(':')[0]) < level), path];
}

export function navigateAndCloseMenu(path, close, onNavigate) {
  close();
  onNavigate(path);
}

export function validateCategoryName(value) {
  const name = String(value ?? '').trim();
  if (name.length < 3) return 'Category name must be at least 3 characters.';
  if (name.length > 60) return 'Category name must be 60 characters or fewer.';
  if (!/\p{L}/u.test(name)) return 'Category name must contain at least one letter.';
  if (/(.)\1{3,}/u.test(name)) return 'Category name cannot contain more than 3 identical characters in a row.';
  return '';
}

export function getListingFiltersFromPath(path = '') {
  const query = String(path).split('?')[1] || '';
  const params = new URLSearchParams(query);
  const filter = params.get('filter') || '';
  return {
    search: params.get('search') || params.get('q') || '',
    category: params.get('category') || '',
    location: params.get('location') || '',
    startDate: params.get('startDate') || '',
    endDate: params.get('endDate') || '',
    datePreset: params.get('datePreset') || '',
    minPrice: params.get('minPrice') || '',
    maxPrice: params.get('maxPrice') || '',
    status: params.get('status') || (['upcoming', 'free'].includes(filter) ? filter : ['featured'].includes(filter) ? '' : filter),
    filter,
    sort: params.get('sort') || 'upcoming',
    priceFilter: params.get('priceFilter') || '',
    page: Math.max(1, Number(params.get('page')) || 1),
    limit: Math.min(50, Math.max(1, Math.floor(Number(params.get('limit')) || 6))),
  };
}
