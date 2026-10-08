// Bundles the server (and the shared package) into one file: dist/index.js.
// Runtime libraries stay external and are installed in the production image; the native
// SQLite module cannot be bundled at all.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  external: ['better-sqlite3', 'fastify', '@fastify/static', 'pino', 'web-push', 'zod'],
});
