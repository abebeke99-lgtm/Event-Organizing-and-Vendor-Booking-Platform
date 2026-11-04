import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublicNavigationMenu,
  getListingFiltersFromPath,
  navigateAndCloseMenu,
  routeIsActive,
  updateOpenMenuPath,
  validateCategoryName,
} from '../src/publicNavigationUtils.js';

test('builds public navigation with database-backed categories and supported feature routes', () => {
  const menu = buildPublicNavigationMenu(
    [{ id: 3, name: 'Catering', slug: 'catering', vendorCount: 2, serviceCount: 4 }],
    [{ id: 14, name: 'Weddings', slug: 'weddings', total: 3 }],
    null,
    [{ id: 30, name: 'Catering Services', slug: 'catering-services', serviceCount: 4, serviceMenuOrder: 1 }],
  );
  assert.deepEqual(menu.map((item) => item.label), [
    'Home', 'Events', 'Find Vendors', 'Services', 'Categories', 'Discover', 'About Us', 'Contact Us',
  ]);
  const eventItems = menu.find((item) => item.key === 'events').children;
  const vendorItems = menu.find((item) => item.key === 'vendors').children;
  const vendorCategories = vendorItems.find((item) => item.key === 'vendor-categories').children;
  const eventCategories = menu.find((item) => item.key === 'categories').children;
  assert.ok(eventCategories.some((item) => item.path === '/events?category=weddings'));
  assert.equal(eventCategories.find((item) => item.label === 'Weddings').count, 3);
  assert.ok(vendorCategories.some((item) => item.path === '/vendors?category=catering'));
  assert.ok(menu.find((item) => item.key === 'services').children.some((item) => item.path === '/services?category=catering-services'));
  assert.deepEqual(eventItems.map((item) => item.label), [
    'Browse Events', 'Upcoming Events', 'Free Events', 'Featured Events', 'Popular Events', 'Recently Added Events',
  ]);
  assert.deepEqual(eventItems.map((item) => item.path), [
    '/events', '/events?filter=upcoming', '/events?filter=free', '/events?filter=featured',
    '/events?sort=popular', '/events?sort=newest',
  ]);
  for (const item of eventItems) assert.equal(routeIsActive(item.path, item.path), true);
  assert.equal(getListingFiltersFromPath('/events?sort=popular').sort, 'popular');
  assert.equal(getListingFiltersFromPath('/events?sort=newest').sort, 'newest');
  assert.equal(menu.find((item) => item.key === 'events').children[0].path, '/events');
  assert.deepEqual(vendorItems.map((item) => item.label), [
    'Browse All Vendors', 'Verified Vendors', 'Popular Vendors', 'Featured Vendors',
    'Newly Registered Vendors', 'Vendor Categories',
  ]);
  assert.deepEqual(vendorItems.map((item) => item.path), [
    '/vendors', '/vendors?verified=true', '/vendors?sort=popular',
    '/vendors?filter=featured', '/vendors?sort=recently-added', '/vendors',
  ]);
  assert.equal(vendorItems[0].path, '/vendors');
  assert.equal(vendorCategories[0].label, 'Catering');
  assert.equal(vendorItems[2].path, '/vendors?sort=popular');
  assert.equal(menu.find((item) => item.key === 'services').children[0].path, '/services');
  assert.equal(menu.find((item) => item.key === 'services').children.some((item) => item.label === 'Service Categories'), false);
  const discoverItems = menu.find((item) => item.key === 'discover').children;
  assert.deepEqual(discoverItems.map((item) => item.label), [
    'Popular Events', 'Featured Events', 'Popular Vendors', 'Featured Vendors', 'Popular Services',
    'Popular Venues', 'Event Calendar', 'Recently Added Events', 'Recommended Events', 'Explore All',
  ]);
  assert.deepEqual(discoverItems.map((item) => item.path), [
    '/events?sort=popular',
    '/events?filter=featured',
    '/vendors?sort=popular',
    '/vendors?filter=featured',
    '/services?sort=popular',
    '/venues',
    '/calendar',
    '/events?sort=newest',
    '/recommendations',
    '/events',
  ]);
  for (const item of discoverItems) assert.equal(routeIsActive(item.path, item.path), true, item.label);
  const about = menu.find((item) => item.key === 'about');
  assert.equal(about.labelLink, undefined);
  assert.equal(about.path, '/about');
  assert.deepEqual(about.children.map((item) => [item.label, item.path]), [
    ['About EventHub', '/about'],
    ['Our Mission & Vision', '/about?section=mission-vision'],
    ['How EventHub Works', '/about?section=how-it-works'],
    ['Why Choose EventHub', '/about?section=why-choose-eventhub'],
    ['Our Team', '/about?section=our-team'],
    ['Our Partners', '/about?section=our-partners'],
    ['Success Stories', '/about?section=success-stories'],
    ['FAQs', '/about?section=faqs'],
  ]);
  assert.deepEqual(menu.map((item) => item.path), [
    '/', '/events', '/vendors', '/services', '/categories', '/calendar', '/about', '/contact',
  ]);
  assert.equal(menu.find((item) => item.key === 'contact').children, undefined);
  assert.equal(menu.find((item) => item.key === 'home').children, undefined);
});

