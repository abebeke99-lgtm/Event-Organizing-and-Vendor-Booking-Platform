const PLATFORM_ROLES = new Set(['admin', 'organizer', 'vendor', 'customer']);

export async function authenticatePlatformUser(request, email, password) {
  const response = await request('/platform/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const user = response?.user ?? response?.data?.user;
  if (!user || !PLATFORM_ROLES.has(String(user.role || '').toLowerCase())) {
    throw new Error('The server did not confirm a valid account and role.');
  }
  return { ...user, role: String(user.role).toLowerCase() };
}

export function dashboardPathForRole(role) {
  const paths = {
    admin: '/admin/dashboard',
    organizer: '/organizer/dashboard',
    vendor: '/vendor/dashboard',
    customer: '/customer/dashboard',
  };
  return paths[String(role || '').toLowerCase()] || '/login';
}

export function getAdministratorRouteRedirect(path, user) {
  const route = String(path || '').split('?')[0];
  if (route === '/admin/login') return '/login';
  if (!route.startsWith('/admin') || user) return null;
  return '/login';
}
