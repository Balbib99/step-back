import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildId, listFiles, renderServiceWorker } from './vite-plugin-sw';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'step-back-sw-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'index.html'), '<html></html>');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'js');
  writeFileSync(join(dir, 'assets', 'index-abc.js.map'), 'map');
  writeFileSync(join(dir, 'icons', 'icon-192.png'), 'png');
  writeFileSync(join(dir, 'sw.js'), 'old worker');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('listFiles', () => {
  it('lists what the app is made of, as addresses, without the worker or source maps', () => {
    expect(listFiles(dir)).toEqual([
      '/assets/index-abc.js',
      '/icons/icon-192.png',
      '/index.html',
      '/manifest.webmanifest',
    ]);
  });
});

describe('buildId', () => {
  it('changes when the content of a file does, and not otherwise', () => {
    const files = listFiles(dir);
    const before = buildId(dir, files);
    expect(buildId(dir, files)).toBe(before);
    writeFileSync(join(dir, 'assets', 'index-abc.js'), 'changed');
    expect(buildId(dir, files)).not.toBe(before);
    expect(before).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('renderServiceWorker', () => {
  const template = "const BUILD = '__BUILD__';\nconst PRECACHE = /*__PRECACHE__*/ [];\n";

  it('fills in the build id and the files, adding the page every screen opens from', () => {
    const output = renderServiceWorker(
      template,
      ['/assets/a.js', '/index.html', '/manifest.webmanifest'],
      'abc123',
    );
    expect(output).toContain('const BUILD = "abc123";');
    const precache = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(output)![1]!) as string[];
    expect(precache).toEqual(['/', '/assets/a.js', '/manifest.webmanifest']);
  });

  it('refuses a worker that has lost its placeholders, instead of shipping one that stores nothing', () => {
    expect(() => renderServiceWorker('const x = 1;', [], 'abc')).toThrow(/placeholders/);
  });
});
