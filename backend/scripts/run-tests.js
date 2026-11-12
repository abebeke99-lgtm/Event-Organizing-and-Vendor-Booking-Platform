import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = dirname(fileURLToPath(import.meta.url));
const testDirectory = join(backendDirectory, '..', 'test');
const testFiles = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => join(testDirectory, entry.name))
  .sort();

if (!testFiles.length) {
  throw new Error(`No explicit .test.js files found in ${testDirectory}.`);
}

// Neon integration files share the isolated database, so their fixtures must not overlap.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
  cwd: backendDirectory,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
