import type { Migration } from './migrations.js';

/** Tables every module relies on. Migrations are TypeScript so a bundled build needs no extra files. */
export const CORE_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'core',
    sql: `
-- Core tables shared by every module.

-- Cache of external responses (and anything else with a time-to-live).
-- ttl_s NULL means "never expires on its own".
CREATE TABLE kv_cache (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL,
  ttl_s      INTEGER
);

-- One row per scheduled job execution; /api/health reads the latest per job.
CREATE TABLE job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('ok', 'error')),
  error       TEXT
);

CREATE INDEX job_runs_job_started ON job_runs (job_id, started_at DESC);
`,
  },
];
