import '../src/lib/environment.js';
const { createPostgresRuntimePool } = await import('../src/postgresPool.js');
const pool = createPostgresRuntimePool();
const q = await pool.query(`
  SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='users' AND ccu.column_name='id'
  ORDER BY tc.table_name
`);
console.log(q.rows.map(r=>r.table_name+'.'+r.column_name).join('\n'));
await pool.end();
