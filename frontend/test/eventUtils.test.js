import test from 'node:test';
import assert from 'node:assert/strict';

import { formatEventBudget, formatEventDate, formatEventDateOnly, formatEventTime, getEventCountdown } from '../src/eventUtils.js';

test('formats database UTC dates in the configured Ethiopia timezone', () => {
  assert.equal(formatEventDate('2026-11-18T00:00:00', 'en'), 'Nov 18, 2026, 3:00 AM');
});

test('handles missing and invalid event dates', () => {
  assert.equal(formatEventDate(null), null);
  assert.equal(formatEventDate('not-a-date'), null);
});

test('formats event calendar dates and times in the EventHub timezone', () => {
  assert.equal(formatEventDateOnly('2026-11-18T00:00:00', 'en'), 'Nov 18, 2026');
  assert.equal(formatEventTime('2026-11-18T00:00:00', 'en'), '3:00 AM');
});

test('event countdown calculates days through seconds and stops at event start', () => {
  const start = Date.parse('2026-11-19T01:02:03Z');
  assert.deepEqual(getEventCountdown('2026-11-19T01:02:03Z', start - 90061000), {
    days: 1, hours: 1, minutes: 1, seconds: 1, started: false,
  });
  assert.deepEqual(getEventCountdown('2026-11-19T01:02:03Z', start), {
    days: 0, hours: 0, minutes: 0, seconds: 0, started: true,
  });
  assert.equal(getEventCountdown('invalid', start), null);
});

test('formats ETB budgets and preserves zero values', () => {
  assert.equal(formatEventBudget('240000.00'), 'ETB 240,000');
  assert.equal(formatEventBudget(0), 'ETB 0');
  assert.equal(formatEventBudget(null), null);
});