test('keeps exactly eight top-level navigation items for guests and every signed-in role', () => {
  const guestMenu = buildPublicNavigationMenu();
  const expectedItems = [
    'Home', 'Events', 'Find Vendors', 'Services', 'Categories', 'Discover', 'About Us', 'Contact Us',
  ];
  assert.deepEqual(guestMenu.map((item) => item.label), expectedItems);
  for (const role of ['customer', 'organizer', 'vendor', 'admin']) {
    const menu = buildPublicNavigationMenu([], [], { role });
    assert.deepEqual(menu.map((item) => item.label), expectedItems);
    assert.deepEqual(menu.map((item) => item.key), guestMenu.map((item) => item.key));
    assert.equal(menu.filter((item) => item.path === '/').length, 1);
  }
});

test('Home is a single top-level link and is active only on the homepage route', () => {
  const menu = buildPublicNavigationMenu();
  assert.equal(menu.filter((item) => item.path === '/').length, 1);
  assert.equal(routeIsActive('/', '/'), true);
  assert.equal(routeIsActive('/', '/?source=logo'), true);
  assert.equal(routeIsActive('/', '/events'), false);
  assert.equal(routeIsActive('/', '/events/123'), false);
});

test('Contact Us navigates to and stays active on the Contact page', () => {
  const menu = buildPublicNavigationMenu();
  const contactLink = menu.find((item) => item.key === 'contact');

  assert.equal(contactLink.path, '/contact');
  assert.equal(routeIsActive(contactLink.path, '/contact'), true);
  assert.equal(routeIsActive(contactLink.path, '/contact?vendor=Example'), true);
  assert.equal(routeIsActive(contactLink.path, '/about'), false);
});

test('keeps vendor categories nested below Vendor Categories', () => {
  const menu = buildPublicNavigationMenu([{
    id: 4, name: 'Catering', slug: 'catering', vendorCount: 1,
  }]);
  const vendorItems = menu.find((item) => item.key === 'vendors').children;
  const vendorCategories = vendorItems.find((item) => item.key === 'vendor-categories');
  assert.deepEqual(vendorItems.map((item) => item.label), [
    'Browse All Vendors', 'Verified Vendors', 'Popular Vendors', 'Featured Vendors',
    'Newly Registered Vendors', 'Vendor Categories',
  ]);
  assert.equal(vendorCategories.children[0].label, 'Catering');
  assert.equal(vendorCategories.children[0].path, '/vendors?category=catering');
});

