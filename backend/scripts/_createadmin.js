import '../src/lib/environment.js';
import bcrypt from 'bcryptjs';
const { createPostgresRuntimePool } = await import('../src/postgresPool.js');
const pool = createPostgresRuntimePool();
const email = 'audit-admin-' + Date.now() + '@example.invalid';
const hash = await bcrypt.hash('AuditPass123!', 10);
const r = await pool.query(
  "INSERT INTO users (full_name, email, password_hash, status) VALUES ($1,$2,$3,'active') RETURNING id",
  ['Audit Admin', email, hash]
);
const userId = r.rows[0].id;
await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, 1)", [userId]);
console.log('USER_ID=' + userId);
console.log('EMAIL=' + email);
console.log('PASSWORD=AuditPass123!');
await pool.end();
