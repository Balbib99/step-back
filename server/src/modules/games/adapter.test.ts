import { gameSchema, isTeamAbbr, teamSchema } from '@step-back/shared';
import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../../core/http.js';
import {
  ESPN_BASE,
  EspnFormatError,
  fetchScoreboard,
  fetchTeams,
  fetchTeamSchedule,
  parseSchedule,
  parseScoreboard,
  parseTeams,
} from './adapter.js';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('parseScoreboard · finished games (real ESPN data)', () => {
  const games = parseScoreboard(readEspnFixture('scoreboard-final.json'));

  it('maps every event to a valid Game', () => {
    expect(games).toHaveLength(4);
    for (const game of games) expect(() => gameSchema.parse(game)).not.toThrow();
  });

  it('maps a final game completely', () => {
    const game = games.find((g) => g.id === '401898390');
    expect(game).toMatchObject({
      season: 2027,
      seasonType: 'preseason',
      startUtc: '2026-10-07T02:00:00.000Z',
      status: 'final',
      statusDetail: 'Final',
      period: null,
      clock: null,
      venue: 'Chase Center',
    });
    expect(game?.home).toMatchObject({
      abbr: 'GS',
      name: 'Golden State Warriors',
      score: 124,
      winner: true,
      linescores: [45, 36, 15, 28],
    });
    expect(game?.away).toMatchObject({ abbr: 'LAL', score: 98, winner: false });
  });

  it('keeps the invariants of a finished game: one winner, and quarters add up to the score', () => {
    for (const game of games) {
      expect([game.home.winner, game.away.winner].filter(Boolean)).toHaveLength(1);
      for (const side of [game.home, game.away]) {
        expect(side.score).not.toBeNull();
        expect(sum(side.linescores)).toBe(side.score);
      }
      const winner = game.home.winner ? game.home : game.away;
      const loser = game.home.winner ? game.away : game.home;
      expect(winner.score!).toBeGreaterThan(loser.score!);
    }
  });

  it('reads the record from the scoreboard shape (summary)', () => {
    const game = games.find((g) => g.id === '401898390');
    expect(game?.home.record).toBe('1-1');
  });
});

describe('parseScoreboard · scheduled games', () => {
  const games = parseScoreboard(readEspnFixture('scoreboard-scheduled.json'));

  it('has no score, winner or line score before tip-off, even though ESPN says "0"', () => {
    expect(games.length).toBeGreaterThan(0);
    for (const game of games) {
      expect(game.status).toBe('scheduled');
      for (const side of [game.home, game.away]) {
        expect(side.score).toBeNull();
        expect(side.winner).toBeNull();
        expect(side.linescores).toEqual([]);
      }
      expect(game.period).toBeNull();
      expect(game.clock).toBeNull();
      expect(game.statusDetail).not.toBe('');
    }
  });

  it('normalises the start time to ISO UTC', () => {
    expect(games[0]?.startUtc).toBe('2026-10-08T23:00:00.000Z');
  });
});

describe('parseScoreboard · postponed game (real: Hornets at Lakers, Jan 2025)', () => {
  const games = parseScoreboard(readEspnFixture('scoreboard-postponed.json'));
  const postponed = games.find((g) => g.id === '401705090');

  it('is postponed even though ESPN reports state "post"', () => {
    expect(postponed).toMatchObject({
      status: 'postponed',
      statusDetail: 'Postponed',
      seasonType: 'regular',
      season: 2025,
    });
  });

  it('has no score and no winner', () => {
    for (const side of [postponed!.home, postponed!.away]) {
      expect(side.score).toBeNull();
      expect(side.winner).toBeNull();
    }
  });

  it('does not confuse the finished games of the same day with it', () => {
    const finals = games.filter((g) => g.status === 'final');
    expect(finals).toHaveLength(games.length - 1);
  });
});

