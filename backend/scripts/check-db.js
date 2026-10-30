import 'dotenv/config';
import { getDatabaseConfigurationErrors } from '../src/lib/databaseConfig.js';

const missingVariables = getDatabaseConfigurationErrors(process.env, { requireTls: true })
  .map((error) => error.split(/[ (]/)[0].split('=')[0]);

if (missingVariables.length) {
  console.error(`FAIL Configuration: set valid values for ${[...new Set(missingVariables)].join(', ')}`);
  process.exitCode = 1;
} else {
  const { formatDatabaseError, getDatabaseFailureCode, pool } = await import('../src/db.js');
  await checkDatabase({ formatDatabaseError, getDatabaseFailureCode, pool });
}

async function checkDatabase({ formatDatabaseError, getDatabaseFailureCode, pool }) {
  let step = 'TLS-verified connection and SELECT 1';
  try {
    const [result] = await pool.query('SELECT 1 AS result');
    if (Number(result[0]?.result) !== 1) throw new Error('SELECT 1 returned an unexpected result.');
    console.log('PASS TLS-verified MySQL connection');
    console.log('PASS SELECT 1');
    step = 'SELECT DATABASE()';
    const [rows] = await pool.query('SELECT DATABASE() AS database_name');
    if (rows[0]?.database_name !== process.env.DB_NAME) {
      const error = new Error('Connected database does not match DB_NAME.');
      error.code = 'DB_NAME_MISMATCH';
      throw error;
    }
    console.log('PASS SELECT DATABASE() matches DB_NAME');
  } catch (error) {
    console.error(`FAIL ${step} [${getDatabaseFailureCode(error)}]: ${formatDatabaseError(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
