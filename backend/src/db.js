import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createDatabaseConfig } from './lib/databaseConfig.js';
import { isPostgresConnectionError } from './lib/postgresRetry.js';
import { formatPostgresError, getPostgresFailureCode } from './postgresDb.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

export const isPostgresDialect = process.env.DB_DIALECT === 'postgres';
const postgresModule = isPostgresDialect ? await import('./postgresPool.js') : null;

export {
  createDatabaseConfig,
  getDatabaseConfigurationErrors,
  validateDatabaseEnvironment,
} from './lib/databaseConfig.js';

export function formatDatabaseError(error, password = process.env.DB_PASSWORD) {
  if (isPostgresDialect) return formatPostgresError(error);
  const details = [
    typeof error?.code === 'string' ? error.code : error?.name,
    Number.isInteger(error?.errno) ? `errno=${error.errno}` : null,
    typeof error?.sqlState === 'string' ? `sqlState=${error.sqlState}` : null,
  ].filter(Boolean);
  const messages = [...new Set([error?.message, error?.sqlMessage]
    .filter((message) => typeof message === 'string' && message))];
  for (let message of messages) {
    message = message
      .replace(/((?:password|passwd|pwd)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
      .replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
    if (password) message = message.replaceAll(password, '[REDACTED]');
    message = message.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '[REDACTED CERTIFICATE]');
    details.push(message);
  }
  return details.join(': ') || 'Unknown database error';
}

export const pool = isPostgresDialect ? postgresModule.getPostgresRuntimePool() : mysql.createPool(createDatabaseConfig());

export async function verifyDatabaseConnection(database = pool, expectedDatabase) {
  await database.query('SELECT 1');
  if (expectedDatabase) {
    const result = await database.query(
      isPostgresDialect ? 'SELECT current_database() AS database_name' : 'SELECT DATABASE() AS database_name',
    );
    const rows = isPostgresDialect ? result.rows : result[0];
    if (rows[0]?.database_name !== expectedDatabase) {
      throw new Error('Connected database does not match DB_NAME.');
    }
  }
}

export function getDatabaseFailureCode(error) {
  if (isPostgresDialect) return getPostgresFailureCode(error);
  if (error?.message === 'Connected database does not match DB_NAME.') return 'DB_NAME_MISMATCH';
  if (['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR'].includes(error?.code)) {
    return 'DB_AUTH_FAILED';
  }
  if (/^(CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_VERIFY|HANDSHAKE_SSL)/i.test(error?.code || '')
    || /certificate|tls|ssl handshake/i.test(error?.message || '')) {
    return 'DB_TLS_FAILED';
  }
  return 'DB_CONNECT_FAILED';
}

export async function inTransaction(work) {
  if (isPostgresDialect) {
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
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
