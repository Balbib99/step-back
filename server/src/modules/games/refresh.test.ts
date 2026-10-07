import type { Game, GameStatus, GameTeam } from '@step-back/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { openDb } from '../../core/db.js';
import { HttpError, type HttpClient } from '../../core/http.js';
import { createLogger } from '../../core/logger.js';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { runMigrations } from '../../core/migrations.js';
import { gamesModule } from './index.js';
import {
  espnDaysToFetch,
  nextRefreshDelayMs,
  REFRESH,
  refreshDelayFromStore,
  refreshScoreboards,
} from './refresh.js';
import { createGamesRepo, type GamesRepo } from './repo.js';
import { parseScoreboard } from './adapter.js';

const logger = createLogger({ env: 'test', logLevel: 'info' });

const side = (abbr: string): GameTeam => ({
  teamId: abbr,
  abbr,
  name: abbr,
  score: null,
  record: null,
  winner: null,
  linescores: [],
});

const game = (id: string, startUtc: string, status: GameStatus = 'scheduled'): Game => ({
  id,
  season: 2027,
  seasonType: 'preseason',
  startUtc,
  status,
  statusDetail: '',
  period: null,
  clock: null,
  venue: null,
  home: side('IND'),
  away: side('MIN'),
});

// 20:00 UTC on 7 October 2026: 22:00 in Madrid, 16:00 in New York.
const NOW = new Date('2026-10-07T20:00:00Z');
const at = (minutesFromNow: number) =>
  new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString();

describe('nextRefreshDelayMs', () => {
  it('waits an hour when nothing is close', () => {
    expect(nextRefreshDelayMs([], NOW)).toBe(REFRESH.idle);
    expect(nextRefreshDelayMs([game('far', at(60 * 24 * 3))], NOW)).toBe(REFRESH.idle); // in 3 days
    expect(nextRefreshDelayMs([game('old', at(-60 * 8), 'final')], NOW)).toBe(REFRESH.idle);
  });

  it('looks every 10 minutes when there are games today or tomorrow, or one just ended', () => {
    expect(nextRefreshDelayMs([game('later', at(30))], NOW)).toBe(REFRESH.active);
    expect(nextRefreshDelayMs([game('tomorrow', at(60 * 30))], NOW)).toBe(REFRESH.active);
    expect(nextRefreshDelayMs([game('just-ended', at(-120), 'final')], NOW)).toBe(REFRESH.active);
  });

  it('looks every 30 seconds while a game is being played', () => {
    expect(nextRefreshDelayMs([game('on', at(-40), 'live')], NOW)).toBe(REFRESH.live);
  });

  it('looks every minute when a game is about to start, to catch the tip-off', () => {
    expect(nextRefreshDelayMs([game('soon', at(10))], NOW)).toBe(REFRESH.imminent);
    expect(nextRefreshDelayMs([game('very-soon', at(1))], NOW)).toBe(REFRESH.imminent);
  });

  it('keeps a close watch on a game that should have started but is still "scheduled"', () => {
    expect(nextRefreshDelayMs([game('late', at(-30))], NOW)).toBe(REFRESH.imminent);
    expect(nextRefreshDelayMs([game('very-late', at(-170))], NOW)).toBe(REFRESH.imminent);
  });

  it('gives up the close watch on a stale "scheduled" game after three hours', () => {
    expect(nextRefreshDelayMs([game('forgotten', at(-60 * 4))], NOW)).toBe(REFRESH.active);
  });

  it('is the fastest pace needed by any game', () => {
    const games = [game('far', at(60 * 24 * 3)), game('soon', at(10)), game('on', at(-40), 'live')];
    expect(nextRefreshDelayMs(games, NOW)).toBe(REFRESH.live);
  });

  it('does not rush for a postponed game', () => {
    expect(nextRefreshDelayMs([game('p', at(-30), 'postponed')], NOW)).toBe(REFRESH.active);
  });
});

