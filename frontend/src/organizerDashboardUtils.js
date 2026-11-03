function eventDate(value) {
  if (!value) return Number.NaN;
  return Date.parse(String(value).replace(' ', 'T'));
}

export function summarizeOrganizerDashboard(events = [], bookings = [], now = new Date()) {
  const nowTime = now instanceof Date ? now.getTime() : Number(now);
  const upcomingEvents = events
    .filter((event) => !['cancelled', 'completed'].includes(String(event.status || '').toLowerCase())
      && eventDate(event.startDate || event.date) >= nowTime)
    .sort((left, right) => eventDate(left.startDate || left.date) - eventDate(right.startDate || right.date));
  const ongoingCount = events.filter((event) => {
    if (String(event.status || '').toLowerCase() === 'in_progress') return true;
    const start = eventDate(event.startDate || event.date);
    const end = eventDate(event.endDate);
    return Number.isFinite(start) && Number.isFinite(end) && start <= nowTime && end >= nowTime
      && !['cancelled', 'completed'].includes(String(event.status || '').toLowerCase());
  }).length;
  const statusCounts = bookings.reduce((counts, booking) => {
    const status = String(booking.status || '').toLowerCase();
    if (['requested', 'pending', 'under_review', 'quoted'].includes(status)) counts.pending += 1;
    if (['accepted', 'confirmed', 'in_progress'].includes(status)) counts.confirmed += 1;
    if (status === 'completed') counts.completed += 1;
    return counts;
  }, { pending: 0, confirmed: 0, completed: 0 });

  return {
    totalEvents: events.length,
    upcomingEvents,
    upcomingCount: upcomingEvents.length,
    ongoingCount,
    totalBudget: events.reduce((sum, event) => sum + Number(event.budget || 0), 0),
    ...statusCounts,
  };
}