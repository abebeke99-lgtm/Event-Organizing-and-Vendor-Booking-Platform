import bcrypt from 'bcryptjs';

export class AdministratorProvisioningError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdministratorProvisioningError';
  }
}

export function getAdministratorBootstrapConfig(environment = process.env) {
  const required = ['ADMIN_BOOTSTRAP_EMAIL', 'ADMIN_BOOTSTRAP_NAME', 'ADMIN_BOOTSTRAP_PASSWORD'];
  const missing = required.filter((key) => typeof environment[key] !== 'string' || !environment[key].trim());
  if (missing.length) {
    throw new AdministratorProvisioningError(`Set the required bootstrap environment variables: ${missing.join(', ')}.`);
  }

  const email = environment.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase();
  const name = environment.ADMIN_BOOTSTRAP_NAME.trim();
  const password = environment.ADMIN_BOOTSTRAP_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new AdministratorProvisioningError('ADMIN_BOOTSTRAP_EMAIL must be a valid email address.');
  }
  if (!name || name.length > 160) {
    throw new AdministratorProvisioningError('ADMIN_BOOTSTRAP_NAME must be between 1 and 160 characters.');
  }
  const passwordLength = Array.from(password).length;
  if (passwordLength < 12 || passwordLength > 16 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new AdministratorProvisioningError(
      'ADMIN_BOOTSTRAP_PASSWORD must be between 12 and 16 characters and no more than 72 UTF-8 bytes.',
    );
  }
  return { email, name, password };
}

function isPostgresLikeDatabase(database) {
  return Boolean(database)
    && typeof database.query === 'function'
    && typeof database.getConnection !== 'function'
    && (typeof database.inTransaction === 'function' || typeof database.connect === 'function');
}

function isPostgresLikeConnection(connection) {
  return Boolean(connection)
    && typeof connection.query === 'function'
    && typeof connection.beginTransaction !== 'function';
}

function normalizeRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result[0])) return result[0];
  return [];
}

function normalizeInsertId(result, fallback = null) {
  if (result && typeof result === 'object') {
    if (Number.isInteger(result.insertId)) return result.insertId;
    if (result.rows && result.rows[0] && Number.isInteger(result.rows[0].id)) return result.rows[0].id;
    if (result.rows && result.rows[0] && Number.isInteger(result.rows[0].insertId)) return result.rows[0].insertId;
  }
  return fallback;
}

async function runProvisioningTransaction(database, work) {
  if (isPostgresLikeDatabase(database)) {
    if (typeof database.inTransaction === 'function') {
      return database.inTransaction(async (connection) => work(connection));
    }

    const connection = await database.connect();
    let transactionStarted = false;
    try {
      await connection.query('BEGIN');
      transactionStarted = true;
      const result = await work(connection);
      await connection.query('COMMIT');
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.query('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'PostgreSQL administrator provisioning failed and rollback could not be completed.',
          );
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await work(connection);
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function provisionAdministrator(database, credentials, passwordHasher = (value) => bcrypt.hash(value, 12)) {
  const { email: normalizedEmail, name: normalizedName, password } = getAdministratorBootstrapConfig({
    ADMIN_BOOTSTRAP_EMAIL: credentials?.email,
    ADMIN_BOOTSTRAP_NAME: credentials?.name,
    ADMIN_BOOTSTRAP_PASSWORD: credentials?.password,
  });

  return runProvisioningTransaction(database, async (connection) => {
    if (isPostgresLikeConnection(connection)) {
      const existingResult = await connection.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1 FOR UPDATE',
        [normalizedEmail],
      );
      const existing = normalizeRows(existingResult);
      if (existing.length) {
        throw new AdministratorProvisioningError(
          'An account with that email already exists; refusing to modify existing account data.',
        );
      }

      const rolesResult = await connection.query(
        'SELECT id FROM roles WHERE LOWER(name) = LOWER($1) AND is_admin = TRUE AND is_active = TRUE LIMIT 1',
        ['Admin'],
      );
      const roles = normalizeRows(rolesResult);
      if (!roles.length) {
        throw new AdministratorProvisioningError('Active Admin role is missing. Run the migrations first.');
      }

      const passwordHash = await passwordHasher(password);
      const createdResult = await connection.query(
        "INSERT INTO users (full_name, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id",
        [normalizedName, normalizedEmail, passwordHash],
      );
      const createdId = normalizeInsertId(createdResult, createdResult?.rows?.[0]?.id ?? null);
      await connection.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [createdId, roles[0].id],
      );
      return createdId;
    }

    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE',
      [normalizedEmail],
    );
    if (existing.length) {
      throw new AdministratorProvisioningError(
        'An account with that email already exists; refusing to modify existing account data.',
      );
    }

    const [roles] = await connection.execute(
      'SELECT id FROM roles WHERE name = ? AND is_admin = TRUE AND is_active = TRUE LIMIT 1',
      ['Admin'],
    );
    if (!roles.length) {
      throw new AdministratorProvisioningError('Active Admin role is missing. Run the migrations first.');
    }

    const passwordHash = await passwordHasher(password);
    const [created] = await connection.execute(
      "INSERT INTO users (full_name, email, password_hash, status) VALUES (?, ?, ?, 'active')",
      [normalizedName, normalizedEmail, passwordHash],
    );
    await connection.execute(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [created.insertId, roles[0].id],
    );
    return created.insertId;
  }).catch((error) => {
    if (error?.code === 'ER_DUP_ENTRY' || error?.code === '23505' || /duplicate key|duplicate/i.test(error?.message || '')) {
      throw new AdministratorProvisioningError(
        'An account with that email already exists; refusing to modify existing account data.',
      );
    }
    throw error;
  });
}
