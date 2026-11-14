const LOCAL_API_URL = 'http://127.0.0.1:4000/api';

function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127;
}

export function resolveApiBaseUrl(configuredUrl, isProduction, currentHostname) {
  let value = (configuredUrl || '').trim();
  if (!value) {
    if (isProduction) {
      throw new Error('VITE_API_URL must be configured to the deployed API origin or its /api base path.');
    }
    value = LOCAL_API_URL;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error('VITE_API_URL must be a valid API origin or end in /api, without query or fragment.');
  }

  const path = parsedUrl.pathname.replace(/\/$/, '');
  if (!['http:', 'https:'].includes(parsedUrl.protocol)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
    || (path && path !== '/api')) {
    throw new Error('VITE_API_URL must be an API origin or end in /api, without credentials, query, or fragment.');
  }
  if (!isProduction && currentHostname && isLoopbackHost(currentHostname)
    && isLoopbackHost(parsedUrl.hostname)) {
    parsedUrl.hostname = currentHostname.replace(/^\[|\]$/g, '');
  }
  if (isProduction && parsedUrl.protocol !== 'https:') {
    throw new Error('Production VITE_API_URL must use HTTPS.');
  }
  if (isProduction && isLoopbackHost(parsedUrl.hostname)) {
    throw new Error('Production VITE_API_URL must not use a localhost or loopback host.');
  }

  return `${parsedUrl.origin}/api`;
}
