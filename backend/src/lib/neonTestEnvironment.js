import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getPostgresConfigurationErrors } from './postgresConfig.js';

export const defaultNeonTestEnvironmentPath = fileURLToPath(
  new URL('../../.env.neon-test', import.meta.url),
);
export const NEON_TEST_DATABASE_NAME = 'eventhub';

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
    NODE_ENV: 'test',
  };
  const errors = getPostgresConfigurationErrors(testEnvironment, {
    purpose: 'migration',
    expectedDatabase: NEON_TEST_DATABASE_NAME,
  });
  if (errors.length) {
    throw new Error(`Neon test configuration at ${resolvedFilePath} is invalid: ${errors.join(' ')}`);
  }

  return testEnvironment;
}
