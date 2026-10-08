import type { AppModule } from '../../core/modules.js';
import { createGamesRepo } from '../games/repo.js';
import { PUSH_MIGRATIONS } from './push-migrations.js';
import { createPushRepo } from './repo.js';
import { registerPushRoutes } from './routes.js';
import { createDispatcher, createWebPushProvider, type PushProvider } from './sender.js';

const DAY = 24 * 60 * 60_000;
/** How often to look for a notification that is due. Tip-off is noticed within the games refresh anyway. */
const DISPATCH_EVERY_MS = 30_000;
/** An event is only repeated within hours, so a month of log is far more than needed. */
const LOG_KEPT_MS = 30 * DAY;

export const PUSH_JOB_ID = 'push:dispatch';

/**
 * Web Push for the favourite teams: the start and the end of their games, and an optional
 * reminder before. It needs the `games` module (its table). Without VAPID keys it is off:
 * its routes answer 503 and it schedules nothing. `provider` is only for tests.
 */
export function createPushModule(options: { provider?: PushProvider } = {}): AppModule {
  return {
    id: 'push',

    migrations: PUSH_MIGRATIONS,

    routes: (app, context) => {
      registerPushRoutes(app, {
        repo: createPushRepo(context.db),
        favorites: context.config.favoriteTeams,
        enabled: context.config.vapid !== undefined,
      });
    },

    jobs: (context) => {
      const { config } = context;
      const provider =
        options.provider ?? (config.vapid ? createWebPushProvider(config.vapid) : undefined);
      if (!provider) return [];

      const repo = createPushRepo(context.db);
      const games = createGamesRepo(context.db);
      const dispatcher = createDispatcher({
        repo,
        games: (teams, fromUtc, toUtc) => {
          const seen = new Map(
            teams.flatMap((teamAbbr) =>
              games.games({ fromUtc, toUtc, teamAbbr }).map((game) => [game.id, game] as const),
            ),
          );
          return [...seen.values()];
        },
        provider,
        teams: config.favoriteTeams,
        timeZone: config.timeZone,
        logger: context.logger,
      });

      return [
        {
          id: PUSH_JOB_ID,
          every: DISPATCH_EVERY_MS,
          run: async () => {
            await dispatcher.run();
            repo.purgeLog(Date.now() - LOG_KEPT_MS);
          },
        },
      ];
    },
  };
}

export const pushModule = createPushModule();