describe('espnDaysToFetch', () => {
  it('takes yesterday, today and tomorrow, US Eastern, when nothing is on', () => {
    expect(espnDaysToFetch([], NOW)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
  });

  it('uses the Eastern day, not the UTC one, near midnight', () => {
    // 03:30 UTC on the 8th is 23:30 on the 7th in New York.
    const late = new Date('2026-10-08T03:30:00Z');
    expect(espnDaysToFetch([], late)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    // 05:00 UTC on the 8th is 01:00 on the 8th in New York.
    expect(espnDaysToFetch([], new Date('2026-10-08T05:00:00Z'))).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
  });

  it('asks only for the days of the games that are on or about to be', () => {
    const live = game('a', '2026-10-07T19:00:00Z', 'live'); // 15:00 ET on the 7th
    const alsoLive = game('b', '2026-10-07T19:30:00Z', 'live');
    expect(espnDaysToFetch([live, alsoLive, game('far', at(60 * 40))], NOW)).toEqual([
      '2026-10-07',
    ]);
  });

  it('asks for two days when the games on are of two Eastern days', () => {
    const evening = game('a', '2026-10-07T23:00:00Z', 'live'); // 19:00 ET on the 7th
    const afterMidnight = game('b', '2026-10-08T05:00:00Z', 'live'); // 01:00 ET on the 8th
    expect(espnDaysToFetch([evening, afterMidnight], NOW)).toEqual(['2026-10-07', '2026-10-08']);
  });
});

describe('refreshScoreboards', () => {
  let repo: GamesRepo;

  beforeEach(() => {
    const db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...(gamesModule.migrations ?? [])]);
    repo = createGamesRepo(db);
  });

  /** ESPN answers: finals for the 6th, upcoming games for the 8th, nothing for other days. */
  function fakeEspn(options: { failDay?: string } = {}) {
    const asked: string[] = [];
    const getJson = vi.fn(async (_url: string, request?: { params?: Record<string, unknown> }) => {
      const dates = String(request?.params?.dates);
      asked.push(dates);
      if (dates === options.failDay) throw new HttpError('HTTP 404', _url, 404);
      if (dates === '20261006') return readEspnFixture('scoreboard-final.json');
      if (dates === '20261008') return readEspnFixture('scoreboard-scheduled.json');
      return { events: [] };
    });
    return { http: { get: vi.fn(), getJson } as unknown as HttpClient, asked };
  }

  it('stores the games of yesterday, today and tomorrow when nothing is on', async () => {
    const { http, asked } = fakeEspn();
    const result = await refreshScoreboards({ http, repo, logger, now: NOW });

    expect(asked).toEqual(['20261006', '20261007', '20261008']);
    expect(result).toEqual({
      days: ['2026-10-06', '2026-10-07', '2026-10-08'],
      games: 10,
      failures: [],
    });
    expect(repo.countGames()).toBe(10);
  });

  it('asks only for the day of the game that is on', async () => {
    repo.upsertGames([game('live', '2026-10-07T19:00:00Z', 'live')]);
    const { http, asked } = fakeEspn();
    await refreshScoreboards({ http, repo, logger, now: NOW });
    expect(asked).toEqual(['20261007']);
  });

  it('updates a game that was scheduled once it has been played', async () => {
    const [played] = parseScoreboard(readEspnFixture('scoreboard-final.json'));
    repo.upsertGames([{ ...played!, status: 'scheduled', home: side('X'), away: side('Y') }]);
    const { http } = fakeEspn();
    await refreshScoreboards({ http, repo, logger, now: NOW });
    expect(repo.game(played!.id)).toMatchObject({
      status: 'final',
      home: { score: played!.home.score },
    });
  });

  it('keeps what it could read when one day fails, and says which', async () => {
    const { http } = fakeEspn({ failDay: '20261007' });
    const result = await refreshScoreboards({ http, repo, logger, now: NOW });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/^2026-10-07: HTTP 404/);
    expect(repo.countGames()).toBe(10); // the other two days still arrived
  });
});

describe('refreshDelayFromStore', () => {
  it('reads the pace from what is stored', () => {
    const db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...(gamesModule.migrations ?? [])]);
    const repo = createGamesRepo(db);

    expect(refreshDelayFromStore(repo, NOW)).toBe(REFRESH.idle);
    repo.upsertGames([game('soon', at(15))]);
    expect(refreshDelayFromStore(repo, NOW)).toBe(REFRESH.imminent);
    repo.upsertGames([game('soon', at(15), 'live')]);
    expect(refreshDelayFromStore(repo, NOW)).toBe(REFRESH.live);
  });
});
