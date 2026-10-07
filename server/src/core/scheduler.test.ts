import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from './db.js';
import { createJobRuns, type JobRuns } from './job-runs.js';
import { createLogger } from './logger.js';
import { CORE_MIGRATIONS } from './core-migrations.js';
import { runMigrations } from './migrations.js';
import { createScheduler, type Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  let jobRuns: JobRuns;
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    const db = openDb(':memory:');
    runMigrations(db, CORE_MIGRATIONS);
    jobRuns = createJobRuns(db);
    scheduler = createScheduler({
      jobRuns,
      logger: createLogger({ env: 'test', logLevel: 'info' }),
      backoffBaseMs: 1_000,
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    vi.useRealTimers();
  });

  it('runs a job immediately on start and then every interval', async () => {
    const run = vi.fn();
    scheduler.add({ id: 'tick', every: 10_000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('can wait a full interval before the first run', async () => {
    const run = vi.fn();
    scheduler.add({ id: 'late', every: 5_000, run, runOnStart: false });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('records successes and failures in job_runs', async () => {
    let call = 0;
    scheduler.add({
      id: 'flaky',
      every: 60_000,
      run: () => {
        if (++call === 1) throw new Error('boom');
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(jobRuns.latestPerJob()).toMatchObject([
      { jobId: 'flaky', status: 'error', error: 'boom' },
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(jobRuns.latestPerJob()).toMatchObject([{ jobId: 'flaky', status: 'ok', error: null }]);
  });

  it('retries a failing job with exponential backoff capped at its interval', async () => {
    const times: number[] = [];
    scheduler.add({
      id: 'down',
      every: 5_000,
      run: async () => {
        times.push(Date.now());
        throw new Error('still down');
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    const gaps = times.slice(1).map((time, index) => time - times[index]!);
    expect(gaps.slice(0, 5)).toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('resets the backoff after a success', async () => {
    const outcomes = [false, false, true, false];
    const times: number[] = [];
    scheduler.add({
      id: 'recovering',
      every: 60_000,
      run: () => {
        times.push(Date.now());
        if (!outcomes.shift()) throw new Error('fail');
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0 + 1_000 + 2_000); // fail, retry +1s, retry +2s (ok)
    await vi.advanceTimersByTimeAsync(60_000); // normal interval, fails again
    await vi.advanceTimersByTimeAsync(1_000); // backoff restarted at 1 s
    expect(times.slice(1).map((time, i) => time - times[i]!)).toEqual([
      1_000, 2_000, 60_000, 1_000,
    ]);
  });

  it('keeps other jobs running when one fails', async () => {
    const healthy = vi.fn();
    scheduler.add({ id: 'bad', every: 1_000, run: () => Promise.reject(new Error('x')) });
    scheduler.add({ id: 'good', every: 1_000, run: healthy });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(healthy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('never overlaps two runs of the same job', async () => {
    let active = 0;
    let maxActive = 0;
    scheduler.add({
      id: 'slow',
      every: 100,
      run: async () => {
        maxActive = Math.max(maxActive, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        active--;
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(maxActive).toBe(1);
  });

  it('aborts a job that exceeds its timeout and records the error', async () => {
    let aborted = false;
    scheduler.add({
      id: 'hang',
      every: 60_000,
      timeoutMs: 2_000,
      run: ({ signal }) =>
        new Promise<void>(() => {
          signal.addEventListener('abort', () => (aborted = true));
        }),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(aborted).toBe(true);
    expect(jobRuns.latestPerJob()).toMatchObject([
      { jobId: 'hang', status: 'error', error: 'timed out after 2000 ms' },
    ]);
  });

  it('re-evaluates a dynamic interval after every run', async () => {
    let interval = 10_000;
    const times: number[] = [];
    scheduler.add({
      id: 'adaptive',
      every: () => interval,
      run: () => {
        times.push(Date.now());
        interval = 1_000; // e.g. a game just went live
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(times.slice(1).map((time, i) => time - times[i]!)).toEqual([1_000, 1_000, 1_000]);
  });

  it('survives an interval function that throws', async () => {
    const run = vi.fn();
    scheduler.add({
      id: 'bad-interval',
      every: () => {
        throw new Error('nope');
      },
      run,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runNow triggers a job outside its schedule and never rejects', async () => {
    const run = vi.fn().mockRejectedValue(new Error('bad'));
    scheduler.add({ id: 'manual', every: 60_000, run, runOnStart: false });
    await expect(scheduler.runNow('manual')).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    await expect(scheduler.runNow('unknown')).rejects.toThrow(/Unknown job/);
  });

  it('rejects duplicate job ids', () => {
    scheduler.add({ id: 'dup', every: 1_000, run: () => undefined });
    expect(() => scheduler.add({ id: 'dup', every: 1_000, run: () => undefined })).toThrow(
      /Duplicate/,
    );
  });

  it('starts a job added after start()', async () => {
    const run = vi.fn();
    scheduler.start();
    scheduler.add({ id: 'late-add', every: 1_000, run });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stop() prevents further runs, aborts in-flight work and waits for it', async () => {
    const run = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
    );
    scheduler.add({ id: 'stoppable', every: 1_000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stop() returns promptly for a job that ignores the abort signal and leaves no error behind', async () => {
    scheduler.add({
      id: 'deaf',
      every: 1_000,
      timeoutMs: 60_000,
      run: () => new Promise<void>(() => undefined),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.stop(); // would hang until the 60 s timeout without the abort race
    expect(jobRuns.latestPerJob()).toEqual([]);
  });
});
