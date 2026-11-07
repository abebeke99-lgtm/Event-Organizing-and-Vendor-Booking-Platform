import { pool, validateDatabaseEnvironment } from '../src/db.js';
import {
  AdministratorProvisioningError,
  getAdministratorBootstrapConfig,
  provisionAdministrator,
} from '../src/lib/adminProvisioning.js';

try {
  validateDatabaseEnvironment();
  const credentials = getAdministratorBootstrapConfig();
  await provisionAdministrator(pool, credentials);
  console.log('Initial administrator provisioned successfully.');
} catch (error) {
  if (error instanceof AdministratorProvisioningError) {
    console.error(error.message);
  } else {
    console.error('Administrator provisioning failed. Check database connectivity and migrations; no credentials were logged.');
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
