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
import { translate } from '../src/language.js';

test('builds public navigation with database-backed categories and supported feature routes', () => {
  const menu = buildPublicNavigationMenu(
    [{ id: 3, name: 'Catering', slug: 'catering', vendorCount: 2, serviceCount: 4 }],
    [{ id: 'Weddings', name: 'Weddings', total: 3 }],
  );
  assert.deepEqual(menu.map((item) => item.label), [
    'Home', 'Events', 'Find Vendors', 'Services', 'Categories', 'Discover', 'About Us', 'Contact Us',
  ]);
  assert.ok(menu.find((item) => item.key === 'events').children.some((item) => item.path === '/events?category=weddings'));
  assert.ok(menu.find((item) => item.key === 'vendors').children.some((item) => item.path === '/vendors?category=Catering'));
  assert.ok(menu.find((item) => item.key === 'services').children.some((item) => item.path === '/services?category=Catering'));
  assert.ok(menu.find((item) => item.key === 'categories').children.some((item) => item.path === '/categories/catering'));
  assert.equal(menu.find((item) => item.key === 'events').children[0].path, '/events');
  assert.equal(menu.find((item) => item.key === 'vendors').children[0].path, '/vendors');
  assert.equal(menu.find((item) => item.key === 'services').children[0].path, '/services');
  assert.equal(menu.find((item) => item.key === 'services').children.some((item) => item.label === 'Service Categories'), false);
  assert.deepEqual(menu.find((item) => item.key === 'discover').children.map((item) => [item.label, item.path]), [
    ['Event Calendar', '/calendar'],
    ['Compare Vendors', '/compare'],
    ['Recently Viewed', '/recently-viewed'],
  ]);
  const about = menu.find((item) => item.key === 'about');
  assert.equal(about.labelLink, true);
  assert.equal(about.path, '/about');
  assert.deepEqual(about.children.map((item) => [item.label, item.path]), [
    ['About EventHub', '/about'],
    ['Help & Support', '/help'],
    ['Privacy Policy', '/privacy'],
    ['Terms and Conditions', '/terms'],
  ]);
  assert.deepEqual(about.children.map((item) => item.groupHeading || ''), [
    'publicNavAboutGroup', 'publicNavSupportGroup', 'publicNavLegalGroup', '',
  ]);
  assert.equal(about.children.some((item) => item.label === 'Contact Us'), false);
  for (const key of ['events', 'vendors', 'services', 'categories']) {
    const children = menu.find((item) => item.key === key).children;
    const entryPoints = children.filter((item) => /^(Browse|View All)\b/.test(item.label));
    assert.equal(entryPoints.length, 1, `${key} should have one Browse/View All entry`);
  }
});

test('gates customer-only navigation items while retaining public comparison and discovery', () => {
  const guestMenu = buildPublicNavigationMenu();
  assert.equal(guestMenu.some((item) => item.key === 'my-eventhub'), false);
  const customerMenu = buildPublicNavigationMenu([], [], { role: 'customer' });
  const accountMenu = customerMenu.find((item) => item.key === 'my-eventhub');
  assert.deepEqual(accountMenu.children.map((item) => item.path), [
    '/my-bookings', '/my-favorites', '/recommendations', '/customer/dashboard?view=notifications',
  ]);
  assert.ok(customerMenu.some((item) => item.key === 'discover'));
});

test('preserves database category children as a second menu level', () => {
  const menu = buildPublicNavigationMenu([{
    id: 4,
    name: 'Food',
    slug: 'food',
    vendorCount: 1,
    children: [{ id: 8, name: 'Catering', slug: 'catering' }],
  }]);
  const vendorCategory = menu.find((item) => item.key === 'vendors').children.find((item) => item.label === 'Food');
  assert.equal(vendorCategory.children[0].path, '/vendors?category=Catering');
});

test('hides empty vendor and service categories and limits each dynamic menu to six', () => {
  const categories = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    name: `Category ${index + 1}`,
    slug: `category-${index + 1}`,
    vendorCount: index === 7 ? 0 : 7 - index,
    serviceCount: index === 0 ? 0 : 8 - index,
  }));
  categories.push({ id: 9, name: 'Unused', slug: 'unused', vendorCount: 0, serviceCount: 0 });
  const menu = buildPublicNavigationMenu(categories);
  const vendors = menu.find((item) => item.key === 'vendors').children;
  const services = menu.find((item) => item.key === 'services').children;
  assert.equal(vendors.length, 7);
  assert.equal(services.length, 7);
  assert.equal(vendors.some((item) => item.label === 'Category 8' || item.label === 'Unused'), false);
  assert.equal(services.some((item) => item.label === 'Category 1' || item.label === 'Unused'), false);
});

