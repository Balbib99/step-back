import {
  healthResponseSchema,
  newsItemSchema,
  newsResponseSchema,
  type NewsItem,
} from '@step-back/shared';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { readNewsFixture } from '../../../test/fixtures/news/read.js';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { parseTeams } from '../games/adapter.js';
import { gamesModule } from '../games/index.js';
import { createGamesRepo } from '../games/repo.js';
import { CLEANUP_JOB_ID, createNewsModule, sourceJobId } from './index.js';
import { parseSources, SOURCES } from './sources.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** What each configured address answers. Anything else is a test mistake: no real network. */
function internet(overrides: Record<string, () => Response> = {}) {
  const answers: Record<string, () => Response> = {
    'site.api.espn.com': () => new Response(readNewsFixture('espn-news.json')),
    'sports.yahoo.com': () => new Response(readNewsFixture('yahoo.rss.xml')),
    'www.cbssports.com': () =>
      new Response(readNewsFixture('cbs.rss.xml'), { headers: { etag: 'W/"cbs-1"' } }),
    'www.reddit.com': () => new Response(readNewsFixture('reddit.atom.xml')),
    'www.gigantes.com': () => new Response(readNewsFixture('gigantes.rss.xml')),
    ...overrides,
  };
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, headers: (init?.headers ?? {}) as Record<string, string> });
    const answer = answers[new URL(href).host];
    if (!answer) throw new Error(`tests must not reach ${href}`);
    return answer();
  });
  return { fetchMock, calls };
}

let app: App | undefined;
let imagesDir: string | undefined;
beforeEach(() => {
  imagesDir = mkdtempSync(join(tmpdir(), 'step-back-news-'));
});
afterEach(async () => {
  await app?.server.close();
  app = undefined;
  if (imagesDir) rmSync(imagesDir, { recursive: true, force: true });
});

async function build(fetchMock: ReturnType<typeof internet>['fetchMock'], sources = SOURCES) {
  app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', NEWS_IMAGES_DIR: imagesDir! }),
    // News labels items with the teams the games module stores, so it needs that module.
    modules: [gamesModule, createNewsModule(sources)],
    fetch: fetchMock as unknown as typeof fetch,
  });
  // The tagger reads the teams the games module stores (ESPN's own team list).
  createGamesRepo(app.db).upsertTeams(parseTeams(readEspnFixture('teams.json')));
  return app;
}

const refreshAll = async (scheduler: App['scheduler'], sources = SOURCES) => {
  for (const source of sources) await scheduler.runNow(sourceJobId(source.id));
};

const getNews = async (server: App['server'], query = '') => {
  const response = await server.inject(`/api/news${query}`);
  return { status: response.statusCode, body: response.json() };
};

/** Every item the API has, reading it page by page as the app does. */
const everything = async (server: App['server'], query = '') => {
  const items: NewsItem[] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const { body } = await getNews(server, `?limit=50${query}${before ? `&before=${before}` : ''}`);
    items.push(...(body.news as NewsItem[]));
    if (!body.nextBefore) break;
    before = body.nextBefore;
  }
  return items;
};

describe('the real sources.json', () => {
  it('is valid and has at least four sources, Gigantes included', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(4);
    const gigantes = SOURCES.find((source) => source.id === 'gigantes')!;
    expect(gigantes).toMatchObject({ lang: 'es', type: 'feed' });
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });

  it('is checked: repeated ids and broken patterns are rejected', () => {
    const base = { name: 'X', lang: 'en', type: 'feed', url: 'https://x.example.com/feed' };
    expect(() =>
      parseSources([
        { ...base, id: 'a' },
        { ...base, id: 'a' },
      ]),
    ).toThrow(/appears twice/);
    expect(() => parseSources([{ ...base, id: 'a', skipTitles: ['('] }])).toThrow(
      /not a valid pattern/,
    );
    expect(() => parseSources([{ ...base, id: 'Bad Id' }])).toThrow();
  });
});

