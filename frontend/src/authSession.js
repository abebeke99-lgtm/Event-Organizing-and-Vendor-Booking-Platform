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

export const PLATFORM_SESSION_HINT_KEY = 'eventhub-platform-session';

export function hasPlatformSessionHint() {
  try {
    return globalThis.localStorage?.getItem(PLATFORM_SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPlatformSessionHint() {
  try {
    globalThis.localStorage?.setItem(PLATFORM_SESSION_HINT_KEY, '1');
  } catch {
    return;
  }
}

export function clearPlatformSessionHint() {
  try {
    globalThis.localStorage?.removeItem(PLATFORM_SESSION_HINT_KEY);
  } catch {
    return;
  }
}

export function createAuthSessionLoader({
  getAdminSession,
  getPlatformSession,
  hasPlatformSession = () => true,
  clearPlatformSession = () => {},
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  sessionRetryAttempts = 3,
}) {
  let snapshot = { status: 'loading' };
  let inFlight = null;
  let generation = 0;
  const listeners = new Set();

  function publish(nextSnapshot) {
    snapshot = nextSnapshot;
    for (const listener of listeners) listener();
  }

  async function getSessionWithRetry(getSession) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await getSession();
      } catch (error) {
        if (error?.status !== 503 || attempt >= sessionRetryAttempts) throw error;
        await sleep(500 * (2 ** (attempt - 1)));
      }
    }
  }

  async function resolveSession() {
    const [adminResult, platformResult] = await Promise.allSettled([
      getSessionWithRetry(getAdminSession),
      hasPlatformSession() ? getSessionWithRetry(getPlatformSession) : Promise.resolve({ user: null }),
    ]);
    const adminResponse = adminResult.status === 'fulfilled' ? adminResult.value : null;
    const platformResponse = platformResult.status === 'fulfilled' ? platformResult.value : null;
    const hasAdminPayload = Boolean(adminResponse && Object.hasOwn(adminResponse, 'user'));
    const hasPlatformPayload = Boolean(
      (platformResponse?.data && Object.hasOwn(platformResponse.data, 'user'))
      || (platformResponse && Object.hasOwn(platformResponse, 'user')),
    );
    const adminUser = hasAdminPayload ? adminResponse.user : null;
    const platformUser = platformResponse?.data?.user ?? platformResponse?.user ?? null;

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
    const wakingError = errors.find((error) => error?.status === 503);
    if (wakingError) {
      return {
        status: 'waking',
        message: 'Server is waking up. Please wait a moment, then retry.',
      };
    }
    if (platformResult.status === 'rejected' && platformResult.reason?.status === 401) {
      clearPlatformSession();
    }
    const requestError = errors.find((error) => error?.status !== 401);
    if (requestError) return getErrorResult(requestError, now);

    return { status: 'unauthenticated', user: null, role: null };
  }

  function load({ force = false } = {}) {
    if (inFlight) return inFlight;
    if (snapshot.status === 'rate-limited' && now() < snapshot.retryAt) {
      return Promise.resolve(snapshot);
    }
    if (!force && ['authenticated', 'unauthenticated', 'error', 'waking'].includes(snapshot.status)) {
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