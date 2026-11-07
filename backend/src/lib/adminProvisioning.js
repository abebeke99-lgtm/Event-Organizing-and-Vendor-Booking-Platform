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

export async function provisionAdministrator(database, credentials, passwordHasher = (value) => bcrypt.hash(value, 12)) {
  const { email: normalizedEmail, name: normalizedName, password } = getAdministratorBootstrapConfig({
    ADMIN_BOOTSTRAP_EMAIL: credentials?.email,
    ADMIN_BOOTSTRAP_NAME: credentials?.name,
    ADMIN_BOOTSTRAP_PASSWORD: credentials?.password,
  });

  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;

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
    await connection.commit();
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new AdministratorProvisioningError(
        'An account with that email already exists; refusing to modify existing account data.',
      );
    }
    throw error;
  } finally {
    connection.release();
  }
}
