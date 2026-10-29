import test from 'node:test';
import assert from 'node:assert/strict';

import { formatEventBudget, formatEventDate } from '../src/eventUtils.js';

test('formats database UTC dates in the configured Ethiopia timezone', () => {
  assert.equal(formatEventDate('2026-11-18T00:00:00', 'en'), 'Nov 18, 2026, 3:00 AM');
});

test('handles missing and invalid event dates', () => {
  assert.equal(formatEventDate(null), null);
  assert.equal(formatEventDate('not-a-date'), null);
});

test('formats ETB budgets and preserves zero values', () => {
  assert.equal(formatEventBudget('240000.00'), 'ETB 240,000');
  assert.equal(formatEventBudget(0), 'ETB 0');
  assert.equal(formatEventBudget(null), null);
});