import test from 'node:test';
import assert from 'node:assert/strict';

import { getHomepageCategoryCounts, getHomepageCategoryTranslationKey, getHomepageLocationOptions, getHomepageSectionState, getHomepageStatistics } from '../src/homepageUtils.js';

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
