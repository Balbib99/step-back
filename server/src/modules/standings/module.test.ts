import { healthResponseSchema, standingsResponseSchema } from '@step-back/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { gamesModule } from '../games/index.js';
import { createGamesRepo } from '../games/repo.js';
import { parseScoreboard } from '../games/adapter.js';
import { standingsModule, STANDINGS_JOB_ID } from './index.js';
import { createStandingsRepo } from './repo.js';

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function build(
  answer: () => Response = () => json(readEspnFixture('standings-2025-26.json')),
) {
  const fetchMock = vi.fn(async () => answer());
  app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
    modules: [gamesModule, standingsModule],
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { ...app, fetchMock };
}

describe('GET /api/standings', () => {
  it('is empty before the first download, not an error', async () => {
    const { server } = await build();
    const response = await server.inject('/api/standings');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ standings: [] });
  });

  it('serves both conferences once downloaded, east first', async () => {
    const { server, scheduler } = await build();
    await scheduler.runNow(STANDINGS_JOB_ID);

    const { standings } = standingsResponseSchema.parse(
      (await server.inject('/api/standings')).json(),
    );
    expect(standings.map((table) => table.conference)).toEqual(['east', 'west']);
    expect(standings[0]?.entries[0]?.abbr).toBe('DET');
    expect(standings[1]?.entries[0]?.abbr).toBe('OKC');
  });

  it('serves one conference when asked, in any letter case', async () => {
    const { server, scheduler } = await build();
    await scheduler.runNow(STANDINGS_JOB_ID);

    for (const value of ['west', 'WEST', 'West']) {
      const { standings } = (await server.inject(`/api/standings?conference=${value}`)).json();
      expect(standings).toHaveLength(1);
      expect(standings[0].conference).toBe('west');
    }
  });

  it('rejects a conference that does not exist, saying why', async () => {
    const { server } = await build();
    const response = await server.inject('/api/standings?conference=north');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'invalid_query',
      message: 'must be east or west',
    });
  });
});

describe('the standings job', () => {
  it('is registered next to the games jobs', async () => {
    const { scheduler } = await build();
    expect(scheduler.jobIds()).toContain(STANDINGS_JOB_ID);
  });

  it('downloads the first time it runs, and not again two minutes later', async () => {
    const { scheduler, fetchMock } = await build();
    await scheduler.runNow(STANDINGS_JOB_ID);
    await scheduler.runNow(STANDINGS_JOB_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads again when a game has ended since', async () => {
    const { scheduler, fetchMock, db } = await build();
    await scheduler.runNow(STANDINGS_JOB_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A game is stored as finished a bit after the standings were downloaded.
    const standings = createStandingsRepo(db);
    const downloadedAt = standings.lastFetchedAt()!;
    const [finished] = parseScoreboard(readEspnFixture('scoreboard-final.json'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(downloadedAt + 3 * 60_000);
    createGamesRepo(db).upsertGames([finished!]);
    await scheduler.runNow(STANDINGS_JOB_ID);
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a failure in the health check and keeps serving the last table', async () => {
    let failing = false;
    const { server, scheduler, db } = await build(() =>
      failing ? json({ error: 'gone' }, 404) : json(readEspnFixture('standings-2025-26.json')),
    );
    await scheduler.runNow(STANDINGS_JOB_ID);
    expect(createStandingsRepo(db).get()).toHaveLength(2);

    // Make the next check due (more than an hour later) and ESPN fail.
    failing = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61 * 60_000);
    await scheduler.runNow(STANDINGS_JOB_ID);
    vi.useRealTimers();

    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(health.status).toBe('degraded');
    expect(health.jobs.find((job) => job.id === STANDINGS_JOB_ID)?.status).toBe('error');
    const { standings } = (await server.inject('/api/standings')).json();
    expect(standings[0].entries).toHaveLength(15); // still the last good table
  });
});
