import { Pool } from 'pg';
import { isPostgresConnectionError } from '../src/lib/postgresRetry.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresPoolConfig } from '../src/lib/postgresConfig.js';

const concurrencyLevels = [1, 2, 4, 8, 16];
const repeatCount = 3;
const queryDelaySeconds = 0.05;

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function recordPoolCounts(pool, counts) {
  counts.active = Math.max(counts.active, pool.totalCount - pool.idleCount);
  counts.idle = Math.max(counts.idle, pool.idleCount);
  counts.waiting = Math.max(counts.waiting, pool.waitingCount);
}

async function runEndpoint(endpoint, config) {
  const pool = new Pool({ ...config, statement_timeout: 10000 });
  const idleErrors = new Map();
  pool.on('error', (error) => {
    const code = error?.code || error?.name || 'UNKNOWN';
    idleErrors.set(code, (idleErrors.get(code) || 0) + 1);
  });
  try {
    const identity = await pool.query(
      'SELECT current_database() AS database_name, current_setting(\'server_version\') AS server_version',
    );
    if (identity.rows[0]?.database_name !== 'eventhub'
      || !identity.rows[0]?.server_version.startsWith('18.')) {
      throw new Error('The concurrency probe must target the isolated PostgreSQL 18 eventhub database.');
    }

    for (const concurrency of concurrencyLevels) {
      const results = [];
      for (let repetition = 0; repetition < repeatCount; repetition += 1) {
        let successful = 0;
        let failed = 0;
        const failuresByCode = new Map();
        const acquisitionWaitMs = [];
        const queryDurationMs = [];
        const counts = { active: 0, idle: 0, waiting: 0 };
        let sampleCounts = true;
        const sampler = setInterval(() => {
          if (sampleCounts) recordPoolCounts(pool, counts);
        }, 5);
        const startedAt = performance.now();

        const jobs = Array.from({ length: concurrency }, async () => {
          let client;
          let releaseError;
          try {
            const acquisitionStartedAt = performance.now();
            client = await pool.connect();
            acquisitionWaitMs.push(performance.now() - acquisitionStartedAt);
            recordPoolCounts(pool, counts);

            const queryStartedAt = performance.now();
            const result = await client.query(
              `SELECT current_database() AS database_name, pg_backend_pid() AS backend_pid,
                      pg_sleep($1) AS waited`,
              [queryDelaySeconds],
            );
            queryDurationMs.push(performance.now() - queryStartedAt);
            if (result.rows[0]?.database_name !== 'eventhub'
              || !Number.isInteger(result.rows[0]?.backend_pid)) {
              throw new Error('A read-only probe query returned an invalid PostgreSQL result.');
            }
            successful += 1;
          } catch (error) {
            failed += 1;
            const code = error?.code || error?.name || 'UNKNOWN';
            failuresByCode.set(code, (failuresByCode.get(code) || 0) + 1);
            if (isPostgresConnectionError(error)) releaseError = error;
          } finally {
            if (client) client.release(releaseError);
            recordPoolCounts(pool, counts);
          }
        });

        recordPoolCounts(pool, counts);
        await Promise.all(jobs);
        const totalMs = performance.now() - startedAt;
        sampleCounts = false;
        clearInterval(sampler);
        recordPoolCounts(pool, counts);
        results.push({
          successful,
          failed,
          failuresByCode,
          acquisitionWaitP95Ms: percentile(acquisitionWaitMs, 0.95),
          queryDurationP95Ms: percentile(queryDurationMs, 0.95),
          totalMs,
          counts,
          waitingAfterRun: pool.waitingCount,
          activeAfterRun: pool.totalCount - pool.idleCount,
        });
      }

      const summary = {
        endpoint,
        poolMax: config.max,
        concurrency,
        repeats: repeatCount,
        successful: results.reduce((sum, result) => sum + result.successful, 0),
        failed: results.reduce((sum, result) => sum + result.failed, 0),
        errors: Object.fromEntries([...results.flatMap((result) => [...result.failuresByCode])]
          .reduce((counts, [code, count]) => counts.set(code, (counts.get(code) || 0) + count), new Map())),
        avgAcquisitionWaitP95Ms: Number((results.reduce((sum, result) => sum + result.acquisitionWaitP95Ms, 0)
          / repeatCount).toFixed(1)),
        maxAcquisitionWaitP95Ms: Number(Math.max(...results.map((result) => result.acquisitionWaitP95Ms)).toFixed(1)),
        avgQueryDurationP95Ms: Number((results.reduce((sum, result) => sum + result.queryDurationP95Ms, 0)
          / repeatCount).toFixed(1)),
        avgTotalMs: Number((results.reduce((sum, result) => sum + result.totalMs, 0) / repeatCount).toFixed(1)),
        peakActive: Math.max(...results.map((result) => result.counts.active)),
        peakIdle: Math.max(...results.map((result) => result.counts.idle)),
        peakWaiting: Math.max(...results.map((result) => result.counts.waiting)),
        waitingAfterRun: Math.max(...results.map((result) => result.waitingAfterRun)),
        activeAfterRun: Math.max(...results.map((result) => result.activeAfterRun)),
      };
      console.log(JSON.stringify(summary));
      if (summary.failed || summary.waitingAfterRun || summary.activeAfterRun) {
        process.exitCode = 1;
      }
    }
  } finally {
    await pool.end();
    if (idleErrors.size) {
      console.error(JSON.stringify({ endpoint, idleClientErrors: Object.fromEntries(idleErrors) }));
      process.exitCode = 1;
    }
  }
}

try {
  const environment = await loadNeonTestEnvironment();
  await runEndpoint('pooled', createPostgresPoolConfig(environment, { purpose: 'runtime' }));
  await runEndpoint('direct', createPostgresPoolConfig(environment, { purpose: 'migration' }));
} catch (error) {
  console.error(`Neon pool concurrency test failed [${error?.code || error?.name || 'UNKNOWN'}].`);
  process.exitCode = 1;
}
