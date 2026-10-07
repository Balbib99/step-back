import {
  gameHighlightsResponseSchema,
  healthResponseSchema,
  highlightsResponseSchema,
  type Game,
  type Highlight,
} from '@step-back/shared';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { parseScoreboard, parseTeams } from '../games/adapter.js';
import { gamesModule } from '../games/index.js';
import { createGamesRepo } from '../games/repo.js';
import { createNewsModule } from '../news/index.js';
import { NBA_FEED_URL } from './adapter.js';
import { AFTER_GAME_EVERY_MS, NORMAL_EVERY_MS, refreshDelay } from './refresh.js';
import { GAME_LENGTH_MS } from './matcher.js';
import { HIGHLIGHTS_CLEANUP_JOB_ID, HIGHLIGHTS_JOB_ID, highlightsModule } from './index.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const HOUR = 3_600_000;

const channelFixture = () =>
  readFileSync(
    new URL('../../../test/fixtures/highlights/nba-channel.atom.xml', import.meta.url),
    'utf8',
  );

/** A channel feed with the given videos (newest first), in the shape YouTube serves. */
function feedWith(videos: { id: string; title: string; published: number }[]): string {
  const entries = videos
    .map(
      (v) => `<entry>
  <yt:videoId>${v.id}</yt:videoId>
  <title>${v.title}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${v.id}"/>
  <published>${new Date(v.published).toISOString()}</published>
  <media:group><media:thumbnail url="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" width="480" height="360"/></media:group>
</entry>`,
    )
    .join('\n');
  return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>NBA</title>${entries}</feed>`;
}

const FINALS = parseScoreboard(readEspnFixture('scoreboard-final.json')); // BKN@CHA, NO@OKC, DEN@UTAH, LAL@GS
const [BKN_CHA, , DEN_UTAH, LAL_GS] = FINALS as [Game, Game, Game, Game];
const endOf = (game: Game) => Date.parse(game.startUtc) + GAME_LENGTH_MS;

let app: App | undefined;
let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'step-back-highlights-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await app?.server.close();
  app = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

async function build(
  answers: { feed?: () => Response; thumb?: () => Response; env?: Record<string, string> } = {},
) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    calls.push(href);
    if (href === NBA_FEED_URL) return (answers.feed ?? (() => new Response(channelFixture())))();
    if (new URL(href).host.endsWith('ytimg.com')) {
      return (answers.thumb ?? (() => new Response(JPEG)))();
    }
    throw new Error(`tests must not reach ${href}`);
  });
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      NEWS_IMAGES_DIR: join(dataDir, 'news-images'),
      ...answers.env,
    }),
    // Highlights needs the games and the news modules (their tables).
    modules: [gamesModule, createNewsModule([]), highlightsModule],
    fetch: fetchMock as unknown as typeof fetch,
  });
  const games = createGamesRepo(app.db);
  games.upsertTeams(parseTeams(readEspnFixture('teams.json')));
  games.upsertGames(FINALS);
  return { ...app, calls, games };
}

const refresh = (scheduler: App['scheduler']) => scheduler.runNow(HIGHLIGHTS_JOB_ID);
const list = async (server: App['server'], query = '') =>
  (await server.inject(`/api/highlights${query}`)).json() as {
    highlights: Highlight[];
    nextBefore: string | null;
  };

describe('the real channel feed', () => {
  it('stores the 15 videos as clips: none of them is the summary of a game', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T22:00:00Z'));
    const { server, scheduler } = await build();
    await refresh(scheduler);

    const body = highlightsResponseSchema.parse(await list(server, '?limit=50'));
    expect(body.highlights).toHaveLength(15);
    expect(body.highlights.every((h) => h.kind === 'clip' && h.gameId === null)).toBe(true);
  });

  it('does not guess a team from a city alone in a clip: only summaries get that treatment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T22:00:00Z'));
    const { server, scheduler } = await build();
    await refresh(scheduler);

    const { highlights } = await list(server, '?limit=50');
    const mascot = highlights.find((h) => h.title.startsWith('Charlotte Mascot'))!;
    expect(mascot.teams).toEqual([]);
  });

  it('labels the players ESPN has labelled in the news', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T22:00:00Z'));
    const { server, scheduler, db } = await build();
    db.prepare("INSERT INTO news_players (name) VALUES ('Tyrese Haliburton')").run();
    await refresh(scheduler);

    const { highlights } = await list(server, '?limit=50');
    expect(highlights.find((h) => h.title.startsWith('Tyrese Haliburton'))!.players).toEqual([
      'Tyrese Haliburton',
    ]);
  });
});

describe('summaries of a game', () => {
  async function withSummaries() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(endOf(LAL_GS) + 6 * HOUR);
    const feed = feedWith([
      {
        id: 'LALGSsummar',
        title: 'LAKERS at WARRIORS | FULL GAME HIGHLIGHTS | October 6, 2026',
        published: endOf(LAL_GS) + 2 * HOUR,
      },
      {
        id: 'DENUTAHsumr',
        title: 'Denver Nuggets vs Utah Jazz Full Game Highlights',
        published: endOf(DEN_UTAH) + 3 * HOUR,
      },
      {
        id: 'nogamesumar',
        title: 'KNICKS at 76ERS | FULL GAME HIGHLIGHTS | October 5, 2026',
        published: endOf(LAL_GS) + HOUR,
      },
      {
        id: 'justaclipaa',
        title: 'Wow what a dunk by the Lakers',
        published: endOf(LAL_GS) + 4 * HOUR,
      },
    ]);
    const built = await build({ feed: () => new Response(feed) });
    await refresh(built.scheduler);
    return built;
  }

  it('links each summary to its game, and labels it with both teams', async () => {
    const { server } = await withSummaries();
    const { highlights } = await list(server, '?limit=50');
    const byYt = (id: string) => highlights.find((h) => h.ytId === id)!;

    expect(byYt('LALGSsummar')).toMatchObject({ kind: 'full_highlights', gameId: LAL_GS.id });
    expect(byYt('LALGSsummar').teams.sort()).toEqual(['GS', 'LAL']);
    expect(byYt('DENUTAHsumr')).toMatchObject({ kind: 'full_highlights', gameId: DEN_UTAH.id });
  });

  it('keeps a summary of a game the app does not have as a summary without a game', async () => {
    const { server } = await withSummaries();
    const { highlights } = await list(server, '?limit=50');
    expect(highlights.find((h) => h.ytId === 'nogamesumar')).toMatchObject({
      kind: 'full_highlights',
      gameId: null,
      teams: ['PHI', 'NY'].sort(),
    });
  });

  it('keeps a loose clip as a clip, labelled by team name', async () => {
    const { server } = await withSummaries();
    const { highlights } = await list(server, '?limit=50');
    expect(highlights.find((h) => h.ytId === 'justaclipaa')).toMatchObject({
      kind: 'clip',
      gameId: null,
      teams: ['LAL'],
    });
  });

  it('GET /api/games/:id/highlights gives the game and its video', async () => {
    const { server } = await withSummaries();
    const response = await server.inject(`/api/games/${LAL_GS.id}/highlights`);
    expect(response.statusCode).toBe(200);
    const body = gameHighlightsResponseSchema.parse(response.json());
    expect(body.game.id).toBe(LAL_GS.id);
    expect(body.highlights.map((h) => h.ytId)).toEqual(['LALGSsummar']);
  });

  it('a game without a video answers with an empty list, not an error', async () => {
    const { server } = await withSummaries();
    const response = await server.inject(`/api/games/${BKN_CHA.id}/highlights`);
    expect(response.statusCode).toBe(200);
    expect(gameHighlightsResponseSchema.parse(response.json()).highlights).toEqual([]);
  });

  it('an unknown game is a 404', async () => {
    const { server } = await withSummaries();
    expect((await server.inject('/api/games/nope/highlights')).statusCode).toBe(404);
  });

  it('filters the feed by team', async () => {
    const { server } = await withSummaries();
    const { highlights } = await list(server, '?team=LAL');
    expect(highlights.map((h) => h.ytId).sort()).toEqual(['LALGSsummar', 'justaclipaa']);
  });
});

describe('a summary that comes out before its game is stored as finished', () => {
  it('is linked on a later run, once the game is final', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(endOf(LAL_GS) + 3 * HOUR);
    const feed = feedWith([
      {
        id: 'LALGSsummar',
        title: 'LAKERS at WARRIORS | FULL GAME HIGHLIGHTS',
        published: endOf(LAL_GS) + HOUR,
      },
    ]);
    const { server, scheduler, games } = await build({ feed: () => new Response(feed) });
    // The game is still stored as live when the video is first read.
    games.upsertGames([{ ...LAL_GS, status: 'live' }]);
    await refresh(scheduler);
    expect((await list(server)).highlights[0]!.gameId).toBeNull();

    games.upsertGames([{ ...LAL_GS, status: 'final' }]);
    await refresh(scheduler);
    const [video] = (await list(server)).highlights;
    expect(video!.gameId).toBe(LAL_GS.id);
    expect(video!.teams.sort()).toEqual(['GS', 'LAL']);
  });
});

describe('running again', () => {
  it('adds nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T22:00:00Z'));
    const { server, scheduler } = await build();
    await refresh(scheduler);
    const first = (await list(server, '?limit=50')).highlights.map((h) => h.id);
    await refresh(scheduler);
    expect((await list(server, '?limit=50')).highlights.map((h) => h.id)).toEqual(first);
  });
});

describe('when YouTube fails', () => {
  it('shows in the health check and keeps the videos it had', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T22:00:00Z'));
    let failing = false;
    const { server, scheduler } = await build({
      feed: () =>
        failing ? new Response('gone', { status: 404 }) : new Response(channelFixture()),
    });
    await refresh(scheduler);
    failing = true;
    await refresh(scheduler);

    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(health.jobs.find((j) => j.id === HIGHLIGHTS_JOB_ID)?.status).toBe('error');
    expect((await list(server, '?limit=50')).highlights).toHaveLength(15);
  });

  it('shows in the health check when the feed is something else', async () => {
    const { server, scheduler } = await build({
      feed: () => new Response('<html>Sorry</html>'),
    });
    await refresh(scheduler);
    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(health.jobs.find((j) => j.id === HIGHLIGHTS_JOB_ID)?.status).toBe('error');
    expect((await list(server)).highlights).toEqual([]);
  });
});

describe('GET /api/highlights', () => {
  it('is empty before the first download, not an error', async () => {
    const { server } = await build();
    expect(await list(server)).toEqual({ highlights: [], nextBefore: null });
  });

  it.each([
    ['?team=lakers!', /team must be abbreviations/],
    ['?limit=0', /./],
    ['?limit=500', /limit cannot be more than 50/],
    ['?before=zzz', /not a valid cursor/],
  ])('rejects %s, saying why', async (query, message) => {
    const { server } = await build();
    const response = await server.inject(`/api/highlights${query}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_query' });
    expect(response.json().message).toMatch(message);
  });
});

