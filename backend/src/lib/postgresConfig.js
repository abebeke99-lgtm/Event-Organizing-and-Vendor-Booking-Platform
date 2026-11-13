const NEON_HOST_SUFFIX = '.neon.tech';

function parsePostgresConnectionUrl(value, name, { requireNeon = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid ${requireNeon ? 'Neon ' : ''}PostgreSQL URL.`);
  }

  const isNeon = url.hostname.endsWith(NEON_HOST_SUFFIX);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || !url.username
    || !url.password
    || url.pathname.length < 2
    || (requireNeon && !isNeon)
    || (isNeon && !['require', 'verify-full'].includes(url.searchParams.get('sslmode')))) {
    const provider = requireNeon || isNeon ? 'Neon ' : '';
    const tlsRequirement = provider ? ' with sslmode=require or sslmode=verify-full' : '';
    throw new Error(`${name} must be a credentialed ${provider}PostgreSQL URL${tlsRequirement}.`);
  }

  return url;
}

export function getPostgresConfigurationErrors(environment = process.env, {
  purpose = 'migration',
  expectedDatabase,
} = {}) {
  if (!['runtime', 'migration'].includes(purpose)) {
    throw new Error('PostgreSQL connection purpose must be runtime or migration.');
  }

  const errors = [];
  const requiredNames = purpose === 'runtime' ? ['DATABASE_URL'] : ['DATABASE_URL', 'DIRECT_URL'];
  for (const name of requiredNames) {
    const value = environment[name]?.trim();
    if (!value) {
      errors.push(`${name} is required.`);
      continue;
    }

    try {
      const url = parsePostgresConnectionUrl(value, name, { requireNeon: true });
      let databaseName;
      try {
        databaseName = decodeURIComponent(url.pathname.slice(1));
      } catch {
        errors.push(`${name} must use a valid encoded database name.`);
        continue;
      }
      if (expectedDatabase && databaseName !== expectedDatabase) {
        errors.push(`${name} must target the isolated ${expectedDatabase} database.`);
      }
      if (url.hostname.endsWith(NEON_HOST_SUFFIX)) {
        const isPooled = url.hostname.split('.')[0].endsWith('-pooler');
        if (name === 'DATABASE_URL' && !isPooled) {
          errors.push('DATABASE_URL must use the Neon pooled endpoint.');
        }
        if (name === 'DIRECT_URL' && isPooled) {
          errors.push('DIRECT_URL must use the Neon direct endpoint.');
        }
      }

      const sslMode = url.searchParams.get('sslmode');
      const tlsRequired = environment.NODE_ENV === 'production' || environment.DB_SSL === 'true';
      if (tlsRequired && ['disable', 'allow', 'prefer'].includes(sslMode)) {
        errors.push(`${name} must not use an sslmode that permits an unencrypted connection.`);
      }
      if (environment.DB_SSL === 'false' && sslMode && sslMode !== 'disable') {
        errors.push(`${name} sslmode conflicts with DB_SSL=false.`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (environment.DB_SSL && !['true', 'false'].includes(environment.DB_SSL)) {
    errors.push('DB_SSL must be set to true or false.');
  }
  if (environment.NODE_ENV === 'production' && environment.DB_SSL === 'false') {
    errors.push('DB_SSL must be true in production.');
  }

  if (purpose === 'migration' && environment.DATABASE_URL && environment.DIRECT_URL) {
    try {
      const pooled = parsePostgresConnectionUrl(environment.DATABASE_URL.trim(), 'DATABASE_URL', {
        requireNeon: expectedDatabase !== undefined,
      });
      const direct = parsePostgresConnectionUrl(environment.DIRECT_URL.trim(), 'DIRECT_URL', {
        requireNeon: expectedDatabase !== undefined,
      });
      if (pooled.hostname.endsWith(NEON_HOST_SUFFIX) && direct.hostname.endsWith(NEON_HOST_SUFFIX)) {
        const pooledBaseHost = pooled.hostname.replace(/-pooler(?=\.|$)/, '');
        if (pooledBaseHost !== direct.hostname) {
          errors.push('DATABASE_URL and DIRECT_URL must target the same Neon endpoint.');
        }
      }
    } catch {
      // The individual URL errors above describe invalid values without exposing them.
    }
  }

  return errors;
}

export function createPostgresPoolConfig(environment = process.env, { purpose = 'runtime' } = {}) {
  if (!['runtime', 'migration'].includes(purpose)) {
    throw new Error('PostgreSQL pool purpose must be runtime or migration.');
  }

  const errors = getPostgresConfigurationErrors(environment, { purpose });
  if (errors.length) {
    throw new Error(`PostgreSQL configuration is incomplete or invalid: ${errors.join(' ')}`);
  }

  const configuredConnectionString = purpose === 'runtime'
    ? environment.DATABASE_URL.trim()
    : environment.DIRECT_URL.trim();
  const connectionUrl = new URL(configuredConnectionString);
  const sslMode = connectionUrl.searchParams.get('sslmode');
  const isNeonPooledEndpoint = connectionUrl.hostname.endsWith(NEON_HOST_SUFFIX);
  const sslEnabled = environment.DB_SSL === 'true'
    || environment.NODE_ENV === 'production'
    || (environment.DB_SSL !== 'false' && sslMode !== 'disable');
  const certificateVerificationExplicit = environment.DB_SSL === 'true'
    || environment.NODE_ENV === 'production';
  if (sslEnabled && certificateVerificationExplicit && sslMode === 'require') {
    connectionUrl.searchParams.set('sslmode', 'verify-full');
  }

  return {
    connectionString: connectionUrl.toString(),
    ...(sslEnabled ? { ssl: { rejectUnauthorized: true } } : {}),
    max: purpose === 'migration' ? 2 : isNeonPooledEndpoint ? 4 : 8,
    connectionTimeoutMillis: purpose === 'runtime' ? 15000 : 10000,
    idleTimeoutMillis: purpose === 'runtime' ? 10000 : 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    application_name: purpose === 'runtime' ? 'eventhub-api' : 'eventhub-migrations',
  };
}
