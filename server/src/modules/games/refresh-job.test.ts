import { healthResponseSchema } from '@step-back/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { CALENDAR_JOB_ID, gamesModule, REFRESH_JOB_ID } from './index.js';
import { createGamesRepo } from './repo.js';

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
});

async function build(scoreboard: (url: string) => Response) {
  app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
    modules: [gamesModule],
    fetch: vi.fn(async (url: string | URL | Request) =>
      scoreboard(String(url)),
    ) as unknown as typeof fetch,
  });
  return app;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('games jobs', () => {
  it('registers the calendar load and the adaptive refresh', async () => {
    const { scheduler } = await build(() => json({ events: [] }));
    expect(scheduler.jobIds()).toEqual([CALENDAR_JOB_ID, REFRESH_JOB_ID]);
  });

  it('refreshes the scoreboards, stores the games and reports the job as healthy', async () => {
    const { server, scheduler, db } = await build(() =>
      json(readEspnFixture('scoreboard-scheduled.json')),
    );

    await scheduler.runNow(REFRESH_JOB_ID);

    expect(createGamesRepo(db).countGames()).toBe(6); // the same 6 games for every day asked
    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(health.jobs.find((job) => job.id === REFRESH_JOB_ID)).toMatchObject({
      status: 'ok',
      error: null,
    });
  });

  it('turns the health degraded, saying what failed, when ESPN does not answer', async () => {
    const { server, scheduler } = await build(() => json({ error: 'gone' }, 404));

    await scheduler.runNow(REFRESH_JOB_ID);

    const health = healthResponseSchema.parse((await server.inject('/api/health')).json());
    const job = health.jobs.find((candidate) => candidate.id === REFRESH_JOB_ID);
    expect(health.status).toBe('degraded');
    expect(job?.status).toBe('error');
    expect(job?.error).toMatch(/3 scoreboard requests failed/);
  });
});
