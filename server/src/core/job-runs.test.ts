import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { createJobRuns, type JobRuns } from './job-runs.js';
import { CORE_MIGRATIONS_DIR, loadMigrationsFromDir, runMigrations } from './migrations.js';

describe('JobRuns', () => {
  let runs: JobRuns;

  beforeEach(() => {
    const db = openDb(':memory:');
    runMigrations(db, loadMigrationsFromDir(CORE_MIGRATIONS_DIR));
    runs = createJobRuns(db);
  });

  it('reports the latest run of each job', () => {
    runs.record({ jobId: 'games', startedAt: 1, finishedAt: 2, status: 'ok' });
    runs.record({ jobId: 'games', startedAt: 10, finishedAt: 11, status: 'error', error: 'boom' });
    runs.record({ jobId: 'news', startedAt: 5, finishedAt: 6, status: 'ok' });

    expect(runs.latestPerJob()).toEqual([
      { jobId: 'games', startedAt: 10, finishedAt: 11, status: 'error', error: 'boom' },
      { jobId: 'news', startedAt: 5, finishedAt: 6, status: 'ok', error: null },
    ]);
  });

  it('finds the last success even when newer runs failed', () => {
    runs.record({ jobId: 'games', startedAt: 1, finishedAt: 2, status: 'ok' });
    runs.record({ jobId: 'games', startedAt: 10, finishedAt: 11, status: 'error', error: 'x' });
    expect(runs.lastSuccess('games')?.startedAt).toBe(1);
    expect(runs.lastSuccess('unknown')).toBeUndefined();
  });

  it('rejects an invalid status at the database level', () => {
    expect(() =>
      runs.record({ jobId: 'g', startedAt: 1, finishedAt: 2, status: 'weird' as 'ok' }),
    ).toThrow();
  });

  it('prunes old runs', () => {
    runs.record({ jobId: 'g', startedAt: 1, finishedAt: 2, status: 'ok' });
    runs.record({ jobId: 'g', startedAt: 100, finishedAt: 101, status: 'ok' });
    expect(runs.prune(50)).toBe(1);
    expect(runs.latestPerJob()).toHaveLength(1);
  });
});
