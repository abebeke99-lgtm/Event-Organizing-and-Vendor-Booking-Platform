import './src/lib/environment.js';
import { loadNeonTestEnvironment } from './src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from './src/postgresDb.js';
import { loadAdminDashboardOverview, resolveDashboardDateRange } from './src/lib/dashboardFilters.js';

const environment = await loadNeonTestEnvironment();
const database = createPostgresDatabase(environment);
const end = new Date().toISOString().slice(0,10);
const startDate = new Date(Date.now() - 29*24*60*60*1000).toISOString().slice(0,10);
const period = resolveDashboardDateRange({ range: 'custom', from: startDate, to: end });
const t0 = Date.now();
await loadAdminDashboardOverview(database.runtimeAdapter, period);
console.log('DURATION_MS', Date.now()-t0);