describe('parseScoreboard · live game (synthetic, derived from a real scheduled event)', () => {
  const [game] = parseScoreboard(readEspnFixture('scoreboard-live.synthetic.json'));

  it('is live with the period and clock', () => {
    expect(game).toMatchObject({
      status: 'live',
      period: 3,
      clock: '4:12',
      statusDetail: '4:12 - 3rd',
    });
  });

  it('carries the running score and line score, with no winner yet', () => {
    expect(game?.home).toMatchObject({ score: 78, winner: null, linescores: [24, 30, 24] });
    expect(game?.away).toMatchObject({ score: 74, winner: null, linescores: [27, 25, 22] });
  });
});

describe('parseSchedule · team schedule shape (real ESPN data)', () => {
  const games = parseSchedule(readEspnFixture('schedule-min-preseason.json'));

  it('maps all events, all of them Timberwolves games', () => {
    expect(games).toHaveLength(6);
    for (const game of games) {
      expect(() => gameSchema.parse(game)).not.toThrow();
      expect([game.home.abbr, game.away.abbr]).toContain('MIN');
      expect(game.seasonType).toBe('preseason');
    }
  });

  it('reads scores given as objects and the record as displayValue', () => {
    const game = games.find((g) => g.id === '401914102');
    expect(game).toMatchObject({ status: 'final', startUtc: '2026-10-06T00:00:00.000Z' });
    expect(game?.away).toMatchObject({ abbr: 'MIN', score: 116, winner: true, record: '1-0' });
    expect(game?.home).toMatchObject({ abbr: 'MIL', score: 97, winner: false, record: '0-1' });
  });

  it('leaves upcoming games without a score', () => {
    const upcoming = games.filter((g) => g.status === 'scheduled');
    expect(upcoming).toHaveLength(5);
    for (const game of upcoming) {
      expect(game.home.score).toBeNull();
      expect(game.away.score).toBeNull();
    }
  });

  it('gives the same result for a game as the scoreboard does, despite the different shapes', () => {
    const fromSchedule = games.find((g) => g.id === '401914102')!;
    const fromBoard = parseScoreboard(readEspnFixture('scoreboard-min-mil-day.json')).find(
      (g) => g.id === '401914102',
    )!;
    expect(fromBoard).toBeDefined();
    for (const key of [
      'id',
      'season',
      'seasonType',
      'startUtc',
      'status',
      'statusDetail',
    ] as const) {
      expect(fromSchedule[key]).toEqual(fromBoard[key]);
    }
    for (const side of ['home', 'away'] as const) {
      expect(fromSchedule[side]).toMatchObject({
        teamId: fromBoard[side].teamId,
        abbr: fromBoard[side].abbr,
        score: fromBoard[side].score,
        winner: fromBoard[side].winner,
        record: fromBoard[side].record,
      });
    }
  });

  it('keeps a game against a club that is not in the NBA (real: London Lions at Portland)', () => {
    const game = parseSchedule(readEspnFixture('schedule-por-preseason.json')).find(
      (g) => g.id === '401914130',
    );
    expect(game?.away).toMatchObject({ abbr: 'LON', name: 'London Lions' });
    expect(game?.home).toMatchObject({ abbr: 'POR', name: 'Portland Trail Blazers' });
    expect(isTeamAbbr('LON')).toBe(false); // the UI paints it with the neutral palette
  });
});

describe('parseTeams', () => {
  const teams = parseTeams(readEspnFixture('teams.json'));

  it('returns the 30 teams as valid Team objects', () => {
    expect(teams).toHaveLength(30);
    for (const team of teams) expect(() => teamSchema.parse(team)).not.toThrow();
  });

  it('maps a team', () => {
    expect(teams.find((t) => t.abbr === 'MIN')).toEqual({
      id: '16',
      abbr: 'MIN',
      name: 'Minnesota Timberwolves',
      shortName: 'Timberwolves',
      location: 'Minnesota',
      logoUrl: 'https://a.espncdn.com/i/teamlogos/nba/500/min.png',
    });
  });

  it('uses abbreviations that all have a palette, so the UI can colour every team', () => {
    const missing = teams.filter((t) => !isTeamAbbr(t.abbr)).map((t) => t.abbr);
    expect(missing).toEqual([]);
  });
});

