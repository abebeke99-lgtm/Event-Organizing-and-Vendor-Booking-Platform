import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicCategoryName } from '../src/lib/categoryName.js';

test('public category names exclude generated integration fixtures but preserve real catalog names', () => {
  for (const name of [
    'Customer payment detail 147b18fa-3014-4dc5-aefb-8e450700f6a4',
    'Dashboard edcca75f-bdf7-4dae-b480-97995f5db507',
    'Marketplace 131bc968-d76f-42d9-af09-da0fbd35e325 Category',
    'Marketplace 131bc968-d76f-42d9-af09-da0fbd35e325 Services',
    'Neon booking category 2c8c480d-e14a-4258-ac44-5c147804cccd',
  ]) {
    assert.equal(isPublicCategoryName(name), false, name);
  }

  for (const name of ['Catering', 'Event Rentals', 'Photography', 'Wedding Venues']) {
    assert.equal(isPublicCategoryName(name), true, name);
  }
});
