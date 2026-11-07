const PLATFORM_ROLES = new Set(['customer', 'organizer', 'vendor']);

export async function authenticateAdministrator(request, email, password) {
  const loginResponse = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const loggedInUser = loginResponse?.user;
  if (!loggedInUser || loggedInUser.id == null || typeof loggedInUser.email !== 'string') {
    throw new Error('Administrator sign-in response was invalid.');
  }

  const sessionResponse = await request('/auth/me');
  const authenticatedUser = sessionResponse?.user;
  const roles = typeof authenticatedUser?.roles === 'string'
    ? authenticatedUser.roles.split(',').map((role) => role.trim())
    : authenticatedUser?.roles;
  if (!authenticatedUser
    || String(authenticatedUser.id) !== String(loggedInUser.id)
    || authenticatedUser.email?.toLowerCase() !== loggedInUser.email.toLowerCase()
    || !Array.isArray(roles)
    || !roles.some((role) => role.toLowerCase() === 'admin')) {
    throw new Error('Administrator session could not be verified.');
  }
  return authenticatedUser;
}

export async function authenticatePlatformUser(request, email, password) {
  const response = await request('/platform/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const user = response?.data?.user;
  if (!user || !PLATFORM_ROLES.has(user.role)) {
    throw new Error('This sign-in page is for customer, organizer, and vendor accounts.');
  }
  return user;
}

export function getAdministratorRouteRedirect(path, user, portal) {
  const route = String(path || '').split('?')[0];
  if (!route.startsWith('/admin')) return null;
  if (user && portal === 'admin' && (!user.role || user.role === 'admin')) {
    return route === '/admin/login' ? '/admin' : null;
  }
  if (user) {
    const role = ['customer', 'organizer', 'vendor'].includes(portal) ? portal : 'customer';
    return `/${role}/dashboard`;
  }
  return route === '/admin/login' ? null : '/admin/login';
}