test('preserves category destinations while Discover centralizes existing listing routes', () => {
  const menu = buildPublicNavigationMenu(
    [{ id: 4, name: 'Catering', slug: 'catering', vendorCount: 1 }],
    [{ id: 14, name: 'Weddings', slug: 'weddings', total: 3 }],
    null,
    [{ id: 30, name: 'Catering Services', slug: 'catering-services', serviceCount: 4, serviceMenuOrder: 1 }],
  );
  const destinationOwners = new Map();
  for (const parent of menu) {
    if (parent.key === 'discover') continue;
    const visit = (item) => {
      if (item.path) {
        const owner = destinationOwners.get(item.path);
        assert.ok(!owner || owner === parent.key, `${item.path} appears under unrelated menus ${owner} and ${parent.key}`);
        destinationOwners.set(item.path, parent.key);
      }
      item.children?.forEach(visit);
    };
    parent.children?.forEach(visit);
  }
  assert.equal(destinationOwners.get('/events?category=weddings'), 'categories');
  assert.equal(destinationOwners.get('/vendors?category=catering'), 'vendors');
  assert.equal(destinationOwners.get('/services?category=catering-services'), 'services');
});

test('Find Vendors destinations appear once, in the requested order, and activate their filters', () => {
  const menu = buildPublicNavigationMenu([
    { id: 8, name: 'Catering', slug: 'catering' },
    { id: 9, name: 'CATERING', slug: 'catering-duplicate' },
  ]);
  const vendorItems = menu.find((item) => item.key === 'vendors').children;
  assert.deepEqual(vendorItems.map((item) => item.label), [
    'Browse All Vendors', 'Verified Vendors', 'Popular Vendors', 'Featured Vendors',
    'Newly Registered Vendors', 'Vendor Categories',
  ]);
  for (const item of vendorItems.slice(0, 5)) {
    assert.equal(routeIsActive(item.path, item.path), true, item.label);
    assert.equal(vendorItems.filter((candidate) => candidate.path === item.path).length, item.path === '/vendors' ? 2 : 1);
  }
  const categoryItems = vendorItems.at(-1).children;
  assert.equal(categoryItems.length, 1);
  assert.equal(categoryItems[0].path, '/vendors?category=catering');
});

test('Services menu contains all 15 destinations in order and uses unique category slugs', () => {
  const names = [
    'Catering Services',
    'Photography & Videography',
    'Decoration & Florists',
    'Wedding Planning',
    'Venue & Event Spaces',
    'Music & Entertainment',
    'Sound & Lighting',
    'Transportation',
    'Makeup & Beauty',
    'Rental Equipment',
    'Cakes & Bakery',
    'Printing & Invitations',
    'Security Services',
    'Other Services',
  ];
  const categories = names.map((name, index) => ({
    id: index + 10,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    serviceCount: index,
    serviceMenuOrder: index + 1,
  }));
  categories.push({ ...categories[0], id: 100, serviceMenuOrder: 20 });
  const services = buildPublicNavigationMenu([], [], null, categories)
    .find((item) => item.key === 'services').children;
  assert.deepEqual(services.map((item) => item.label), ['All Services', ...names]);
  assert.deepEqual(services.map((item) => item.path), [
    '/services',
    ...names.map((name) => `/services?category=${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`),
  ]);
  assert.equal(services[0].path, '/services');
  for (const item of services.slice(1)) {
    assert.equal(item.database, true);
    assert.equal(routeIsActive(item.path, item.path), true, item.label);
  }
});

test('preserves database category children as a second menu level', () => {
  const menu = buildPublicNavigationMenu([{
    id: 4,
    name: 'Food',
    slug: 'food',
    vendorCount: 1,
    children: [{ id: 8, name: 'Catering', slug: 'catering' }],
  }]);
  const vendorCategory = menu.find((item) => item.key === 'vendors').children.find((item) => item.label === 'Vendor Categories');
  assert.equal(vendorCategory.children[0].path, '/vendors?category=food');
  assert.equal(vendorCategory.children[0].children[0].path, '/vendors?category=catering');
});

