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
  profile: ['profile'],
};

export function getCustomerDashboardEndpoints(view) {
  return ENDPOINTS_BY_VIEW[view] || [];
}