test('shows six categories ordered by combined listing count with their available image icons', () => {
  const categories = [
    { id: 1, name: 'Smaller', slug: 'smaller', vendorCount: 1, serviceCount: 0 },
    { id: 2, name: 'Popular', slug: 'popular', vendorCount: 5, serviceCount: 9, image: '/images/popular.webp' },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: index + 3,
      name: `Category ${index + 1}`,
      slug: `category-${index + 1}`,
      vendorCount: 3,
      serviceCount: 0,
    })),
  ];
  const menu = buildPublicNavigationMenu(categories);
  const categoryItems = menu.find((item) => item.key === 'categories').children;
  assert.equal(categoryItems.length, 7);
  assert.deepEqual(categoryItems.slice(0, 6).map((item) => item.label), [
    'Popular', 'Category 1', 'Category 2', 'Category 3', 'Category 4', 'Category 5',
  ]);
  assert.equal(categoryItems[0].icon, '/images/popular.webp');
  assert.equal(categoryItems[0].path, '/categories/popular');
  assert.equal(categoryItems[6].label, 'View All Categories');
  assert.equal(categoryItems[6].path, '/categories');
});

test('omits empty event categories without adding an empty-state menu item', () => {
  const menu = buildPublicNavigationMenu([], []);
  const events = menu.find((item) => item.key === 'events').children;
  assert.deepEqual(events.map((item) => item.label), ['Browse Events', 'Upcoming Events', 'Free Events']);
  assert.equal(events.some((item) => /No categories available/i.test(item.label)), false);
});

test('translates About menu group headings in English and Amharic', () => {
  assert.deepEqual(
    ['publicNavAboutGroup', 'publicNavSupportGroup', 'publicNavLegalGroup'].map((key) => translate(key, 'en')),
    ['About', 'Support', 'Legal'],
  );
  assert.deepEqual(
    ['publicNavAboutGroup', 'publicNavSupportGroup', 'publicNavLegalGroup'].map((key) => translate(key, 'am')),
    ['ስለ እኛ', 'ድጋፍ', 'ሕጋዊ'],
  );
});

test('marks parent routes active and matches child filters precisely', () => {
  assert.equal(routeIsActive('/events', '/events?status=free'), true);
  assert.equal(routeIsActive('/events', '/events/12'), true);
  assert.equal(routeIsActive('/events', '/services'), false);
  assert.equal(routeIsActive('/events?category=weddings', '/events?category=weddings'), true);
  assert.equal(routeIsActive('/events?category=weddings', '/events?category=concerts'), false);
  assert.equal(routeIsActive('/events?status=free', '/events?status=upcoming'), false);
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
  assert.ok(about.children.some((item) => routeIsActive(item.path, '/help')));
  assert.equal(about.children.some((item) => routeIsActive(item.path, '/contact')), false);
  assert.ok(about.children.some((item) => routeIsActive(item.path, '/privacy')));
  assert.ok(about.children.some((item) => routeIsActive(item.path, '/terms')));
});

test('reads category links into listing filters and validates category names', () => {
  assert.deepEqual(getListingFiltersFromPath('/vendors?category=Wedding%20Venues'), {
    search: '', category: 'Wedding Venues', location: '', startDate: '', endDate: '',
    minPrice: '', maxPrice: '', status: '', sort: 'upcoming', page: 1, limit: 6,
  });
  assert.equal(getListingFiltersFromPath('/events?status=upcoming').status, 'upcoming');
  assert.equal(getListingFiltersFromPath('/events?status=free').status, 'free');
  assert.equal(validateCategoryName('  Café  '), '');
  assert.match(validateCategoryName('ss'), /at least 3/);
  assert.match(validateCategoryName('sssssss'), /identical characters/);
  assert.match(validateCategoryName('123'), /at least one letter/);
  assert.match(validateCategoryName('a'.repeat(61)), /60 characters/);
});
