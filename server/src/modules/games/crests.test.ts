import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { openDb } from '../../core/db.js';
import { HttpError, type HttpClient } from '../../core/http.js';
import { createLogger } from '../../core/logger.js';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { runMigrations } from '../../core/migrations.js';
import { parseTeams } from './adapter.js';
import {
  CrestUnavailableError,
  createCrestStore,
  resizedCrestUrl,
  type CrestStore,
} from './crests.js';
import { gamesModule } from './index.js';
import { createGamesRepo } from './repo.js';

const logger = createLogger({ env: 'test', logLevel: 'info' });

const png = (marker: number) =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker, marker, marker]);
const html = Uint8Array.from(Buffer.from('<html>not found</html>'));

type Responder = (url: string) => Uint8Array | Error;

function fakeHttp(respond: Responder) {
  const getBytes = vi.fn(async (url: string) => {
    const result = respond(url);
    if (result instanceof Error) throw result;
    return { status: 200, headers: new Headers(), body: result };
  });
  return { http: { get: vi.fn(), getJson: vi.fn(), getBytes } as unknown as HttpClient, getBytes };
}

describe('resizedCrestUrl', () => {
  it('asks ESPN image service for a 128 px crest', () => {
    expect(resizedCrestUrl('https://a.espncdn.com/i/teamlogos/nba/500/min.png')).toBe(
      'https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/min.png&w=128&h=128',
    );
  });

  it('leaves any other address alone', () => {
    expect(resizedCrestUrl('https://example.com/logo.png')).toBe('https://example.com/logo.png');
    expect(resizedCrestUrl('https://a.espncdn.com/guid/abc/logos/primary.png')).toBe(
      'https://a.espncdn.com/guid/abc/logos/primary.png',
    );
  });
});

describe('CrestStore', () => {
  let dir: string;
  let repo: ReturnType<typeof createGamesRepo>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'step-back-crests-'));
    const db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...(gamesModule.migrations ?? [])]);
    repo = createGamesRepo(db);
    repo.upsertTeams(parseTeams(readEspnFixture('teams.json')));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const store = (http: HttpClient): CrestStore => createCrestStore({ dir, http, repo, logger });
  const resized = 'combiner';

  it('downloads the resized crest the first time and keeps it on disk', async () => {
    const { http, getBytes } = fakeHttp(() => png(1));
    expect(await store(http).get('MIN')).toEqual(png(1));

    expect(getBytes).toHaveBeenCalledTimes(1);
    expect(getBytes.mock.calls[0]![0]).toBe(
      'https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/min.png&w=128&h=128',
    );
    expect(new Uint8Array(readFileSync(join(dir, 'MIN.png')))).toEqual(png(1));
    expect(readdirSync(dir)).toEqual(['MIN.png']); // no temporary file left behind
  });

  it('serves it from disk afterwards, even from a fresh store (a server restart)', async () => {
    const first = fakeHttp(() => png(1));
    await store(first.http).get('MIN');

    const second = fakeHttp(() => new Error('must not be called'));
    expect(await store(second.http).get('MIN')).toEqual(png(1));
    expect(second.getBytes).not.toHaveBeenCalled();
  });

  it('downloads a crest once even when it is asked for many times at once', async () => {
    const { http, getBytes } = fakeHttp(() => png(2));
    const crests = store(http);
    const results = await Promise.all([crests.get('LAL'), crests.get('LAL'), crests.get('LAL')]);
    expect(results.every((bytes) => bytes?.[8] === 2)).toBe(true);
    expect(getBytes).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original image when the resizing service fails', async () => {
    const { http, getBytes } = fakeHttp((url) =>
      url.includes(resized) ? new HttpError('HTTP 500', url, 500) : png(3),
    );
    expect(await store(http).get('PHI')).toEqual(png(3));
    expect(getBytes.mock.calls.map((call) => call[0])).toEqual([
      'https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/phi.png&w=128&h=128',
      'https://a.espncdn.com/i/teamlogos/nba/500/phi.png',
    ]);
  });

  it('does not accept something that is not a PNG, such as an error page', async () => {
    const { http } = fakeHttp((url) => (url.includes(resized) ? html : png(4)));
    expect(await store(http).get('MIN')).toEqual(png(4)); // rejected the page, used the original
    const onlyHtml = fakeHttp(() => html);
    await expect(store(onlyHtml.http).get('PHI')).rejects.toBeInstanceOf(CrestUnavailableError);
  });

  it('caches nothing when every attempt fails, and tries again next time', async () => {
    let failing = true;
    const { http, getBytes } = fakeHttp((url) =>
      failing ? new HttpError('HTTP 503', url, 503) : png(5),
    );
    const crests = store(http);

    await expect(crests.get('MIN')).rejects.toBeInstanceOf(CrestUnavailableError);
    expect(readdirSync(dir)).toEqual([]);

    failing = false;
    expect(await crests.get('MIN')).toEqual(png(5));
    expect(getBytes).toHaveBeenCalledTimes(3); // 2 failed attempts, then 1 good
  });

  it('knows nothing about a team that is not in the database, and does not go to the network', async () => {
    const { http, getBytes } = fakeHttp(() => png(1));
    expect(await store(http).get('LON')).toBeUndefined();
    expect(getBytes).not.toHaveBeenCalled();
  });

  it('warms the cache with the missing crests only, reporting those that fail', async () => {
    writeFileSync(join(dir, 'MIN.png'), png(9)); // already on disk
    const { http, getBytes } = fakeHttp((url) =>
      url.includes('/lal.png') ? new HttpError('HTTP 404', url, 404) : png(6),
    );

    const result = await store(http).warm();

    expect(result.failed).toEqual(['LAL']);
    expect(result.downloaded).toBe(28); // 30 teams - MIN already there - LAL failed
    expect(readdirSync(dir)).toHaveLength(29); // MIN + the 28 downloaded
    const askedFor = getBytes.mock.calls.map((call) => call[0]).join(' ');
    expect(askedFor).not.toContain('/min.png');
  });

  it('warming again downloads nothing', async () => {
    const first = fakeHttp(() => png(6));
    await store(first.http).warm();
    const second = fakeHttp(() => new Error('must not be called'));
    expect(await store(second.http).warm()).toEqual({ downloaded: 0, failed: [] });
    expect(second.getBytes).not.toHaveBeenCalled();
  });
});
