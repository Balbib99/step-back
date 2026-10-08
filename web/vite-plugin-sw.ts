import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Files that are not part of the app shell: the worker itself and source maps. */
const SKIPPED = /(^|\/)sw\.js$|\.map$/;

/** Every file under `dir`, as addresses starting with "/" (`/assets/index-abc.js`). */
export function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(`/${relative(dir, path).split(sep).join('/')}`);
    }
  };
  walk(dir);
  return found.filter((file) => !SKIPPED.test(file)).sort();
}

/**
 * The worker with its two placeholders filled in: the build id (changes whenever any file does)
 * and the addresses to store. `/` is stored too: it is the page every screen opens from.
 */
export function renderServiceWorker(
  template: string,
  files: readonly string[],
  build: string,
): string {
  const precache = ['/', ...files.filter((file) => file !== '/index.html')];
  if (!template.includes("'__BUILD__'") || !template.includes('/*__PRECACHE__*/ []')) {
    throw new Error('sw.js has lost its placeholders (__BUILD__ and __PRECACHE__)');
  }
  return template
    .replace("'__BUILD__'", JSON.stringify(build))
    .replace('/*__PRECACHE__*/ []', JSON.stringify(precache, null, 2));
}

/** A short id that changes with the content of any stored file. */
export function buildId(dir: string, files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(join(dir, file)));
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * Writes `dist/sw.js` after the build, from `sw/sw.js`, listing what the build produced. It runs
 * last because the list has to include the files Vite copies from `public/` too.
 */
export function serviceWorker(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'step-back-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },
    closeBundle() {
      const dist = join(root, outDir);
      const files = listFiles(dist);
      const template = readFileSync(join(root, 'sw', 'sw.js'), 'utf8');
      writeFileSync(
        join(dist, 'sw.js'),
        renderServiceWorker(template, files, buildId(dist, files)),
      );
    },
  };
}
