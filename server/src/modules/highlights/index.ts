import { dirname, join } from 'node:path';
import type { AppModule, ModuleContext } from '../../core/modules.js';
import { createGamesRepo } from '../games/repo.js';
import { createImageStore, type ImageStore } from '../news/images.js';
import { createNewsRepo } from '../news/repo.js';
import { HIGHLIGHTS_MIGRATIONS } from './highlights-migrations.js';
import { refreshDelay, refreshHighlights } from './refresh.js';
import { createHighlightsRepo, type HighlightsRepo } from './repo.js';
import { registerHighlightsRoutes } from './routes.js';

const DAY = 24 * 60 * 60_000;
const KEEP_DAYS = 90;

export const HIGHLIGHTS_JOB_ID = 'highlights:refresh';
export const HIGHLIGHTS_CLEANUP_JOB_ID = 'highlights:cleanup';

// Routes and jobs share one thumbnail store (and so one in-flight download per thumbnail).
const stores = new WeakMap<ModuleContext, { repo: HighlightsRepo; thumbnails: ImageStore }>();
function storesFor(context: ModuleContext) {
  let found = stores.get(context);
  if (!found) {
    const repo = createHighlightsRepo(context.db);
    found = {
      repo,
      thumbnails: createImageStore({
        // Next to the news pictures, whichever folder those are kept in.
        dir: join(dirname(context.config.newsImagesDir), 'highlight-thumbs'),
        http: context.http,
        repo,
        logger: context.logger,
      }),
    };
    stores.set(context, found);
  }
  return found;
}

/**
 * Videos of the official NBA channel, linked to their game. It needs the `games` module (games and
 * teams) and the `news` module (the players ESPN has labelled).
 */
export const highlightsModule: AppModule = {
  id: 'highlights',

  migrations: HIGHLIGHTS_MIGRATIONS,

  routes: (app, context) => {
    const { repo, thumbnails } = storesFor(context);
    registerHighlightsRoutes(app, repo, createGamesRepo(context.db), thumbnails);
  },

  jobs: (context) => {
    const { repo, thumbnails } = storesFor(context);
    const games = createGamesRepo(context.db);
    const news = createNewsRepo(context.db, new Map());
    return [
      {
        id: HIGHLIGHTS_JOB_ID,
        every: () => refreshDelay(Date.now(), games, context.config.favoriteTeams),
        run: async ({ logger }) => {
          await refreshHighlights({
            http: context.http,
            repo,
            games,
            knownPlayers: news.knownPlayers(),
            logger,
            now: Date.now(),
          });
        },
      },
      {
        id: HIGHLIGHTS_CLEANUP_JOB_ID,
        every: DAY,
        runOnStart: false,
        run: ({ logger }) => {
          const removed = repo.purge(Date.now() - KEEP_DAYS * DAY);
          thumbnails.remove(removed);
          if (removed.length > 0) logger.info({ removed: removed.length }, 'old videos deleted');
        },
      },
    ];
  },
};
