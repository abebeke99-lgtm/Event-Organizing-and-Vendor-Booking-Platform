import axios from 'axios';
import { clearPlatformSessionHint, getRetryAfterMilliseconds } from '../authSession.js';
import { getLanguage } from '../language.js';
import { resolveApiBaseUrl } from './apiUrl.js';

const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : import.meta.env;
const browserHostname = typeof window === 'undefined' ? undefined : window.location.hostname;

const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(
    viteEnvironment.VITE_API_URL,
    Boolean(viteEnvironment.PROD),
    browserHostname,
  ),
  withCredentials: true,
  timeout: 15_000,
});

let sessionInvalidationDispatched = false;

apiClient.interceptors.request.use((config) => {
  config.withCredentials = true;
  config.headers = { ...config.headers, 'Accept-Language': getLanguage() };
  return config;
});

apiClient.interceptors.response.use((response) => {
  const requestPath = String(response.config?.url || '');
  if (/\/(?:auth|platform)\/(?:login|me)(?:\?|$)/.test(requestPath)) {
    sessionInvalidationDispatched = false;
  }
  return response;
}, async (error) => {
  if (!axios.isAxiosError(error) || axios.isCancel(error)) throw error;
  if (!error.response) {
    const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    throw Object.assign(new Error(
      timedOut
        ? 'The server took too long to respond. Please try again.'
        : 'Unable to reach the server. Check your connection and try again.',
    ), {
      code: error.code || 'NETWORK_ERROR',
      cause: error,
    });
  }

  let body = error.response.data;
  if (body instanceof Blob) {
    try {
      body = JSON.parse(await body.text());
    } catch {
      body = null;
    }
  }
  const status = error.response.status;
  const message = body && typeof body === 'object' && (body.message || body.error);
  const retryAfter = error.response.headers?.get?.('retry-after')
    ?? error.response.headers?.['retry-after'];
  const requestPath = String(error.config?.url || '');
  const isSessionProbe = /\/(?:auth|platform)\/me(?:\?|$)/.test(requestPath);
  const isPlatformSessionProbe = /\/platform\/me(?:\?|$)/.test(requestPath);
  const isLoginRequest = /\/(?:auth|platform)\/login(?:\?|$)/.test(requestPath);
  const isAuthenticatedRequest = /^\/(?:admin|platform|vendor|customer|organizer|ai)(?:\/|$)/.test(requestPath);

  if (status === 401 && isAuthenticatedRequest && !isSessionProbe && !isLoginRequest
    && typeof window !== 'undefined' && !sessionInvalidationDispatched) {
    clearPlatformSessionHint();
    sessionInvalidationDispatched = true;
    window.dispatchEvent(new Event('eventhub:auth-invalidated'));
  }
  if (status === 401 && isPlatformSessionProbe) clearPlatformSessionHint();

  throw Object.assign(new Error(message || `Request failed (${status}).`), {
    status,
    retryAfterMs: getRetryAfterMilliseconds(retryAfter),
  });
});

export default apiClient;
