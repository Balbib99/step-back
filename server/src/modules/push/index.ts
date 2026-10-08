import type { Config } from '../../core/config.js';
import type { AppModule } from '../../core/modules.js';
import { createGamesRepo } from '../games/repo.js';
import { createNewsRepo } from '../news/repo.js';
import { SOURCES, type NewsSource } from '../news/sources.js';
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
 * reminder before. It needs the `games` and `news` modules (their tables). Without VAPID keys it is off:
 * its routes answer 503 and it schedules nothing. `provider` is only for tests.
 */
export function createPushModule(
  options: { provider?: PushProvider; sources?: readonly NewsSource[] } = {},
): AppModule {
  const sources = options.sources ?? SOURCES;
  const providerFor = (config: Config) =>
    options.provider ?? (config.vapid ? createWebPushProvider(config.vapid) : undefined);

  return {
    id: 'push',

    migrations: PUSH_MIGRATIONS,

    routes: (app, context) => {
      registerPushRoutes(app, {
        repo: createPushRepo(context.db, context.config.favoriteTeams),
        favorites: context.config.favoriteTeams,
        enabled: context.config.vapid !== undefined,
        provider: providerFor(context.config),
      });
    },

    jobs: (context) => {
      const { config } = context;
      const provider = providerFor(config);
      if (!provider) return [];

      const repo = createPushRepo(context.db, config.favoriteTeams);
      const news = createNewsRepo(
        context.db,
        new Map(sources.map((source) => [source.id, source.name])),
      );
      const games = createGamesRepo(context.db);
      const dispatcher = createDispatcher({
        repo,
        games: (fromUtc, toUtc) => games.games({ fromUtc, toUtc }),
        news: (teams) => news.list({ teams, limit: 30 }).news,
        prioritySources: new Set(sources.filter((s) => s.priority).map((s) => s.id)),
        sourceName: (id) => sources.find((s) => s.id === id)?.name ?? id,
        provider,
        favorites: config.favoriteTeams,
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
