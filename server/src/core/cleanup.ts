import type { AppModule } from './modules.js';

const DAY = 24 * 60 * 60_000;
/** Job runs are only kept for a look at recent history; `/api/health` needs just the latest. */
export const JOB_RUNS_KEPT_DAYS = 14;

export const CLEANUP_JOB_ID = 'core:cleanup';

/**
 * The housekeeping every module leaves to the core: the history of job runs (the push job alone
 * adds thousands a day) and cache entries past their time. News, translations, videos and sent
 * notifications are cleaned by their own modules.
 */
export const cleanupModule: AppModule = {
  id: 'cleanup',
  jobs: (context) => [
    {
      id: CLEANUP_JOB_ID,
      every: DAY,
      runOnStart: false,
      run: ({ logger }) => {
        const runs = context.jobRuns.prune(Date.now() - JOB_RUNS_KEPT_DAYS * DAY);
        const cached = context.cache.purgeExpired();
        if (runs > 0 || cached > 0) logger.info({ runs, cached }, 'housekeeping done');
      },
    },
  ],
};