test('shows every vendor category and service-scoped database category independently of service counts', () => {
  const categories = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    name: `Category ${index + 1}`,
    slug: `category-${index + 1}`,
    vendorCount: index === 7 ? 0 : 7 - index,
  }));
  categories.push({ id: 9, name: 'Unused', slug: 'unused', vendorCount: 0, serviceCount: 0 });
  const serviceNames = [
    'Catering Services',
    'Photography & Videography',
    'Decoration & Florists',
    'Wedding Planning',
    'Venue & Event Spaces',
    'Music & Entertainment',
    'Sound & Lighting',
    'Transportation',
    'Makeup & Beauty',
    'Rental Equipment',
    'Cakes & Bakery',
    'Printing & Invitations',
    'Security Services',
    'Other Services',
  ];
  const serviceCategories = serviceNames.map((name, index) => ({
    id: 30 + index,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    serviceCount: index === 0 ? 0 : index,
    serviceMenuOrder: index + 1,
  })).reverse();
  const menu = buildPublicNavigationMenu(categories, [], null, serviceCategories);
  const vendors = menu.find((item) => item.key === 'vendors').children;
  const services = menu.find((item) => item.key === 'services').children;
  assert.equal(vendors.length, 6);
  assert.equal(vendors[5].children.length, 9);
  assert.equal(services.length, 15);
  assert.ok(vendors[5].children.some((item) => item.label === 'Category 8' && item.count === 0));
  assert.ok(vendors[5].children.some((item) => item.label === 'Unused' && item.count === 0));
  assert.equal(services.some((item) => item.label === 'Category 1' || item.label === 'Unused'), false);
  assert.deepEqual(services.map((item) => item.label), [
    'All Services',
    ...serviceNames,
  ]);
  assert.equal(services[1].count, 0);
  assert.ok(services.slice(1).every((item, index) => item.path === `/services?category=${serviceNames[index].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`));
});

test('uses stable category slugs and database counts for service category links', () => {
  const menu = buildPublicNavigationMenu([], [], null, [
    { id: 1, name: 'Catering Services', slug: 'catering-services', serviceCount: 0, serviceMenuOrder: 1 },
    { id: 2, name: 'Photography & Videography', slug: 'photography-videography', service_count: 7, serviceMenuOrder: 2 },
    { id: 3, name: 'Decoration & Florists', slug: 'decoration-florists', serviceCount: 3, serviceMenuOrder: 3 },
    { id: 4, name: 'Other Services', slug: 'other-services', serviceCount: null, serviceMenuOrder: 14 },
  ]);
  const services = menu.find((item) => item.key === 'services').children;
  assert.equal(services[1].path, '/services?category=catering-services');
  assert.equal(services[1].count, 0);
  assert.equal(services[2].path, '/services?category=photography-videography');
  assert.equal(services[2].count, 7);
  assert.equal(services[3].path, '/services?category=decoration-florists');
  assert.equal(services[3].count, 3);
  assert.equal(services[4].path, '/services?category=other-services');
  assert.equal(Object.hasOwn(services[4], 'count'), false);
});

test('sorts vendor categories by name and accepts API snake-case counts', () => {
  const menu = buildPublicNavigationMenu([
    { id: 2, name: 'Photography', slug: 'photography', vendor_count: 12 },
    { id: 1, name: 'Catering', slug: 'catering', vendor_count: 0 },
  ]);
  const categories = menu.find((item) => item.key === 'vendors').children
    .find((item) => item.key === 'vendor-categories').children;
  assert.deepEqual(categories.map((item) => item.label), ['Catering', 'Photography']);
  assert.equal(categories[0].path, '/vendors?category=catering');
  assert.equal(categories[0].count, 0);
  assert.equal(categories[1].count, 12);
});