describe('the news of every source', () => {
  it('registers one job per source plus the cleanup, each by name', async () => {
    const { fetchMock } = internet();
    const { scheduler } = await build(fetchMock);
    expect(scheduler.jobIds().filter((id) => id.startsWith('news:'))).toEqual([
      ...SOURCES.map((s) => sourceJobId(s.id)),
      CLEANUP_JOB_ID,
    ]);
  });

  it('is empty before the first download, not an error', async () => {
    const { fetchMock } = internet();
    const { server } = await build(fetchMock);
    expect(await getNews(server)).toEqual({ status: 200, body: { news: [], nextBefore: null } });
  });

  it('mixes at least four sources, newest first, without duplicates', async () => {
    const { fetchMock } = internet();
    const { server, scheduler } = await build(fetchMock);
    await refreshAll(scheduler);

    const { status, body } = await getNews(server, '?limit=50');
    expect(status).toBe(200);
    newsResponseSchema.parse(body);
    const news = await everything(server);

    expect(new Set(news.map((n) => n.sourceId)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(news.map((n) => n.url)).size).toBe(news.length);
    const times = news.map((n) => Date.parse(n.publishedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('running every source again adds nothing', async () => {
    const { fetchMock } = internet();
    const { server, scheduler } = await build(fetchMock);
    await refreshAll(scheduler);
    const first = await everything(server);

    await refreshAll(scheduler);
    const second = await everything(server);
    expect(second.map((n) => n.id)).toEqual(first.map((n) => n.id));
  });

  it("leaves out r/nba's daily threads", async () => {
    const { fetchMock } = internet();
    const { server, scheduler } = await build(fetchMock);
    await refreshAll(scheduler);
    const news = await everything(server);
    expect(news.some((n) => n.title.startsWith('Daily Discussion Thread'))).toBe(false);
    expect(news.some((n) => n.sourceId === 'reddit')).toBe(true);
  });

  it('keeps ESPN video clips as video and Spanish items as Spanish', async () => {
    const { fetchMock } = internet();
    const { server, scheduler } = await build(fetchMock);
    await refreshAll(scheduler);

    const videos = (await getNews(server, '?media=video&limit=50')).body.news as NewsItem[];
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.every((n) => n.mediaKind === 'video' && n.sourceId === 'espn')).toBe(true);

    const spanish = (await getNews(server, '?lang=es&limit=50')).body.news as NewsItem[];
    expect(spanish.length).toBe(10);
    expect(spanish.every((n) => n.sourceId === 'gigantes' && n.lang === 'es')).toBe(true);
  });
});

describe('filtering by team and player', () => {
  async function loaded() {
    const { fetchMock } = internet();
    const built = await build(fetchMock);
    await refreshAll(built.scheduler);
    return built.server;
  }

  it('filtering by Lakers returns only news labelled LAL', async () => {
    const server = await loaded();
    const { news } = (await getNews(server, '?team=LAL&limit=50')).body as { news: NewsItem[] };
    expect(news.length).toBeGreaterThan(0);
    expect(news.every((n) => n.teams.includes('LAL'))).toBe(true);
  });

  it('labels ESPN items from its own labels and the other sources by name', async () => {
    const server = await loaded();
    const news = await everything(server);
    const sixers = news.find((n) => n.title.startsWith('Problemas en los nuevos Sixers'))!;
    expect(sixers.teams).toEqual(['PHI']); // by name: "Sixers"
    const dundon = news.find((n) => n.title.startsWith("Trail Blazers' Dundon"))!;
    expect(dundon.teams).toEqual(['POR']); // by ESPN's label
  });

  it('finds news in any source about a player ESPN has labelled', async () => {
    const server = await loaded();
    const { news } = (await getNews(server, '?player=LeBron%20James&limit=50')).body as {
      news: NewsItem[];
    };
    const sources = new Set(news.map((n) => n.sourceId));
    expect(sources.has('espn')).toBe(true);
    expect(news.every((n) => n.players.includes('LeBron James'))).toBe(true);
  });

  it('takes several teams at once', async () => {
    const server = await loaded();
    const both = (await getNews(server, '?team=LAL,PHI&limit=50')).body.news as NewsItem[];
    const lal = (await getNews(server, '?team=LAL&limit=50')).body.news as NewsItem[];
    const phi = (await getNews(server, '?team=PHI&limit=50')).body.news as NewsItem[];
    expect(both.length).toBe(new Set([...lal, ...phi].map((n) => n.id)).size);
  });

  it('pages through the news by cursor', async () => {
    const server = await loaded();
    const expected = await everything(server);
    expect(expected.length).toBeGreaterThan(50); // more than one page of the largest size

    const seen: number[] = [];
    let query = '?limit=7';
    for (let guard = 0; guard < 20; guard++) {
      const { body } = await getNews(server, query);
      seen.push(...(body.news as NewsItem[]).map((n) => n.id));
      if (!body.nextBefore) break;
      query = `?limit=7&before=${body.nextBefore}`;
    }
    expect(seen).toEqual(expected.map((n) => n.id));
  });

  it.each([
    ['?lang=fr', /lang must be en or es/],
    ['?media=audio', /media must be video/],
    ['?team=lakers!', /team must be abbreviations/],
    ['?limit=0', /./],
    ['?limit=500', /limit cannot be more than 50/],
    ['?before=nonsense', /not a valid cursor/],
  ])('rejects %s, saying why', async (query, message) => {
    const { fetchMock } = internet();
    const { server } = await build(fetchMock);
    const { status, body } = await getNews(server, query);
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'invalid_query' });
    expect(body.message).toMatch(message);
  });
});

describe('GET /api/news/:id', () => {
  it('gives one item, or 404', async () => {
    const { fetchMock } = internet();
    const { server, scheduler } = await build(fetchMock);
    await refreshAll(scheduler);
    const [first] = (await getNews(server)).body.news as NewsItem[];

    const found = await server.inject(`/api/news/${first!.id}`);
    expect(found.statusCode).toBe(200);
    expect(newsItemSchema.parse(found.json())).toEqual(first);

    expect((await server.inject('/api/news/99999')).statusCode).toBe(404);
    expect((await server.inject('/api/news/abc')).statusCode).toBe(404);
  });
});

describe('a source that is down', () => {
  it('does not affect the others, and shows up in the health check by name', async () => {
    const { fetchMock } = internet({
      'www.cbssports.com': () => new Response('gone', { status: 404 }),
    });
    const { server, scheduler } = await build(fetchMock);
    await refreshAll(scheduler);

    const news = await everything(server);
    const sources = new Set(news.map((n) => n.sourceId));
    expect(sources.has('cbs')).toBe(false);
    expect(['espn', 'yahoo', 'reddit', 'gigantes'].every((id) => sources.has(id))).toBe(true);

    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(health.status).toBe('degraded');
    const status = (id: string) => health.jobs.find((job) => job.id === sourceJobId(id))?.status;
    expect(status('cbs')).toBe('error');
    expect(status('espn')).toBe('ok');
    expect(status('gigantes')).toBe('ok');
  });

  it('fails the source that answers with a block page, and keeps its earlier news', async () => {
    let blocked = false;
    const { fetchMock } = internet({
      'sports.yahoo.com': () =>
        blocked
          ? new Response('<html><body>Access Restricted</body></html>')
          : new Response(readNewsFixture('yahoo.rss.xml')),
    });
    const { server, scheduler } = await build(fetchMock);
    await scheduler.runNow(sourceJobId('yahoo'));
    const before = (await getNews(server, '?limit=50')).body.news as NewsItem[];
    expect(before.length).toBe(8);

    blocked = true;
    await scheduler.runNow(sourceJobId('yahoo'));
    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(health.jobs.find((job) => job.id === sourceJobId('yahoo'))?.status).toBe('error');
    expect(((await getNews(server, '?limit=50')).body.news as NewsItem[]).length).toBe(8);
  });
});

describe('conditional downloads', () => {
  it('asks again with the ETag it was given, and takes "not modified" without reading anything', async () => {
    let cbsRequests = 0;
    const { fetchMock, calls } = internet({
      'www.cbssports.com': () => {
        cbsRequests += 1;
        const conditional = calls.filter((c) => c.url.includes('cbssports')).at(-1)?.headers[
          'if-none-match'
        ];
        return conditional === 'W/"cbs-1"'
          ? new Response(null, { status: 304 })
          : new Response(readNewsFixture('cbs.rss.xml'), { headers: { etag: 'W/"cbs-1"' } });
      },
    });
    const { server, scheduler } = await build(fetchMock);

    await scheduler.runNow(sourceJobId('cbs'));
    await scheduler.runNow(sourceJobId('cbs'));

    expect(cbsRequests).toBe(2);
    const cbsCalls = calls.filter((c) => c.url.includes('cbssports'));
    expect(cbsCalls[0]!.headers).not.toHaveProperty('if-none-match');
    expect(cbsCalls[1]!.headers).toHaveProperty('if-none-match', 'W/"cbs-1"');

    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(health.jobs.find((job) => job.id === sourceJobId('cbs'))?.status).toBe('ok');
    expect(((await getNews(server, '?limit=50')).body.news as NewsItem[]).length).toBe(8);
  });
});

describe('GET /api/news/:id/image', () => {
  const cbsPicture = 'sportshub.cbsistatic.com';

  async function withPictures(answer: () => Response) {
    const { fetchMock, calls } = internet({ [cbsPicture]: answer });
    const built = await build(fetchMock);
    await built.scheduler.runNow(sourceJobId('cbs'));
    const { news } = (await getNews(built.server, '?limit=50')).body as { news: NewsItem[] };
    return { ...built, news, calls };
  }

  it('serves the picture from this server, downloads it once and keeps it', async () => {
    const { server, news, calls } = await withPictures(() => new Response(PNG));
    const withPicture = news.find((n) => n.imageUrl)!;

    const first = await server.inject(withPicture.imageUrl!);
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['cache-control']).toContain('max-age=');
    expect(first.headers['x-content-type-options']).toBe('nosniff');
    expect(new Uint8Array(first.rawPayload)).toEqual(PNG);

    await server.inject(withPicture.imageUrl!);
    expect(calls.filter((c) => c.url.includes(cbsPicture))).toHaveLength(1);
    expect(readdirSync(imagesDir!).filter((f) => f.endsWith('.img'))).toHaveLength(1);
  });

  it('never hands the third party address to the page', async () => {
    const { news } = await withPictures(() => new Response(PNG));
    expect(JSON.stringify(news)).not.toContain('cbsistatic');
  });

  it('answers 502 when the picture cannot be downloaded', async () => {
    const { server, news } = await withPictures(() => new Response('gone', { status: 404 }));
    const response = await server.inject(news.find((n) => n.imageUrl)!.imageUrl!);
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'image_unavailable' });
  });

  it('refuses to keep something that is not a picture, whatever the source claims', async () => {
    const { server, news } = await withPictures(
      () => new Response('<html>hello</html>', { headers: { 'content-type': 'image/png' } }),
    );
    const response = await server.inject(news.find((n) => n.imageUrl)!.imageUrl!);
    expect(response.statusCode).toBe(502);
    expect(readdirSync(imagesDir!)).toEqual([]);
  });

  it('does not call an address inside the network: the feed is written by a third party', async () => {
    const { fetchMock, calls } = internet();
    const { server, scheduler, db } = await build(fetchMock);
    await scheduler.runNow(sourceJobId('cbs'));
    db.prepare(
      "UPDATE news_items SET media_url = 'https://caddy/admin' WHERE media_url IS NOT NULL",
    ).run();
    db.prepare(
      "UPDATE news_items SET media_url = 'http://localhost:2019/config' WHERE id = 2",
    ).run();

    for (const id of [1, 2]) {
      const response = await server.inject(`/api/news/${id}/image`);
      expect(response.statusCode).toBe(502);
    }
    expect(calls.some((c) => c.url.includes('caddy') || c.url.includes('localhost'))).toBe(false);
  });

  it('answers 404 for an item with no picture, an unknown item or a bad id', async () => {
    const { server, news } = await withPictures(() => new Response(PNG));
    const plain = news.find((n) => n.imageUrl === null);
    // The CBS recording has a picture on every item, so make one that has none.
    expect(plain).toBeUndefined();
    expect((await server.inject('/api/news/99999/image')).statusCode).toBe(404);
    expect((await server.inject('/api/news/abc/image')).statusCode).toBe(404);
  });
});

describe('the daily cleanup', () => {
  it('deletes news older than 90 days together with their pictures', async () => {
    const { fetchMock } = internet({ 'sportshub.cbsistatic.com': () => new Response(PNG) });
    const { server, scheduler, db } = await build(fetchMock);
    await scheduler.runNow(sourceJobId('cbs'));
    const { news } = (await getNews(server, '?limit=50')).body as { news: NewsItem[] };
    const old = news.find((n) => n.imageUrl)!;
    await server.inject(old.imageUrl!); // the picture is now on disk
    expect(readdirSync(imagesDir!)).toHaveLength(1);

    db.prepare('UPDATE news_items SET published_utc = ? WHERE id = ?').run(
      Date.now() - 91 * 24 * 3_600_000,
      old.id,
    );
    await scheduler.runNow(CLEANUP_JOB_ID);

    const after = (await getNews(server, '?limit=50')).body.news as NewsItem[];
    expect(after).toHaveLength(news.length - 1);
    expect(after.some((n) => n.id === old.id)).toBe(false);
    expect(readdirSync(imagesDir!).filter((f) => f.endsWith('.img'))).toEqual([]);
  });
});
