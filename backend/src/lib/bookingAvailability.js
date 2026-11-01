export async function lockBookingVendor(database, vendorId) {
  const [[vendor]] = await database.execute(
    'SELECT id FROM vendor_profiles WHERE id = ? FOR UPDATE',
    [vendorId],
  );
  if (!vendor) throw Object.assign(new Error('Vendor not found.'), { status: 404 });
}

export async function checkBookingDateAvailability(database, { vendorId, bookingId, scheduledDate }) {
  const [[availability]] = await database.execute(
    'SELECT status, note FROM vendor_availability WHERE vendor_id = ? AND available_date = DATE(?) FOR UPDATE',
    [vendorId, scheduledDate],
  );
  if (availability && availability.status !== 'available'
    && availability.note !== `Booking #${bookingId}`) {
    throw Object.assign(new Error('The vendor is not available on the selected date.'), { status: 409 });
  }
  const [[conflict]] = await database.execute(
    `SELECT b.id FROM bookings b
     JOIN events e ON e.id = b.event_id
     WHERE b.vendor_id = ? AND b.id <> ?
       AND b.status IN ('accepted', 'confirmed', 'in_progress')
       AND DATE(COALESCE(b.scheduled_date, e.start_date)) = DATE(?)
     LIMIT 1 FOR UPDATE`,
    [vendorId, bookingId, scheduledDate],
  );
  if (conflict) {
    throw Object.assign(new Error('The vendor already has a confirmed booking on the selected date.'), { status: 409 });
  }
  return availability;
}

export async function reserveBookingDate(database, { vendorId, bookingId, scheduledDate, availability }) {
  const note = `Booking #${bookingId}`;
  if (availability) {
    await database.execute(
      "UPDATE vendor_availability SET status = 'booked', note = ? WHERE vendor_id = ? AND available_date = DATE(?)",
      [note, vendorId, scheduledDate],
    );
  } else {
    await database.execute(
      "INSERT INTO vendor_availability (vendor_id, available_date, status, note) VALUES (?, DATE(?), 'booked', ?)",
      [vendorId, scheduledDate, note],
    );
  }
}

export async function releaseBookingDate(database, { vendorId, bookingId, scheduledDate }) {
  const [[remaining]] = await database.execute(
    `SELECT b.id FROM bookings b
     JOIN events e ON e.id = b.event_id
     WHERE b.vendor_id = ? AND b.id <> ?
       AND b.status IN ('accepted', 'confirmed', 'in_progress')
       AND DATE(COALESCE(b.scheduled_date, e.start_date)) = DATE(?)
     LIMIT 1 FOR UPDATE`,
    [vendorId, bookingId, scheduledDate],
  );
  if (!remaining) {
    await database.execute(
      "UPDATE vendor_availability SET status = 'available', note = NULL WHERE vendor_id = ? AND available_date = DATE(?) AND status = 'booked' AND note = ?",
      [vendorId, scheduledDate, `Booking #${bookingId}`],
    );
  }
}
