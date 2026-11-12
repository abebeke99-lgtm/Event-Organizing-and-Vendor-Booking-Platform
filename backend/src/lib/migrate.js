import { pathToFileURL } from 'node:url';
import { getDatabaseDialect } from './startupConfig.js';
import { getPostgresConfigurationErrors } from './postgresConfig.js';
import { runPostgresMigrations } from './postgresMigrate.js';
import { createPostgresDatabase } from '../postgresDb.js';

export function splitSqlStatements() {
  throw new Error('MySQL migration execution is no longer supported. PostgreSQL migrations must be used instead.');
}

export async function runMigrations(database, options = {}) {
  if (getDatabaseDialect() !== 'postgres') {
    throw new Error('DB_DIALECT must be postgres. MySQL migration execution is disabled.');
  }

  const configErrors = getPostgresConfigurationErrors(process.env, { purpose: 'migration' });
  if (configErrors.length) {
    throw new Error(`PostgreSQL migration config is incomplete or invalid: ${configErrors.join(', ')}`);
  }

  const databaseConnection = database ?? createPostgresDatabase(process.env);
  try {
    return await runPostgresMigrations(databaseConnection, options);
  } finally {
    if (!database) await databaseConnection.close();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await runMigrations();
}
