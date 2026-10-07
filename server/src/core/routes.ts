import type { ConfigResponse, HealthResponse, JobStatus } from '@step-back/shared';
import type { FastifyInstance } from 'fastify';
import type { JobRuns } from './job-runs.js';
import type { ModuleContext } from './modules.js';
import type { Scheduler } from './scheduler.js';

interface CoreRouteDeps {
  context: ModuleContext;
  moduleIds: string[];
  scheduler: Scheduler;
  jobRuns: JobRuns;
  startedAt: number;
}

const iso = (epochMs: number | undefined) =>
  epochMs === undefined ? null : new Date(epochMs).toISOString();

export function registerCoreRoutes(app: FastifyInstance, deps: CoreRouteDeps): void {
  const { context, moduleIds, scheduler, jobRuns, startedAt } = deps;

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const latest = new Map(jobRuns.latestPerJob().map((run) => [run.jobId, run]));
    const jobs: JobStatus[] = scheduler.jobIds().map((id) => {
      const run = latest.get(id);
      return {
        id,
        status: run?.status ?? 'pending',
        lastRunAt: iso(run?.finishedAt),
        lastSuccessAt: iso(jobRuns.lastSuccess(id)?.finishedAt),
        error: run?.status === 'error' ? run.error : null,
      };
    });
    return {
      status: jobs.some((job) => job.status === 'error') ? 'degraded' : 'ok',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      modules: moduleIds,
      jobs,
    };
  });

  app.get('/api/config', async (): Promise<ConfigResponse> => {
    const { config } = context;
    return {
      timeZone: config.timeZone,
      favoriteTeams: config.favoriteTeams,
      features: { translation: config.deeplApiKey !== undefined, push: config.vapid !== undefined },
      vapidPublicKey: config.vapid?.publicKey ?? null,
      modules: moduleIds,
    };
  });
}