describe('GET /api/highlights/:id/thumb', () => {
  async function loaded(thumb?: () => Response) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T22:00:00Z'));
    const built = await build(thumb ? { thumb } : {});
    await refresh(built.scheduler);
    const [first] = (await list(built.server)).highlights;
    return { ...built, first: first! };
  }

  it('serves the thumbnail from this server, downloaded once and kept', async () => {
    const { server, first, calls } = await loaded();
    const one = await server.inject(first.thumbnailUrl);
    expect(one.statusCode).toBe(200);
    expect(one.headers['content-type']).toBe('image/jpeg');
    expect(one.headers['cache-control']).toContain('max-age=');
    expect(new Uint8Array(one.rawPayload)).toEqual(JPEG);

    await server.inject(first.thumbnailUrl);
    expect(calls.filter((url) => url.includes('ytimg.com'))).toHaveLength(1);
    expect(readdirSync(join(dataDir, 'highlight-thumbs'))).toHaveLength(1);
  });

  it('answers 502 when YouTube does not give it, and 404 for an unknown video', async () => {
    const { server, first } = await loaded(() => new Response('gone', { status: 404 }));
    expect((await server.inject(first.thumbnailUrl)).statusCode).toBe(502);
    expect((await server.inject('/api/highlights/99999/thumb')).statusCode).toBe(404);
    expect((await server.inject('/api/highlights/abc/thumb')).statusCode).toBe(404);
  });
});

