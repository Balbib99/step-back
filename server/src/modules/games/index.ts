import { fileURLToPath } from 'node:url';
import { loadMigrationsFromDir } from '../../core/migrations.js';
import type { AppModule } from '../../core/modules.js';
import { loadCalendar } from './calendar.js';
import { seasonForDate } from './dates.js';
import { createGamesRepo } from './repo.js';
import { registerGamesRoutes } from './routes.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A full calendar load is ~90 requests, so it is repeated weekly to pick up newly published games. */
const RELOAD_AFTER_MS = 6 * DAY_MS;

export const CALENDAR_JOB_ID = 'games:calendar';

export const gamesModule: AppModule = {
  id: 'games',

  migrations: loadMigrationsFromDir(fileURLToPath(new URL('./migrations', import.meta.url))),

  routes: (app, context) => {
    registerGamesRoutes(app, createGamesRepo(context.db), context.config);
  },

  jobs: (context) => {
    const repo = createGamesRepo(context.db);
    return [
      {
        id: CALENDAR_JOB_ID,
        every: DAY_MS,
        timeoutMs: 5 * 60_000,
        run: async ({ logger }) => {
          const lastLoad = context.jobRuns.lastSuccess(CALENDAR_JOB_ID);
          if (
            lastLoad &&
            repo.countGames() > 0 &&
            Date.now() - lastLoad.finishedAt < RELOAD_AFTER_MS
          ) {
            return; // restarts of the server must not repeat ~90 requests
          }
          const { failures } = await loadCalendar({
            http: context.http,
            repo,
            logger,
            season: seasonForDate(new Date()),
          });
          if (failures.length > 0) {
            throw new Error(`${failures.length} schedule requests failed (first: ${failures[0]})`);
          }
        },
      },
    ];
  },
};
