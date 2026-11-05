import test from 'node:test';
import assert from 'node:assert/strict';

import { getPublicServiceById, listPublicServices } from '../src/lib/serviceCatalog.js';

const services = [
  {
    id: 1,
    vendorId: 1,
    categoryId: 11,
    title: 'Luxury Wedding Venue',
    vendorName: 'Aster Floral Studio',
    category: 'Wedding Venues',
    city: 'Addis Ababa',
    price: 90000,
    currency: 'ETB',
    rating: 4.9,
    available: true,
    status: 'active',
    published: true,
    visibility: 'public',
    createdAt: '2026-03-10T00:00:00.000Z',
  },
  {
    id: 2,
    vendorId: 2,
    categoryId: 12,
    title: 'Premium Catering Package',
    vendorName: 'Golden Horizon Catering',
    category: 'Catering',
    city: 'Bahir Dar',
    price: 56000,
    currency: 'ETB',
    rating: 4.8,
    available: false,
    status: 'active',
    published: true,
    visibility: 'public',
    createdAt: '2026-02-10T00:00:00.000Z',
  },
  {
    id: 3,
    vendorId: 1,
    title: 'Private Gala Styling',
    vendorName: 'Aster Floral Studio',
    category: 'Decoration',
    city: 'Addis Ababa',
    price: 45000,
    currency: 'ETB',
    rating: 4.7,
    status: 'draft',
    published: true,
    visibility: 'public',
  },
  {
    id: 4,
    vendorId: 3,
    title: 'Hidden Studio Setup',
    vendorName: 'Hidden Studio',
    category: 'Photography',
    city: 'Hawassa',
    price: 15000,
    currency: 'ETB',
    rating: 5,
    status: 'active',
    published: false,
    visibility: 'public',
  },
  {
    id: 5,
    vendorId: 1,
    title: 'Archived planning',
    vendorName: 'Aster Floral Studio',
    category: 'Wedding Planning',
    city: 'Addis Ababa',
    status: 'archived',
    published: true,
  },
];

test('public services exclude draft and unpublished records', () => {
  const result = listPublicServices(services, { page: 1, limit: 10 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.services.map((service) => service.id), [1, 2]);
});

test('search, category, location and sorting filters apply to public services', () => {
  const result = listPublicServices(services, {
    search: 'catering',
    category: 'catering',
    location: 'bahir',
    sort: 'price-low',
    page: 1,
    limit: 10,
  });
  assert.equal(result.total, 1);
  assert.equal(result.services[0].title, 'Premium Catering Package');
});

test('service search is case-insensitive across fields and relevance ranks title matches first', () => {
  const searchableServices = [
    { ...services[0], id: 21, title: 'Catering Service', category: 'Events', vendorName: 'Local Vendor', description: '', city: 'Hawassa' },
    { ...services[1], id: 22, title: 'Dinner Service', category: 'Events', vendorName: 'Local Vendor', description: 'Catering for large events', city: 'Bahir Dar' },
    { ...services[0], id: 23, title: 'Buffet Setup', category: 'Events', vendorName: 'Catering Company', description: '', city: 'Addis Ababa' },
    { ...services[0], id: 24, title: 'Event Hall', category: 'Events', vendorName: 'Local Vendor', description: '', city: 'Catering City' },
    { ...services[0], id: 25, title: 'Event Planning', category: 'Catering', vendorName: 'Local Vendor', description: '', city: 'Hawassa' },
  ];
  const ranked = listPublicServices(searchableServices, { search: 'CATERING', sort: 'relevance', page: 1, limit: 10 });
  assert.deepEqual(ranked.services.map((service) => service.id), [21, 25, 23, 22, 24]);

  const cityMatch = listPublicServices(services, { search: 'BAHIR', page: 1, limit: 10 });
  assert.deepEqual(cityMatch.services.map((service) => service.id), [2]);
});

test('category ID filtering selects only services linked to the requested database category', () => {
  const result = listPublicServices(services, { categoryId: 11, page: 1, limit: 10 });
  assert.equal(result.total, 1);
  assert.deepEqual(result.services.map((service) => service.id), [1]);
});

test('service lookup rejects hidden or invalid ids', () => {
  assert.equal(getPublicServiceById(services, 3), null);
  assert.equal(getPublicServiceById(services, 1)?.title, 'Luxury Wedding Venue');
  assert.equal(getPublicServiceById(services, 'abc'), null);
});

test('vendorId filter returns only one vendor\'s services', () => {
  const result = listPublicServices(services, { vendorId: 1, page: 1, limit: 10 });
  assert.equal(result.total, 1);
  assert.deepEqual(result.services.map((service) => service.id), [1]);
});

test('price, rating, and availability filters combine', () => {
  const result = listPublicServices(services, {
    minPrice: 50000,
    maxPrice: 100000,
    minRating: 4.85,
    availableOnly: true,
    page: 1,
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.services[0].id, 1);
});

test('vendor-name filter and newest sorting use real service fields', () => {
  const result = listPublicServices([
    { ...services[0], createdAt: '2026-01-01T00:00:00.000Z' },
    { ...services[0], id: 6, title: 'Recent catering', createdAt: '2026-05-01T00:00:00.000Z' },
    { ...services[1], id: 7, createdAt: '2026-04-01T00:00:00.000Z' },
  ], { vendor: 'aster', sort: 'newest', page: 1, limit: 10 });
  assert.deepEqual(result.services.map((service) => service.id), [6, 1]);
});

test('popular services rank by actual bookings, then reviews and ratings', () => {
  const result = listPublicServices([
    { ...services[0], id: 11, bookingCount: 2, reviewCount: 20, rating: 4.9 },
    { ...services[1], id: 12, bookingCount: 15, reviewCount: 1, rating: 4.2 },
    { ...services[0], id: 13, title: 'No engagement', bookingCount: 0, reviewCount: 0, rating: 0 },
  ], { sort: 'popular', page: 1, limit: 10 });

  assert.deepEqual(result.services.map((service) => service.id), [12, 11, 13]);
});
