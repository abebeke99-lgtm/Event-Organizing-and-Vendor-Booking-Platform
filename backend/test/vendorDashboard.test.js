import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeVendorOverview,
  validateVendorBookingTransition,
  ensureVendorOwnership,
} from '../src/lib/vendorDashboard.js';

test('summarises vendor metrics from owned records', () => {
  const summary = summarizeVendorOverview({
    services: [
      { status: 'Published' },
      { status: 'Published' },
      { status: 'Inactive' },
      { status: 'Draft' }
    ],
    bookings: [
      { status: 'Pending' },
      { status: 'Accepted' },
      { status: 'Completed' },
      { status: 'Rejected' }
    ],
    quotations: [
      { status: 'Sent' },
      { status: 'Accepted' },
      { status: 'Expired' }
    ],
    earnings: [1000, 450],
    messages: [{ read: false }, { read: true }],
    ratings: [5, 4, 5],
  });

  assert.equal(summary.totalServices, 4);
  assert.equal(summary.activeServices, 2);
  assert.equal(summary.pendingBookings, 1);
  assert.equal(summary.confirmedBookings, 1);
  assert.equal(summary.averageRating, 4.67);
  assert.equal(summary.unreadMessages, 1);
  assert.equal(summary.totalEarnings, 1450);
});

test('validates accepted vendor booking transitions', () => {
  assert.equal(validateVendorBookingTransition('Pending', 'Accepted'), true);
  assert.equal(validateVendorBookingTransition('Accepted', 'Completed'), true);
  assert.equal(validateVendorBookingTransition('Completed', 'Cancelled'), false);
  assert.equal(validateVendorBookingTransition('Rejected', 'Accepted'), false);
});

test('blocks access to records not owned by the authenticated vendor', () => {
  assert.throws(() => ensureVendorOwnership(11, 7), /vendor ownership/i);
  assert.doesNotThrow(() => ensureVendorOwnership(7, 7));
});
