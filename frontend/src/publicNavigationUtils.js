function categoryLink(category, pathPrefix, countField) {
  const slug = category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const item = {
    key: `${pathPrefix}-${category.id || slug}`,
    label: category.name,
    path: pathPrefix === 'category'
      ? `/categories/${encodeURIComponent(slug)}`
      : pathPrefix === 'event'
        ? `/events?category=${encodeURIComponent(category.name.toLowerCase())}`
        : `/${pathPrefix === 'vendor' ? 'vendors' : 'services'}?category=${encodeURIComponent(category.name)}`,
    icon: category.image || null,
  };
  if (countField && Number.isFinite(Number(category[countField]))) {
    item.count = Number(category[countField]);
  }
  const children = Array.isArray(category.children) ? category.children.map((child) => ({
    key: `${pathPrefix}-child-${child.id || child.slug}`,
    label: child.name,
    title: child.name,
    path: pathPrefix === 'category'
      ? `/categories/${encodeURIComponent(child.slug || child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`
      : pathPrefix === 'event'
        ? `/events?category=${encodeURIComponent(child.name.toLowerCase())}`
        : `/${pathPrefix === 'vendor' ? 'vendors' : 'services'}?category=${encodeURIComponent(child.name)}`,
  })) : [];
  return { ...item, title: category.name, children };
}

export function buildPublicNavigationMenu(categories = [], eventCategories = [], user = null) {
  const eventItems = eventCategories.slice(0, 5).map((item) => categoryLink(item, 'event'));
  const serviceItems = categories
    .filter((item) => Number(item.serviceCount) > 0)
    .slice(0, 6)
    .map((item) => categoryLink(item, 'service', 'serviceCount'));
  const vendorItems = categories
    .filter((item) => Number(item.vendorCount) > 0)
    .slice(0, 6)
    .map((item) => categoryLink(item, 'vendor', 'vendorCount'));
  const popularCategories = [...categories]
    .sort((left, right) => ((Number(right.vendorCount) || 0) + (Number(right.serviceCount) || 0))
      - ((Number(left.vendorCount) || 0) + (Number(left.serviceCount) || 0)))
    .slice(0, 6)
    .map((item) => categoryLink(item, 'category'));
  const menu = [
    { key: 'home', label: 'Home', path: '/' },
    { key: 'events', label: 'Events', path: '/events', children: [
      { key: 'browse-events', label: 'Browse Events', path: '/events', fixed: true },
      { key: 'upcoming-events', label: 'Upcoming Events', path: '/events?status=upcoming' },
      { key: 'free-events', label: 'Free Events', path: '/events?status=free' },
      ...eventItems.map((item) => ({ ...item, database: true })),
    ] },
    { key: 'vendors', label: 'Find Vendors', path: '/vendors', children: [
      { key: 'browse-vendors', label: 'Browse Vendors', path: '/vendors', fixed: true },
      ...vendorItems.map((item) => ({ ...item, database: true })),
    ] },
    { key: 'services', label: 'Services', path: '/services', children: [
      { key: 'browse-services', label: 'Browse Services', path: '/services', fixed: true },
      ...serviceItems.map((item) => ({ ...item, database: true })),
    ] },
    { key: 'categories', label: 'Categories', path: '/categories', children: [
      ...popularCategories.map((item) => ({ ...item, database: true })),
      { key: 'all-categories', label: 'View All Categories', path: '/categories', footer: true },
    ] },
    { key: 'discover', label: 'Discover', path: '/calendar', icon: 'compass', children: [
      { key: 'event-calendar', label: 'Event Calendar', description: 'Explore events by date', path: '/calendar', icon: 'calendar' },
      { key: 'compare-vendors', label: 'Compare Vendors', description: 'Compare your shortlist', path: '/compare', icon: 'compare' },
      { key: 'recently-viewed', label: 'Recently Viewed', description: 'Return to events and vendors', path: '/recently-viewed', icon: 'history' },
    ] },
    {
      key: 'about',
      label: 'About Us',
      path: '/about',
      labelLink: true,
      children: [
        { key: 'about-eventhub', label: 'About EventHub', path: '/about', groupHeading: 'publicNavAboutGroup' },
        { key: 'help-center', label: 'Help & Support', path: '/help', groupHeading: 'publicNavSupportGroup' },
        { key: 'privacy-policy', label: 'Privacy Policy', path: '/privacy', groupHeading: 'publicNavLegalGroup' },
        { key: 'terms-conditions', label: 'Terms and Conditions', path: '/terms' },
      ],
    },
    { key: 'contact', label: 'Contact Us', path: '/contact' },
  ];
  if (user?.role === 'customer') {
    menu.splice(menu.length - 1, 0, {
      key: 'my-eventhub',
      label: 'My EventHub',
      path: '/my-bookings',
      children: [
        { key: 'my-bookings', label: 'My Bookings', path: '/my-bookings', icon: 'ticket' },
        { key: 'my-favorites', label: 'My Favorites', path: '/my-favorites', icon: 'heart' },
        { key: 'my-recommendations', label: 'For You', path: '/recommendations', icon: 'sparkles' },
        { key: 'my-notifications', label: 'Notifications', path: '/customer/dashboard?view=notifications', icon: 'bell' },
      ],
    });
  }
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
  return {
    search: params.get('search') || params.get('q') || '',
    category: params.get('category') || '',
    location: params.get('location') || '',
    startDate: params.get('startDate') || '',
    endDate: params.get('endDate') || '',
    minPrice: params.get('minPrice') || '',
    maxPrice: params.get('maxPrice') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || 'upcoming',
    page: Math.max(1, Number(params.get('page')) || 1),
    limit: Math.min(50, Math.max(1, Math.floor(Number(params.get('limit')) || 6))),
  };
}