describe('format changes fail loudly', () => {
  const scoreboard = () =>
    structuredClone(readEspnFixture('scoreboard-scheduled.json')) as {
      events: Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    };

  it('reports where the payload stopped matching', () => {
    const data = scoreboard();
    delete data.events[0]!.competitions;
    expect(() => parseScoreboard(data)).toThrow(EspnFormatError);
    expect(() => parseScoreboard(data)).toThrow(
      /scoreboard format changed: events\.0\.competitions/,
    );
  });

  it('rejects an unknown season type instead of guessing', () => {
    const data = scoreboard();
    data.events[0]!.season.type = 4;
    expect(() => parseScoreboard(data)).toThrow(/unknown season type 4/);
  });

  it('rejects an event with one team', () => {
    const data = scoreboard();
    data.events[0]!.competitions[0].competitors.pop();
    expect(() => parseScoreboard(data)).toThrow(EspnFormatError);
  });

  it('rejects an invalid start date', () => {
    const data = scoreboard();
    data.events[0]!.date = 'tomorrow-ish';
    expect(() => parseScoreboard(data)).toThrow(/invalid date/);
  });

  it('rejects a payload that is not a scoreboard at all', () => {
    expect(() => parseScoreboard({ message: 'rate limited' })).toThrow(EspnFormatError);
    expect(() => parseTeams({})).toThrow(EspnFormatError);
  });

  it('tolerates fields ESPN adds', () => {
    const data = scoreboard();
    data.events[0]!.somethingNew = { nested: true };
    expect(() => parseScoreboard(data)).not.toThrow();
  });
});

describe('fetch functions', () => {
  function fakeHttp(payload: unknown) {
    const getJson = vi.fn(async () => payload);
    return { http: { get: vi.fn(), getJson } as unknown as HttpClient, getJson };
  }

  it('asks the scoreboard for a day, as ESPN writes dates', async () => {
    const { http, getJson } = fakeHttp(readEspnFixture('scoreboard-scheduled.json'));
    const games = await fetchScoreboard(http, '2026-10-08');
    expect(getJson).toHaveBeenCalledWith(`${ESPN_BASE}/scoreboard`, {
      params: { dates: '20261008' },
    });
    expect(games).toHaveLength(6);
  });

  it('asks for a team schedule by season and season type', async () => {
    const { http, getJson } = fakeHttp(readEspnFixture('schedule-min-preseason.json'));
    await fetchTeamSchedule(http, '16', 2027, 1);
    expect(getJson).toHaveBeenCalledWith(`${ESPN_BASE}/teams/16/schedule`, {
      params: { season: 2027, seasontype: 1 },
    });
  });

  it('asks for the whole season when no season type is given', async () => {
    const { http, getJson } = fakeHttp(readEspnFixture('schedule-min-preseason.json'));
    await fetchTeamSchedule(http, '16', 2027);
    expect(getJson).toHaveBeenCalledWith(`${ESPN_BASE}/teams/16/schedule`, {
      params: { season: 2027, seasontype: undefined },
    });
  });

  it('asks for all the teams', async () => {
    const { http, getJson } = fakeHttp(readEspnFixture('teams.json'));
    expect(await fetchTeams(http)).toHaveLength(30);
    expect(getJson).toHaveBeenCalledWith(`${ESPN_BASE}/teams`, { params: { limit: 40 } });
  });

  it('lets a format change surface as an EspnFormatError from the fetch call', async () => {
    const { http } = fakeHttp({ events: [{ id: '1' }] });
    await expect(fetchScoreboard(http, '2026-10-08')).rejects.toBeInstanceOf(EspnFormatError);
  });
});
