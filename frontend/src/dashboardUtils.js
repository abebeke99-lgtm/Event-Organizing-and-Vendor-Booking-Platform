export function formatDashboardDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDashboardDateRange(preset, now = new Date(), customRange = {}) {
  const endDate = formatDashboardDate(now);
  if (preset === 'custom') {
    return { startDate: customRange.startDate || endDate, endDate: customRange.endDate || endDate };
  }
  const days = preset === 'today' ? 1 : preset === '7d' ? 7 : 30;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  return { startDate: formatDashboardDate(start), endDate };
}
