const ENDPOINTS_BY_VIEW = {
  overview: ['overview', 'booking-requests', 'services', 'notifications'],
  profile: ['profile', 'categories', 'media'],
  verification: ['verification'],
  services: ['services', 'categories', 'packages', 'media'],
  'add-edit-services': ['services', 'categories', 'packages', 'media'],
  categories: ['categories'],
  pricing: ['packages'],
  availability: ['availability', 'bookings'],
  requests: ['booking-requests'],
  confirmed: ['bookings'],
  history: ['history'],
  coordination: ['tasks'],
  quotations: ['quotations'],
  payments: ['payments'],
  messages: ['messages', 'booking-requests', 'bookings'],
  reviews: ['overview', 'reviews'],
  notifications: ['notifications'],
  reports: ['reports', 'services'],
  settings: ['profile'],
  account: ['account'],
};

export function getVendorDashboardEndpoints(view) {
  return ENDPOINTS_BY_VIEW[view] || [];
}
