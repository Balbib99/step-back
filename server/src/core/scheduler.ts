import type { JobRuns } from './job-runs.js';
import type { Logger } from './logger.js';

export interface JobContext {
  /** Aborted when the job times out or the scheduler stops. */
  signal: AbortSignal;
  logger: Logger;
}

export interface JobDefinition {
  id: string;
  /** Delay between the end of one run and the start of the next. A function lets it adapt (e.g. live games). */
  every: number | (() => number);
  run: (context: JobContext) => Promise<void> | void;
  /** Default 60 s. */
  timeoutMs?: number;
  /** Run once as soon as the scheduler starts. Default true. */
  runOnStart?: boolean;
}

export interface Scheduler {
  add(job: JobDefinition): void;
  /** Ids of every registered job, in registration order. */
  jobIds(): string[];
  start(): void;
  /** Runs a job now (outside its schedule) and resolves when it finishes. Never rejects. */
  runNow(id: string): Promise<void>;
  /** Stops scheduling, aborts in-flight runs and waits for them to settle. */
  stop(): Promise<void>;
}

export interface SchedulerOptions {
  jobRuns: JobRuns;
  logger: Logger;
  /** First retry delay after a failure; doubles each time, never longer than the job's normal interval. */
  backoffBaseMs?: number;
}

interface JobState {
  job: JobDefinition;
  failures: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: Promise<void> | undefined;
  controller: AbortController | undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const FALLBACK_INTERVAL_MS = 60_000;
const ABORTED = 'aborted by scheduler stop';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { jobRuns, logger, backoffBaseMs = 1_000 } = options;
  const states = new Map<string, JobState>();
  let started = false;
  let stopped = false;

  function intervalOf(state: JobState): number {
    try {
      const { every } = state.job;
      return typeof every === 'function' ? every() : every;
    } catch (error) {
      logger.error({ jobId: state.job.id, err: messageOf(error) }, 'job interval function threw');
      return FALLBACK_INTERVAL_MS;
    }
  }

  function schedule(state: JobState, delayMs: number): void {
    if (stopped) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void execute(state);
    }, delayMs);
  }

  function execute(state: JobState): Promise<void> {
    if (state.running) return state.running; // never overlap runs of the same job
    state.running = (async () => {
      const { job } = state;
      const startedAt = Date.now();
      const controller = new AbortController();
      state.controller = controller;
      const timeoutMs = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let failure: string | undefined;

      try {
        const work = Promise.resolve().then(() => job.run({ signal: controller.signal, logger }));
        work.catch(() => undefined); // a late rejection after a timeout must not be unhandled
        const timeout = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`timed out after ${timeoutMs} ms`));
            controller.abort();
          }, timeoutMs);
          // Stop waiting as soon as the scheduler stops, even if the job ignores the signal.
          controller.signal.addEventListener('abort', () => reject(new Error(ABORTED)), {
            once: true,
          });
        });
        await Promise.race([work, timeout]);
      } catch (error) {
        failure = messageOf(error);
      } finally {
        clearTimeout(timeoutHandle);
        state.controller = undefined;
      }

      // Shutting down is not a job failure: leave no error behind and do not reschedule.
      if (failure === ABORTED) return;

      try {
        jobRuns.record({
          jobId: job.id,
          startedAt,
          finishedAt: Date.now(),
          status: failure === undefined ? 'ok' : 'error',
          ...(failure !== undefined && { error: failure }),
        });
      } catch (error) {
        logger.error({ jobId: job.id, err: messageOf(error) }, 'could not record job run');
      }

      const interval = intervalOf(state);
      if (failure === undefined) {
        state.failures = 0;
        schedule(state, interval);
      } else {
        state.failures += 1;
        logger.warn({ jobId: job.id, failures: state.failures, err: failure }, 'job failed');
        schedule(state, Math.min(backoffBaseMs * 2 ** (state.failures - 1), interval));
      }
    })().finally(() => {
      state.running = undefined;
    });
    return state.running;
  }

  function begin(state: JobState): void {
    if (state.job.runOnStart === false) schedule(state, intervalOf(state));
    else void execute(state);
  }

  return {
    add(job) {
      if (states.has(job.id)) throw new Error(`Duplicate job id: ${job.id}`);
      const state: JobState = {
        job,
        failures: 0,
        timer: undefined,
        running: undefined,
        controller: undefined,
      };
      states.set(job.id, state);
      if (started) begin(state);
    },
    jobIds() {
      return [...states.keys()];
    },
    start() {
      if (started) return;
      started = true;
      for (const state of states.values()) begin(state);
    },
    async runNow(id) {
      const state = states.get(id);
      if (!state) throw new Error(`Unknown job id: ${id}`);
      clearTimeout(state.timer);
      state.timer = undefined;
      await execute(state);
    },
    async stop() {
      stopped = true;
      const inFlight: Promise<void>[] = [];
      for (const state of states.values()) {
        clearTimeout(state.timer);
        state.timer = undefined;
        state.controller?.abort();
        if (state.running) inFlight.push(state.running);
      }
      await Promise.allSettled(inFlight);
    },
  };
}
