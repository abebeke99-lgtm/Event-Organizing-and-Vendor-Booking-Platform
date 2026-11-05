import test from 'node:test';
import assert from 'node:assert/strict';

import { getHomepageCategoryCounts, getHomepageCategoryTranslationKey, getHomepageLocationOptions, getHomepageSectionState, getHomepageStatistics, getHomepageTestimonials } from '../src/homepageUtils.js';
import { getHomepageVenueCards, homepageInspirationImages, homepageVenueImagePaths } from '../src/homepageVenueUtils.js';

test('homepage statistics include only valid values supplied by the API', () => {
  assert.deepEqual(getHomepageStatistics({
    averageVendorRating: '4.7',
    confirmedOrCompletedBookingCount: 0,
    activeVendorCount: '12',
    publishedEventCount: null,
    completedBookingCount: 'not-a-count',
  }), [
    { label: 'publicHomeAverageVendorRating', value: 4.7, rating: true },
    { label: 'publicHomeConfirmedBookings', value: 0, rating: false },
    { label: 'publicHomeActiveVendors', value: 12, rating: false },
  ]);
});

test('homepage statistics reject fabricated, malformed, and out-of-range values', () => {
  assert.deepEqual(getHomepageStatistics({
    averageVendorRating: 5.1,
    confirmedOrCompletedBookingCount: -1,
    activeVendorCount: 1.5,
    publishedEventCount: '',
    completedBookingCount: undefined,
  }), []);
  assert.deepEqual(getHomepageStatistics(null), []);
});

test('category counts preserve real zeros and omit absent or invalid values', () => {
  assert.deepEqual(getHomepageCategoryCounts({ vendorCount: 0, serviceCount: '3' }), {
    vendorCount: 0,
    serviceCount: 3,
  });
  assert.deepEqual(getHomepageCategoryCounts({ vendorCount: undefined, serviceCount: 'unknown' }), {
    vendorCount: null,
    serviceCount: null,
  });
});

test('known public categories map to localized homepage labels', () => {
  assert.equal(getHomepageCategoryTranslationKey('Wedding Venues'), 'publicHomeWeddingVenues');
  assert.equal(getHomepageCategoryTranslationKey('Graduation Services'), 'publicHomeGraduations');
  assert.equal(getHomepageCategoryTranslationKey('Entertainment'), 'publicHomeEntertainment');
  assert.equal(getHomepageCategoryTranslationKey('Unlisted category'), null);
});

test('homepage location options are unique values derived from public records', () => {
  assert.deepEqual(getHomepageLocationOptions(
    [{ city: 'Addis Ababa' }, { location: 'Bahir Dar' }],
    [{ city: ' addis ababa ' }, { city: '' }],
    [{ location: 'Hawassa' }],
  ), ['Addis Ababa', 'Bahir Dar', 'Hawassa']);
});

test('homepage sections distinguish loading, empty, error, and populated states', () => {
  assert.equal(getHomepageSectionState({ loading: true, error: true, items: [] }), 'loading');
  assert.equal(getHomepageSectionState({ loading: false, error: true, items: [{ id: 1 }] }), 'error');
  assert.equal(getHomepageSectionState({ loading: false, error: false, items: [] }), 'empty');
  assert.equal(getHomepageSectionState({ loading: false, error: false, items: [{ id: 1 }] }), 'populated');
});

test('homepage testimonials include only real public reviews with valid ratings and comments', () => {
  assert.deepEqual(getHomepageTestimonials([{
    vendor: { id: 9, business_name: 'Bright Events' },
    reviews: [
      { id: 2, rating: 5, comment: '  Great service. ', customerName: 'Customer' },
      { id: 3, rating: 0, comment: 'No rating' },
      { id: 4, rating: 4, comment: '  ' },
      { id: 5, rating: 6, comment: 'Invalid rating' },
    ],
  }]), [{
    id: 2,
    quote: 'Great service.',
    rating: 5,
    customerName: 'Customer',
    vendorName: 'Bright Events',
  }]);
  assert.deepEqual(getHomepageTestimonials(null), []);
});

test('homepage venue cards use real venue records and matching published event images', () => {
  assert.deepEqual(getHomepageVenueCards([
    { name: 'Grand Hall', city: 'Addis Ababa', eventCount: 2 },
    { name: 'Venue without a photo', city: 'Hawassa', eventCount: 1 },
    { name: '', city: 'Unknown', eventCount: 5 },
  ], [
    { venue: ' grand hall ', location: 'Addis Ababa', coverImage: '/api/events/1/image' },
    { venue: 'Grand Hall', location: 'Other City', coverImage: '/api/events/2/image' },
  ]), [
    { name: 'Grand Hall', city: 'Addis Ababa', eventCount: 2, image: '/api/events/1/image' },
    { name: 'Venue without a photo', city: 'Hawassa', eventCount: 1, image: null },
  ]);
  assert.deepEqual(getHomepageVenueCards(null, []), []);
});

test('homepage venue gallery uses the uploaded image assets', () => {
  assert.equal(homepageVenueImagePaths.length, 9);
  assert.equal(new Set(homepageVenueImagePaths).size, homepageVenueImagePaths.length);
  assert.ok(homepageVenueImagePaths.every((path) => path.startsWith('/')));
  assert.deepEqual(homepageInspirationImages.map(({ src }) => src), [
    '/images.jfif',
    '/images%20(1).jfif',
    '/images%20(2).jfif',
    '/images%20(3).jfif',
    '/images%20(4).jfif',
  ]);
  assert.equal(new Set(homepageInspirationImages.map(({ src }) => src)).size, 5);
  assert.ok(homepageInspirationImages.every(({ categoryKey }) => categoryKey.startsWith('publicHomeCategory')));
});
