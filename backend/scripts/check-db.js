import 'dotenv/config';
import { getPostgresConfigurationErrors } from '../src/lib/postgresConfig.js';

const configurationErrors = getPostgresConfigurationErrors(process.env, { purpose: 'runtime' });
if (configurationErrors.length) {
  console.error(`FAIL PostgreSQL configuration: ${configurationErrors.join(' ')}`);
  process.exitCode = 1;
} else {
  const { createPostgresRuntimePool } = await import('../src/postgresPool.js');
  const { formatPostgresError, getPostgresFailureCode } = await import('../src/postgresDb.js');
  let pool;

  try {
    pool = createPostgresRuntimePool();
    const identity = await pool.query(
      'SELECT version() AS server_version, current_database() AS database_name, current_schema() AS schema_name',
    );
    if (!identity.rows[0]?.server_version || !identity.rows[0]?.database_name || !identity.rows[0]?.schema_name) {
      throw new Error('PostgreSQL connection did not return server, database, and schema identity.');
    }

    const probe = await pool.query('SELECT 1 AS result');
    if (Number(probe.rows[0]?.result) !== 1) {
      throw new Error('PostgreSQL SELECT 1 returned an unexpected result.');
    }

    const schema = await pool.query(
      `SELECT COUNT(*)::integer AS table_count
       FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
    );
    const tableCount = Number(schema.rows[0]?.table_count);
    if (!Number.isInteger(tableCount) || tableCount < 1) {
      throw new Error('The configured PostgreSQL schema contains no application tables.');
    }

    console.log('PASS Neon PostgreSQL runtime connection and SELECT 1');
    console.log(`PASS PostgreSQL schema is available (${tableCount} tables)`);
  } catch (error) {
    console.error(`FAIL PostgreSQL check [${getPostgresFailureCode(error)}]: ${formatPostgresError(error)}`);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}
