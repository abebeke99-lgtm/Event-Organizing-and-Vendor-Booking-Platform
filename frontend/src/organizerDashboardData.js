const SECONDARY_OVERVIEW_ENDPOINTS = [
  ['/platform/events/mine', 'events'],
  ['/platform/vendors?page=1&limit=4&sort=recommended', 'vendors'],
  ['/platform/bookings', 'bookings'],
];

export function createOrganizerDashboardOverviewRequests(api, owner, signal, requestDashboardData) {
  const overview = requestDashboardData(
    api,
    owner,
    '/platform/organizer/overview',
    signal,
  );
  const secondary = Promise.allSettled(SECONDARY_OVERVIEW_ENDPOINTS.map(([path]) => (
    requestDashboardData(api, owner, path, signal)
  )));

  return {
    overview,
    secondary,
    secondaryEndpoints: SECONDARY_OVERVIEW_ENDPOINTS.map(([, endpoint]) => endpoint),
  };
}
