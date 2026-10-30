import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

function resolveCertificateAuthority(value) {
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
    && !isCertificateAuthorityPem(resolveCertificateAuthority(environment.DB_SSL_CA))) {
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
  const certificateAuthority = resolveCertificateAuthority(environment.DB_SSL_CA);
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
