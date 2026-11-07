import { getDatabaseConfigurationErrors } from './databaseConfig.js';

const requiredVariables = [
  'WEB_ORIGIN',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
  'NODE_ENV',
];

function isValidOriginList(value, isProduction) {
  const origins = value.split(',').map((origin) => origin.trim());
  if (!origins.length || origins.some((origin) => !origin || origin === '*')) return false;
  return origins.every((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.origin === origin
        && (!isProduction || parsed.protocol === 'https:');
    } catch {
      return false;
    }
  });
}

export function getStartupConfigurationErrors(environment = process.env) {
  const errors = [...getDatabaseConfigurationErrors(environment)];
  for (const name of requiredVariables) {
    if (!environment[name]?.trim()) {
      const suggestion = name === 'WEB_ORIGIN'
        ? 'set exact frontend origins, comma-separated'
        : name === 'COOKIE_SECURE'
          ? 'set to true in production or false locally'
          : name === 'COOKIE_SAME_SITE'
            ? 'set to none in production or lax locally'
            : 'set to production, development, or test';
      errors.push(`${name} (${suggestion})`);
    }
  }

  if (environment.COOKIE_SECURE && !['true', 'false'].includes(environment.COOKIE_SECURE)) {
    errors.push('COOKIE_SECURE (set to true or false)');
  }
  if (environment.COOKIE_SAME_SITE && !['strict', 'lax', 'none'].includes(environment.COOKIE_SAME_SITE)) {
    errors.push('COOKIE_SAME_SITE (set to strict, lax, or none)');
  }
  if (environment.COOKIE_SAME_SITE === 'none' && environment.COOKIE_SECURE !== 'true') {
    errors.push('COOKIE_SECURE (set to true when COOKIE_SAME_SITE is none)');
  }
  if (environment.NODE_ENV && !['development', 'test', 'production'].includes(environment.NODE_ENV)) {
    errors.push('NODE_ENV (set to production, development, or test)');
  }
  if (environment.WEB_ORIGIN && !isValidOriginList(environment.WEB_ORIGIN, environment.NODE_ENV === 'production')) {
    errors.push('WEB_ORIGIN (set exact origins; production origins must use HTTPS)');
  }
  if (environment.NODE_ENV === 'production') {
    if (environment.COOKIE_SECURE !== 'true') {
      errors.push('COOKIE_SECURE (set to true in production)');
    }
    if (environment.COOKIE_SAME_SITE !== 'none') {
      errors.push('COOKIE_SAME_SITE (set to none in production)');
    }
  }

  return [...new Set(errors)];
}
