import 'dotenv/config';
import {
  formatDatabaseError,
  getDatabaseConfigurationErrors,
  pool,
  verifyDatabaseConnection,
} from './db.js';
import { createApp } from './app.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';
const configurationErrors = getDatabaseConfigurationErrors();

if (configurationErrors.length) {
  console.error('Database configuration is incomplete or invalid:', configurationErrors.join(', '));
  process.exitCode = 1;
} else {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Admin API listening on ${HOST}:${PORT}`);

    verifyDatabaseConnection()
      .then(() => console.log('MySQL connection verified.'))
      .catch((error) =>
        console.error(
          'MySQL connection unavailable at startup:',
          formatDatabaseError(error)
        )
      );
  });

  server.on('error', (error) => {
    console.error('Server failed to start:', error.message);
    process.exitCode = 1;
  });
}
