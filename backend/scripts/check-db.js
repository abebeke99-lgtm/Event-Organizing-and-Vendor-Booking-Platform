import 'dotenv/config';
import {
  formatDatabaseError,
  getDatabaseConfigurationErrors,
  pool,
  verifyDatabaseConnection,
} from '../src/db.js';

const configurationErrors = getDatabaseConfigurationErrors(process.env, { requireTls: true });

if (configurationErrors.length) {
  console.error(`Database check not run; configure: ${configurationErrors.join(', ')}`);
  process.exitCode = 1;
} else {
  try {
    await verifyDatabaseConnection();
    console.log('Database TLS connection and SELECT 1 verified.');
  } catch (error) {
    console.error('Database check failed:', formatDatabaseError(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