test('uses public event categories for Categories instead of service or vendor categories', () => {
  const categories = [
    { id: 10, name: 'Wedding', total: 4 },
    { id: 11, name: 'Birthday', total: 2 },
  ];
  const menu = buildPublicNavigationMenu([{ id: 3, name: 'Catering', slug: 'catering' }], categories);
  const categoryItems = menu.find((item) => item.key === 'categories').children;
  assert.equal(categoryItems.length, 2);
  assert.deepEqual(categoryItems.map((item) => item.label), ['Wedding', 'Birthday']);
  assert.deepEqual(categoryItems.map((item) => item.path), ['/events?category=wedding', '/events?category=birthday']);
});

test('preserves all six Events destinations when there are no event categories', () => {
  const menu = buildPublicNavigationMenu([], []);
  const events = menu.find((item) => item.key === 'events').children;
  assert.deepEqual(events.map((item) => item.label), [
    'Browse Events', 'Upcoming Events', 'Free Events', 'Featured Events', 'Popular Events', 'Recently Added Events',
  ]);
  assert.equal(events[3].path, '/events?filter=featured');
  assert.equal(events[4].path, '/events?sort=popular');
  assert.equal(events[5].path, '/events?sort=newest');
  assert.deepEqual(menu.find((item) => item.key === 'categories').children, []);
});

test('shows every unique database event category only under Categories', () => {
  const categories = Array.from({ length: 8 }, (_, index) => ({
    id: `Event ${index + 1}`,
    name: `Event ${index + 1}`,
  }));
  categories.push({ id: 'event 1', name: 'EVENT 1' });
  const menu = buildPublicNavigationMenu([], categories);
  const nested = menu.find((item) => item.key === 'categories').children;

  assert.equal(nested.length, 8);
  assert.deepEqual(nested.map((item) => item.label), categories.slice(0, 8).map((item) => item.name));
  assert.equal(nested[0].path, '/events?category=event-1');
  assert.deepEqual(menu.find((item) => item.key === 'events').children.map((item) => item.label), [
    'Browse Events', 'Upcoming Events', 'Free Events', 'Featured Events', 'Popular Events', 'Recently Added Events',
  ]);
});

test('keeps the twelve configured event categories in backend order with their counts', () => {
  const categories = [
    'Wedding', 'Birthday', 'Graduation', 'Conference', 'Corporate Events',
    'Concerts & Music', 'Festivals', 'Religious Events', 'Cultural Events',
    'Workshops & Training', 'Sports Events', 'Exhibitions',
  ].map((name, index) => ({ id: index + 10, name, total: index }));
  const menu = buildPublicNavigationMenu([], categories);
  const nested = menu.find((item) => item.key === 'categories').children;

  assert.deepEqual(nested.map((item) => item.label), categories.map((item) => item.name));
  assert.deepEqual(nested.map((item) => item.count), categories.map((item) => item.total));
  assert.deepEqual(nested.map((item) => item.path), categories.map((item) => `/events?category=${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`));
});

test('About menu shows only its requested entries without duplicate support/legal destinations', () => {
  const about = buildPublicNavigationMenu().find((item) => item.key === 'about');
  assert.deepEqual(about.children.map((item) => item.label), [
    'About EventHub', 'Our Mission & Vision', 'How EventHub Works', 'Why Choose EventHub',
    'Our Team', 'Our Partners', 'Success Stories', 'FAQs',
  ]);
  assert.deepEqual(about.children.map((item) => item.path), [
    '/about', '/about?section=mission-vision', '/about?section=how-it-works',
    '/about?section=why-choose-eventhub', '/about?section=our-team',
    '/about?section=our-partners', '/about?section=success-stories', '/about?section=faqs',
  ]);
});

