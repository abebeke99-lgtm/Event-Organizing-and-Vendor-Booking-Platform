import test from 'node:test';
import assert from 'node:assert/strict';

import { getVendorDashboardEndpoints } from '../src/vendorDashboardData.js';

test('vendor dashboard loads only the active section data', () => {
  assert.deepEqual(getVendorDashboardEndpoints('overview'), [
    'overview', 'booking-requests', 'services', 'notifications',
  ]);
  assert.deepEqual(getVendorDashboardEndpoints('availability'), ['availability', 'bookings']);
  assert.deepEqual(getVendorDashboardEndpoints('messages'), [
    'messages', 'booking-requests', 'bookings',
  ]);
  assert.deepEqual(getVendorDashboardEndpoints('reviews'), ['overview', 'reviews']);
  assert.deepEqual(getVendorDashboardEndpoints('unknown'), []);
});
