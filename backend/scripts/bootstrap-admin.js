import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const name = process.env.ADMIN_BOOTSTRAP_NAME?.trim();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (!email || !name || !password || password.length < 16) {
  console.error('Set ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_NAME, and a password of at least 16 characters in the environment.');
  process.exitCode = 1;
} else {
  try {
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) throw new Error('An account with that email already exists; refusing to modify existing account data.');
    const [roles] = await pool.execute('SELECT id FROM roles WHERE name = ? AND is_admin = TRUE AND is_active = TRUE', ['Admin']);
    if (!roles.length) throw new Error('Admin role is missing. Run the migrations first.');
    const hash = await bcrypt.hash(password, 12);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [created] = await connection.execute('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)', [name, email, hash]);
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [created.insertId, roles[0].id]);
      await connection.commit();
      console.log(`Created initial administrator account ${email}.`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
}
