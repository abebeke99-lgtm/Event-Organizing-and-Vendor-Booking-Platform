import pg from 'pg';
import { createPostgresPoolConfig } from './lib/postgresConfig.js';
import { createPostgresAdapter } from './lib/postgresAdapter.js';
import { connectWithRetry, getPostgresErrorCause } from './lib/postgresRetry.js';

const { Pool } = pg;

const POSTGRES_ERROR_MESSAGES = new Map([
  ['23502', 'A required database value is missing.'],
  ['23503', 'A related database record does not exist.'],
  ['23505', 'A database record already exists.'],
  ['23514', 'A database constraint was not satisfied.'],
  ['28P01', 'Database authentication failed.'],
  ['3D000', 'The configured database does not exist.'],
  ['40001', 'The database transaction must be retried.'],
  ['40P01', 'The database transaction encountered a deadlock.'],
]);

export function formatPostgresError(error) {
  if (error?.code === 'DB_SCHEMA_INCOMPLETE') {
    return error.message;
  }
  if (/^(PostgreSQL configuration|Neon test configuration|Neon test configuration is unavailable)/.test(error?.message || '')) {
    return error.message;
  }
  const cause = getPostgresErrorCause(error);
  const code = typeof cause?.code === 'string' ? cause.code : null;
  if (code && POSTGRES_ERROR_MESSAGES.has(code)) {
    return `PostgreSQL error ${code}: ${POSTGRES_ERROR_MESSAGES.get(code)}`;
  }
  if (/certificate|tls|ssl handshake/i.test(cause?.message || '')) {
    return 'PostgreSQL TLS connection failed.';
  }
  const errorType = cause?.name && cause.name !== 'Error' ? ` (${cause.name})` : '';
  return `PostgreSQL operation failed${code ? ` (${code})` : errorType}.`;
}

export function getPostgresFailureCode(error) {
  if (error?.code === 'DB_SCHEMA_INCOMPLETE') return 'DB_SCHEMA_INCOMPLETE';
  if (/^(PostgreSQL configuration|Neon test configuration|Neon test configuration is unavailable)/.test(error?.message || '')) {
    return 'DB_CONFIG_INVALID';
  }
  if (error?.message === 'Connected database does not match the expected database.') return 'DB_NAME_MISMATCH';
  const cause = getPostgresErrorCause(error);
  if (cause?.code === '28P01' || cause?.code === '28000') return 'DB_AUTH_FAILED';
  if (cause?.code === '3D000') return 'DB_NAME_MISSING';
  if (/^(CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_VERIFY|HANDSHAKE_SSL)/i.test(cause?.code || '')
    || /certificate|tls|ssl handshake/i.test(cause?.message || '')) {
    return 'DB_TLS_FAILED';
  }
  return 'DB_CONNECT_FAILED';
}

export function createPostgresDatabase(environment = process.env, { poolFactory = (config) => new Pool(config) } = {}) {
  const runtimePool = poolFactory(createPostgresPoolConfig(environment, { purpose: 'runtime' }));
  const runtimeAdapter = createPostgresAdapter(runtimePool, {
    connect: () => connectWithRetry(() => runtimePool.connect()),
  });
  let migrationPool;
  let migrationAdapter;
  let closePromise;

  function getMigrationAdapter() {
    if (!migrationAdapter) {
      migrationPool = poolFactory(createPostgresPoolConfig(environment, { purpose: 'migration' }));
      migrationAdapter = createPostgresAdapter(migrationPool, {
        connect: () => connectWithRetry(() => migrationPool.connect()),
      });
    }
    return migrationAdapter;
  }

  async function verifyPool(adapter, purpose) {
    const result = await adapter.query('SELECT version() AS server_version, current_database() AS database_name');
    if (!result.rows[0]?.database_name || !result.rows[0]?.server_version) {
      throw new Error(`The Neon ${purpose} connection did not return PostgreSQL identity information.`);
    }
    await adapter.query('SELECT 1');
    return result.rows[0];
  }

  return {
    runtimePool,
    runtimeAdapter,
    get migrationPool() {
      getMigrationAdapter();
      return migrationPool;
    },
    get migrationAdapter() {
      return getMigrationAdapter();
    },
    verifyRuntimeConnection: () => verifyPool(runtimeAdapter, 'runtime'),
    verifyMigrationConnection: () => verifyPool(getMigrationAdapter(), 'migration'),
    inTransaction(work, pool = runtimePool) {
      return pool === migrationPool && migrationAdapter
        ? migrationAdapter.inTransaction(work)
        : runtimeAdapter.inTransaction(work);
    },
    close() {
      if (!closePromise) {
        closePromise = Promise.all([
          runtimePool.end(),
          ...(migrationPool ? [migrationPool.end()] : []),
        ]);
      }
      return closePromise;
    },
  };
}
