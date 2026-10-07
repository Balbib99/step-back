import { z } from 'zod';

export const jobStatusSchema = z.object({
  id: z.string(),
  /** `pending`: registered but has not run yet. */
  status: z.enum(['ok', 'error', 'pending']),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const healthResponseSchema = z.object({
  /** `degraded` when at least one job's latest run failed. The server itself is still up. */
  status: z.enum(['ok', 'degraded']),
  time: z.string(),
  uptimeSeconds: z.number(),
  modules: z.array(z.string()),
  jobs: z.array(jobStatusSchema),
});

export const configResponseSchema = z.object({
  timeZone: z.string(),
  favoriteTeams: z.array(z.string()),
  features: z.object({ translation: z.boolean(), push: z.boolean() }),
  /** Public by design: the browser needs it to subscribe to Web Push. */
  vapidPublicKey: z.string().nullable(),
  modules: z.array(z.string()),
});

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ConfigResponse = z.infer<typeof configResponseSchema>;
