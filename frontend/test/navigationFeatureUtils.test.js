import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearComparedVendors,
  getCalendarMonthRange,
  getComparedVendorIds,
  getEventDateKey,
  getRecentlyViewed,
  recordRecentlyViewed,
  toggleComparedVendor,
} from '../src/navigationFeatureUtils.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('comparison list supports toggling vendors and caps the shortlist at three', () => {
  const storage = createStorage();
  assert.deepEqual(toggleComparedVendor(2, storage), { ids: [2], added: true });
  assert.deepEqual(toggleComparedVendor(3, storage), { ids: [2, 3], added: true });
  assert.deepEqual(toggleComparedVendor(5, storage), { ids: [2, 3, 5], added: true });
  assert.equal(toggleComparedVendor(8, storage).limitReached, true);
  assert.deepEqual(getComparedVendorIds(storage), [2, 3, 5]);
  assert.deepEqual(toggleComparedVendor(3, storage), { ids: [2, 5], added: false });
  clearComparedVendors(storage);
  assert.deepEqual(getComparedVendorIds(storage), []);
});

test('recently viewed records deduplicate and keep the latest 12 items', () => {
  const storage = createStorage();
  recordRecentlyViewed('event', 1, storage);
  recordRecentlyViewed('vendor', 1, storage);
  recordRecentlyViewed('event', 1, storage);
  for (let id = 2; id <= 14; id += 1) recordRecentlyViewed('vendor', id, storage);
  const history = getRecentlyViewed(storage);
  assert.equal(history.length, 12);
  assert.deepEqual(history[0], { type: 'vendor', id: 14, viewedAt: history[0].viewedAt });
  assert.equal(history.some((item) => item.type === 'event' && item.id === 1), false);
});

test('calendar month range and event date extraction use local calendar dates', () => {
  assert.deepEqual(getCalendarMonthRange(2028, 1), { startDate: '2028-02-01', endDate: '2028-02-29' });
  assert.equal(getEventDateKey('2027-10-04T22:00:00.000Z'), '2027-10-04');
  assert.equal(getEventDateKey(''), '');
});
