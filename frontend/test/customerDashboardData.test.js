import test from 'node:test';
import assert from 'node:assert/strict';

import { getCustomerDashboardEndpoints } from '../src/customerDashboardData.js';

test('customer dashboard loads only the active section data', () => {
  assert.deepEqual(getCustomerDashboardEndpoints('payments'), ['payments', 'refunds']);
  assert.deepEqual(getCustomerDashboardEndpoints('bookings'), []);
  assert.deepEqual(getCustomerDashboardEndpoints('unknown'), []);
});
