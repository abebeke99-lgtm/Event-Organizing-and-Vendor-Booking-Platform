import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAboutPagePayload, getAboutStatistics, normalizeAboutRecord } from '../src/lib/aboutContent.js';

const sampleCatalog = {
  categories: [
    { id: 1, name: 'Wedding Venues', slug: 'wedding-venues', isActive: true },
    { id: 2, name: 'Catering', slug: 'catering', isActive: true },
    { id: 3, name: 'Photography', slug: 'photography', isActive: false },
  ],
  vendors: [
    { id: 1, business_name: 'Aster Floral Studio', verified: true, visibility: 'public', isPublished: true, status: 'active' },
    { id: 2, business_name: 'Hidden Studio', verified: true, visibility: 'private', isPublished: false, status: 'active' },
  ],
  services: [
    { id: 1, title: 'Wedding Styling', published: true, visibility: 'public', status: 'active' },
    { id: 2, title: 'Private Service', published: false, visibility: 'public', status: 'draft' },
  ],
  bookings: [
    { id: 1, status: 'completed' },
    { id: 2, status: 'cancelled' },
  ],
};

test('buildAboutPagePayload returns the proper public fields and translations', () => {
  const payload = buildAboutPagePayload({
    language: 'en',
    mission: 'Simplify planning',
    vision: 'Make discovery easier',
    values: [{ title: 'Trust', description: 'We keep it clear.' }],
  }, sampleCatalog);

  assert.equal(payload.hero.heading, 'About EventHub');
  assert.equal(payload.mission, 'Simplify planning');
  assert.equal(payload.values[0].title, 'Trust');
  assert.equal(payload.categories.length, 2);
  assert.equal(payload.statistics.vendorCount, 1);
  assert.equal(payload.statistics.serviceCount, 1);
});

test('getAboutStatistics only counts eligible public records', () => {
  const stats = getAboutStatistics(sampleCatalog);
  assert.equal(stats.categoryCount, 2);
  assert.equal(stats.vendorCount, 1);
  assert.equal(stats.serviceCount, 1);
  assert.equal(stats.completedBookingCount, 1);
});

test('normalizeAboutRecord keeps the published content and strips unsafe fields', () => {
  const result = normalizeAboutRecord({
    hero_heading: '  About EventHub  ',
    mission: '<script>alert(1)</script>Keep it simple',
    values: [{ title: 'Trust', description: 'Clear and honest' }],
    is_published: true,
    updated_at: '2026-01-01T00:00:00Z',
    secret: 'should-be-removed',
  });

  assert.equal(result.hero_heading, 'About EventHub');
  assert.equal(result.mission, 'Keep it simple');
  assert.equal(result.values.length, 1);
  assert.equal(result.secret, undefined);
});
