import { boxscoreResponseSchema, type Game, type GameTeam } from '@step-back/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { EspnFormatError } from '../espn-common.js';
import { parseBoxscore } from './boxscore.js';
import { FINAL_TTL_SECONDS, LIVE_TTL_SECONDS } from './boxscore-service.js';
import { gamesModule } from './index.js';
import { createGamesRepo } from './repo.js';

// The recorded box score of Golden State 118 at Portland 123 (preseason, 8 October 2026), only
// the part the app reads. ESPN's team ids: Golden State 9, Portland 22.
interface RawSummary {
  boxscore: {
    players: {
      statistics: {
        athletes: { athlete: { id: string }; stats: string[]; didNotPlay?: boolean }[];
      }[];
    }[];
  };
}
const SUMMARY = () => readEspnFixture('summary-final.boxscore.json') as RawSummary;

const side = (teamId: string, abbr: string): GameTeam => ({
  teamId,
  abbr,
  name: abbr,
  score: null,
  record: null,
  winner: null,
  linescores: [],
});

const game = (extra: Partial<Game> = {}): Game => ({
  id: '401914129',
  season: 2027,
  seasonType: 'preseason',
  startUtc: '2026-10-08T02:00:00.000Z',
  status: 'final',
  statusDetail: 'Final',
  period: null,
  clock: null,
  venue: null,
  away: side('9', 'GS'),
  home: side('22', 'POR'),
  ...extra,
});

const AT = '2026-10-08T12:00:00.000Z';

describe('parseBoxscore, with the real ESPN answer', () => {
  const box = parseBoxscore(SUMMARY(), game(), AT);

  it('gives each team on its own side, in the shape the app promises', () => {
    expect(() => boxscoreResponseSchema.parse(box)).not.toThrow();
    expect(box.away?.abbr).toBe('GS');
    expect(box.home?.abbr).toBe('POR');
    expect(box.away?.players).toHaveLength(11);
    expect(box.home?.players).toHaveLength(19);
  });

  it('puts the numbers under the right name', () => {
    const leons = box.away!.players.find((p) => p.shortName === 'M. Leons')!;
    // ["33","5","2-11","1-4","0-0","5","0","2","1","1","2","3","2","-1"] in ESPN's order.
    expect(leons).toMatchObject({
      name: 'Malevy Leons',
      jersey: '33',
      position: 'F',
      starter: true,
      played: true,
      minutes: 33,
      points: 5,
      fieldGoals: '2-11',
      threePointers: '1-4',
      freeThrows: '0-0',
      rebounds: 5,
      assists: 0,
      turnovers: 2,
      steals: 1,
      blocks: 1,
      fouls: 2,
      plusMinus: -1,
    });
  });

  it('points to the photo on this server, only for players ESPN has one of', () => {
    const leons = box.away!.players.find((p) => p.shortName === 'M. Leons')!;
    expect(leons.photoUrl).toBe('/api/players/4897449/headshot');
    // ESPN has no photo of G. Ike and J. Kent.
    expect(box.away!.players.find((p) => p.shortName === 'G. Ike')!.photoUrl).toBeNull();
    expect(box.home!.players.find((p) => p.shortName === 'J. Kent')!.photoUrl).toBeNull();
    const withPhoto = [...box.away!.players, ...box.home!.players].filter((p) => p.photoUrl);
    expect(withPhoto).toHaveLength(27);
  });

  it('adds up: the points of the players are the points of the team', () => {
    for (const team of [box.away!, box.home!]) {
      const sum = team.players.reduce((total, p) => total + (p.points ?? 0), 0);
      expect(sum).toBe(team.totals.points);
    }
    expect(box.away!.totals).toMatchObject({ points: 118, rebounds: 40, assists: 26 });
    expect(box.home!.totals.points).toBe(123);
  });

  it('puts who did not play last, with the reason and no numbers', () => {
    const players = box.away!.players;
    const last = players.slice(-2);
    expect(last.map((p) => p.shortName)).toEqual(['J. Butler III', 'M. Moody']);
    expect(last.every((p) => !p.played && p.points === null && p.minutes === null)).toBe(true);
    expect(last[0]!.reason).toBeTruthy();
    expect(players.slice(0, -2).every((p) => p.played)).toBe(true);
  });

  it('starts with the starters', () => {
    const played = box.home!.players.filter((p) => p.played);
    expect(played.slice(0, 5).every((p) => p.starter)).toBe(true);
    expect(played.slice(5).every((p) => !p.starter)).toBe(true);
  });
});

