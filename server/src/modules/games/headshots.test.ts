import { mkdtempSync, rmSync, utimesSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { createHttpClient } from '../../core/http.js';
import { gamesModule } from './index.js';
import {
  createHeadshotStore,
  HEADSHOT_MAX_AGE_MS,
  headshotPath,
  headshotSourceUrl,
  HeadshotUnavailableError,
  isPlayerId,
} from './headshots.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'step-back-headshots-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A store over a fake ESPN: `answers` says what each photo request gets. */
function store(answer: (url: string) => Response, now?: () => number) {
  const calls: string[] = [];
  const http = createHttpClient({
    userAgent: 'test',
    minIntervalMs: 0,
    fetch: (async (url: string) => {
      calls.push(url);
      return answer(url);
    }) as unknown as typeof fetch,
  });
  return { calls, store: createHeadshotStore({ dir, http, logger, ...(now && { now }) }) };
}
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });

describe('player ids and addresses', () => {
  it('accepts only plain numbers', () => {
    expect(isPlayerId('4897449')).toBe(true);
    for (const bad of ['', 'abc', '12a', '../etc', '1/2', '12345678901', '-1', ' 1']) {
      expect(isPlayerId(bad)).toBe(false);
    }
  });

  it('serves from this server and downloads small photos from the ESPN image service', () => {
    expect(headshotPath('4897449')).toBe('/api/players/4897449/headshot');
    const url = new URL(headshotSourceUrl('4897449'));
    expect(url.host).toBe('a.espncdn.com');
    expect(url.searchParams.get('img')).toBe('/i/headshots/nba/players/full/4897449.png');
    expect(url.searchParams.get('w')).toBe('160');
  });
});

describe('the headshot store', () => {
  it('downloads a photo once and keeps it on disk', async () => {
    const { store: photos, calls } = store(png);
    expect(await photos.get('4897449')).toEqual(PNG);
    expect(await photos.get('4897449')).toEqual(PNG);
    expect(calls).toHaveLength(1);
    expect(readFileSync(join(dir, '4897449.png'))).toEqual(Buffer.from(PNG));
  });

  it('asks ESPN once for many looks at the same time', async () => {
    const { store: photos, calls } = store(png);
    await Promise.all([photos.get('1'), photos.get('1'), photos.get('1')]);
    expect(calls).toHaveLength(1);
  });

  it('answers from disk after a restart (a new store, the same folder)', async () => {
    await store(png).store.get('7');
    const second = store(() => new Response('down', { status: 500 }));
    expect(await second.store.get('7')).toEqual(PNG);
    expect(second.calls).toEqual([]);
  });

  it('says there is no photo when ESPN has none, and does not ask again for a while', async () => {
    let now = 1_000_000;
    const { store: photos, calls } = store(
      () => new Response('', { status: 404 }),
      () => now,
    );
    expect(await photos.get('9')).toBeUndefined();
    expect(await photos.get('9')).toBeUndefined();
    expect(calls).toHaveLength(1);
    now += 61 * 60_000;
    await photos.get('9');
    expect(calls).toHaveLength(2);
  });

  it('refuses what is not a PNG, and keeps nothing', async () => {
    const { store: photos } = store(() => new Response('<html>nope</html>'));
    await expect(photos.get('3')).rejects.toBeInstanceOf(HeadshotUnavailableError);
    expect(existsSync(join(dir, '3.png'))).toBe(false);
  });

  it('refuses a photo that is far too large', async () => {
    const huge = new Uint8Array(400_000);
    huge.set(PNG);
    const { store: photos } = store(() => new Response(huge));
    await expect(photos.get('3')).rejects.toBeInstanceOf(HeadshotUnavailableError);
  });

  it('fails with an error when ESPN is down and there is nothing kept', async () => {
    const { store: photos } = store(() => new Response('down', { status: 500 }));
    await expect(photos.get('3')).rejects.toBeInstanceOf(HeadshotUnavailableError);
  });

  it('downloads again after a month, and keeps the old photo when ESPN fails then', async () => {
    const now = Date.now();
    writeFileSync(join(dir, '5.png'), PNG);
    const old = new Date(now - HEADSHOT_MAX_AGE_MS - 60_000);
    utimesSync(join(dir, '5.png'), old, old);

    const down = store(
      () => new Response('down', { status: 500 }),
      () => now,
    );
    expect(await down.store.get('5')).toEqual(PNG); // the old one, not an error
    expect(down.calls.length).toBeGreaterThan(0);

    const fresh = Uint8Array.from([...PNG, 99]);
    const up = store(
      () => new Response(fresh),
      () => now,
    );
    expect(await up.store.get('5')).toEqual(fresh);
  });
});

describe('GET /api/players/:id/headshot', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.server.close();
    app = undefined;
  });

  async function build(answer: () => Response) {
    const calls: string[] = [];
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', HEADSHOTS_DIR: dir }),
      modules: [gamesModule],
      fetch: vi.fn(async (url: string | URL | Request) => {
        calls.push(String(url));
        return answer();
      }) as unknown as typeof fetch,
    });
    return { server: app.server, calls };
  }

  it('serves a PNG that the browser may keep for a week', async () => {
    const { server } = await build(png);
    const response = await server.inject('/api/players/4897449/headshot');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('public, max-age=604800');
    expect(response.rawPayload).toEqual(Buffer.from(PNG));
  });

  it('is a 404 for a player ESPN has no photo of', async () => {
    const { server } = await build(() => new Response('', { status: 404 }));
    expect((await server.inject('/api/players/123/headshot')).statusCode).toBe(404);
  });

  it('is a 404, and never reaches ESPN, for an id that is not a number', async () => {
    const { server, calls } = await build(png);
    for (const id of ['abc', '1a', '..%2F..%2Fetc', '12345678901']) {
      expect((await server.inject(`/api/players/${id}/headshot`)).statusCode).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it('is a 502 when ESPN fails', async () => {
    const { server } = await build(() => new Response('down', { status: 500 }));
    expect((await server.inject('/api/players/123/headshot')).statusCode).toBe(502);
  });
});
