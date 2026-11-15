import {
  createPostgresPoolConfig,
  getPostgresConfigurationErrors,
} from './postgresConfig.js';

const obsoleteEnvironmentVariables = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_SSL_CA',
  'DB_SSL_CA_BASE64',
];

export function getDatabaseConfigurationErrors(environment = process.env, options = {}) {
  const errors = getPostgresConfigurationErrors(environment, { purpose: 'runtime', ...options });
  for (const name of obsoleteEnvironmentVariables) {
    if (environment[name]?.trim()) {
      errors.push(`${name} is obsolete; configure the Neon PostgreSQL URL instead.`);
    }
  }
  return [...new Set(errors)];
}

export function validateDatabaseEnvironment(environment = process.env) {
  const errors = getDatabaseConfigurationErrors(environment, { purpose: 'runtime' });
  if (errors.length) {
    throw new Error(`Database configuration is incomplete or invalid: ${errors.join(' ')}`);
  }
}

export function createDatabaseConfig(environment = process.env) {
  validateDatabaseEnvironment(environment);
  return createPostgresPoolConfig(environment, { purpose: 'runtime' });
}
