import 'dotenv/config';
import { getStartupConfigurationErrors } from './lib/startupConfig.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';
const configurationErrors = getStartupConfigurationErrors();

if (configurationErrors.length) {
  console.error('Required configuration is incomplete or invalid:', configurationErrors.join(', '));
  process.exitCode = 1;
} else {
  const [{ formatDatabaseError, pool, verifyDatabaseConnection }, { createApp }] = await Promise.all([
    import('./db.js'),
    import('./app.js'),
  ]);
  const app = createApp();
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
    console.error('Server failed to start:', error.code || error.name || 'Unknown server error');
    process.exitCode = 1;
  });
}
