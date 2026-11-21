import '../src/lib/environment.js';
const { createPostgresRuntimePool } = await import('../src/postgresPool.js');
const pool = createPostgresRuntimePool();
const q = async (sql) => (await pool.query(sql)).rows;
const ur = await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_roles' ORDER BY ordinal_position");
console.log('user_roles cols:', ur.map(c=>c.column_name).join(', '));
const sessions = await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions' ORDER BY ordinal_position");
console.log('user_sessions cols:', sessions.map(c=>c.column_name).join(', '));
await pool.end();
