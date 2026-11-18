const LOCAL_API_URL = 'http://127.0.0.1:5000/api';
const RESERVED_HOST_SUFFIXES = ['.example', '.invalid', '.test'];
const RESERVED_EXAMPLE_HOSTS = new Set(['example.com', 'example.net', 'example.org']);

function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127;
}

function isReservedHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return RESERVED_EXAMPLE_HOSTS.has(host)
    || [...RESERVED_EXAMPLE_HOSTS].some((reservedHost) => host.endsWith(`.${reservedHost}`))
    || RESERVED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
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
  if (isProduction && isReservedHost(parsedUrl.hostname)) {
    throw new Error('Production VITE_API_URL must not use an example or reserved placeholder domain.');
  }

  return `${parsedUrl.origin}/api`;
}
