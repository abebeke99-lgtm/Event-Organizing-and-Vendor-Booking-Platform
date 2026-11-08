const NEON_HOST_SUFFIX = '.neon.tech';

function parseNeonConnectionUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid Neon PostgreSQL URL.`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname.endsWith(NEON_HOST_SUFFIX)
    || !url.username
    || !url.password
    || url.pathname.length < 2
    || url.searchParams.get('sslmode') !== 'require') {
    throw new Error(`${name} must be a credentialed Neon PostgreSQL URL with sslmode=require.`);
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
      const url = parseNeonConnectionUrl(value, name);
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
      const isPooled = url.hostname.split('.')[0].endsWith('-pooler');
      if (name === 'DATABASE_URL' && !isPooled) {
        errors.push('DATABASE_URL must use the Neon pooled endpoint.');
      }
      if (name === 'DIRECT_URL' && isPooled) {
        errors.push('DIRECT_URL must use the Neon direct endpoint.');
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (purpose === 'migration' && environment.DATABASE_URL && environment.DIRECT_URL) {
    try {
      const pooled = parseNeonConnectionUrl(environment.DATABASE_URL.trim(), 'DATABASE_URL');
      const direct = parseNeonConnectionUrl(environment.DIRECT_URL.trim(), 'DIRECT_URL');
      const pooledBaseHost = pooled.hostname.replace(/-pooler(?=\.|$)/, '');
      if (pooledBaseHost !== direct.hostname) {
        errors.push('DATABASE_URL and DIRECT_URL must target the same Neon endpoint.');
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

  return {
    connectionString: purpose === 'runtime' ? environment.DATABASE_URL.trim() : environment.DIRECT_URL.trim(),
    ssl: { rejectUnauthorized: true },
    max: purpose === 'runtime' ? 8 : 2,
    connectionTimeoutMillis: purpose === 'runtime' ? 15000 : 10000,
    idleTimeoutMillis: purpose === 'runtime' ? 10000 : 30000,
    application_name: purpose === 'runtime' ? 'eventhub-api' : 'eventhub-migrations',
  };
}
