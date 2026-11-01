import axios from 'axios';
import { getRetryAfterMilliseconds } from '../authSession.js';

function resolveApiBaseUrl() {
  const configuredUrl = (import.meta.env.VITE_API_URL || '').trim();
  if (!configuredUrl) {
    if (import.meta.env.PROD) {
      throw new Error('VITE_API_URL must be configured to the deployed API origin or its /api base path.');
    }
    return '/api';
  }

  const parsedUrl = new URL(configuredUrl);
  const path = parsedUrl.pathname.replace(/\/$/, '');
  if (parsedUrl.search || parsedUrl.hash || (path && path !== '/api')) {
    throw new Error('VITE_API_URL must be an API origin or end in /api, without query or fragment.');
  }
  if (import.meta.env.PROD && parsedUrl.protocol !== 'https:') {
    throw new Error('Production VITE_API_URL must use HTTPS.');
  }

  return `${parsedUrl.origin}/api`;
}

const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
});

let invalidationQueued = false;

apiClient.interceptors.request.use((config) => {
  config.withCredentials = true;
  return config;
});

apiClient.interceptors.response.use(undefined, async (error) => {
  if (!axios.isAxiosError(error) || !error.response) throw error;

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
  const isLoginRequest = /\/(?:auth|platform)\/login(?:\?|$)/.test(requestPath);

  if (status === 401 && !isSessionProbe && !isLoginRequest && typeof window !== 'undefined' && !invalidationQueued) {
    invalidationQueued = true;
    queueMicrotask(() => {
      window.dispatchEvent(new Event('eventhub:auth-invalidated'));
      invalidationQueued = false;
    });
  }

  throw Object.assign(new Error(message || `Request failed (${status}).`), {
    status,
    retryAfterMs: getRetryAfterMilliseconds(retryAfter),
  });
});

export default apiClient;
