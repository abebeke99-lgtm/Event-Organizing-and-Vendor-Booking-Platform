import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const demoAccounts = [
  { email: 'admin@eventflow.test', password: 'Admin@12345', name: 'EventFlow Admin', role: 'admin' },
  { email: 'organizer@eventflow.test', password: 'Organizer@12345', name: 'EventFlow Organizer', role: 'organizer' },
  { email: 'vendor@eventflow.test', password: 'Vendor@12345', name: 'EventFlow Vendor', role: 'vendor' },
  { email: 'customer@eventflow.test', password: 'Customer@12345', name: 'EventFlow Customer', role: 'customer' },
];
const bekelePassword = process.env.BEKELE_ADMIN_PASSWORD || '';
const accounts = [
  ...demoAccounts,
  { email: 'bekele@gmail.com', password: bekelePassword, name: 'Bekele', role: 'admin' },
];

function isValidPassword(password) {
  return typeof password === 'string'
    && password.length >= 11
    && password.length <= 72
    && Buffer.byteLength(password, 'utf8') <= 72;
}

if (process.env.NODE_ENV !== 'development'
  || process.env.DB_HOST !== '127.0.0.1'
  || process.env.DB_PORT !== '3306'
  || process.env.DB_NAME !== 'event_platform') {
  console.error('Refusing to seed: this script is restricted to the configured local XAMPP event_platform database.');
  process.exitCode = 1;
} else if (!bekelePassword) {
  console.error('Set BEKELE_ADMIN_PASSWORD before running seed:users; it will be used to update bekele@gmail.com.');
  process.exitCode = 1;
} else if (accounts.some(({ password }) => !isValidPassword(password))) {
  console.error('All seed passwords must be between 11 and 72 characters and no more than 72 UTF-8 bytes.');
  process.exitCode = 1;
} else {
  const { pool } = await import('../src/db.js');
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const roleIds = new Map();
    for (const role of ['admin', 'organizer', 'vendor', 'customer']) {
      const [roles] = await connection.execute(
        role === 'admin'
          ? 'SELECT id FROM roles WHERE is_admin = TRUE AND is_active = TRUE ORDER BY id LIMIT 1'
          : 'SELECT id FROM roles WHERE LOWER(name) = ? AND is_active = TRUE LIMIT 1',
        role === 'admin' ? [] : [role],
      );
      if (!roles.length) throw new Error(`The active ${role} role is missing; run the existing migrations first.`);
      roleIds.set(role, roles[0].id);
    }

    for (const account of accounts) {
      const passwordHash = await bcrypt.hash(account.password, 12);
      const [existingUsers] = await connection.execute(
        'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE',
        [account.email],
      );
      let userId;
      if (existingUsers.length) {
        userId = existingUsers[0].id;
        await connection.execute(
          "UPDATE users SET full_name = ?, email = ?, password_hash = ?, status = 'active' WHERE id = ?",
          [account.name, account.email, passwordHash, userId],
        );
        await connection.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);
      } else {
        const [created] = await connection.execute(
          "INSERT INTO users (full_name, email, password_hash, status) VALUES (?, ?, ?, 'active')",
          [account.name, account.email, passwordHash],
        );
        userId = created.insertId;
      }
      await connection.execute(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, roleIds.get(account.role)],
      );
    }

    await connection.commit();
    console.log('Seeded active accounts; the current users schema has no separate email-verification column.');
    for (const account of accounts) {
      console.log(`${account.email} / ${account.password} / ${account.role}`);
    }
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(`User seed failed: ${error.code || error.name || 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    connection?.release();
    await pool.end();
  }
}
