export const BOOKING_TRANSITIONS = Object.freeze({
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
  expired: ['pending'],
});

export function validateBookingTransition(currentStatus, nextStatus) {
  if (!currentStatus || !nextStatus) return false;
  const allowed = BOOKING_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

export function createBookingSnapshot({ id, status, quotedAmount, currency, serviceTitle }) {
  return {
    id,
    status: status || 'pending',
    amount: Number(quotedAmount ?? 0),
    currency: String(currency || 'ETB').toUpperCase(),
    serviceTitle: serviceTitle || 'Event service',
  };
}

export function calculateDashboardSummary({ users = 0, vendors = 0, events = 0, bookings = [] }) {
  const totalBookings = Array.isArray(bookings) ? bookings.length : 0;
  let pendingBookings = 0;
  let confirmedBookings = 0;
  let completedBookings = 0;
  let cancelledBookings = 0;

  for (const booking of bookings) {
    const currentStatus = String((booking && booking.status) || '').toLowerCase();

    if (currentStatus === 'pending') pendingBookings += 1;
    if (['accepted', 'awaiting_payment', 'confirmed'].includes(currentStatus)) confirmedBookings += 1;
    if (currentStatus === 'completed') completedBookings += 1;
    if (currentStatus === 'cancelled') cancelledBookings += 1;
  }

  return {
    totalUsers: Number(users),
    totalVendors: Number(vendors),
    totalEvents: Number(events),
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
  };
}
