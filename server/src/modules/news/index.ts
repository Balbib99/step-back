import type { AppModule, ModuleContext } from '../../core/modules.js';
import { createGamesRepo } from '../games/repo.js';
import { createImageStore, type ImageStore } from './images.js';
import { NEWS_MIGRATIONS } from './news-migrations.js';
import { refreshSource } from './refresh.js';
import { createNewsRepo, type NewsRepo } from './repo.js';
import { registerNewsRoutes } from './routes.js';
import { SOURCES, type NewsSource } from './sources.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Each source is read this often (the spec asks for 10-15 minutes). */
const REFRESH_EVERY_MS = 12 * MINUTE;
/** News older than this is deleted. */
const KEEP_DAYS = 90;

export const sourceJobId = (sourceId: string) => `news:${sourceId}`;
export const CLEANUP_JOB_ID = 'news:cleanup';

/**
 * The news module for a list of sources. Each source has its own scheduled job, so one that is
 * down shows up in `/api/health` by name and does not hold back the others.
 */
export function createNewsModule(sources: readonly NewsSource[]): AppModule {
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));

  // Routes and jobs share one picture store (and so one in-flight download per picture).
  const stores = new WeakMap<ModuleContext, { repo: NewsRepo; images: ImageStore }>();
  const storesFor = (context: ModuleContext) => {
    let found = stores.get(context);
    if (!found) {
      const repo = createNewsRepo(context.db, sourceNames);
      found = {
        repo,
        images: createImageStore({
          dir: context.config.newsImagesDir,
          http: context.http,
          repo,
          logger: context.logger,
          ...(context.resolve && { resolve: context.resolve }),
        }),
      };
      stores.set(context, found);
    }
    return found;
  };

  return {
    id: 'news',

    migrations: NEWS_MIGRATIONS,

    routes: (app, context) => {
      const { repo, images } = storesFor(context);
      registerNewsRoutes(app, repo, images);
    },

    jobs: (context) => {
      const { repo, images } = storesFor(context);
      const games = createGamesRepo(context.db);
      return [
        ...sources.map((source) => ({
          id: sourceJobId(source.id),
          every: REFRESH_EVERY_MS,
          run: async ({ logger }: { logger: ModuleContext['logger'] }) => {
            await refreshSource({
              source,
              http: context.http,
              repo,
              // Read each time: the teams arrive with the first calendar load.
              teams: games.teams(),
              logger,
              now: Date.now(),
            });
          },
        })),
        {
          id: CLEANUP_JOB_ID,
          every: DAY,
          runOnStart: false,
          run: ({ logger }: { logger: ModuleContext['logger'] }) => {
            const removed = repo.purge(Date.now() - KEEP_DAYS * DAY);
            images.remove(removed);
            if (removed.length > 0) logger.info({ removed: removed.length }, 'old news deleted');
          },
        },
      ];
    },
  };
}

export const newsModule = createNewsModule(SOURCES);
