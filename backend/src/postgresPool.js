import pg from 'pg';
import { createPostgresAdapter } from './lib/postgresAdapter.js';
import { createPostgresPoolConfig } from './lib/postgresConfig.js';
import { connectWithRetry } from './lib/postgresRetry.js';

const { Pool } = pg;

export function createPostgresRuntimePool({
  environment = process.env,
  poolFactory = (config) => new Pool(config),
  logger = console,
  sleep,
} = {}) {
  const pool = poolFactory(createPostgresPoolConfig(environment, { purpose: 'runtime' }));
  const connect = () => connectWithRetry(() => pool.connect(), {
    ...(sleep ? { sleep } : {}),
  });
  const adapter = createPostgresAdapter(pool, { connect });
  pool.on('error', (error) => {
    logger.error('PostgreSQL idle client error:', error?.code || error?.name || 'UNKNOWN');
  });

  return {
    dialect: 'postgres',
    query: (...args) => adapter.query(...args),
    connect,
    inTransaction: (work) => adapter.inTransaction(() => work(adapter)),
    execute: (...args) => adapter.query(...args),
    end() {
      return pool.end();
    },
    on(...args) {
      pool.on(...args);
      return this;
    },
  };
}

let sharedPool;

export function getPostgresRuntimePool() {
  if (!sharedPool) sharedPool = createPostgresRuntimePool();
  return sharedPool;
}
