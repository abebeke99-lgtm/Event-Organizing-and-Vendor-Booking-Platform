import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPublicEventCategoriesQuery, buildPublicEventListingQuery, listPublicEvents, getPublicEventById, getPublicCategories, mapDatabaseEvent, resolveEventCategoryFilter } from '../src/lib/eventCatalog.js';
import { createEventSchema, toMysqlDateTime } from '../src/lib/eventInput.js';

const sampleEvents = [
  {
    id: 1,
    title: 'Addis Jazz Festival',
    description: 'Live jazz experience in the capital city.',
    category: 'music',
    location: 'Addis Ababa',
    startDate: '2026-11-18T18:00:00',
    status: 'active',
    published: true,
    visibility: 'public',
  },
  {
    id: 2,
    title: 'Wedding Weekend in Bahir Dar',
    description: 'A destination wedding with full vendor coordination.',
    category: 'wedding',
    location: 'Bahir Dar',
    startDate: '2026-11-12T10:00:00',
    status: 'active',
    published: true,
    visibility: 'public',
  },
  {
    id: 3,
    title: 'Private Gala Dinner',
    description: 'Invite-only private event with limited access.',
    category: 'private',
    location: 'Hawassa',
    startDate: '2026-10-30T19:00:00',
    status: 'draft',
    published: true,
    visibility: 'private',
  },
  {
    id: 4,
    title: 'Startup Summit',
    description: 'Startup founder summit with guest speakers.',
    category: 'conference',
    location: 'Addis Ababa',
    startDate: '2026-12-05T09:00:00',
    status: 'active',
    published: true,
    visibility: 'public',
  },
  {
    id: 5,
    title: 'Art & Culture Expo',
    description: 'A public exhibition of local culture and design.',
    category: 'exhibition',
    location: 'Dire Dawa',
    startDate: '2026-08-15T08:00:00',
    status: 'active',
    published: false,
    visibility: 'public',
  },
];

test('public event listings exclude hidden, draft and unpublished records', () => {
  const result = listPublicEvents(sampleEvents, { page: 1, limit: 10 });
  assert.equal(result.total, 3);
  assert.deepEqual(result.events.map((event) => event.id), [2, 1, 4]);
});

test('newest and oldest sorts use persisted creation timestamps, not publication dates', () => {
  const newest = buildPublicEventListingQuery({ sort: 'newest' });
  const oldest = buildPublicEventListingQuery({ sort: 'oldest' });
  assert.equal(newest.orderBy, 'e.created_at DESC, e.id DESC');
  assert.equal(oldest.orderBy, 'e.created_at ASC, e.id ASC');

  const events = [
    { id: 1, status: 'active', startDate: '2027-01-01', publishedAt: '2026-06-01', createdAt: '2026-01-02' },
    { id: 2, status: 'active', startDate: '2027-01-02', publishedAt: '2026-01-01', createdAt: '2026-02-02' },
  ];
  assert.deepEqual(listPublicEvents(events, { sort: 'newest' }).events.map((event) => event.id), [2, 1]);
  assert.deepEqual(listPublicEvents(events, { sort: 'oldest' }).events.map((event) => event.id), [1, 2]);
});

