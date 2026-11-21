import './src/lib/environment.js';
const { pool } = await import('./src/db.js');
const r = await pool.query("SELECT u.id,u.email,u.username,u.status,r.name FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.is_admin=TRUE ORDER BY u.id LIMIT 10");
console.log(JSON.stringify(r.rows,null,2));
