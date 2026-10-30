import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardDateRange } from '../src/dashboardUtils.js';

test('dashboard preset ranges use inclusive local calendar days', () => {
  const now = new Date(2026, 9, 30, 13, 0, 0);

  assert.deepEqual(getDashboardDateRange('today', now), {
    startDate: '2026-10-30',
    endDate: '2026-10-30',
  });
  assert.deepEqual(getDashboardDateRange('7d', now), {
    startDate: '2026-10-24',
    endDate: '2026-10-30',
  });
  assert.deepEqual(getDashboardDateRange('30d', now), {
    startDate: '2026-10-01',
    endDate: '2026-10-30',
  });
});

test('dashboard presets handle month and year boundaries and custom dates', () => {
  assert.deepEqual(getDashboardDateRange('7d', new Date(2026, 0, 3)), {
    startDate: '2025-12-28',
    endDate: '2026-01-03',
  });
  assert.deepEqual(getDashboardDateRange('custom', new Date(2026, 9, 30), {
    startDate: '2026-10-04',
    endDate: '2026-10-16',
  }), {
    startDate: '2026-10-04',
    endDate: '2026-10-16',
  });
});
