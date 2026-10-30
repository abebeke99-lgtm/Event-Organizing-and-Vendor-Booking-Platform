import mysql from 'mysql2/promise';
import 'dotenv/config';
import { createDatabaseConfig } from './lib/databaseConfig.js';

export {
  createDatabaseConfig,
  getDatabaseConfigurationErrors,
  validateDatabaseEnvironment,
} from './lib/databaseConfig.js';

export function formatDatabaseError(error, password = process.env.DB_PASSWORD) {
  const details = [
    typeof error?.code === 'string' ? error.code : error?.name,
    Number.isInteger(error?.errno) ? `errno=${error.errno}` : null,
    typeof error?.sqlState === 'string' ? `sqlState=${error.sqlState}` : null,
  ].filter(Boolean);
  let message = typeof error?.message === 'string' ? error.message : '';
  message = message
    .replace(/((?:password|passwd|pwd)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  if (password) message = message.replaceAll(password, '[REDACTED]');
  message = message.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '[REDACTED CERTIFICATE]');
  if (message) details.push(message);
  return details.join(': ') || 'Unknown database error';
}

export const pool = mysql.createPool(createDatabaseConfig());

export async function verifyDatabaseConnection(database = pool, expectedDatabase) {
  await database.query('SELECT 1');
  if (expectedDatabase) {
    const [rows] = await database.query('SELECT DATABASE() AS database_name');
    if (rows[0]?.database_name !== expectedDatabase) {
      throw new Error('Connected database does not match DB_NAME.');
    }
  }
}

export function getDatabaseFailureCode(error) {
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
