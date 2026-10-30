import { getDatabaseConfigurationErrors } from './databaseConfig.js';

const requiredVariables = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'WEB_ORIGIN',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
  'NODE_ENV',
];

export function getStartupConfigurationErrors(environment = process.env) {
  const errors = new Set(
    requiredVariables.filter((name) => !environment[name]?.trim()),
  );
  for (const error of getDatabaseConfigurationErrors(environment)) {
    errors.add(error.split(/[ (]/)[0].split('=')[0]);
  }

  if (environment.COOKIE_SECURE && !['true', 'false'].includes(environment.COOKIE_SECURE)) {
    errors.add('COOKIE_SECURE');
  }
  if (environment.COOKIE_SAME_SITE && !['strict', 'lax', 'none'].includes(environment.COOKIE_SAME_SITE)) {
    errors.add('COOKIE_SAME_SITE');
  }
  if (environment.NODE_ENV && !['development', 'test', 'production'].includes(environment.NODE_ENV)) {
    errors.add('NODE_ENV');
  }
  if (environment.WEB_ORIGIN) {
    const origins = environment.WEB_ORIGIN.split(',').map((origin) => origin.trim());
    if (origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return parsed.origin !== origin
          || (environment.NODE_ENV === 'production' && parsed.protocol !== 'https:');
      } catch {
        return true;
      }
    })) errors.add('WEB_ORIGIN');
  }
  if (environment.NODE_ENV === 'production') {
    if (environment.COOKIE_SECURE !== 'true') errors.add('COOKIE_SECURE');
    if (environment.COOKIE_SAME_SITE !== 'none') errors.add('COOKIE_SAME_SITE');
    if (!environment.WEB_ORIGIN?.trim()) errors.add('WEB_ORIGIN');
  }

  return [...errors];
}
