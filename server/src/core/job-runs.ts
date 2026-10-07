import type { Db } from './db.js';

export interface JobRun {
  jobId: string;
  startedAt: number;
  finishedAt: number;
  status: 'ok' | 'error';
  error: string | null;
}

export interface JobRuns {
  record(run: Omit<JobRun, 'error'> & { error?: string }): void;
  /** Most recent run of each job. */
  latestPerJob(): JobRun[];
  /** Most recent successful run of a job, if any. */
  lastSuccess(jobId: string): JobRun | undefined;
  /** Deletes runs that started before `olderThan` (epoch ms); returns how many. */
  prune(olderThan: number): number;
}

interface Row {
  job_id: string;
  started_at: number;
  finished_at: number;
  status: 'ok' | 'error';
  error: string | null;
}

const toRun = (row: Row): JobRun => ({
  jobId: row.job_id,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  status: row.status,
  error: row.error,
});

export function createJobRuns(db: Db): JobRuns {
  const insert = db.prepare(
    'INSERT INTO job_runs (job_id, started_at, finished_at, status, error) VALUES (?, ?, ?, ?, ?)',
  );
  const latest = db.prepare(`
    SELECT job_id, started_at, finished_at, status, error FROM job_runs
    WHERE id IN (SELECT MAX(id) FROM job_runs GROUP BY job_id)
    ORDER BY job_id
  `);
  const success = db.prepare(`
    SELECT job_id, started_at, finished_at, status, error FROM job_runs
    WHERE job_id = ? AND status = 'ok' ORDER BY id DESC LIMIT 1
  `);
  const prune = db.prepare('DELETE FROM job_runs WHERE started_at < ?');

  return {
    record(run) {
      insert.run(run.jobId, run.startedAt, run.finishedAt, run.status, run.error ?? null);
    },
    latestPerJob() {
      return (latest.all() as Row[]).map(toRun);
    },
    lastSuccess(jobId) {
      const row = success.get(jobId) as Row | undefined;
      return row ? toRun(row) : undefined;
    },
    prune(olderThan) {
      return prune.run(olderThan).changes;
    },
  };
}
