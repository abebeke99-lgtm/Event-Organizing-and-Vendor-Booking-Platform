const providerIds = ['google', 'microsoft'];

export function parseOAuthProviderStatuses(response) {
  if (!Array.isArray(response?.providers)
    || ![providerIds.length, providerIds.length - 1].includes(response.providers.length)) {
    throw Object.assign(new Error('The server returned an invalid social sign-in provider list.'), {
      code: 'INVALID_OAUTH_PROVIDER_RESPONSE',
    });
  }

  const statuses = {};
  for (const provider of response.providers) {
    if (!providerIds.includes(provider?.id)
      || !['configured', 'not_configured'].includes(provider.status)
      || provider.configured !== (provider.status === 'configured')
      || Object.hasOwn(statuses, provider.id)) {
      throw Object.assign(new Error('The server returned an invalid social sign-in provider list.'), {
        code: 'INVALID_OAUTH_PROVIDER_RESPONSE',
      });
    }
    statuses[provider.id] = provider.status;
  }

  const missingProviders = providerIds.filter((providerId) => !Object.hasOwn(statuses, providerId));
  if (missingProviders.some((providerId) => providerId !== 'microsoft')) {
    throw Object.assign(new Error('The server returned an incomplete social sign-in provider list.'), {
      code: 'INVALID_OAUTH_PROVIDER_RESPONSE',
    });
  }
  if (missingProviders.includes('microsoft')) statuses.microsoft = 'not_configured';
  return statuses;
}

export function getConfiguredOAuthProviders(response) {
  const statuses = parseOAuthProviderStatuses(response);
  return providerIds.filter((provider) => statuses[provider] === 'configured');
}

export function buildOAuthStartUrl(apiBaseUrl, provider, intent = 'login', {
  rememberMe = false,
} = {}) {
  if (!providerIds.includes(provider)) throw new Error('Unsupported social sign-in provider.');
  if (!['login', 'admin-login', 'link'].includes(intent)) throw new Error('Unsupported social sign-in intent.');
  const baseUrl = new URL(apiBaseUrl || '/api', globalThis.location?.origin || 'http://localhost');
  const apiPath = baseUrl.pathname.replace(/\/+$/, '');
  const url = new URL(
    `${apiPath}/platform/oauth/${encodeURIComponent(provider)}/start`,
    baseUrl.origin,
  );
  url.searchParams.set('intent', intent);
  if (rememberMe) url.searchParams.set('rememberMe', 'true');
  return url.href;
}