test('marks parent routes active and matches child filters precisely', () => {
  assert.equal(routeIsActive('/events', '/events?status=free'), true);
  assert.equal(routeIsActive('/events', '/events/12'), true);
  assert.equal(routeIsActive('/events', '/services'), false);
  assert.equal(routeIsActive('/events?category=weddings', '/events?category=weddings'), true);
  assert.equal(routeIsActive('/events?category=weddings', '/events?category=concerts'), false);
  assert.equal(routeIsActive('/events?status=free', '/events?status=upcoming'), false);
  assert.equal(routeIsActive('/events?filter=free', '/events?filter=upcoming'), false);
});

test('menu expansion retains ancestors and supports nested close and Escape', () => {
  const top = updateOpenMenuPath([], '0:services');
  const nested = updateOpenMenuPath(top, '1:service-category');
  assert.deepEqual(nested, ['0:services', '1:service-category']);
  assert.deepEqual(updateOpenMenuPath(nested, 'parent'), ['0:services']);
  assert.deepEqual(updateOpenMenuPath(nested, ''), []);
});

test('switching top-level menus keeps only the hovered dropdown open', () => {
  const events = updateOpenMenuPath([], '0:events');
  const vendors = updateOpenMenuPath(events, '0:vendors');
  assert.deepEqual(vendors, ['0:vendors']);
});

test('one menu-link click closes the menu and navigates immediately', () => {
  let route = '/events';
  let menuOpen = true;
  const calls = [];

  navigateAndCloseMenu('/vendors', () => {
    menuOpen = false;
    calls.push('close');
  }, (path) => {
    route = path;
    calls.push('navigate');
  });

  assert.equal(route, '/vendors');
  assert.equal(menuOpen, false);
  assert.deepEqual(calls, ['close', 'navigate']);
});

test('opening About replaces the Events menu and its route descendants stay active', () => {
  const events = updateOpenMenuPath([], '0:events');
  assert.deepEqual(updateOpenMenuPath(events, '0:about'), ['0:about']);
  const about = buildPublicNavigationMenu().find((item) => item.key === 'about');
  assert.ok(about.children.some((item) => routeIsActive(item.path, '/about?section=faqs')));
  assert.ok(about.children.some((item) => routeIsActive(item.path, '/about?section=mission-vision')));
  assert.equal(about.children.some((item) => routeIsActive(item.path, '/contact')), false);
});

test('reads category links into listing filters and validates category names', () => {
  assert.deepEqual(getListingFiltersFromPath('/vendors?category=Wedding%20Venues'), {
    search: '', category: 'Wedding Venues', location: '', startDate: '', endDate: '',
    datePreset: '', minPrice: '', maxPrice: '', status: '', filter: '', sort: 'upcoming', priceFilter: '', page: 1, limit: 6,
  });
  assert.equal(getListingFiltersFromPath('/vendors?category=cake-and-bakery').category, 'cake-and-bakery');
  assert.equal(getListingFiltersFromPath('/events?status=upcoming').status, 'upcoming');
  assert.equal(getListingFiltersFromPath('/events?status=free').status, 'free');
  assert.equal(getListingFiltersFromPath('/events?filter=upcoming').status, 'upcoming');
  assert.equal(getListingFiltersFromPath('/events?filter=upcoming').filter, 'upcoming');
  assert.equal(getListingFiltersFromPath('/events?filter=upcoming&datePreset=this_week&priceFilter=free').datePreset, 'this_week');
  assert.equal(getListingFiltersFromPath('/events?filter=upcoming&datePreset=this_week&priceFilter=free').priceFilter, 'free');
  assert.equal(getListingFiltersFromPath('/events?filter=free').status, 'free');
  assert.equal(validateCategoryName('  Café  '), '');
  assert.match(validateCategoryName('ss'), /at least 3/);
  assert.match(validateCategoryName('sssssss'), /identical characters/);
  assert.match(validateCategoryName('123'), /at least one letter/);
  assert.match(validateCategoryName('a'.repeat(61)), /60 characters/);
});
