import '../src/lib/environment.js';
const { createPostgresRuntimePool } = await import('../src/postgresPool.js');
const pool = createPostgresRuntimePool();
const q = async (sql) => (await pool.query(sql)).rows;
const users = await q("SELECT id, full_name, email, status, username FROM users ORDER BY id LIMIT 30");
console.log('USERS:', users.length);
console.log(JSON.stringify(users, null, 2));
// roles table?
const roles = await q("SELECT * FROM roles LIMIT 30");
console.log('ROLES:', roles.length, JSON.stringify(roles));
await pool.end();
