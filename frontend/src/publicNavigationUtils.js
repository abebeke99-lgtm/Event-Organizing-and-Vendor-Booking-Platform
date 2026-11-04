function categoryLink(category, pathPrefix, countField) {
  const slug = category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const item = {
    key: `${pathPrefix}-${category.id || slug}`,
    label: category.name,
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
  const allServices = { key: 'all-services', label: 'All Services', path: '/services', fixed: true };
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
    { key: 'home', label: 'Home', path: '/' },
    { key: 'events', label: 'Events', path: '/events', children: [
      { key: 'browse-events', label: 'Browse Events', path: '/events', fixed: true },
      { key: 'upcoming-events', label: 'Upcoming Events', path: '/events?filter=upcoming' },
      { key: 'free-events', label: 'Free Events', path: '/events?filter=free' },
      { key: 'featured-events', label: 'Featured Events', path: '/events?filter=featured' },
      { key: 'popular-events', label: 'Popular Events', path: '/events?sort=popular' },
      { key: 'recent-events', label: 'Recently Added Events', path: '/events?sort=newest' },
    ] },
    { key: 'vendors', label: 'Find Vendors', path: '/vendors', children: [
      { key: 'browse-vendors', label: 'Browse All Vendors', path: '/vendors', fixed: true },
      { key: 'verified-vendors', label: 'Verified Vendors', path: '/vendors?verified=true' },
      { key: 'popular-vendors', label: 'Popular Vendors', path: '/vendors?sort=popular' },
      { key: 'featured-vendors', label: 'Featured Vendors', path: '/vendors?filter=featured' },
      { key: 'recent-vendors', label: 'Newly Registered Vendors', path: '/vendors?sort=recently-added' },
      {
        key: 'vendor-categories',
        label: 'Vendor Categories',
        path: '/vendors',
        expandable: true,
        children: vendorItems.map((item) => ({ ...item, database: true })),
      },
    ] },
    { key: 'services', label: 'Services', path: '/services', children: [
      ...serviceItems,
    ] },
    { key: 'categories', label: 'Categories', path: '/categories', children: [
      ...eventItems.map((item) => ({ ...item, database: true })),
    ] },
    { key: 'discover', label: 'Discover', path: '/calendar', icon: 'compass', children: [
      { key: 'discover-popular-events', label: 'Popular Events', path: '/events?sort=popular', icon: 'trending-up' },
      { key: 'discover-featured-events', label: 'Featured Events', path: '/events?filter=featured', icon: 'star' },
      { key: 'discover-popular-vendors', label: 'Popular Vendors', path: '/vendors?sort=popular', icon: 'store' },
      { key: 'discover-featured-vendors', label: 'Featured Vendors', path: '/vendors?filter=featured', icon: 'star' },
      { key: 'discover-popular-services', label: 'Popular Services', path: '/services?sort=popular', icon: 'trending-up' },
      { key: 'discover-popular-venues', label: 'Popular Venues', path: '/venues', icon: 'building' },
      { key: 'discover-event-calendar', label: 'Event Calendar', description: 'Explore events by date', path: '/calendar', icon: 'calendar-days' },
      { key: 'discover-recent-events', label: 'Recently Added Events', path: '/events?sort=newest', icon: 'clock' },
      { key: 'discover-recommended-events', label: 'Recommended Events', path: '/recommendations', icon: 'sparkles' },
      { key: 'discover-explore-all', label: 'Explore All', path: '/events', icon: 'compass' },
    ] },
    {
      key: 'about',
      label: 'About Us',
      path: '/about',
      children: [
        { key: 'about-eventhub', label: 'About EventHub', path: '/about' },
        { key: 'about-mission-vision', label: 'Our Mission & Vision', path: '/about?section=mission-vision' },
        { key: 'about-how-it-works', label: 'How EventHub Works', path: '/about?section=how-it-works' },
        { key: 'about-why-choose', label: 'Why Choose EventHub', path: '/about?section=why-choose-eventhub' },
        { key: 'about-our-team', label: 'Our Team', path: '/about?section=our-team' },
        { key: 'about-our-partners', label: 'Our Partners', path: '/about?section=our-partners' },
        { key: 'about-success-stories', label: 'Success Stories', path: '/about?section=success-stories' },
        { key: 'about-faqs', label: 'FAQs', path: '/about?section=faqs' },
      ],
    },
    { key: 'contact', label: 'Contact Us', path: '/contact' },
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
