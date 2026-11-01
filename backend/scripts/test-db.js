import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const { getDatabaseConfigurationErrors } = await import('../src/lib/databaseConfig.js');
const requireTls = process.env.NODE_ENV === 'production';
const configurationErrors = getDatabaseConfigurationErrors(process.env, { requireTls });

function commonCause(error) {
  if (['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR'].includes(error?.code)) {
    return 'Check DB_USER and DB_PASSWORD in the local backend environment.';
  }
  if (error?.code === 'ER_BAD_DB_ERROR') {
    return 'The configured database does not exist; verify DB_NAME before creating it.';
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return 'Check that MySQL is running and DB_HOST/DB_PORT point to the intended server.';
  }
  if (error?.code === 'DB_TLS_FAILED' || /certificate|tls|ssl/i.test(error?.message || '')) {
    return 'For Aiven, verify DB_SSL=true and the valid DB_SSL_CA PEM in the secure production environment.';
  }
  return 'Check the local MySQL service, selected environment, and database configuration.';
}

if (configurationErrors.length) {
  console.error(`FAIL Configuration: set valid values for ${configurationErrors.join(', ')}`);
  process.exitCode = 1;
} else {
  const { formatDatabaseError, getDatabaseFailureCode, pool } = await import('../src/db.js');
  try {
    const [probe] = await pool.query('SELECT 1 AS result');
    if (Number(probe[0]?.result) !== 1) throw new Error('SELECT 1 returned an unexpected result.');
    console.log(requireTls ? 'PASS TLS-verified MySQL connection' : 'PASS local MySQL connection');
    console.log('PASS SELECT 1');

    const [databaseRows] = await pool.query('SELECT DATABASE() AS database_name');
    if (databaseRows[0]?.database_name !== process.env.DB_NAME) {
      const mismatch = new Error('Connected database does not match DB_NAME.');
      mismatch.code = 'DB_NAME_MISMATCH';
      throw mismatch;
    }
    console.log('PASS SELECT DATABASE() matches DB_NAME');

    const [tableRows] = await pool.query('SHOW TABLES');
    const tables = tableRows.map((row) => Object.values(row)[0]);
    const requiredTables = ['users', 'roles', 'user_roles', 'admin_sessions', 'user_sessions'];
    const missingTables = requiredTables.filter((table) => !tables.includes(table));
    if (missingTables.length) {
      const missing = new Error(`Required tables are missing: ${missingTables.join(', ')}.`);
      missing.code = 'DB_TABLES_MISSING';
      throw missing;
    }
    console.log(`PASS required authentication tables (${requiredTables.length})`);
  } catch (error) {
    const code = getDatabaseFailureCode(error);
    console.error(`FAIL MySQL check [${error.code || code}]: ${formatDatabaseError(error)}`);
    console.error(commonCause(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
