import { createApp } from './src/app.js';
import { hashToken } from './src/lib/security.js';

const sessionToken='customer-api-test-session';
const user={id:21,full_name:'Customer Test',email:'customer-test@example.test',phone:null,preferred_language:'en',status:'active',role:'customer'};
const db={
  async execute(sql, values=[]){
    if (sql.includes('FROM user_sessions s')) {
      const ok = values[0] === hashToken(sessionToken);
      return [ok ? [{ ...user, permission_keys:'favorites.manage_own,bookings.view_own' }] : [], []];
    }
    return [[], []];
  },
  async query(sql, values=[]){
    if (sql.includes('FROM user_sessions s')) {
      const ok = values[0] === hashToken(sessionToken);
      return { rows: ok ? [{ ...user, permission_keys:'favorites.manage_own,bookings.view_own' }] : [] };
    }
    throw new Error('Unexpected query: ' + sql.slice(0, 80));
  },
};

const app = createApp({ database: db });
const probe = await app.locals.database.query('SELECT * FROM user_sessions s WHERE s.token_hash = $1', [hashToken(sessionToken)]);
console.log('PROBE', JSON.stringify(probe));
const server = app.listen(0, '127.0.0.1');
server.once('listening', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/customer/overview`, {
    headers: { Cookie: `platform_session=${sessionToken}` },
  });
  console.log('status=', response.status);
  console.log(await response.text());
  server.close();
});
