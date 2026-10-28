import test from 'node:test';
import assert from 'node:assert/strict';

import { listPublicVendors, getPublicVendorById, deriveVendorSummary } from '../src/lib/vendorCatalog.js';

const sampleVendors = [
  {
    id: 1,
    business_name: 'Aster Floral Studio',
    category: 'Decoration',
    city: 'Addis Ababa',
    description: 'Luxury floral design and event styling.',
    verified: true,
    rating: 4.9,
    reviewCount: 24,
    priceFrom: 18000,
    isPublished: true,
    status: 'active',
    visibility: 'public',
    services: [{ id: 1, title: 'Wedding Styling', price: 18000, published: true }],
  },
  {
    id: 2,
    business_name: 'Golden Horizon Catering',
    category: 'Catering',
    city: 'Bahir Dar',
    description: 'Premium catering and hospitality for all events.',
    verified: true,
    rating: 4.8,
    reviewCount: 15,
    priceFrom: 26000,
    isPublished: true,
    status: 'active',
    visibility: 'public',
    services: [{ id: 2, title: 'Corporate Lunch', price: 26000, published: true }],
  },
  {
    id: 3,
    business_name: 'CitySound Events',
    category: 'Music & DJs',
    city: 'Addis Ababa',
    description: 'Event sound and DJ services for private and corporate events.',
    verified: false,
    rating: 4.6,
    reviewCount: 9,
    priceFrom: 15000,
    isPublished: true,
    status: 'active',
    visibility: 'public',
    services: [{ id: 3, title: 'DJ Set', price: 15000, published: true }],
  },
  {
    id: 4,
    business_name: 'Hidden Studio',
    category: 'Photography',
    city: 'Hawassa',
    description: 'Private vendor not meant for the public directory.',
    verified: true,
    rating: 5,
    reviewCount: 2,
    priceFrom: 20000,
    isPublished: false,
    status: 'active',
    visibility: 'private',
    services: [],
  },
];

test('public vendor directory only includes verified, published, public vendors', () => {
  const result = listPublicVendors(sampleVendors, { page: 1, limit: 10 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.vendors.map((vendor) => vendor.id), [1, 2]);
});

test('search matches vendor names, categories, location and descriptions', () => {
  const result = listPublicVendors(sampleVendors, { search: 'catering', page: 1, limit: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.vendors[0].business_name, 'Golden Horizon Catering');
});

test('verified-only and location/category filters combine correctly', () => {
  const result = listPublicVendors(sampleVendors, {
    verified: true,
    category: 'Decoration',
    location: 'Addis',
    page: 1,
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.vendors[0].id, 1);
});

test('sorting and pagination produce stable results', () => {
  const highestRated = listPublicVendors(sampleVendors, { sort: 'highest-rated', page: 1, limit: 2 });
  const pageTwo = listPublicVendors(sampleVendors, { page: 2, limit: 1 });

  assert.deepEqual(highestRated.vendors.map((vendor) => vendor.id), [1, 2]);
  assert.equal(pageTwo.totalPages, 2);
  assert.equal(pageTwo.vendors[0].id, 2);
});

test('profile lookup rejects private or missing records and calculates summaries', () => {
  const vendor = getPublicVendorById(sampleVendors, 2);
  const summary = deriveVendorSummary(vendor);

  assert.equal(getPublicVendorById(sampleVendors, 4), null);
  assert.equal(vendor.business_name, 'Golden Horizon Catering');
  assert.equal(summary.verified, true);
  assert.equal(summary.publicServiceCount, 1);
});
