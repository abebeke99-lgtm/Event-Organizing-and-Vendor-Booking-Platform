export async function lockBookingVendor(database, vendorId) {
  if (database.dialect === 'postgres') {
    const result = await database.query(
      'SELECT id FROM vendor_profiles WHERE id = $1 FOR UPDATE',
      [vendorId],
    );
    if (!result.rows[0]) throw Object.assign(new Error('Vendor not found.'), { status: 404 });
    return;
  }
  const [[vendor]] = await database.execute(
    'SELECT id FROM vendor_profiles WHERE id = ? FOR UPDATE',
    [vendorId],
  );
  if (!vendor) throw Object.assign(new Error('Vendor not found.'), { status: 404 });
}

export async function checkBookingDateAvailability(database, { vendorId, bookingId, scheduledDate }) {
  if (database.dialect === 'postgres') {
    const availabilityResult = await database.query(
      `SELECT status, note FROM vendor_availability
       WHERE vendor_id = $1 AND available_date = $2::date FOR UPDATE`,
      [vendorId, scheduledDate],
    );
    const availability = availabilityResult.rows[0];
    if (availability && availability.status !== 'available'
      && availability.note !== `Booking #${bookingId}`) {
      throw Object.assign(new Error('The vendor is not available on the selected date.'), { status: 409 });
    }
    const conflictResult = await database.query(
      `SELECT b.id FROM bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.vendor_id = $1 AND b.id <> $2
         AND b.status = ANY($3::varchar[])
         AND COALESCE(b.scheduled_date::date, e.start_date::date) = $4::date
       LIMIT 1`,
      [vendorId, bookingId, ['accepted', 'confirmed', 'in_progress'], scheduledDate],
    );
    if (conflictResult.rows[0]) {
      throw Object.assign(new Error('The vendor already has a confirmed booking on the selected date.'), { status: 409 });
    }
    return availability || null;
  }
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
  if (database.dialect === 'postgres') {
    if (availability) {
      await database.query(
        `UPDATE vendor_availability SET status = 'booked', note = $1
         WHERE vendor_id = $2 AND available_date = $3::date`,
        [note, vendorId, scheduledDate],
      );
    } else {
      await database.query(
        `INSERT INTO vendor_availability (vendor_id, available_date, status, note)
         VALUES ($1, $2::date, 'booked', $3)
         ON CONFLICT (vendor_id, available_date)
         DO UPDATE SET status = 'booked', note = EXCLUDED.note`,
        [vendorId, scheduledDate, note],
      );
    }
    return;
  }
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
  if (database.dialect === 'postgres') {
    const remaining = await database.query(
      `SELECT b.id FROM bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.vendor_id = $1 AND b.id <> $2
         AND b.status = ANY($3::varchar[])
         AND COALESCE(b.scheduled_date::date, e.start_date::date) = $4::date
       LIMIT 1`,
      [vendorId, bookingId, ['accepted', 'confirmed', 'in_progress'], scheduledDate],
    );
    if (!remaining.rows[0]) {
      await database.query(
        `UPDATE vendor_availability SET status = 'available', note = NULL
         WHERE vendor_id = $1 AND available_date = $2::date
           AND status = 'booked' AND note = $3`,
        [vendorId, scheduledDate, `Booking #${bookingId}`],
      );
    }
    return;
  }
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
