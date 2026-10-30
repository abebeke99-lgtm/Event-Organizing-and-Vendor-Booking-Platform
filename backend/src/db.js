import { X509Certificate } from 'node:crypto';
import mysql from 'mysql2/promise';
import 'dotenv/config';

function normalizeCertificateAuthority(value) {
  return value?.replace(/\\n/g, '\n').trim();
}

function isCertificateAuthorityPem(value) {
  if (typeof value !== 'string') return false;
  const certificates = value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!certificates?.length) return false;

  try {
    return certificates.some((certificate) => new X509Certificate(certificate).ca);
  } catch {
    return false;
  }
}

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

export function getDatabaseConfigurationErrors(
  environment = process.env,
  { requireTls = environment.NODE_ENV === 'production' } = {},
) {
  const missing = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
    .filter((name) => !environment[name]?.trim());
  const port = Number(environment.DB_PORT);
  if (environment.DB_PORT && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    missing.push('DB_PORT (must be a valid TCP port)');
  }
  if (requireTls && environment.DB_SSL !== 'true') {
    missing.push('DB_SSL=true');
  }
  if ((requireTls || environment.DB_SSL === 'true')
    && !isCertificateAuthorityPem(normalizeCertificateAuthority(environment.DB_SSL_CA))) {
    missing.push('DB_SSL_CA (valid PEM certificate required)');
  }
  return missing;
}

export function validateDatabaseEnvironment(environment = process.env) {
  const errors = getDatabaseConfigurationErrors(environment);
  if (errors.length) {
    throw new Error(`Database configuration is incomplete or invalid: ${errors.join(', ')}.`);
  }
}

export function createDatabaseConfig(environment = process.env) {
  const sslEnabled = environment.DB_SSL === 'true';
  const certificateAuthority = normalizeCertificateAuthority(environment.DB_SSL_CA);
  if (sslEnabled && !isCertificateAuthorityPem(certificateAuthority)) {
    throw new Error('DB_SSL_CA must contain a PEM-encoded certificate when DB_SSL=true.');
  }

  return {
    host: environment.DB_HOST,
    port: Number(environment.DB_PORT || 3306),
    database: environment.DB_NAME,
    user: environment.DB_USER,
    password: environment.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 10000,
    decimalNumbers: true,
    charset: 'utf8mb4',
    ...(sslEnabled ? {
      ssl: {
        rejectUnauthorized: true,
        ca: certificateAuthority,
      },
    } : {}),
  };
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
