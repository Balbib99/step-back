import { newsResponseSchema, type NewsItem } from '@step-back/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readNewsFixture } from '../../../test/fixtures/news/read.js';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { gamesModule } from '../games/index.js';
import { createGamesRepo } from '../games/repo.js';
import { parseTeams } from '../games/adapter.js';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { createNewsModule, sourceJobId } from './index.js';
import { SOURCES, parseSources, type NewsSource } from './sources.js';
import { isShortUrl, parseYoutubeNews, withoutHashtags } from './youtube-adapter.js';

// The recorded feed of the Drafteados channel (15 videos, 7 of them Shorts), 9 October 2026.
const FEED = () => readNewsFixture('drafteados.atom.xml');

const DRAFTEADOS = SOURCES.find((source) => source.id === 'drafteados')!;

describe('the Drafteados source', () => {
  it('is a Spanish YouTube channel in sources.json', () => {
    expect(DRAFTEADOS).toMatchObject({ name: 'Drafteados', lang: 'es', type: 'youtube' });
    expect(DRAFTEADOS.url).toContain('channel_id=UCTJNmeP0HiOU4-qOMNVNoGA');
  });

  it('is never sent as featured news: ESPN is the only priority source', () => {
    expect(SOURCES.filter((source) => source.priority).map((source) => source.id)).toEqual([
      'espn',
    ]);
  });

  it('is a valid list of sources', () => {
    expect(() => parseSources(SOURCES)).not.toThrow();
  });
});

describe('parseYoutubeNews, with the real feed', () => {
  const items = parseYoutubeNews(FEED());

  it('turns every video into a video post with its thumbnail and the official player', () => {
    expect(items).toHaveLength(15);
    for (const item of items) {
      expect(item.mediaKind).toBe('video');
      expect(item.mediaUrl).toMatch(/^https:\/\/i\d?\.ytimg\.com\/vi\/[\w-]{11}\//);
      expect(item.embedUrl).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}$/);
    }
  });

  it('knows which videos are Shorts, by the address the feed gives them', () => {
    const shorts = items.filter((item) => isShortUrl(item.url));
    expect(shorts).toHaveLength(7);
    expect(shorts.every((item) => item.url.startsWith('https://www.youtube.com/shorts/'))).toBe(
      true,
    );
    const long = items.filter((item) => !isShortUrl(item.url));
    expect(long.every((item) => item.url.startsWith('https://www.youtube.com/watch?v='))).toBe(
      true,
    );
  });

  it('keeps the title and leaves the description out: it is hashtags and trip offers', () => {
    expect(items.every((item) => item.summary === null)).toBe(true);
    const jokic = items.find((item) => item.title.startsWith('NIKOLA JOKIC'))!;
    expect(jokic.publishedAt).toBe(Date.parse('2026-10-09T10:00:25+00:00'));
  });

  it('reads no description that could label a video with teams and cities it is not about', () => {
    // The Clippers guide advertises trips to Texas and San Francisco in its description.
    const clippers = items.find((item) => item.title.includes('Clippers'))!;
    expect(clippers.summary).toBeNull();
    expect(clippers.playerNames).toEqual([]);
  });
});

describe('withoutHashtags', () => {
  it('drops the hashtags that end a title, and only those', () => {
    expect(withoutHashtags('¿CÓMO FUNCIONA EL DINERO EN LA NBA?  #nba #doncic #stephencurry')).toBe(
      '¿CÓMO FUNCIONA EL DINERO EN LA NBA?',
    );
    expect(withoutHashtags('El #1 de la lista | Guía Nuggets 26-27')).toBe(
      'El #1 de la lista | Guía Nuggets 26-27',
    );
  });

  it('never leaves a title empty', () => {
    expect(withoutHashtags('#nba #jokic')).toBe('#nba #jokic');
  });

  it('is applied to the videos of the real feed', () => {
    const titles = parseYoutubeNews(FEED()).map((item) => item.title);
    expect(titles.some((title) => title.includes('#'))).toBe(false);
    expect(titles).toContain('¿CÓMO FUNCIONA EL DINERO EN LA NBA?');
  });
});

