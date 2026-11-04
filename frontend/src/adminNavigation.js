export const ADMIN_DASHBOARD_SLUGS = Object.freeze([
  'overview',
  'users',
  'roles',
  'vendors',
  'categories',
  'events',
  'bookings',
  'package-requests',
  'payments',
  'reviews',
  'complaints',
  'messages',
  'reports',
  'notifications',
  'audit-logs',
  'settings',
  'profile',
  'hero-images',
  'account-settings',
]);

export function adminPathForSlug(slug) {
  const section = ADMIN_DASHBOARD_SLUGS.includes(slug) ? slug : 'overview';
  return section === 'overview' ? '/admin' : `/admin/${section}`;
}

export function adminSlugFromPath(path) {
  const pathname = String(path ?? '').split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  const match = pathname.match(/^\/admin(?:\/([^/]+))?$/);
  if (!match) return null;
  const section = match[1] || 'overview';
  return ADMIN_DASHBOARD_SLUGS.includes(section) ? section : 'overview';
}