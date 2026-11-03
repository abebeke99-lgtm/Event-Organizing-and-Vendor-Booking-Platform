import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeOrganizerDashboard } from '../src/organizerDashboardUtils.js';

test('organizer overview uses owner-scoped events and startDate for upcoming events', () => {
  const summary = summarizeOrganizerDashboard([
    { id: 1, startDate: '2030-01-02T10:00', budget: 1200, status: 'draft' },
    { id: 2, startDate: '2029-12-31T10:00', endDate: '2030-01-01T10:00', budget: 300, status: 'active' },
    { id: 3, startDate: '2030-01-04T10:00', budget: 500, status: 'cancelled' },
  ], [], new Date('2030-01-01T12:00:00'));

  assert.equal(summary.totalEvents, 3);
  assert.deepEqual(summary.upcomingEvents.map((event) => event.id), [1]);
  assert.equal(summary.ongoingCount, 0);
  assert.equal(summary.totalBudget, 2000);
});

test('organizer overview groups booking lifecycle counts by status', () => {
  const summary = summarizeOrganizerDashboard([], [
    { status: 'requested' },
    { status: 'under_review' },
    { status: 'accepted' },
    { status: 'in_progress' },
    { status: 'completed' },
    { status: 'rejected' },
  ], new Date('2030-01-01T12:00:00'));

  assert.equal(summary.pending, 2);
  assert.equal(summary.confirmed, 2);
  assert.equal(summary.completed, 1);
});