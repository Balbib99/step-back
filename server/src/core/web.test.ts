import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from './app.js';
import { loadConfig } from './config.js';

let app: App | undefined;
let webDir: string;

beforeEach(() => {
  webDir = mkdtempSync(join(tmpdir(), 'step-back-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(
    join(webDir, 'index.html'),
    '<!doctype html><title>step-back</title><div id="root"></div>',
  );
  writeFileSync(join(webDir, 'assets', 'app.3f9a1c.js'), 'console.log("app")');
  writeFileSync(join(webDir, 'manifest.webmanifest'), '{"name":"step-back"}');
});

afterEach(async () => {
  await app?.server.close();
  app = undefined;
  rmSync(webDir, { recursive: true, force: true });
});

async function start(env: Record<string, string> = {}) {
  app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', WEB_DIR: webDir, ...env }),
  });
  return app.server;
}

describe('serving the web app', () => {
  it('serves index.html at the root, revalidated every time so a new release shows up', async () => {
    const server = await start();
    const response = await server.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain('<div id="root">');
  });

  it('caches hashed assets for a year', async () => {
    const server = await start();
    const response = await server.inject('/assets/app.3f9a1c.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('revalidates other files, such as the manifest', async () => {
    const server = await start();
    const response = await server.inject('/manifest.webmanifest');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('answers a link into the app with index.html, so a reload on /calendario works', async () => {
    const server = await start();
    for (const path of [
      '/calendario',
      '/clasificacion',
      '/calendario?fecha=2026-10-07&equipo=MIN',
    ]) {
      const response = await server.inject(path);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<div id="root">');
      expect(response.headers['cache-control']).toBe('no-cache');
    }
  });

  it('keeps the API as it is', async () => {
    const server = await start();
    expect((await server.inject('/api/health')).json()).toMatchObject({ status: 'ok' });
    const missing = await server.inject('/api/nope');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
  });

  it('is a real 404 for a file that does not exist, not index.html', async () => {
    const server = await start();
    const response = await server.inject('/assets/missing.js');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('does not answer anything but GET with the app', async () => {
    const server = await start();
    expect((await server.inject({ method: 'POST', url: '/calendario' })).statusCode).toBe(404);
  });

  it('cannot be asked for files outside the web folder', async () => {
    writeFileSync(join(webDir, '..', 'step-back-secret.txt'), 'secret');
    const server = await start();
    for (const path of [
      '/../step-back-secret.txt',
      '/%2e%2e/step-back-secret.txt',
      '/..%2fstep-back-secret.txt',
    ]) {
      const response = await server.inject(path);
      expect(response.body).not.toContain('secret');
    }
    rmSync(join(webDir, '..', 'step-back-secret.txt'), { force: true });
  });
});

describe('without a web folder', () => {
  it('serves no app: development uses the Vite server for that', async () => {
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }) });
    expect((await app.server.inject('/')).statusCode).toBe(404);
    expect((await app.server.inject('/calendario')).json()).toEqual({ error: 'not_found' });
  });

  it('refuses to start when the folder has no index.html, saying why', async () => {
    rmSync(join(webDir, 'index.html'));
    await expect(
      buildApp({ config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', WEB_DIR: webDir }) }),
    ).rejects.toThrow(/has no index\.html/);
  });
});
