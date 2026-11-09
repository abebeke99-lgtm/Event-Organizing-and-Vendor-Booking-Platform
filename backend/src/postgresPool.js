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
  let state = 'open';
  let endPromise;
  const connect = () => {
    if (state !== 'open') {
      throw new Error(`PostgreSQL runtime pool is ${state}.`);
    }
    return connectWithRetry(() => pool.connect(), {
      ...(sleep ? { sleep } : {}),
    });
  };
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
      if (!endPromise) {
        state = 'closing';
        endPromise = Promise.resolve()
          .then(() => pool.end())
          .finally(() => {
            state = 'closed';
          });
      }
      return endPromise;
    },
    getStats() {
      return {
        state,
        totalCount: Number.isInteger(pool.totalCount) ? pool.totalCount : null,
        idleCount: Number.isInteger(pool.idleCount) ? pool.idleCount : null,
        waitingCount: Number.isInteger(pool.waitingCount) ? pool.waitingCount : null,
      };
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
