import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeCustomerOverview, ensureCustomerOwnership, isDuplicateFavorite } from '../src/lib/customerDashboard.js';

test('summarises customer activity across events, bookings, quotations, and payments', () => {
  const summary = summarizeCustomerOverview({
    events: [{ date: '2026-11-18T16:00:00Z' }, { date: '2026-11-30T09:00:00Z' }, { date: '2026-10-05T18:00:00Z' }],
    bookings: [
      { status: 'pending' },
      { status: 'confirmed' },
      { status: 'completed' },
      { status: 'cancelled' },
    ],
    quotations: [
      { status: 'sent' },
      { status: 'revision_requested' },
      { status: 'accepted' },
    ],
    payments: [
      { status: 'pending' },
      { status: 'successful' },
      { status: 'failed' },
    ],
    messages: [{ read: false }, { read: true }],
    notifications: [{ read: false }, { read: true }],
  });

  assert.equal(summary.totalBookings, 4);
  assert.equal(summary.pendingBookings, 1);
  assert.equal(summary.confirmedBookings, 1);
  assert.equal(summary.upcomingEvents, 2);
  assert.equal(summary.completedBookings, 1);
  assert.equal(summary.pendingQuotations, 2);
  assert.equal(summary.outstandingPayments, 2);
  assert.equal(summary.unreadMessages, 1);
  assert.equal(summary.unreadNotifications, 1);
});

test('blocks access to records not owned by the authenticated customer', () => {
  assert.throws(() => ensureCustomerOwnership(11, 7), /customer ownership/i);
  assert.doesNotThrow(() => ensureCustomerOwnership(7, 7));
});

test('prevents duplicate saved-vendor records', () => {
  const favorites = [{ vendorId: 1 }, { vendorId: 2 }];
  assert.equal(isDuplicateFavorite(favorites, 1), true);
  assert.equal(isDuplicateFavorite(favorites, 3), false);
});
