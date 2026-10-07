import {
  healthResponseSchema,
  translationResponseSchema,
  translationStatusSchema,
} from '@step-back/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import type { FeedItem } from '../news/feed-item.js';
import { gamesModule } from '../games/index.js';
import { createNewsModule } from '../news/index.js';
import { createNewsRepo } from '../news/repo.js';
import { QUOTA_JOB_ID, TRANSLATION_CLEANUP_JOB_ID, translationModule } from './index.js';

const KEY = 'test-key-1234:fx';
const DAY = 24 * 60 * 60_000;

const feedItem = (path: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  url: `https://example.com/${path}`,
  title: 'Lakers beat the Warriors',
  summary: 'LeBron James scored 30 points.',
  publishedAt: Date.now() - 3_600_000,
  mediaKind: 'none',
  mediaUrl: null,
  embedUrl: null,
  durationSeconds: null,
  teamIds: [],
  playerNames: [],
  ...extra,
});

/** A fake DeepL: translates by putting "ES: " in front, and keeps a count of characters used. */
function deepl(options: { used?: number; limit?: number; failTranslate?: () => Response } = {}) {
  const state = {
    used: options.used ?? 0,
    limit: options.limit ?? 1_000_000,
    translateCalls: 0,
    usageCalls: 0,
  };
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!href.startsWith('https://api-free.deepl.com/'))
      throw new Error(`tests must not reach ${href}`);
    if (href.endsWith('/v2/usage')) {
      state.usageCalls += 1;
      return new Response(
        JSON.stringify({ character_count: state.used, character_limit: state.limit }),
      );
    }
    state.translateCalls += 1;
    if (options.failTranslate) return options.failTranslate();
    const { text } = JSON.parse(init!.body as string) as { text: string[] };
    state.used += text.reduce((n, t) => n + [...t].length, 0);
    return new Response(JSON.stringify({ translations: text.map((t) => ({ text: `ES: ${t}` })) }));
  });
  return { state, fetchMock };
}

let app: App | undefined;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'step-back-translation-'));
});
afterEach(async () => {
  await app?.server.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function build(
  fetchMock: ReturnType<typeof deepl>['fetchMock'],
  env: Record<string, string> = {},
) {
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      NEWS_IMAGES_DIR: join(dir, 'images'),
      DEEPL_API_KEY: KEY,
      ...env,
    }),
    // Translation reads news titles and summaries, so it needs the news module (which needs games).
    modules: [gamesModule, createNewsModule([]), translationModule],
    fetch: fetchMock as unknown as typeof fetch,
  });
  const news = createNewsRepo(app.db, new Map([['espn', 'ESPN']]));
  const add = (item: FeedItem, lang: 'en' | 'es' = 'en') => {
    news.ingest('espn', lang, [{ item, tags: { teams: [], players: [] } }], Date.now());
    return news.list({ limit: 1 }).news[0]!.id;
  };
  return { ...app, news, add };
}

const translate = (server: App['server'], id: number | string) =>
  server.inject({ method: 'POST', url: `/api/news/${id}/translate` });

