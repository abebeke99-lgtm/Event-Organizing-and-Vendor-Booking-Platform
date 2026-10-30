import 'dotenv/config';
const missingVariables = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
  .filter((name) => !process.env[name]?.trim());
const certificateAuthority = process.env.DB_SSL_CA?.replace(/\\n/g, '\n').trim();

if (process.env.DB_SSL !== 'true') missingVariables.push('DB_SSL=true');
if (!certificateAuthority || !/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.test(certificateAuthority)) {
  missingVariables.push('DB_SSL_CA (valid PEM certificate required)');
}

if (missingVariables.length) {
  console.error(`Database check not run; configure: ${missingVariables.join(', ')}`);
  process.exitCode = 1;
} else {
  const { formatDatabaseError, pool, verifyDatabaseConnection } = await import('../src/db.js');
  try {
    await verifyDatabaseConnection(pool, process.env.DB_NAME);
    console.log('Database TLS connection, SELECT 1, and selected database verified.');
  } catch (error) {
    console.error('Database check failed:', formatDatabaseError(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
