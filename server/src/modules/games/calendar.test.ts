import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { openDb } from '../../core/db.js';
import { HttpError, type HttpClient } from '../../core/http.js';
import { createLogger } from '../../core/logger.js';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { runMigrations } from '../../core/migrations.js';
import { loadCalendar } from './calendar.js';
import { gamesModule } from './index.js';
import { createGamesRepo, type GamesRepo } from './repo.js';

const logger = createLogger({ env: 'test', logLevel: 'info' });

/** Every team's schedule is the Timberwolves fixture (6 games) for preseason, empty otherwise. */
function fakeHttp(options: { failFor?: (teamId: string, seasonType: number) => boolean } = {}) {
  const calls: Array<{ url: string; params?: Record<string, string | number | undefined> }> = [];
  const getJson = vi.fn(
    async (url: string, request?: { params?: Record<string, string | number | undefined> }) => {
      calls.push({ url, ...(request?.params && { params: request.params }) });
      if (url.endsWith('/teams')) return readEspnFixture('teams.json');
      const match = /\/teams\/(\d+)\/schedule$/.exec(url);
      if (!match) throw new Error(`unexpected url ${url}`);
      const seasonType = Number(request?.params?.seasontype);
      if (options.failFor?.(match[1]!, seasonType)) throw new HttpError('HTTP 500', url, 500);
      return seasonType === 1 ? readEspnFixture('schedule-min-preseason.json') : { events: [] };
    },
  );
  return { http: { get: vi.fn(), getJson } as unknown as HttpClient, calls };
}

describe('loadCalendar', () => {
  let repo: GamesRepo;

  beforeEach(() => {
    const db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...(gamesModule.migrations ?? [])]);
    repo = createGamesRepo(db);
  });

  it('stores the 30 teams and the games of every team, once each', async () => {
    const { http } = fakeHttp();
    const result = await loadCalendar({ http, repo, logger, season: 2027 });

    expect(result).toEqual({ teams: 30, games: 6, failures: [] });
    expect(repo.teams()).toHaveLength(30);
    expect(repo.countGames()).toBe(6); // the same 6 games came back for 30 teams: merged by id
  });

  it('asks each team for the three season types of the season, because ESPN only returns the current phase otherwise', async () => {
    const { http, calls } = fakeHttp();
    await loadCalendar({ http, repo, logger, season: 2027 });

    const schedules = calls.filter((c) => c.url.includes('/schedule'));
    expect(schedules).toHaveLength(90);
    const forMin = schedules.filter((c) => c.url.includes('/teams/16/'));
    expect(forMin.map((c) => c.params)).toEqual([
      { season: 2027, seasontype: 1 },
      { season: 2027, seasontype: 2 },
      { season: 2027, seasontype: 3 },
    ]);
  });

  it('is idempotent across loads', async () => {
    await loadCalendar({ http: fakeHttp().http, repo, logger, season: 2027 });
    await loadCalendar({ http: fakeHttp().http, repo, logger, season: 2027 });
    expect(repo.countGames()).toBe(6);
  });

  it('keeps what it could read when some requests fail, and reports the failures', async () => {
    const { http } = fakeHttp({ failFor: (teamId, type) => teamId === '16' && type === 1 });
    const result = await loadCalendar({ http, repo, logger, season: 2027 });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/^MIN type 1: HTTP 500/);
    expect(result.teams).toBe(30);
    expect(repo.countGames()).toBe(6); // the other 29 teams still delivered the games
  });

  it('fails outright when the teams list cannot be read', async () => {
    const http = {
      get: vi.fn(),
      getJson: vi.fn(async () => {
        throw new HttpError('HTTP 503', 'x', 503);
      }),
    } as unknown as HttpClient;
    await expect(loadCalendar({ http, repo, logger, season: 2027 })).rejects.toThrow(/503/);
  });
});
