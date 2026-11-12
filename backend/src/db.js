import './lib/environment.js';
import { createDatabaseConfig } from './lib/databaseConfig.js';
import { isPostgresConnectionError } from './lib/postgresRetry.js';
import { getDatabaseDialect } from './lib/startupConfig.js';
import { formatPostgresError, getPostgresFailureCode } from './postgresDb.js';

export const databaseDialect = getDatabaseDialect();
export const isPostgresDialect = databaseDialect === 'postgres';
const postgresModule = await import('./postgresPool.js');
const normalizedAdapters = new WeakMap();

export function normalizeDatabaseAdapter(database) {
  if (!database || typeof database !== 'object') return database;
  if (normalizedAdapters.has(database)) return normalizedAdapters.get(database);
  const adapter = Object.isExtensible(database)
    ? database
    : new Proxy(Object.create(database), {
      set(target, property, value) {
        return Reflect.defineProperty(target, property, {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      },
    });

  function createQueryResult(rows, rowCount, fields, metadata = {}) {
    return {
      ...metadata,
      rows,
      rowCount,
      fields,
      [Symbol.iterator]: function* iterateLegacyResult() {
        yield rows;
        yield fields;
      },
    };
  }

  function normalizeQueryResult(result) {
    if (result && typeof result === 'object' && 'rows' in result) {
      return createQueryResult(
        Array.isArray(result.rows) ? result.rows : [],
        Number.isInteger(result.rowCount) ? result.rowCount : (Array.isArray(result.rows) ? result.rows.length : 0),
        Array.isArray(result.fields) ? result.fields : [],
        { command: result.command, oid: result.oid, rowsAffected: result.rowsAffected },
      );
    }
    if (Array.isArray(result)) {
      if (result.length === 2 && Array.isArray(result[1]) && !Array.isArray(result[0])) {
        return createQueryResult(
          [],
          Number.isInteger(result[0]?.affectedRows) ? result[0].affectedRows : 0,
          result[1],
        );
      }
      const rows = Array.isArray(result[0])
        && (result.length === 1 || (result.length === 2 && Array.isArray(result[1])))
        ? result[0]
        : result;
      return createQueryResult(rows, rows.length, Array.isArray(result[1]) ? result[1] : []);
    }
    if (result === undefined) {
      return createQueryResult([], 0, []);
    }
    return createQueryResult([], 0, []);
  }

  function normalizeExecuteResult(result) {
    if (result && typeof result === 'object' && 'rows' in result) {
      return [Array.isArray(result.rows) ? result.rows : [], Array.isArray(result.fields) ? result.fields : []];
    }
    if (Array.isArray(result)) {
      if (Array.isArray(result[0])) {
        return [result[0], Array.isArray(result[1]) ? result[1] : []];
      }
      if (result.length === 2 && Array.isArray(result[1])) {
        return [result[0], result[1]];
      }
      if (result.length === 1 && result[0] && typeof result[0] === 'object') {
        return [result[0], []];
      }
      return [result, []];
    }
    return [result ?? [], []];
  }

  const originalQuery = typeof database.query === 'function' ? database.query.bind(database) : null;
  const originalExecute = typeof database.execute === 'function' ? database.execute.bind(database) : null;
  const rewriteLegacyPlaceholders = (sql) => (typeof sql === 'string' ? sql.replace(/\$\d+/g, '?') : sql);
  const callLegacyExecute = async (args, fallback = false) => {
    if (!originalExecute) return null;
    const [sql, ...rest] = args;
    const candidates = fallback ? [args, [rewriteLegacyPlaceholders(sql), ...rest]] : [args, [rewriteLegacyPlaceholders(sql), ...rest]];
    for (const candidate of candidates) {
      try {
        return await originalExecute(...candidate);
      } catch (error) {
        if (candidate === candidates[candidates.length - 1]) throw error;
      }
    }
    return null;
  };
  if (typeof database.query !== 'function' && typeof database.execute === 'function') {
    adapter.query = async (...args) => {
      return normalizeQueryResult(await callLegacyExecute(args));
    };
  } else if (originalQuery) {
    const currentQuery = originalQuery;
    adapter.query = async (...args) => {
      try {
        const result = await currentQuery(...args);
        const normalizedResult = normalizeQueryResult(result);
        const isReadQuery = /^\s*(SELECT|WITH)\b/i.test(args[0]);
        if (originalExecute && isReadQuery && Array.isArray(result) && normalizedResult.rows.length === 0) {
          try {
            return normalizeQueryResult(await callLegacyExecute(args));
          } catch {
            return normalizedResult;
          }
        }
        return normalizedResult;
      } catch (error) {
        if (typeof originalExecute === 'function') {
          const executeResult = await callLegacyExecute(args);
          return normalizeQueryResult(executeResult);
        }
        throw error;
      }
    };
  }

  if (typeof database.execute !== 'function' && typeof adapter.query === 'function') {
    adapter.execute = async (...args) => {
      return normalizeExecuteResult(await adapter.query(...args));
    };
  } else if (originalExecute) {
    const currentExecute = originalExecute;
    adapter.execute = async (...args) => {
      return normalizeExecuteResult(await currentExecute(...args));
    };
  }

  if (typeof database.connect !== 'function' && typeof database.getConnection === 'function') {
    adapter.connect = (...args) => database.getConnection(...args);
  }

  if (typeof adapter.inTransaction !== 'function' && (typeof database.getConnection === 'function' || typeof adapter.connect === 'function')) {
    adapter.inTransaction = async (work) => {
      const connection = typeof database.getConnection === 'function'
        ? await database.getConnection()
        : await adapter.connect();
      const normalizedConnection = normalizeDatabaseAdapter(connection);
      if (typeof normalizedConnection.beginTransaction === 'function') {
        await normalizedConnection.beginTransaction();
      }
      try {
        const result = await work(normalizedConnection);
        if (typeof normalizedConnection.commit === 'function') {
          await normalizedConnection.commit();
        }
        return result;
      } catch (error) {
        try {
          if (typeof normalizedConnection.rollback === 'function') {
            await normalizedConnection.rollback();
          }
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Database transaction failed and rollback could not be completed.',
          );
        }
        throw error;
      } finally {
        if (typeof normalizedConnection.release === 'function') {
          normalizedConnection.release();
        }
      }
    };
  }

  normalizedAdapters.set(database, adapter);
  normalizedAdapters.set(adapter, adapter);
  return adapter;
}

export {
  createDatabaseConfig,
  getDatabaseConfigurationErrors,
  validateDatabaseEnvironment,
} from './lib/databaseConfig.js';

export function formatDatabaseError(error, password = process.env.DB_PASSWORD) {
  return formatPostgresError(error, password);
}

let databasePool;
function getDatabasePool() {
  if (!databasePool) {
    databasePool = postgresModule.getPostgresRuntimePool();
  }
  return databasePool;
}

export const pool = new Proxy({}, {
  get(_target, property, receiver) {
    const instance = getDatabasePool();
    const value = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  set(_target, property, value) {
    getDatabasePool()[property] = value;
    return true;
  },
  has(_target, property) {
    return property in getDatabasePool();
  },
  ownKeys() {
    return Reflect.ownKeys(getDatabasePool());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(getDatabasePool(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

export async function verifyDatabaseConnection(database = pool, expectedDatabase) {
  const client = database ?? getDatabasePool();
  const result = await client.query('SELECT version() AS server_version, current_database() AS database_name');
  if (expectedDatabase && result.rows[0]?.database_name !== expectedDatabase) {
    throw new Error('Connected database does not match DB_NAME.');
  }
}

export function getDatabaseFailureCode(error) {
  return getPostgresFailureCode(error);
}

export async function inTransaction(work) {
  const connection = await pool.connect();
  let releaseError;
  try {
    await connection.query('BEGIN');
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    if (isPostgresConnectionError(error)) releaseError = error;
    try {
      await connection.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
      throw new AggregateError(
        [error, rollbackError],
        'PostgreSQL transaction failed and rollback could not be completed.',
      );
    }
    throw error;
  } finally {
    connection.release(releaseError);
  }
}