describe('POST /api/news/:id/translate', () => {
  it('gives the title and summary in Spanish, translated by DeepL', async () => {
    const { fetchMock } = deepl();
    const { server, add } = await build(fetchMock);
    const id = add(feedItem('a'));

    const response = await translate(server, id);

    expect(response.statusCode).toBe(200);
    expect(translationResponseSchema.parse(response.json())).toEqual({
      title: 'ES: Lakers beat the Warriors',
      summary: 'ES: LeBron James scored 30 points.',
      cached: false,
    });
  });

  it('sends only the title and summary to DeepL, nothing else about the item', async () => {
    const { fetchMock } = deepl();
    const { server, add } = await build(fetchMock);
    await translate(server, add(feedItem('a')));
    const translateCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/v2/translate'),
    )!;
    expect(JSON.parse((translateCall[1] as RequestInit).body as string)).toEqual({
      text: ['Lakers beat the Warriors', 'LeBron James scored 30 points.'],
      source_lang: 'EN',
      target_lang: 'ES',
    });
  });

  it('translates only the title of an item that has no summary', async () => {
    const { fetchMock, state } = deepl();
    const { server, add } = await build(fetchMock);
    const response = await translate(server, add(feedItem('a', { summary: null })));
    expect(response.json()).toEqual({
      title: 'ES: Lakers beat the Warriors',
      summary: null,
      cached: false,
    });
    expect(state.used).toBe('Lakers beat the Warriors'.length);
  });

  it('answers a second press from the cache, without calling DeepL or spending quota', async () => {
    const { fetchMock, state } = deepl();
    const { server, add } = await build(fetchMock);
    const id = add(feedItem('a'));

    const first = await translate(server, id);
    const usedAfterFirst = state.used;
    const second = await translate(server, id);

    expect(first.json().cached).toBe(false);
    expect(second.json()).toEqual({ ...first.json(), cached: true });
    expect(state.translateCalls).toBe(1);
    expect(state.used).toBe(usedAfterFirst);
  });

  it('translates once when pressed twice at the same moment', async () => {
    const { fetchMock, state } = deepl();
    const { server, add } = await build(fetchMock);
    const id = add(feedItem('a'));
    const [one, two] = await Promise.all([translate(server, id), translate(server, id)]);
    expect(one.statusCode).toBe(200);
    expect(two.json().title).toBe(one.json().title);
    expect(state.translateCalls).toBe(1);
  });

  it('does not call DeepL for an item already in Spanish', async () => {
    const { fetchMock, state } = deepl();
    const { server, add } = await build(fetchMock);
    const response = await translate(server, add(feedItem('es'), 'es'));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'already_spanish' });
    expect(state.translateCalls).toBe(0);
  });

  it('answers 404 for an unknown item or a bad id, without calling DeepL', async () => {
    const { fetchMock, state } = deepl();
    const { server } = await build(fetchMock);
    expect((await translate(server, 9999)).statusCode).toBe(404);
    expect((await translate(server, 'abc')).statusCode).toBe(404);
    expect(state.translateCalls).toBe(0);
  });

  describe('when the quota is spent', () => {
    it('answers 429 with a clear message and does not call DeepL to translate', async () => {
      const { fetchMock, state } = deepl({ used: 999_990, limit: 1_000_000 });
      const { server, add } = await build(fetchMock);
      const response = await translate(server, add(feedItem('a'))); // needs 54 characters

      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ error: 'quota_exceeded' });
      expect(response.json().message).toMatch(/crédito de traducción/);
      expect(state.translateCalls).toBe(0);
    });

    it('still serves what was translated before: that costs nothing', async () => {
      const { fetchMock, state } = deepl();
      const { server, add } = await build(fetchMock);
      const id = add(feedItem('a'));
      await translate(server, id);

      state.used = state.limit; // the quota is now spent
      app!.context.cache.delete('translation:usage');

      const again = await translate(server, id);
      expect(again.statusCode).toBe(200);
      expect(again.json().cached).toBe(true);
    });

    it('learns it from DeepL answering 456, and stops asking', async () => {
      const { fetchMock, state } = deepl({
        failTranslate: () => new Response('{}', { status: 456 }),
      });
      const { server, add } = await build(fetchMock);
      const id = add(feedItem('a'));
      const first = await translate(server, id);
      expect(first.statusCode).toBe(429);

      const other = add(feedItem('b'));
      const second = await translate(server, other);
      expect(second.statusCode).toBe(429);
      expect(state.translateCalls).toBe(1); // the second one never reached DeepL
    });
  });

  describe('when DeepL fails', () => {
    it('answers 502 with a message, and keeps nothing', async () => {
      const { fetchMock } = deepl({ failTranslate: () => new Response('{}', { status: 400 }) });
      const { server, add, db } = await build(fetchMock);
      const response = await translate(server, add(feedItem('a')));
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ error: 'translation_failed' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM translations').get()).toEqual({ n: 0 });
    });

    it('says the key is wrong when DeepL rejects it', async () => {
      const { fetchMock } = deepl({ failTranslate: () => new Response('{}', { status: 403 }) });
      const { server, add } = await build(fetchMock);
      const response = await translate(server, add(feedItem('a')));
      expect(response.statusCode).toBe(502);
      expect(response.json().message).toMatch(/DEEPL_API_KEY/);
    });

    it('never puts the key in an answer', async () => {
      const { fetchMock } = deepl({ failTranslate: () => new Response('{}', { status: 403 }) });
      const { server, add } = await build(fetchMock);
      const response = await translate(server, add(feedItem('a')));
      expect(response.body).not.toContain('test-key');
    });
  });

  it('answers 503 when there is no API key, and calls nothing', async () => {
    const { fetchMock } = deepl();
    const { server, add } = await build(fetchMock, { DEEPL_API_KEY: '' });
    const response = await translate(server, add(feedItem('a')));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'translation_disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the DeepL address', () => {
  it('uses api.deepl.com for a key that is not of the old free plan', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ character_count: 1, character_limit: 100 }));
    });
    const { server } = await build(fetchMock as never, { DEEPL_API_KEY: 'plain-key' });
    await server.inject('/api/translation/status');
    expect(calls).toEqual(['https://api.deepl.com/v2/usage']);
  });

  it('uses the address from DEEPL_API_URL when set', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ character_count: 1, character_limit: 100 }));
    });
    const { server } = await build(fetchMock as never, {
      DEEPL_API_URL: 'https://api-free.deepl.com',
      DEEPL_API_KEY: 'plain-key',
    });
    await server.inject('/api/translation/status');
    expect(calls).toEqual(['https://api-free.deepl.com/v2/usage']);
  });

  it('treats an empty DEEPL_API_URL as not set', async () => {
    const { fetchMock } = deepl();
    await expect(build(fetchMock, { DEEPL_API_URL: '' })).resolves.toBeDefined();
  });
});

