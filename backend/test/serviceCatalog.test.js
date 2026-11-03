import test from 'node:test';
import assert from 'node:assert/strict';

import { getPublicServiceById, listPublicServices } from '../src/lib/serviceCatalog.js';

const services = [
  {
    id: 1,
    vendorId: 1,
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
  },
  {
    id: 2,
    vendorId: 2,
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
