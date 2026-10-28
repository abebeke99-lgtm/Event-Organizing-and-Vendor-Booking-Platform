export function summarizeVendorOverview({ services = [], bookings = [], quotations = [], earnings = [], messages = [], ratings = [] }) {
  const activeServices = services.filter((service) => {
    const status = String(service.status || '').toLowerCase();
    return status === 'published' || status === 'active';
  }).length;

  const pendingBookings = bookings.filter((booking) => {
    const status = String(booking.status || '').toLowerCase();
    return ['pending', 'under_review', 'awaiting_customer_confirmation'].includes(status);
  }).length;

  const confirmedBookings = bookings.filter((booking) => {
    const status = String(booking.status || '').toLowerCase();
    return ['accepted', 'confirmed', 'in_progress'].includes(status);
  }).length;

  const unreadMessages = messages.filter((message) => !message.read).length;
  const averageRating = ratings.length ? Number((ratings.reduce((sum, rating) => sum + Number(rating || 0), 0) / ratings.length).toFixed(2)) : 0;
  const totalEarnings = earnings.reduce((sum, amount) => sum + Number(amount || 0), 0);

  return {
    totalServices: services.length,
    activeServices,
    pendingBookings,
    confirmedBookings,
    pendingQuotations: quotations.filter((item) => ['received', 'draft', 'sent', 'revision_requested'].includes(String(item.status || '').toLowerCase())).length,
    totalEarnings,
    averageRating,
    unreadMessages,
  };
}

export function validateVendorBookingTransition(currentStatus, nextStatus) {
  const normalizedCurrent = String(currentStatus || '').trim().toLowerCase();
  const normalizedNext = String(nextStatus || '').trim().toLowerCase();

  if (!normalizedCurrent || !normalizedNext) return false;

  const allowed = {
    pending: ['accepted', 'rejected', 'under_review'],
    under_review: ['accepted', 'rejected'],
    accepted: ['confirmed', 'cancelled', 'in_progress', 'completed'],
    confirmed: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    rejected: [],
    cancelled: [],
    awaiting_customer_confirmation: ['accepted', 'rejected'],
  };

  return (allowed[normalizedCurrent] || []).includes(normalizedNext);
}

export function ensureVendorOwnership(recordVendorId, authenticatedVendorId) {
  if (Number(recordVendorId) !== Number(authenticatedVendorId)) {
    throw new Error('Vendor ownership mismatch: record does not belong to this vendor.');
  }
  return true;
}
