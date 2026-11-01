function getErrorResult(error, now) {
  if (error?.status === 429) {
    const retryAfterMs = Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
      ? error.retryAfterMs
      : 60_000;
    return {
      status: 'rate-limited',
      message: error.message || 'Session verification is temporarily rate limited.',
      retryAfterMs,
      retryAt: now() + retryAfterMs,
    };
  }

  return {
    status: 'error',
    message: error?.message || 'Session verification is temporarily unavailable.',
  };
}

export function getRetryAfterMilliseconds(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now);
}

export function createAuthSessionLoader({ getAdminSession, getPlatformSession, now = Date.now }) {
  let snapshot = { status: 'loading' };
  let inFlight = null;
  let generation = 0;
  const listeners = new Set();

  function publish(nextSnapshot) {
    snapshot = nextSnapshot;
    for (const listener of listeners) listener();
  }

  async function resolveSession() {
    const [adminResult, platformResult] = await Promise.allSettled([
      getAdminSession(),
      getPlatformSession(),
    ]);
    const adminResponse = adminResult.status === 'fulfilled' ? adminResult.value : null;
    const platformResponse = platformResult.status === 'fulfilled' ? platformResult.value : null;
    const hasAdminPayload = Boolean(adminResponse && Object.hasOwn(adminResponse, 'user'));
    const hasPlatformPayload = Boolean(platformResponse?.data && Object.hasOwn(platformResponse.data, 'user'));
    const adminUser = hasAdminPayload ? adminResponse.user : null;
    const platformUser = hasPlatformPayload ? platformResponse.data.user : null;

    if (adminUser) return { status: 'authenticated', user: adminUser, role: 'admin' };
    if (platformUser) return { status: 'authenticated', user: platformUser, role: platformUser.role };

    if ((adminResult.status === 'fulfilled' && !hasAdminPayload)
      || (platformResult.status === 'fulfilled' && !hasPlatformPayload)) {
      return getErrorResult(new Error('Session response was invalid.'), now);
    }

    const errors = [adminResult, platformResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    const rateLimitError = errors.find((error) => error?.status === 429);
    if (rateLimitError) return getErrorResult(rateLimitError, now);
    const requestError = errors.find((error) => error?.status !== 401);
    if (requestError) return getErrorResult(requestError, now);

    return { status: 'unauthenticated', user: null, role: null };
  }

  function load({ force = false } = {}) {
    if (inFlight) return inFlight;
    if (snapshot.status === 'rate-limited' && now() < snapshot.retryAt) {
      return Promise.resolve(snapshot);
    }
    if (!force && ['authenticated', 'unauthenticated', 'error'].includes(snapshot.status)) {
      return Promise.resolve(snapshot);
    }

    const currentGeneration = generation;
    publish({ status: 'loading' });
    const request = resolveSession()
      .then((result) => {
        if (generation === currentGeneration) publish(result);
        return result;
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });
    inFlight = request;
    return request;
  }

  function setAuthenticated(user, role = user?.role || 'customer') {
    generation += 1;
    inFlight = null;
    publish({ status: 'authenticated', user, role });
  }

  function setUnauthenticated() {
    generation += 1;
    inFlight = null;
    publish({ status: 'unauthenticated', user: null, role: null });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getSnapshot: () => snapshot,
    load,
    setAuthenticated,
    setUnauthenticated,
    subscribe,
  };
}