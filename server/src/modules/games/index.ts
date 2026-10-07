import { fileURLToPath } from 'node:url';
import { loadMigrationsFromDir } from '../../core/migrations.js';
import type { AppModule } from '../../core/modules.js';
import type { ModuleContext } from '../../core/modules.js';
import { loadCalendar } from './calendar.js';
import { createCrestStore, type CrestStore } from './crests.js';
import { seasonForDate } from './dates.js';
import { refreshDelayFromStore, refreshScoreboards } from './refresh.js';
import { createGamesRepo } from './repo.js';
import { registerGamesRoutes } from './routes.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A full calendar load is ~90 requests, so it is repeated weekly to pick up newly published games. */
const RELOAD_AFTER_MS = 6 * DAY_MS;

export const CALENDAR_JOB_ID = 'games:calendar';
export const REFRESH_JOB_ID = 'games:refresh';

// Routes and jobs share one crest store (and so one in-flight download per crest).
const crestStores = new WeakMap<ModuleContext, CrestStore>();
function crestStoreFor(context: ModuleContext): CrestStore {
  let store = crestStores.get(context);
  if (!store) {
    store = createCrestStore({
      dir: context.config.crestsDir,
      http: context.http,
      repo: createGamesRepo(context.db),
      logger: context.logger,
    });
    crestStores.set(context, store);
  }
  return store;
}

export const gamesModule: AppModule = {
  id: 'games',

  migrations: loadMigrationsFromDir(fileURLToPath(new URL('./migrations', import.meta.url))),

  routes: (app, context) => {
    registerGamesRoutes(app, createGamesRepo(context.db), context.config, crestStoreFor(context));
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
          const recent =
            lastLoad !== undefined &&
            repo.countGames() > 0 &&
            Date.now() - lastLoad.finishedAt < RELOAD_AFTER_MS; // restarts must not repeat ~90 requests

          const calendar = recent
            ? undefined
            : await loadCalendar({
                http: context.http,
                repo,
                logger,
                season: seasonForDate(new Date()),
              });

          // Only the crests missing on disk are downloaded, so this is free once they are all there.
          const { downloaded, failed } = await crestStoreFor(context).warm();
          if (downloaded > 0) logger.info({ downloaded }, 'team crests downloaded');
          if (failed.length > 0)
            logger.warn({ failed }, 'some team crests could not be downloaded');

          if (calendar && calendar.failures.length > 0) {
            throw new Error(
              `${calendar.failures.length} schedule requests failed (first: ${calendar.failures[0]})`,
            );
          }
        },
      },
      {
        // Scores and statuses of today's games. The wait between runs adapts to what is going on.
        id: REFRESH_JOB_ID,
        every: () => refreshDelayFromStore(repo),
        run: async ({ logger }) => {
          const { failures } = await refreshScoreboards({
            http: context.http,
            repo,
            logger,
            now: new Date(),
          });
          if (failures.length > 0) {
            throw new Error(
              `${failures.length} scoreboard requests failed (first: ${failures[0]})`,
            );
          }
        },
      },
    ];
  },
};
