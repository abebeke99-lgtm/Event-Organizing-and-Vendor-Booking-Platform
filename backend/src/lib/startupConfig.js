import { getDatabaseConfigurationErrors } from './databaseConfig.js';

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
  const isProduction = environment.NODE_ENV === 'production';

  if (!environment.NODE_ENV?.trim()) {
    errors.push('NODE_ENV (set to production, development, or test)');
  } else if (!['development', 'test', 'production'].includes(environment.NODE_ENV)) {
    errors.push('NODE_ENV (set to production, development, or test)');
  }

  if (!environment.WEB_ORIGIN?.trim()) {
    errors.push('WEB_ORIGIN (set exact frontend origins, comma-separated)');
  } else if (!isValidOriginList(environment.WEB_ORIGIN, isProduction)) {
    errors.push('WEB_ORIGIN (set exact origins; production origins must use HTTPS)');
  }

  if (!environment.COOKIE_SECURE?.trim()) {
    errors.push('COOKIE_SECURE (set to true in production or false locally)');
  } else if (!['true', 'false'].includes(environment.COOKIE_SECURE)) {
    errors.push('COOKIE_SECURE (set to true or false)');
  } else if (isProduction && environment.COOKIE_SECURE !== 'true') {
    errors.push('COOKIE_SECURE (set to true in production)');
  } else if (environment.COOKIE_SAME_SITE === 'none' && environment.COOKIE_SECURE !== 'true') {
    errors.push('COOKIE_SECURE (set to true when COOKIE_SAME_SITE is none)');
  }

  if (!environment.COOKIE_SAME_SITE?.trim()) {
    errors.push('COOKIE_SAME_SITE (set to none in production or lax locally)');
  } else if (!['strict', 'lax', 'none'].includes(environment.COOKIE_SAME_SITE)) {
    errors.push('COOKIE_SAME_SITE (set to strict, lax, or none)');
  } else if (isProduction && environment.COOKIE_SAME_SITE !== 'none') {
    errors.push('COOKIE_SAME_SITE (set to none in production)');
  }

  return [...new Set(errors)];
}
