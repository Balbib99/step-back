import type { AppModule, ModuleContext } from '../../core/modules.js';
import type { JobDefinition } from '../../core/scheduler.js';
import { createNewsRepo } from '../news/repo.js';
import { createDeeplTranslator } from './client.js';
import { createTranslationsRepo } from './repo.js';
import { registerTranslationRoutes } from './routes.js';
import { createTranslationService, type TranslationService } from './service.js';
import { TRANSLATION_MIGRATIONS } from './translation-migrations.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export const QUOTA_JOB_ID = 'translation:quota';
export const TRANSLATION_CLEANUP_JOB_ID = 'translation:cleanup';

const services = new WeakMap<ModuleContext, TranslationService>();
function serviceFor(context: ModuleContext): TranslationService {
  let service = services.get(context);
  if (!service) {
    const { config } = context;
    service = createTranslationService({
      translator: config.deeplApiKey
        ? createDeeplTranslator({
            http: context.http,
            apiKey: config.deeplApiKey,
            baseUrl: config.deeplApiUrl,
          })
        : undefined,
      // Titles and summaries come from the news module; its table and repo are used as they are.
      news: createNewsRepo(context.db, new Map()),
      repo: createTranslationsRepo(context.db),
      cache: context.cache,
      logger: context.logger,
    });
    services.set(context, service);
  }
  return service;
}

/**
 * Spanish versions of news titles and summaries, on demand, through DeepL. It needs the `news`
 * module (its table). Without `DEEPL_API_KEY` it only reports that it is off.
 */
export const translationModule: AppModule = {
  id: 'translation',

  migrations: TRANSLATION_MIGRATIONS,

  routes: (app, context) => {
    registerTranslationRoutes(app, serviceFor(context));
  },

  jobs: (context) => {
    const repo = createTranslationsRepo(context.db);
    const jobs: JobDefinition[] = [
      {
        id: TRANSLATION_CLEANUP_JOB_ID,
        every: DAY,
        runOnStart: false,
        run: ({ logger }) => {
          const removed = repo.purge(Date.now() - 7 * DAY);
          if (removed > 0) logger.info({ removed }, 'old translations deleted');
        },
      },
    ];
    // The quota check shows up in /api/health as a failing job from 90 % of the quota on.
    if (context.config.deeplApiKey) {
      jobs.unshift({
        id: QUOTA_JOB_ID,
        every: 6 * HOUR,
        run: async () => serviceFor(context).checkQuota(),
      });
    }
    return jobs;
  },
};
