import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getPostgresConfigurationErrors } from './postgresConfig.js';

export const defaultNeonTestEnvironmentPath = fileURLToPath(
  new URL('../../.env.neon-test', import.meta.url),
);
const defaultProductionEnvironmentPath = fileURLToPath(
  new URL('../../.env', import.meta.url),
);
export const NEON_TEST_DATABASE_NAME = 'eventhub';

function postgresDatabaseIdentity(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Production PostgreSQL configuration cannot be verified for Neon test isolation.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length < 2) {
    throw new Error('Production PostgreSQL configuration cannot be verified for Neon test isolation.');
  }

  let database;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error('Production PostgreSQL configuration cannot be verified for Neon test isolation.');
  }

  return {
    host: url.hostname.toLowerCase().replace(/-pooler(?=\.|$)/, ''),
    database,
  };
}

function neonTestDatabaseIdentity(testEnvironment) {
  const identities = ['DATABASE_URL', 'DIRECT_URL']
    .map((name) => testEnvironment[name]?.trim())
    .filter(Boolean)
    .map(postgresDatabaseIdentity);
  return identities.length > 0 ? identities[0] : null;
}

export function assertNeonTestDatabaseIsIsolated(testEnvironment, productionEnvironment) {
  const productionEnvironments = Array.isArray(productionEnvironment)
    ? productionEnvironment
    : [productionEnvironment];
  const productionUrls = productionEnvironments.flatMap((source) => ['DATABASE_URL', 'DIRECT_URL']
    .map((name) => source[name]?.trim())
    .filter(Boolean));
  if (!productionUrls.length) {
    throw new Error('Production PostgreSQL configuration is required to verify Neon test isolation.');
  }

  const productionIdentities = productionUrls.map(postgresDatabaseIdentity);
  const testIdentity = neonTestDatabaseIdentity(testEnvironment);

  if (!testIdentity) {
    throw new Error('Neon test DATABASE_URL or DIRECT_URL is missing; cannot verify isolation.');
  }

  if (productionIdentities.some((productionIdentity) => testIdentity.host === productionIdentity.host)) {
    throw new Error(
      'Neon test database uses the same Neon branch as production; ' +
      'refusing test database access. Configure backend/.env.neon-test with isolated connection strings.'
    );
  }
}

export async function loadNeonTestEnvironment({
  environment = process.env,
  filePath = defaultNeonTestEnvironmentPath,
} = {}) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('The Neon test environment cannot be loaded in production.');
  }

  const resolvedFilePath = resolve(filePath);
  let fileContents;
  try {
    fileContents = await readFile(resolvedFilePath, 'utf8');
  } catch {
    throw new Error(`Neon test configuration file could not be read: ${resolvedFilePath}`);
  }

  const fileEnvironment = dotenv.parse(fileContents);
  const missingNames = ['DATABASE_URL', 'DIRECT_URL']
    .filter((name) => !fileEnvironment[name]?.trim());
  if (missingNames.length) {
    throw new Error(
      `Neon test configuration at ${resolvedFilePath} has missing or empty variable(s): ${missingNames.join(', ')}.`,
    );
  }

  const testEnvironment = {
    ...environment,
    DATABASE_URL: fileEnvironment.DATABASE_URL,
    DIRECT_URL: fileEnvironment.DIRECT_URL,
    DB_SSL: 'true',
    NODE_ENV: 'test',
  };
  const errors = getPostgresConfigurationErrors(testEnvironment, {
    purpose: 'migration',
    expectedDatabase: NEON_TEST_DATABASE_NAME,
  });
  if (errors.length) {
    throw new Error(`Neon test configuration at ${resolvedFilePath} is invalid: ${errors.join(' ')}`);
  }

  let productionFileContents = '';
  try {
    productionFileContents = await readFile(defaultProductionEnvironmentPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error('Production PostgreSQL configuration could not be read for Neon test isolation.');
    }
  }
  assertNeonTestDatabaseIsIsolated(testEnvironment, [
    dotenv.parse(productionFileContents),
    process.env,
  ]);

  return testEnvironment;
}
