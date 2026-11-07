import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const accounts = [
  { email: 'admin@eventflow.test', name: 'EventHub Admin', role: 'admin', password: process.env.SEED_ADMIN_PASSWORD },
  { email: 'organizer@eventflow.test', name: 'EventHub Organizer', role: 'organizer', password: process.env.SEED_ORGANIZER_PASSWORD },
  { email: 'vendor@eventflow.test', name: 'EventHub Vendor', role: 'vendor', password: process.env.SEED_VENDOR_PASSWORD },
  { email: 'customer@eventflow.test', name: 'EventHub Customer', role: 'customer', password: process.env.SEED_CUSTOMER_PASSWORD },
];

function isValidPassword(password) {
  return typeof password === 'string'
    && password.length >= 12
    && Buffer.byteLength(password, 'utf8') <= 72;
}

if (accounts.some(({ password }) => !isValidPassword(password))) {
  console.error('Set SEED_ADMIN_PASSWORD, SEED_ORGANIZER_PASSWORD, SEED_VENDOR_PASSWORD, and SEED_CUSTOMER_PASSWORD to unique passwords of 12-72 UTF-8 bytes.');
  process.exitCode = 1;
  await pool.end();
} else {
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
      if (!roles.length) throw new Error(`The active ${role} role is missing; run db:init first.`);
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
    console.log('Seeded the admin, organizer, vendor, and customer demo accounts.');
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(`User seeding failed (${error.code || error.name || 'ERROR'}). Check that db:init completed and database access is available.`);
    process.exitCode = 1;
  } finally {
    connection?.release();
    await pool.end();
  }
}
