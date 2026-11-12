import '../src/lib/environment.js';

if (process.env.NODE_ENV === 'production') {
  await import('../src/server.js');
} else {
  await import('./dev-neon.js');
}