describe('parseBoxscore, edge cases', () => {
  it('follows the team ids, not the order ESPN lists the teams in', () => {
    const swapped = SUMMARY();
    swapped.boxscore.players.reverse();
    const box = parseBoxscore(swapped, game(), AT);
    expect(box.away?.abbr).toBe('GS');
    expect(box.home?.abbr).toBe('POR');
  });

  it('is empty when ESPN has no players yet (a game that has not started)', () => {
    const box = parseBoxscore({ boxscore: { teams: [] } }, game({ status: 'scheduled' }), AT);
    expect(box).toEqual({ gameId: '401914129', away: null, home: null, updatedAt: AT });
  });

  it('is empty rather than half full when one team is missing', () => {
    const half = SUMMARY();
    half.boxscore.players.pop();
    const box = parseBoxscore(half, game(), AT);
    expect(box.away).toBeNull();
    expect(box.home).toBeNull();
  });

  it('treats a bench player who has not come in yet as one who has not played', () => {
    const live = SUMMARY();
    const entry = live.boxscore.players[0]!.statistics[0]!.athletes[7]!;
    entry.stats = [];
    entry.didNotPlay = false;
    const box = parseBoxscore(live, game({ status: 'live' }), AT);
    const waiting = box.away!.players.find((p) => p.id === entry.athlete.id)!;
    expect(waiting).toMatchObject({ played: false, reason: null, points: null });
  });

  it('reads dashes and blanks as no number, not as zero', () => {
    const odd = SUMMARY();
    const athlete = odd.boxscore.players[0]!.statistics[0]!.athletes[0]!;
    athlete.stats[1] = '--';
    athlete.stats[2] = '';
    athlete.stats[13] = '+7';
    const box = parseBoxscore(odd, game(), AT);
    const line = box.away!.players.find((p) => p.id === athlete.athlete.id)!;
    expect(line.points).toBeNull();
    expect(line.fieldGoals).toBeNull();
    expect(line.plusMinus).toBe(7);
  });

  it('says so when the format is not the one expected', () => {
    expect(() => parseBoxscore({ nothing: true }, game(), AT)).toThrow(EspnFormatError);
  });
});

// ---------------------------------------------------------------------------------------------

describe('GET /api/games/:id/boxscore', () => {
  let app: App | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await app?.server.close();
    app = undefined;
  });

  async function build(answer: () => Response, status: Game['status'] = 'final') {
    const calls: string[] = [];
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
      modules: [gamesModule],
      fetch: vi.fn(async (url: string | URL | Request) => {
        calls.push(String(url));
        return answer();
      }) as unknown as typeof fetch,
    });
    createGamesRepo(app.db).upsertGames([game({ status })]);
    return { ...app, calls };
  }
  const ok = () => new Response(JSON.stringify(SUMMARY()));
  const get = (server: App['server'], id = '401914129') =>
    server.inject(`/api/games/${id}/boxscore`);

  it('serves the numbers of a finished game', async () => {
    const { server, calls } = await build(ok);
    const response = await get(server);
    expect(response.statusCode).toBe(200);
    expect(boxscoreResponseSchema.parse(response.json()).home?.abbr).toBe('POR');
    expect(calls).toEqual([expect.stringContaining('/summary?event=401914129')]);
  });

  it('asks ESPN once for many viewers, then keeps the answer for a while', async () => {
    const { server, calls } = await build(ok);
    await Promise.all([get(server), get(server), get(server)]);
    await get(server);
    expect(calls).toHaveLength(1);
  });

  it('asks again soon for a game that is on, and later for one that is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
    const live = await build(ok, 'live');
    await get(live.server);
    vi.setSystemTime(Date.now() + (LIVE_TTL_SECONDS + 1) * 1000);
    await get(live.server);
    expect(live.calls).toHaveLength(2);
    await app?.server.close();

    const over = await build(ok, 'final');
    await get(over.server);
    vi.setSystemTime(Date.now() + (FINAL_TTL_SECONDS - 60) * 1000);
    await get(over.server);
    expect(over.calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 120 * 1000);
    await get(over.server);
    expect(over.calls).toHaveLength(2);
  });

  it('does not ask ESPN before the game starts', async () => {
    const { server, calls } = await build(ok, 'scheduled');
    const response = await get(server);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ away: null, home: null });
    expect(calls).toEqual([]);
  });

  it('is a 404 for a game that does not exist', async () => {
    const { server } = await build(ok);
    expect((await get(server, 'nope')).statusCode).toBe(404);
  });

  it('answers 502 with a message when ESPN fails and there is nothing kept', async () => {
    const { server } = await build(() => new Response('down', { status: 500 }));
    const response = await get(server);
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('boxscore_unavailable');
  });

  it('shows the last numbers when ESPN fails after having answered once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
    let working = true;
    const { server } = await build(() => (working ? ok() : new Response('down', { status: 500 })));
    await get(server);
    working = false;
    vi.setSystemTime(Date.now() + (FINAL_TTL_SECONDS + 60) * 1000);
    const response = await get(server);
    expect(response.statusCode).toBe(200);
    expect(response.json().home.abbr).toBe('POR');
  });

  it('answers 502 when ESPN changes its format', async () => {
    const { server } = await build(() => new Response(JSON.stringify({ unexpected: 1 })));
    expect((await get(server)).statusCode).toBe(502);
  });
});
