import test from 'node:test';
import assert from 'node:assert/strict';

import { listPublicEvents, getPublicEventById, getPublicCategories, mapDatabaseEvent } from '../src/lib/eventCatalog.js';
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
    type: 'Wedding',
    category: 'wedding',
    location: null,
    startDate: '2026-11-18T03:00:00',
    endDate: null,
    budget: 240000,
    status: 'active',
  });
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

test('event date values are converted to MySQL DATETIME without timezone shifts', () => {
  assert.equal(toMysqlDateTime('2027-06-14T16:30'), '2027-06-14 16:30:00');
  assert.equal(toMysqlDateTime(null), null);
});