test('keyword search matches event titles and descriptions only for public records', () => {
  const result = listPublicEvents(sampleEvents, { search: 'wedding', page: 1, limit: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.events[0].title, 'Wedding Weekend in Bahir Dar');
});

test('keyword search matches category and location case-insensitively', () => {
  const byCategory = listPublicEvents(sampleEvents, { search: 'CONFERENCE', page: 1, limit: 10 });
  const byLocation = listPublicEvents(sampleEvents, { search: 'BAHIR DAR', page: 1, limit: 10 });
  assert.deepEqual(byCategory.events.map((event) => event.id), [4]);
  assert.deepEqual(byLocation.events.map((event) => event.id), [2]);
});

test('category and location filters combine with search and date filtering', () => {
  const result = listPublicEvents(sampleEvents, {
    category: 'conference',
    location: 'Addis',
    startDate: '2026-12-01',
    endDate: '2026-12-31',
    page: 1,
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.events[0].id, 4);
});

test('sort works for upcoming and alphabetical ordering', () => {
  const upcoming = listPublicEvents(sampleEvents, { sort: 'upcoming', page: 1, limit: 10 });
  const alphabetical = listPublicEvents(sampleEvents, { sort: 'alphabetical', page: 1, limit: 10 });

  assert.deepEqual(upcoming.events.map((event) => event.id), [2, 1, 4]);
  assert.deepEqual(alphabetical.events.map((event) => event.id), [1, 4, 2]);
});

test('pagination returns correct totals and page metadata', () => {
  const result = listPublicEvents(sampleEvents, { page: 2, limit: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.totalPages, 2);
  assert.equal(result.page, 2);
  assert.equal(result.events.length, 1);
});

test('event detail lookup returns only public events and rejects invalid ids', () => {
  assert.equal(getPublicEventById(sampleEvents, 3), null);
  assert.equal(getPublicEventById(sampleEvents, 1)?.title, 'Addis Jazz Festival');
  assert.equal(getPublicEventById(sampleEvents, 'abc'), null);
});

test('database event mapping uses persisted fields without invented details', () => {
  const event = mapDatabaseEvent({
    id: '42',
    title: 'Database event',
    event_type: 'Wedding',
    city: '  ',
    start_date: '2026-11-18T03:00:00',
    end_date: null,
    budget: '240000.00',
    status: 'active',
  });

  assert.deepEqual(event, {
    id: 42,
    title: 'Database event',
    description: '',
    type: 'Wedding',
    category: 'wedding',
    location: null,
    venue: null,
    startDate: '2026-11-18T03:00:00',
    endDate: null,
    budget: 240000,
    status: 'active',
    coverImage: null,
    galleryImages: [],
    capacity: null,
    organizerName: null,
    startingPrice: null,
    availableQuantity: null,
    freeAvailableQuantity: null,
    publishedAt: null,
    createdAt: null,
    isFeatured: false,
    popularityCount: 0,
  });
});

test('ticket-price and availability filters combine with safe price sorting', () => {
  const events = [
    { id: 1, title: 'Affordable', category: 'music', startDate: '2027-01-10T18:00:00', status: 'active', startingPrice: 20, availableQuantity: 10 },
    { id: 2, title: 'Premium', category: 'music', startDate: '2027-01-12T18:00:00', status: 'active', startingPrice: 80, availableQuantity: 4 },
    { id: 3, title: 'Sold out', category: 'music', startDate: '2027-01-14T18:00:00', status: 'active', startingPrice: 40, availableQuantity: 0 },
  ];

  const result = listPublicEvents(events, {
    minPrice: 30,
    maxPrice: 100,
    status: 'available',
    sort: 'price_desc',
    page: 1,
    limit: 10,
  });
  assert.deepEqual(result.events.map((event) => event.id), [2]);
});

test('free event listings require a zero price and a future date in the database query', () => {
  const query = buildPublicEventListingQuery({ filter: 'free', search: 'music', category: 'concert', location: 'Addis', sort: 'newest', page: 2, limit: 6 });
  assert.match(query.where, /e\.start_date > NOW\(\)/);
  assert.match(query.where, /t\.starting_price = 0/);
  assert.match(query.where, /LOWER\(u\.full_name\)/);
  assert.equal(query.requiresTicketData, true);
  assert.deepEqual(query.params.slice(0, 6), Array(6).fill('%music%'));
  assert.deepEqual(query.params.slice(6), ['concert', '%addis%', '%addis%']);
  assert.equal(query.offset, 6);
});

test('browse includes published past events while upcoming and free filters narrow results', () => {
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const events = [
    { id: 1, title: 'Past published', category: 'music', startDate: pastDate, status: 'published' },
    { id: 2, title: 'Future free', category: 'music', startDate: futureDate, status: 'published', startingPrice: 0 },
    { id: 3, title: 'Future paid', category: 'music', startDate: futureDate, status: 'active', startingPrice: 20 },
  ];

  assert.equal(listPublicEvents(events, { page: 1, limit: 10 }).total, 3);
  assert.deepEqual(
    listPublicEvents(events, { status: 'upcoming', page: 1, limit: 10 }).events.map((event) => event.id).sort(),
    [2, 3],
  );
  assert.deepEqual(listPublicEvents(events, { status: 'free', page: 1, limit: 10 }).events.map((event) => event.id), [2]);
});

test('public event listing query combines filters and uses parameterized pagination and sorting', () => {
  const query = buildPublicEventListingQuery({
    search: 'Jazz_',
    category: 'music',
    location: 'Addis',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    minPrice: 0,
    maxPrice: 100,
    status: 'ongoing',
    sort: 'title_desc',
    page: 3,
    limit: 12,
  });

  assert.match(query.where, /e\.status IN/);
  assert.match(query.where, /LOWER\(e\.title\) LIKE LOWER\(\?\) ESCAPE '!'/);
  assert.match(query.where, /e\.end_date >= NOW\(\)/);
  assert.match(query.where, /DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(query.where, /t\.starting_price >= \?/);
  assert.equal(query.orderBy, 'e.title DESC, e.id DESC');
  assert.equal(query.limit, 12);
  assert.equal(query.offset, 24);
  assert.equal(query.requiresTicketData, true);
  assert.deepEqual(query.params, [
    '%jazz!_%', '%jazz!_%', '%jazz!_%', '%jazz!_%', '%jazz!_%', '%jazz!_%',
    'music', '%addis%', '%addis%', '2026-11-01', '2026-11-30', 0, 100,
  ]);
  assert.equal(buildPublicEventListingQuery({}).requiresTicketData, false);
});

test('Wedding category filters use the persisted event type and remain parameterized', () => {
  const query = buildPublicEventListingQuery({
    category: 'wedding',
    search: 'ceremony',
    location: 'Addis Ababa',
    status: 'upcoming',
    sort: 'newest',
    page: 2,
    limit: 6,
  });

  assert.match(query.where, /LOWER\(e\.event_type\) = LOWER\(\?\)/);
  assert.match(query.where, /e\.start_date > NOW\(\)/);
  assert.equal(query.orderBy, 'e.created_at DESC, e.id DESC');
  assert.equal(query.limit, 6);
  assert.equal(query.offset, 6);
  assert.equal(query.requiresTicketData, false);
  assert.deepEqual(query.params, [
    '%ceremony%', '%ceremony%', '%ceremony%', '%ceremony%', '%ceremony%', '%ceremony%',
    'wedding', '%addis ababa%', '%addis ababa%',
  ]);
});

test('Discover category IDs filter events through active database categories', () => {
  const query = buildPublicEventListingQuery({ category: '14' });
  assert.match(query.where, /EXISTS \([\s\S]*FROM service_categories sc/);
  assert.match(query.where, /sc\.id = \? AND sc\.is_active = TRUE/);
  assert.match(query.where, /LOWER\(TRIM\(e\.event_type\)\) = LOWER\(TRIM\(sc\.name\)\)/);
  assert.deepEqual(query.params, [14]);
});

test('public event category filters resolve stable slugs to active database category IDs', () => {
  const categories = [
    { id: 21, name: 'Concerts & Music' },
    { id: 22, name: 'Corporate Events' },
  ];
  assert.equal(resolveEventCategoryFilter('concerts-music', categories), '21');
  assert.equal(resolveEventCategoryFilter('Corporate Events', categories), '22');
  assert.equal(resolveEventCategoryFilter('999', categories), '999');
  assert.equal(resolveEventCategoryFilter('unknown-category', categories), 'unknown-category');
});

test('Discover popular and featured listings use real booking and admin feature data', () => {
  const popular = buildPublicEventListingQuery({ sort: 'popular' });
  assert.match(popular.orderBy, /FROM event_ticket_bookings etb/);
  assert.match(popular.orderBy, /etb\.booking_status = 'confirmed'/);
  assert.match(popular.orderBy, /SUM\(etb\.quantity\)[\s\S]*\), 0\) DESC/);
  assert.equal(popular.requiresTicketData, false);

  const featured = buildPublicEventListingQuery({ filter: 'featured' });
  assert.match(featured.where, /e\.is_featured = TRUE/);
  assert.equal(featured.requiresTicketData, false);
});

test('upcoming listing enforces future starts and supports calendar and ticket-price filters', () => {
  const presets = {
    today: /CURDATE\(\)/,
    tomorrow: /DATE_ADD\(CURDATE\(\), INTERVAL 1 DAY\)/,
    this_week: /WEEKDAY\(CURDATE\(\)\)/,
    this_weekend: /INTERVAL 5 DAY/,
    this_month: /DATE_FORMAT\(CURDATE\(\)/,
    next_month: /LAST_DAY\(DATE_ADD\(CURDATE\(\), INTERVAL 1 MONTH\)\)/,
  };

  for (const [datePreset, expected] of Object.entries(presets)) {
    const query = buildPublicEventListingQuery({ filter: 'upcoming', datePreset });
    assert.match(query.where, /e\.start_date > NOW\(\)/);
    assert.match(query.where, expected);
  }

  const free = buildPublicEventListingQuery({ filter: 'upcoming', priceFilter: 'free', sort: 'price_asc' });
  const paid = buildPublicEventListingQuery({ filter: 'upcoming', priceFilter: 'paid', sort: 'price_desc' });
  assert.match(free.where, /t\.starting_price = 0/);
  assert.match(paid.where, /t\.starting_price > 0/);
  assert.match(free.where, /e\.status IN \('active', 'published', 'upcoming', 'open', 'booked', 'in_progress'\)/);
  assert.match(paid.where, /e\.status IN \('active', 'published', 'upcoming', 'open', 'booked', 'in_progress'\)/);
  assert.match(free.orderBy, /t\.starting_price ASC/);
  assert.match(paid.orderBy, /t\.starting_price DESC/);
  assert.equal(free.requiresTicketData, true);
});

test('upcoming and free list helpers exclude completed, cancelled, and expired events', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const events = [
    { id: 1, status: 'active', startDate: future, startingPrice: 0 },
    { id: 2, status: 'completed', publishedAt: new Date().toISOString(), startDate: future, startingPrice: 0 },
    { id: 3, status: 'cancelled', startDate: future, startingPrice: 0 },
    { id: 4, status: 'published', startDate: past, startingPrice: 0 },
  ];

  assert.deepEqual(listPublicEvents(events, { filter: 'upcoming' }).events.map((event) => event.id), [1]);
  assert.deepEqual(listPublicEvents(events, { filter: 'free' }).events.map((event) => event.id), [1]);
});

test('only published completed events remain publicly visible', () => {
  const events = [
    { id: 1, status: 'completed', publishedAt: '2026-01-01T10:00:00' },
    { id: 2, status: 'completed', publishedAt: null },
    { id: 3, status: 'pending_approval', publishedAt: null },
    { id: 4, status: 'rejected', publishedAt: null },
  ];

  assert.deepEqual(listPublicEvents(events, { page: 1, limit: 10 }).events.map((event) => event.id), [1]);
});

test('database event mapping decodes persisted gallery and ticket inventory fields', () => {
  const event = mapDatabaseEvent({
    id: 9,
    title: 'Gallery event',
    event_type: 'Music',
    description: 'Live performances',
    venue: 'City Hall',
    city: 'Addis Ababa',
    cover_image_url: 'https://example.test/cover.jpg',
    gallery_images: '["https://example.test/one.jpg"]',
    start_date: '2027-02-01T10:00:00',
    end_date: null,
    budget: null,
    capacity: 250,
    organizer_name: 'Event Organizer',
    starting_price: '35.00',
    available_quantity: '120',
    status: 'active',
  });
  assert.equal(event.description, 'Live performances');
  assert.equal(event.venue, 'City Hall');
  assert.deepEqual(event.galleryImages, ['https://example.test/one.jpg']);
  assert.equal(event.capacity, 250);
  assert.equal(event.organizerName, 'Event Organizer');
  assert.equal(event.startingPrice, 35);
  assert.equal(event.availableQuantity, 120);
});

test('public categories are normalized and filtered cleanly', () => {
  const categories = [
    { id: 1, name: 'Music', slug: 'music' },
    { id: 2, name: 'Wedding', slug: 'wedding' },
    { id: 3, name: 'Private', hidden: true },
  ];

  const result = getPublicCategories(categories);
  assert.deepEqual(result.map((category) => category.name), ['Music', 'Wedding']);
});

test('public event categories reuse active administrator categories and count only published events', () => {
  const query = buildPublicEventCategoriesQuery();
  assert.match(query, /FROM service_categories sc/);
  assert.match(query, /sc\.is_active = TRUE/);
  assert.match(query, /LOWER\(TRIM\(e\.event_type\)\) = LOWER\(TRIM\(sc\.name\)\)/);
  assert.match(query, /e\.status IN \('active', 'published', 'upcoming', 'open', 'booked', 'in_progress'\)/);
  assert.match(query, /e\.status = 'completed' AND e\.published_at IS NOT NULL/);
  assert.match(query, /COUNT\(e\.id\) AS total/);
  assert.match(query, /ORDER BY FIELD\(LOWER\(sc\.name\)/);
  assert.doesNotMatch(query, /draft|rejected|cancelled/i);
});

test('event creation accepts optional fields and normalizes blank optional values', () => {
  const result = createEventSchema.safeParse({
    title: 'Family celebration',
    type: 'Private event',
    startDate: '2027-06-14T16:30',
    endDate: '',
    budget: '',
    guestCount: '',
  });

  assert.equal(result.success, true);
  assert.equal(result.data.endDate, null);
  assert.equal(result.data.budget, null);
  assert.equal(result.data.guestCount, null);
});

test('event creation rejects invalid dates, reversed date ranges, and invalid amounts', () => {
  const base = {
    title: 'Family celebration',
    type: 'Private event',
    startDate: '2027-06-14T16:30',
  };

  assert.equal(createEventSchema.safeParse({ ...base, startDate: 'not-a-date' }).success, false);
  assert.equal(createEventSchema.safeParse({ ...base, startDate: '2027-02-31T16:30' }).success, false);
  assert.equal(createEventSchema.safeParse({ ...base, startDate: '2027-06-14T16:30Z' }).success, false);
  assert.equal(createEventSchema.safeParse({
    ...base,
    endDate: '2027-06-14T15:30',
  }).success, false);
  assert.equal(createEventSchema.safeParse({ ...base, budget: -1 }).success, false);
  assert.equal(createEventSchema.safeParse({ ...base, guestCount: 0 }).success, false);
});

test('event creation validates public image URLs, gallery entries, and capacity', () => {
  const base = {
    title: 'Family celebration',
    type: 'Private event',
    startDate: '2027-06-14T16:30',
  };

  assert.equal(createEventSchema.safeParse({ ...base, coverImageUrl: 'javascript:alert(1)' }).success, false);
  assert.equal(createEventSchema.safeParse({ ...base, coverImageUrl: 'https://example.test/cover.jpg' }).success, true);
  assert.equal(createEventSchema.safeParse({ ...base, galleryImages: ['data:image/png;base64,abc'] }).success, false);
  assert.equal(createEventSchema.safeParse({ ...base, capacity: 0 }).success, false);
});

test('event date values are converted to MySQL DATETIME without timezone shifts', () => {
  assert.equal(toMysqlDateTime('2027-06-14T16:30'), '2027-06-14 16:30:00');
  assert.equal(toMysqlDateTime(null), null);
});
