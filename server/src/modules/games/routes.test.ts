import { gamesResponseSchema, gameSchema, teamsResponseSchema } from '@step-back/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { parseScoreboard, parseTeams } from './adapter.js';
import { gamesModule } from './index.js';
import { createGamesRepo } from './repo.js';

let app: App | undefined;
let crestsDir: string | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
  if (crestsDir) rmSync(crestsDir, { recursive: true, force: true });
  crestsDir = undefined;
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** What ESPN's image service answers: a PNG for crests, and nothing else is reachable. */
function espnImages(options: { failing?: boolean } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    if (!options.failing && String(url).includes('/combiner/')) {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (options.failing) return new Response('down', { status: 404 });
    throw new Error('tests must not hit the network');
  });
}

/** An app with the games module and the recorded ESPN games already stored. */
async function seeded(
  env: Record<string, string> = {},
  fetchImpl: ReturnType<typeof espnImages> = espnImages(),
) {
  crestsDir = mkdtempSync(join(tmpdir(), 'step-back-routes-'));
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      CRESTS_DIR: crestsDir,
      ...env,
    }),
    modules: [gamesModule],
    fetch: fetchImpl as unknown as typeof fetch,
  });
  const repo = createGamesRepo(app.db);
  repo.upsertTeams(parseTeams(readEspnFixture('teams.json')));
  repo.upsertGames([
    ...parseScoreboard(readEspnFixture('scoreboard-final.json')), // 4 finals, ESPN's "Oct 6"
    ...parseScoreboard(readEspnFixture('scoreboard-scheduled.json')), // 6 upcoming, ESPN's "Oct 8"
  ]);
  return app.server;
}

const getGames = async (server: App['server'], query: string) => {
  const response = await server.inject(`/api/games?${query}`);
  return { status: response.statusCode, body: response.json() };
};

describe('GET /api/teams', () => {
  it('lists the teams, by name', async () => {
    const server = await seeded();
    const { teams } = teamsResponseSchema.parse((await server.inject('/api/teams')).json());
    expect(teams).toHaveLength(30);
    expect(teams[0]?.name).toBe('Atlanta Hawks');
  });

  it('tells where each crest is served from, so the browser never goes to ESPN', async () => {
    const server = await seeded();
    const { teams } = teamsResponseSchema.parse((await server.inject('/api/teams')).json());
    expect(teams[0]?.crestUrl).toBe('/api/crests/ATL.png');
    expect(teams.every((team) => team.crestUrl === `/api/crests/${team.abbr}.png`)).toBe(true);
  });
});

describe('GET /api/crests/:file', () => {
  it('serves the crest as a cacheable PNG', async () => {
    const server = await seeded();
    const response = await server.inject('/api/crests/MIN.png');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('public, max-age=604800');
    expect(new Uint8Array(response.rawPayload)).toEqual(PNG);
  });

  it('downloads it once: the second request comes from disk', async () => {
    const fetchImpl = espnImages();
    const server = await seeded({}, fetchImpl);
    await server.inject('/api/crests/MIN.png');
    await server.inject('/api/crests/MIN.png');
    await server.inject('/api/crests/min.png'); // the abbreviation is not case sensitive
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['LON.png', 'MIN.jpg', 'MIN', '..%2Fsecret.png', 'TOOLONGNAME.png'])(
    'answers 404 for %s',
    async (file) => {
      const server = await seeded();
      const response = await server.inject(`/api/crests/${file}`);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    },
  );

  it('answers 502 when the crest cannot be downloaded, without caching the failure', async () => {
    const server = await seeded({}, espnImages({ failing: true }));
    const response = await server.inject('/api/crests/MIN.png');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'crest_unavailable' });
  });
});

describe('GET /api/games?date=', () => {
  it("uses the local day of the configured time zone, not ESPN's US day", async () => {
    const server = await seeded(); // Europe/Madrid
    // ESPN files these 4 games under Oct 6, but they tip off between 01:00 and 04:00 in Madrid on Oct 7.
    const oct7 = gamesResponseSchema.parse((await getGames(server, 'date=2026-10-07')).body);
    expect(oct7.games.map((g) => g.id)).toEqual([
      '401901820',
      '401898389',
      '401914128',
      '401898390',
    ]);
    expect((await getGames(server, 'date=2026-10-06')).body.games).toEqual([]);
  });

  it('follows the time zone when it is configured differently', async () => {
    const server = await seeded({ TZ_DISPLAY: 'America/New_York' });
    const oct6 = (await getGames(server, 'date=2026-10-06')).body.games;
    expect(oct6).toHaveLength(4); // the same games are Oct 6 evening in New York
  });

  it('groups the next ESPN slate on the following Madrid day', async () => {
    const server = await seeded();
    const { games } = (await getGames(server, 'date=2026-10-09')).body;
    expect(games).toHaveLength(6);
    for (const game of games) expect(() => gameSchema.parse(game)).not.toThrow();
  });
});

describe('GET /api/games?team=&from=&to=', () => {
  it('returns a team schedule, home and away, in start order', async () => {
    const server = await seeded();
    const { games } = (await getGames(server, 'team=LAL')).body;
    expect(
      games.map((g: { away: { abbr: string }; home: { abbr: string } }) => [
        g.away.abbr,
        g.home.abbr,
      ]),
    ).toEqual([
      ['LAL', 'GS'],
      ['SAC', 'LAL'],
    ]);
  });

  it('accepts the team in any case', async () => {
    const server = await seeded();
    expect((await getGames(server, 'team=lal')).body.games).toHaveLength(2);
  });

  it('bounds a range by local days, both ends included', async () => {
    const server = await seeded();
    const { games } = (await getGames(server, 'from=2026-10-07&to=2026-10-07')).body;
    expect(games).toHaveLength(4);
    const both = (await getGames(server, 'team=LAL&from=2026-10-09')).body.games;
    expect(both).toHaveLength(1);
  });
});

describe('invalid queries', () => {
  it.each([
    ['nothing at all', '', /give date, from\/to or team/],
    ['a date that does not exist', 'date=2026-02-30', /real date/],
    ['a date in the wrong format', 'date=hoy', /real date/],
    ['date together with from', 'date=2026-10-07&from=2026-10-01', /cannot be combined/],
    ['a reversed range', 'from=2026-10-10&to=2026-10-01', /not be after/],
    ['a range over 400 days', 'from=2026-01-01&to=2027-12-31', /400 days/],
    ['a team that is not an abbreviation', 'team=Lakers!!', /abbreviation/],
  ])('rejects %s with a 400 that says why', async (_label, query, message) => {
    const server = await seeded();
    const { status, body } = await getGames(server, query);
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_query');
    expect(body.message).toMatch(message);
  });
});

describe('GET /api/games/:id', () => {
  it('returns one game with its line score', async () => {
    const server = await seeded();
    const game = gameSchema.parse((await server.inject('/api/games/401898390')).json());
    expect(game.home).toMatchObject({ abbr: 'GS', score: 124, linescores: [45, 36, 15, 28] });
  });

  it('answers 404 for an unknown game', async () => {
    const server = await seeded();
    const response = await server.inject('/api/games/nope');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });
});
