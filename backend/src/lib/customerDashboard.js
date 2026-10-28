export function summarizeCustomerOverview({ events = [], bookings = [], quotations = [], payments = [], messages = [], notifications = [] }) {
  const pendingBookings = bookings.filter((booking) => {
    const status = String(booking.status || '').trim().toLowerCase();
    return ['pending', 'awaiting_payment', 'under_review', 'requested', 'awaiting_customer_confirmation'].includes(status);
  }).length;

  const confirmedBookings = bookings.filter((booking) => {
    const status = String(booking.status || '').trim().toLowerCase();
    return ['confirmed', 'accepted', 'in_progress'].includes(status);
  }).length;

  const upcomingEvents = events.filter((event) => new Date(event.date || event.start_date || 0).getTime() >= Date.now()).length;
  const completedBookings = bookings.filter((booking) => {
    const status = String(booking.status || '').trim().toLowerCase();
    return ['completed', 'paid', 'finished'].includes(status);
  }).length;

  const pendingQuotations = quotations.filter((quotation) => {
    const status = String(quotation.status || '').trim().toLowerCase();
    return !['accepted', 'declined', 'expired'].includes(status);
  }).length;

  const outstandingPayments = payments.filter((payment) => {
    const status = String(payment.status || '').trim().toLowerCase();
    return ['pending', 'waiting', 'failed', 'requires_action'].includes(status);
  }).length;

  const unreadMessages = messages.filter((message) => !message.read).length;
  const unreadNotifications = notifications.filter((notification) => !notification.read).length;

  return {
    totalBookings: bookings.length,
    pendingBookings,
    confirmedBookings,
    upcomingEvents,
    completedBookings,
    pendingQuotations,
    outstandingPayments,
    unreadMessages,
    unreadNotifications,
  };
}

export function ensureCustomerOwnership(recordCustomerId, authenticatedCustomerId) {
  if (Number(recordCustomerId) !== Number(authenticatedCustomerId)) {
    throw new Error('Customer ownership mismatch: record does not belong to this customer.');
  }
  return true;
}

export function isDuplicateFavorite(existingFavorites = [], vendorId) {
  return existingFavorites.some((favorite) => Number(favorite.vendorId) === Number(vendorId));
}
