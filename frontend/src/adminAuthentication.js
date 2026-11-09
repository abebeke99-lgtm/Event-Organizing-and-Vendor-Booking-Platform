const PLATFORM_ROLES = new Set(['organizer', 'vendor', 'customer']);

export async function authenticateAdministrator(request, email, password) {
  const loginResponse = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const loginUser = loginResponse?.user;
  if (!loginUser || loginUser.id == null || typeof loginUser.email !== 'string'
    || String(loginUser.role).toLowerCase() !== 'admin') {
    if (loginUser) await request('/auth/logout', { method: 'POST' });
    throw new Error('The server did not confirm an active administrator account.');
  }

  let sessionResponse;
  try {
    sessionResponse = await request('/auth/me');
  } catch (sessionError) {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch (logoutError) {
      throw new AggregateError(
        [sessionError, logoutError],
        'The administrator session could not be verified or terminated.',
      );
    }
    throw sessionError;
  }
  const sessionUser = sessionResponse?.user;
  const roles = typeof sessionUser?.roles === 'string'
    ? sessionUser.roles.split(',').map((role) => role.trim())
    : sessionUser?.roles;
  if (!sessionUser
    || String(sessionUser.id) !== String(loginUser.id)
    || typeof sessionUser.email !== 'string'
    || sessionUser.email.toLowerCase() !== loginUser.email.toLowerCase()
    || String(sessionUser.role).toLowerCase() !== 'admin'
    || sessionUser.status !== 'active'
    || !Array.isArray(roles)
    || !roles.some((role) => typeof role === 'string' && role.toLowerCase() === 'admin')) {
    await request('/auth/logout', { method: 'POST' });
    throw new Error('The administrator session could not be verified.');
  }
  return sessionUser;
}

export async function authenticatePlatformUser(request, email, password) {
  const response = await request('/platform/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const user = response?.user ?? response?.data?.user;
  if (!user || !PLATFORM_ROLES.has(String(user.role || '').toLowerCase())) {
    if (user && String(user.role || '').toLowerCase() === 'admin') {
      await request('/auth/logout', { method: 'POST' });
      throw new Error('Administrator accounts must sign in at /admin/login.');
    }
    throw new Error('The server did not confirm a valid account and role.');
  }
  return { ...user, role: String(user.role).toLowerCase() };
}

export function dashboardPathForRole(role) {
  const paths = {
    admin: '/admin',
    organizer: '/organizer/dashboard',
    vendor: '/vendor/dashboard',
    customer: '/customer/dashboard',
  };
  return paths[String(role || '').toLowerCase()] || '/login';
}

export function getAdministratorRouteRedirect(path, user) {
  const route = String(path || '').split('?')[0];
  const role = String(user?.role || '').toLowerCase();
  if (route === '/admin/login') return role === 'admin' ? '/admin' : null;
  if (!route.startsWith('/admin') || role === 'admin') return null;
  return user ? null : '/admin/login';
}
