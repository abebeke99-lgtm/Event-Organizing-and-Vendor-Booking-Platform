import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const allowedRoles = new Set(['customer', 'organizer', 'vendor']);
const email = (process.env.TEST_USER_EMAIL || 'eventhub.local@example.test').trim().toLowerCase();
const name = (process.env.TEST_USER_NAME || 'EventHub Local Test').trim();
const requestedRole = (process.env.TEST_USER_ROLE || 'organizer').trim().toLowerCase();
const password = process.env.TEST_USER_PASSWORD || '';

if (process.env.NODE_ENV !== 'development'
  || process.env.DB_HOST !== '127.0.0.1'
  || process.env.DB_PORT !== '3306'
  || process.env.DB_NAME !== 'event_platform') {
  console.error('Refusing to seed: this script is restricted to the configured local XAMPP event_platform database.');
  process.exitCode = 1;
} else if (!allowedRoles.has(requestedRole)) {
  console.error('TEST_USER_ROLE must be customer, organizer, or vendor.');
  process.exitCode = 1;
} else if (!password || password.length < 12 || password.length > 16
  || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
  console.error('Set TEST_USER_PASSWORD in the terminal to a 12-16 character password with uppercase, lowercase, and a number.');
  process.exitCode = 1;
} else {
  const { inTransaction, pool } = await import('../src/db.js');
  try {
    const roleName = requestedRole[0].toUpperCase() + requestedRole.slice(1);
    const [roles] = await pool.execute(
      'SELECT id FROM roles WHERE LOWER(name) = ? AND is_active = TRUE LIMIT 1',
      [requestedRole]
    );
    if (!roles.length) throw new Error(`The active ${roleName} role does not exist; run the existing migrations first.`);

    const [existingUsers] = await pool.execute(
      'SELECT id, password_hash FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (existingUsers.length) {
      const matches = await bcrypt.compare(password, existingUsers[0].password_hash);
      if (!matches) throw new Error('The local test email already exists with a different password; no records were changed.');
      const [roleRows] = await pool.execute(
        'SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ? LIMIT 1',
        [existingUsers[0].id, roles[0].id]
      );
      if (!roleRows.length) throw new Error('The existing local test user has a different role; no records were changed.');
      console.log(`PASS local test user already exists: ${email} (${requestedRole})`);
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      const userId = await inTransaction(async (connection) => {
        const [result] = await connection.execute(
          "INSERT INTO users (full_name, email, password_hash, status) VALUES (?, ?, ?, 'active')",
          [name, email, passwordHash]
        );
        await connection.execute(
          'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [result.insertId, roles[0].id]
        );
        return result.insertId;
      });
      console.log(`PASS seeded local test user ${email} (${requestedRole}), id ${userId}`);
    }
  } catch (error) {
    console.error(`FAIL local test-user seed: ${error.code || error.name || 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