describe('isShortUrl', () => {
  it('is only a YouTube Short address', () => {
    expect(isShortUrl('https://www.youtube.com/shorts/vq3_0AVlrJM')).toBe(true);
    expect(isShortUrl('https://www.youtube.com/watch?v=vq3_0AVlrJM')).toBe(false);
    expect(isShortUrl('https://example.com/shorts/vq3_0AVlrJM')).toBe(false);
    expect(isShortUrl('https://www.youtube.com.evil.example/shorts/x')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the news API with a YouTube channel', () => {
  let app: App | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await app?.server.close();
    app = undefined;
  });

  const PIXEL = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  async function build(sources: NewsSource[] = [DRAFTEADOS]) {
    const calls: string[] = [];
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
      modules: [gamesModule, createNewsModule(sources)],
      fetch: vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('/feeds/videos.xml')) return new Response(FEED());
        return new Response(PIXEL);
      }) as unknown as typeof fetch,
    });
    createGamesRepo(app.db).upsertTeams(parseTeams(readEspnFixture('teams.json')));
    for (const source of sources) await app.scheduler.runNow(sourceJobId(source.id));
    return { server: app.server, calls };
  }
  const list = async (server: App['server'], query = '') => {
    const limit = query.includes('limit=') ? '' : 'limit=50';
    const response = await server.inject(`/api/news?${limit}${query}`);
    return newsResponseSchema.parse(response.json());
  };

  it('stores the videos as Spanish video posts with the source name', async () => {
    const { server } = await build();
    const { news } = await list(server, '&shorts=include');
    expect(news).toHaveLength(15);
    expect(news.every((n) => n.sourceName === 'Drafteados' && n.lang === 'es')).toBe(true);
    expect(news.every((n) => n.mediaKind === 'video' && n.embedUrl && n.imageUrl)).toBe(true);
  });

  it('marks the Shorts', async () => {
    const { server } = await build();
    const { news } = await list(server, '&shorts=include');
    const shorts = news.filter((n) => n.short);
    expect(shorts).toHaveLength(7);
    expect(shorts.every((n) => n.url.includes('/shorts/'))).toBe(true);
    expect(news.filter((n) => !n.short).every((n) => n.url.includes('watch?v='))).toBe(true);
  });

  it('leaves the Shorts out of the news by default', async () => {
    const { server } = await build();
    const { news } = await list(server);
    expect(news).toHaveLength(8);
    expect(news.some((n: NewsItem) => n.short)).toBe(false);
  });

  it('gives only the Shorts when asked, newest first', async () => {
    const { server } = await build();
    const { news } = await list(server, '&shorts=only');
    expect(news).toHaveLength(7);
    expect(news.every((n) => n.short)).toBe(true);
    const dates = news.map((n) => n.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('pages through the Shorts with the same cursor as the news', async () => {
    const { server } = await build();
    const first = await list(server, '&shorts=only&limit=4');
    expect(first.news).toHaveLength(4);
    expect(first.nextBefore).not.toBeNull();
    const second = await list(server, `&shorts=only&limit=4&before=${first.nextBefore}`);
    expect(second.news).toHaveLength(3);
    expect(second.nextBefore).toBeNull();
    const ids = [...first.news, ...second.news].map((n) => n.id);
    expect(new Set(ids).size).toBe(7);
  });

  it('keeps the other filters working with Shorts', async () => {
    const { server } = await build();
    expect((await list(server, '&shorts=only&lang=en')).news).toEqual([]);
    expect((await list(server, '&shorts=only&lang=es')).news).toHaveLength(7);
  });

  it('refuses a value that is not one of the three', async () => {
    const { server } = await build();
    const response = await server.inject('/api/news?shorts=maybe');
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('shorts must be');
  });

  it('serves the thumbnail of a Short from this server', async () => {
    const { server } = await build();
    const { news } = await list(server, '&shorts=only&limit=1');
    const picture = await server.inject(news[0]!.imageUrl!);
    expect(picture.statusCode).toBe(200);
    expect(picture.headers['content-type']).toBe('image/png');
  });

  it('does not store a video twice when the feed is read again', async () => {
    const { server } = await build();
    await app!.scheduler.runNow(sourceJobId('drafteados'));
    expect((await list(server, '&shorts=include')).news).toHaveLength(15);
  });

  it('labels a video with the team or player named in its title', async () => {
    const { server } = await build();
    const { news } = await list(server, '&shorts=include');
    const guide = news.find((n) => n.title.includes('Nuggets'))!;
    expect(guide.teams).toContain('DEN');
    expect(news.find((n) => /ADAY MARA/i.test(n.title))).toBeDefined();
  });

  it('shows the job by name in the health report, so a failure says which source it is', async () => {
    const { server } = await build();
    const health = (await server.inject('/api/health')).json();
    expect(health.jobs.map((j: { id: string }) => j.id)).toContain('news:drafteados');
  });
});
