const ENDPOINTS_BY_VIEW = {
  overview: ['overview', 'vendors', 'services', 'bookings', 'events', 'messages', 'notifications'],
  vendors: ['categories', 'favorites', 'events'],
  services: ['categories', 'favorites', 'events', 'saved-services'],
  categories: [],
  bookings: [],
  history: [],
  events: ['events'],
  favorites: ['favorites', 'saved-services'],
  quotations: ['quotations'],
  payments: ['payments', 'refunds'],
  messages: ['bookings', 'messages'],
  reviews: ['bookings', 'reviews'],
  notifications: ['notifications'],
  support: ['complaints', 'bookings'],
  profile: ['profile'],
};

export function getCustomerDashboardEndpoints(view) {
  return ENDPOINTS_BY_VIEW[view] || [];
}

export function createCustomerDashboardOverviewRequests(api, owner, signal, requestDashboardData) {
  const [overviewEndpoint, ...secondaryEndpoints] = getCustomerDashboardEndpoints('overview');
  const overview = requestDashboardData(
    api,
    owner,
    `/customer/${overviewEndpoint}`,
    signal,
  );
  const secondary = Promise.allSettled(secondaryEndpoints.map((endpoint) => (
    requestDashboardData(api, owner, `/customer/${endpoint}`, signal)
  )));

  return { overview, secondary, secondaryEndpoints };
}
