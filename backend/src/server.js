import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { getDatabaseDialect, getStartupConfigurationErrors } from './lib/startupConfig.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

if (process.env.NODE_ENV !== 'production' && process.env.DB_DIALECT?.trim() !== 'postgres') {
  const { loadNeonTestEnvironment } = await import('./lib/neonTestEnvironment.js');
  Object.assign(process.env, await loadNeonTestEnvironment(), { DB_DIALECT: 'postgres' });
}

const configuredPort = process.env.PORT?.trim();
const PORT = configuredPort ? Number(configuredPort) : 4000;
const HOST = '0.0.0.0';
const configurationErrors = getStartupConfigurationErrors();

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.warn('AI chat is unavailable: set OPENAI_API_KEY in backend/.env to enable the EventHub AI endpoints.');
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exitCode = 1;
} else if (configurationErrors.length) {
  console.error('Required configuration is incomplete or invalid:', configurationErrors.join(', '));
  process.exitCode = 1;
} else {
  const databaseDialect = getDatabaseDialect();
  const [{ formatDatabaseError, getDatabaseFailureCode, pool, verifyDatabaseConnection }, { createApp }, { loadPaymentProvider }] = await Promise.all([
    import('./db.js'),
    import('./app.js'),
    import('./lib/paymentProvider.js'),
  ]);
  let databaseConnected = false;
  try {
    await verifyDatabaseConnection();
    databaseConnected = true;
  } catch (error) {
    const dialect = databaseDialect === 'postgres' ? 'PostgreSQL' : 'MySQL';
    if (databaseDialect === 'postgres') {
      console.error(`${dialect} connection failed [${getDatabaseFailureCode(error)}]:`, formatDatabaseError(error));
      process.exitCode = 1;
    } else {
      console.warn(`${dialect} connection failed [${getDatabaseFailureCode(error)}]; the API will start with database health unavailable:`, formatDatabaseError(error));
    }
  }

  if (!process.exitCode) {
    if (databaseConnected) console.log(databaseDialect === 'postgres' ? 'Database connected.' : 'MySQL connected.');
    const paymentProvider = await loadPaymentProvider();
    const app = createApp({ paymentProvider, databaseDialect });
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
