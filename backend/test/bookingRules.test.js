import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBookingTransition,
  createBookingSnapshot,
  calculateDashboardSummary,
} from '../src/lib/bookingRules.js';

test('allows a pending booking to move to accepted or rejected', () => {
  assert.equal(validateBookingTransition('pending', 'accepted'), true);
  assert.equal(validateBookingTransition('pending', 'rejected'), true);
  assert.equal(validateBookingTransition('pending', 'completed'), false);
});

test('blocks state changes that do not follow the configured workflow', () => {
  assert.equal(validateBookingTransition('confirmed', 'requested'), false);
  assert.equal(validateBookingTransition('completed', 'cancelled'), false);
});

test('creates a booking snapshot with the required status and financial fields', () => {
  const result = createBookingSnapshot({
    id: 7,
    status: 'confirmed',
    quotedAmount: 2500,
    currency: 'ETB',
    serviceTitle: 'Wedding Catering',
  });

  assert.equal(result.id, 7);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.amount, 2500);
  assert.equal(result.currency, 'ETB');
  assert.equal(result.serviceTitle, 'Wedding Catering');
});

test('summarises the current marketplace with totals and statuses', () => {
  const summary = calculateDashboardSummary({
    users: 12,
    vendors: 4,
    events: 6,
    bookings: [
      { status: 'pending' },
      { status: 'confirmed' },
      { status: 'confirmed' },
      { status: 'completed' },
      { status: 'cancelled' },
    ],
  });

  assert.equal(summary.totalBookings, 5);
  assert.equal(summary.confirmedBookings, 2);
  assert.equal(summary.completedBookings, 1);
  assert.equal(summary.cancelledBookings, 1);
  assert.equal(summary.pendingBookings, 1);
});
