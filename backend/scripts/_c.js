import '../src/lib/environment.js';
const { createPostgresRuntimePool } = await import('../src/postgresPool.js');
const pool = createPostgresRuntimePool();
const q = async (sql) => (await pool.query(sql)).rows;
const cols = await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position");
console.log(cols.map(c=>c.column_name).join(', '));
await pool.end();