describe('GET /api/translation/status', () => {
  it('reports the quota used, read from DeepL', async () => {
    const { fetchMock } = deepl({ used: 250_000, limit: 1_000_000 });
    const { server } = await build(fetchMock);
    const status = translationStatusSchema.parse(
      (await server.inject('/api/translation/status')).json(),
    );
    expect(status).toEqual({
      enabled: true,
      used: 250_000,
      limit: 1_000_000,
      percent: 25,
      blocked: false,
    });
  });

  it('says blocked when the quota is spent', async () => {
    const { fetchMock } = deepl({ used: 1_000_000, limit: 1_000_000 });
    const { server } = await build(fetchMock);
    const status = (await server.inject('/api/translation/status')).json();
    expect(status).toMatchObject({ percent: 100, blocked: true });
  });

  it('says it is off, and asks DeepL nothing, without a key', async () => {
    const { fetchMock } = deepl();
    const { server } = await build(fetchMock, { DEEPL_API_KEY: '' });
    expect((await server.inject('/api/translation/status')).json()).toEqual({
      enabled: false,
      used: null,
      limit: null,
      percent: null,
      blocked: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is enabled but unknown when DeepL cannot be asked', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }));
    const { server } = await build(fetchMock as never);
    expect((await server.inject('/api/translation/status')).json()).toEqual({
      enabled: true,
      used: null,
      limit: null,
      percent: null,
      blocked: false,
    });
  });

  it('counts what it has just spent, without asking DeepL again', async () => {
    const { fetchMock, state } = deepl({ used: 0 });
    const { server, add } = await build(fetchMock);
    await server.inject('/api/translation/status'); // reads 0 and keeps it
    await translate(server, add(feedItem('a')));
    const status = (await server.inject('/api/translation/status')).json();
    expect(status.used).toBe(state.used);
    expect(state.usageCalls).toBe(1);
  });
});

describe('the quota in the health check', () => {
  const jobStatus = async (server: App['server']) =>
    healthResponseSchema
      .parse((await server.inject('/api/health')).json())
      .jobs.find((j) => j.id === QUOTA_JOB_ID);

  it('is fine below 90 %', async () => {
    const { fetchMock } = deepl({ used: 899_999, limit: 1_000_000 });
    const { server, scheduler } = await build(fetchMock);
    await scheduler.runNow(QUOTA_JOB_ID);
    expect((await jobStatus(server))?.status).toBe('ok');
  });

  it('warns from 90 %: the health check turns degraded and says how much is used', async () => {
    const { fetchMock } = deepl({ used: 900_000, limit: 1_000_000 });
    const { server, scheduler } = await build(fetchMock);
    await scheduler.runNow(QUOTA_JOB_ID);
    const job = await jobStatus(server);
    expect(job?.status).toBe('error');
    expect(job?.error).toMatch(/90 %/);
    expect(healthResponseSchema.parse((await server.inject('/api/health')).json()).status).toBe(
      'degraded',
    );
  });

  it('says the credit is spent at 100 %', async () => {
    const { fetchMock } = deepl({ used: 1_000_000, limit: 1_000_000 });
    const { server, scheduler } = await build(fetchMock);
    await scheduler.runNow(QUOTA_JOB_ID);
    expect((await jobStatus(server))?.error).toMatch(/agotado/);
  });

  it('has no quota job without a key', async () => {
    const { fetchMock } = deepl();
    const { scheduler } = await build(fetchMock, { DEEPL_API_KEY: '' });
    expect(scheduler.jobIds()).not.toContain(QUOTA_JOB_ID);
    expect(scheduler.jobIds()).toContain(TRANSLATION_CLEANUP_JOB_ID);
  });
});

describe('how long a translation is kept', () => {
  it('is deleted by the daily cleanup after 7 days, and kept before', async () => {
    const { fetchMock } = deepl();
    const { server, add, scheduler, db } = await build(fetchMock);
    const young = add(feedItem('young'));
    const old = add(feedItem('old', { title: 'Another title' }));
    await translate(server, young);
    await translate(server, old);
    db.prepare('UPDATE translations SET created_at = ? WHERE news_id = ?').run(
      Date.now() - 8 * DAY,
      old,
    );
    db.prepare('UPDATE translations SET created_at = ? WHERE news_id = ?').run(
      Date.now() - 6 * DAY,
      young,
    );

    await scheduler.runNow(TRANSLATION_CLEANUP_JOB_ID);

    expect(db.prepare('SELECT news_id FROM translations').all()).toEqual([{ news_id: young }]);
  });

  it('is not served from the cache once 7 days old, even before the cleanup runs', async () => {
    const { fetchMock, state } = deepl();
    const { server, add, db } = await build(fetchMock);
    const id = add(feedItem('a'));
    await translate(server, id);
    db.prepare('UPDATE translations SET created_at = ?').run(Date.now() - 8 * DAY);

    const again = await translate(server, id);
    expect(again.json().cached).toBe(false);
    expect(state.translateCalls).toBe(2);
  });

  it('goes with its news item when that is purged', async () => {
    const { fetchMock } = deepl();
    const { server, add, news, db } = await build(fetchMock);
    const id = add(feedItem('a'));
    await translate(server, id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM translations').get()).toEqual({ n: 1 });

    news.purge(Date.now() + DAY); // everything is older than tomorrow

    expect(db.prepare('SELECT COUNT(*) AS n FROM translations').get()).toEqual({ n: 0 });
  });
});
