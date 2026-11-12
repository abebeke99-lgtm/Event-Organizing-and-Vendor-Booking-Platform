import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { getPostgresConfigurationErrors } from './postgresConfig.js';

function decodeCertificateAuthority(environment) {
  const base64 = environment.DB_SSL_CA_BASE64?.trim();
  if (base64) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
    try {
      return Buffer.from(base64, 'base64').toString('utf8').trim();
    } catch {
      return null;
    }
  }

  const value = environment.DB_SSL_CA?.trim();
  if (!value) return null;
  const normalized = value.replace(/\\n/g, '\n').trim();
  if (normalized.includes('-----BEGIN CERTIFICATE-----')) return normalized;
  try {
    return readFileSync(normalized, 'utf8').trim();
  } catch {
    return null;
  }
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

function parseDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const host = url.hostname;
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const port = Number(url.port || 5432);
    if (!host || !database || !user || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port, database, user, password, sslmode: url.searchParams.get('sslmode') };
  } catch {
    return null;
  }
}

function isLoopbackHost(value) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  return isIP(host) === 4 && Number(host.split('.')[0]) === 127;
}

function getDatabaseCredentials(environment) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (databaseUrl) return parseDatabaseUrl(databaseUrl);
  return {
    host: environment.DB_HOST?.trim(),
    port: Number(environment.DB_PORT || 5432),
    database: environment.DB_NAME?.trim(),
    user: environment.DB_USER?.trim(),
    password: environment.DB_PASSWORD,
  };
}

export function getDatabaseConfigurationErrors(
  environment = process.env,
  { requireTls = environment.NODE_ENV === 'production', purpose = 'runtime' } = {},
) {
  const errors = [];

  if (environment.DB_DIALECT && environment.DB_DIALECT.trim().toLowerCase() === 'mysql') {
    errors.push('DB_DIALECT (must be postgres; MySQL runtime is no longer supported)');
  }

  const postgresErrors = getPostgresConfigurationErrors(environment, { purpose });
  errors.push(...postgresErrors);

  if (requireTls && environment.DB_SSL !== 'true') {
    errors.push('DB_SSL (set to true in production)');
  }
  if (environment.DB_SSL && !['true', 'false'].includes(environment.DB_SSL)) {
    errors.push('DB_SSL (set to true or false)');
  }
  if ((requireTls || environment.DB_SSL === 'true')
    && (environment.DB_SSL_CA?.trim() || environment.DB_SSL_CA_BASE64?.trim())
    && !isCertificateAuthorityPem(decodeCertificateAuthority(environment))) {
    errors.push('DB_SSL_CA or DB_SSL_CA_BASE64 (set a valid PEM certificate)');
  }

  const databaseUrl = environment.DATABASE_URL?.trim();
  const isProduction = environment.NODE_ENV === 'production';
  if (databaseUrl) {
    const parsed = parseDatabaseUrl(databaseUrl);
    if (parsed && isProduction && parsed.host && isLoopbackHost(parsed.host)) {
      errors.push('DATABASE_URL (must use the remote production Neon host)');
    }
  }

  return [...new Set(errors)];
}

export function validateDatabaseEnvironment(environment = process.env) {
  const errors = getDatabaseConfigurationErrors(environment);
  if (errors.length) {
    throw new Error(`Database configuration is incomplete or invalid: ${errors.join(', ')}.`);
  }
}

export function createDatabaseConfig(environment = process.env) {
  const errors = getDatabaseConfigurationErrors(environment);
  if (errors.length) {
    throw new Error(`Database configuration is incomplete or invalid: ${errors.join(', ')}.`);
  }

  const credentials = getDatabaseCredentials(environment);
  const sslEnabled = environment.DB_SSL === 'true' || environment.NODE_ENV === 'production';
  const certificateAuthority = decodeCertificateAuthority(environment);
  return {
    ...credentials,
    max: 8,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ...(sslEnabled ? {
      ssl: {
        rejectUnauthorized: true,
        ...(certificateAuthority ? { ca: certificateAuthority } : {}),
      },
    } : {}),
  };
}
