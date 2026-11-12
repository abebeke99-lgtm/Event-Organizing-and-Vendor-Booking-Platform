import '../src/lib/environment.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';

const environment = await loadNeonTestEnvironment();
Object.assign(process.env, environment, { DB_DIALECT: 'postgres' });

await import('../src/server.js');