describe('the daily cleanup', () => {
  it('deletes videos older than 90 days with their thumbnails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T22:00:00Z'));
    const { server, scheduler, db } = await build();
    await refresh(scheduler);
    const { highlights } = await list(server, '?limit=50');
    await server.inject(highlights[0]!.thumbnailUrl);
    expect(readdirSync(join(dataDir, 'highlight-thumbs'))).toHaveLength(1);

    db.prepare('UPDATE videos SET published_utc = ? WHERE id = ?').run(
      Date.now() - 91 * 24 * HOUR,
      highlights[0]!.id,
    );
    await scheduler.runNow(HIGHLIGHTS_CLEANUP_JOB_ID);

    expect((await list(server, '?limit=50')).highlights).toHaveLength(14);
    expect(
      readdirSync(join(dataDir, 'highlight-thumbs')).filter((f) => f.endsWith('.img')),
    ).toEqual([]);
  });
});

describe('how often the channel is read', () => {
  const FAVOURITES = ['MIN', 'LAL', 'PHI'];

  it('every 15 minutes normally, and every 5 in the hour after a favourite team game ends', async () => {
    const { games } = await build();
    const now = endOf(LAL_GS) + 30 * 60_000; // the Lakers game ended half an hour ago
    expect(refreshDelay(now, games, FAVOURITES)).toBe(AFTER_GAME_EVERY_MS);
    expect(AFTER_GAME_EVERY_MS).toBe(5 * 60_000);
    expect(NORMAL_EVERY_MS).toBe(15 * 60_000);
  });

  it('does not speed up for a game of a team that is not a favourite', async () => {
    const { games } = await build();
    // Right after the Lakers game ended, for someone who follows other teams.
    expect(refreshDelay(endOf(LAL_GS) + 30 * 60_000, games, ['MIN', 'PHI'])).toBe(NORMAL_EVERY_MS);
  });

  it('goes back to normal two hours or more after the end', async () => {
    const { games } = await build();
    expect(refreshDelay(endOf(LAL_GS) + 3 * HOUR, games, FAVOURITES)).toBe(NORMAL_EVERY_MS);
  });

  it('stays normal while the game is still being played', async () => {
    const { games } = await build();
    games.upsertGames([{ ...LAL_GS, status: 'live' }]);
    expect(refreshDelay(endOf(LAL_GS) - HOUR, games, FAVOURITES)).toBe(NORMAL_EVERY_MS);
  });
});

describe('the module', () => {
  it('has its own refresh and cleanup jobs', async () => {
    const { scheduler } = await build();
    expect(scheduler.jobIds().filter((id) => id.startsWith('highlights:'))).toEqual([
      HIGHLIGHTS_JOB_ID,
      HIGHLIGHTS_CLEANUP_JOB_ID,
    ]);
  });
});
