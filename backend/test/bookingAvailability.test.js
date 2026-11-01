import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkBookingDateAvailability,
  lockBookingVendor,
  releaseBookingDate,
  reserveBookingDate,
} from '../src/lib/bookingAvailability.js';

function databaseWith({ availability = null, conflict = null, vendor = { id: 8 } } = {}) {
  const statements = [];
  return {
    statements,
    async execute(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('FROM vendor_profiles')) return [[vendor].filter(Boolean)];
      if (sql.includes('FROM vendor_availability')) return [[availability].filter(Boolean)];
      if (sql.includes('FROM bookings')) return [[conflict].filter(Boolean)];
      return [{ affectedRows: 1 }];
    },
  };
}

test('booking availability locks the vendor and rejects dates explicitly marked unavailable', async () => {
  const database = databaseWith({ availability: { status: 'blocked', note: null } });
  await lockBookingVendor(database, 8);
  await assert.rejects(
    checkBookingDateAvailability(database, { vendorId: 8, bookingId: 21, scheduledDate: '2030-07-14 16:00:00' }),
    { status: 409, message: 'The vendor is not available on the selected date.' },
  );
  assert.match(database.statements[0].sql, /FOR UPDATE/);
  assert.match(database.statements[1].sql, /FOR UPDATE/);
});

test('booking availability rejects another confirmed booking on the same vendor date', async () => {
  const database = databaseWith({ conflict: { id: 32 } });
  await assert.rejects(
    checkBookingDateAvailability(database, { vendorId: 8, bookingId: 21, scheduledDate: '2030-07-14 16:00:00' }),
    { status: 409, message: 'The vendor already has a confirmed booking on the selected date.' },
  );
});

test('booking date reservations update existing availability and release only their own reservation', async () => {
  const database = databaseWith({ availability: { status: 'available', note: null } });
  await reserveBookingDate(database, {
    vendorId: 8, bookingId: 21, scheduledDate: '2030-07-14 16:00:00', availability: { status: 'available' },
  });
  await releaseBookingDate(database, { vendorId: 8, bookingId: 21, scheduledDate: '2030-07-14 16:00:00' });
  assert.match(database.statements[0].sql, /UPDATE vendor_availability SET status = 'booked'/);
  assert.match(database.statements[2].sql, /UPDATE vendor_availability SET status = 'available'/);
  assert.equal(database.statements[2].values[2], 'Booking #21');
});
