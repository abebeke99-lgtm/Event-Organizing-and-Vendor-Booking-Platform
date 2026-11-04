import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { getStartupConfigurationErrors } from './lib/startupConfig.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const configuredPort = process.env.PORT?.trim();
const PORT = configuredPort ? Number(configuredPort) : 4000;
const HOST = '0.0.0.0';
const configurationErrors = getStartupConfigurationErrors();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exitCode = 1;
} else if (configurationErrors.length) {
  console.error('Required configuration is incomplete or invalid:', configurationErrors.join(', '));
  process.exitCode = 1;
} else {
  const [{ formatDatabaseError, pool, verifyDatabaseConnection }, { createApp }, { loadPaymentProvider }] = await Promise.all([
    import('./db.js'),
    import('./app.js'),
    import('./lib/paymentProvider.js'),
  ]);
  try {
    await verifyDatabaseConnection();
  } catch (error) {
    console.error('MySQL connection failed:', formatDatabaseError(error));
    try {
      await pool.end();
    } catch (closeError) {
      console.error('Failed to close the MySQL pool:', formatDatabaseError(closeError));
    }
    process.exitCode = 1;
  }

  if (!process.exitCode) {
    console.log('MySQL connected.');
    const paymentProvider = await loadPaymentProvider();
    const app = createApp({ paymentProvider });
    const server = app.listen(PORT, HOST, () => {
      console.log(`Admin API listening on ${HOST}:${PORT}`);
    });

    let resourceClosePromise;
    function closeResources() {
      if (!resourceClosePromise) {
        resourceClosePromise = (async () => {
          try {
            if (server.listening) {
              await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
              });
            }
          } finally {
            await pool.end();
          }
        })();
      }
      return resourceClosePromise;
    }

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Find its owner with: netstat -ano | findstr :${PORT}`);
      } else {
        console.error('Backend server error:', error.message || error.code || error.name || 'Unknown server error');
      }
      process.exitCode = 1;
      void closeResources().catch((closeError) => {
        console.error('Failed to release backend resources:', formatDatabaseError(closeError));
      });
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        console.log(`Received ${signal}; shutting down the backend server.`);
        void closeResources().catch((error) => {
          console.error('Failed to shut down cleanly:', formatDatabaseError(error));
          process.exitCode = 1;
        });
      });
    }
  }
}
