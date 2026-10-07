import type { AppModule } from '../../core/modules.js';
import { createGamesRepo } from '../games/repo.js';
import { createStandingsRepo } from './repo.js';
import { shouldRefresh, refreshStandings } from './refresh.js';
import { registerStandingsRoutes } from './routes.js';
import { STANDINGS_MIGRATIONS } from './standings-migrations.js';

export const STANDINGS_JOB_ID = 'standings:refresh';

/** How often the job wakes up to decide whether to download; the download itself is rarer. */
const CHECK_EVERY_MS = 2 * 60_000;

export const standingsModule: AppModule = {
  id: 'standings',

  migrations: STANDINGS_MIGRATIONS,

  routes: (app, context) => {
    registerStandingsRoutes(app, createStandingsRepo(context.db));
  },

  jobs: (context) => {
    const repo = createStandingsRepo(context.db);
    const games = createGamesRepo(context.db);
    return [
      {
        id: STANDINGS_JOB_ID,
        every: CHECK_EVERY_MS,
        run: async ({ logger }) => {
          const now = Date.now();
          const due = shouldRefresh({
            now,
            lastFetchedAt: repo.lastFetchedAt(),
            lastFinalAt: games.lastFinalUpdatedAt(),
          });
          if (due) await refreshStandings({ http: context.http, repo, logger, now });
        },
      },
    ];
  },
};
