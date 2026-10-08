import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from './app.js';
import { backupDatabase } from './backup.js';
import { CLEANUP_JOB_ID, cleanupModule } from './cleanup.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createJobRuns } from './job-runs.js';
import { CORE_MIGRATIONS } from './core-migrations.js';
import { runMigrations } from './migrations.js';
import { CONTENT_SECURITY_POLICY } from './security-headers.js';

const DAY = 24 * 60 * 60_000;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'step-back-housekeeping-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('pruning the job history', () => {
  it('keeps the latest run and the latest success of each job, however old', () => {
    const db = openDb(':memory:');
    runMigrations(db, CORE_MIGRATIONS);
    const runs = createJobRuns(db);
    const run = (jobId: string, at: number, status: 'ok' | 'error') =>
      runs.record({ jobId, startedAt: at, finishedAt: at + 1, status });

    // A weekly job that succeeded long ago and has failed since.
    run('weekly', 1, 'ok');
    run('weekly', 2, 'ok');
    run('weekly', 3, 'error');
    // A busy job with plenty of history.
    for (let at = 10; at < 20; at++) run('busy', at, 'ok');

    expect(runs.prune(1_000)).toBe(1 + 9);
    expect(runs.lastSuccess('weekly')?.startedAt).toBe(2);
    expect(runs.latestPerJob().map((r) => [r.jobId, r.status])).toEqual([
      ['busy', 'ok'],
      ['weekly', 'error'],
    ]);
  });

  it('leaves recent runs alone', () => {
    const db = openDb(':memory:');
    runMigrations(db, CORE_MIGRATIONS);
    const runs = createJobRuns(db);
    for (let at = 10; at < 15; at++) {
      runs.record({ jobId: 'busy', startedAt: at, finishedAt: at, status: 'ok' });
    }
    expect(runs.prune(5)).toBe(0);
  });
});

describe('the cleanup job', () => {
  let app: App | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await app?.server.close();
    app = undefined;
  });

  it('deletes old job runs and expired cache entries, and keeps what is still good', async () => {
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
      modules: [cleanupModule],
    });
    const { db, context, scheduler } = app;
    const now = Date.now();
    const old = now - 15 * DAY;
    for (let i = 0; i < 5; i++) {
      context.jobRuns.record({
        jobId: 'busy',
        startedAt: old + i,
        finishedAt: old + i,
        status: 'ok',
      });
      context.jobRuns.record({
        jobId: 'busy',
        startedAt: now - i - 1,
        finishedAt: now,
        status: 'ok',
      });
    }
    context.cache.set('good', 1, 3600);
    context.cache.set('forever', 2);
    db.prepare(
      "INSERT INTO kv_cache (key, value, fetched_at, ttl_s) VALUES ('expired', '3', ?, 60)",
    ).run(now - DAY);

    await scheduler.runNow(CLEANUP_JOB_ID);

    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(
      count(
        "SELECT COUNT(*) AS n FROM job_runs WHERE job_id = 'busy' AND started_at < " + (now - DAY),
      ),
    ).toBe(0);
    // The 5 recent ones, plus this job's own run.
    expect(count("SELECT COUNT(*) AS n FROM job_runs WHERE job_id = 'busy'")).toBe(5);
    expect(context.cache.get('expired')).toBeUndefined();
    expect(context.cache.get('good')).toBeDefined();
    expect(context.cache.get('forever')).toBeDefined();
  });

  it('does not run when the server starts, only every day', async () => {
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
      modules: [cleanupModule],
    });
    expect(app.scheduler.jobIds()).toEqual([CLEANUP_JOB_ID]);
    expect(app.context.jobRuns.latestPerJob()).toEqual([]);
  });
});

describe('the backup', () => {
  /** A real database file with some data, as the server leaves it (WAL mode, still open). */
  function makeDatabase() {
    const path = join(dir, 'step-back.db');
    const db = openDb(path);
    runMigrations(db, CORE_MIGRATIONS);
    db.prepare(
      "INSERT INTO kv_cache (key, value, fetched_at) VALUES ('a', '1', 1), ('b', '2', 2)",
    ).run();
    return { path, db };
  }

  it('copies a database that is open and being written, with all its data', async () => {
    const { path, db } = makeDatabase();
    const copy = join(dir, 'copy.db');

    const result = await backupDatabase(path, copy);

    expect(result.tables).toBeGreaterThanOrEqual(2);
    const restored = openDb(copy);
    expect(restored.prepare('SELECT key FROM kv_cache ORDER BY key').all()).toEqual([
      { key: 'a' },
      { key: 'b' },
    ]);
    restored.close();
    db.close();
  });

  it('can be restored: the app starts on the copy and finds its data and its migrations', async () => {
    const { path, db } = makeDatabase();
    const copy = join(dir, 'copy.db');
    await backupDatabase(path, copy);
    db.close();
    rmSync(path);

    // What deploy/restore.sh does: put the copy where the database was.
    const restoredPath = join(dir, 'restored.db');
    copyFileSync(copy, restoredPath);
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DB_PATH: restoredPath }),
      modules: [cleanupModule],
    });
    try {
      expect(app.context.cache.get('a')).toMatchObject({ value: 1 });
      expect((await app.server.inject('/api/health')).statusCode).toBe(200);
    } finally {
      await app.server.close();
    }
  });

  it('refuses to overwrite a file, and to back up a database that is not there', async () => {
    const { path, db } = makeDatabase();
    const copy = join(dir, 'copy.db');
    writeFileSync(copy, 'precious');
    await expect(backupDatabase(path, copy)).rejects.toThrow(/already exists/);
    await expect(backupDatabase(join(dir, 'missing.db'), join(dir, 'x.db'))).rejects.toThrow(
      /no database/,
    );
    expect(existsSync(join(dir, 'x.db'))).toBe(false);
    db.close();
  });
});

describe('security headers', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.server.close();
    app = undefined;
  });

  it('are on API answers, missing pages and errors alike', async () => {
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }) });
    for (const url of ['/api/health', '/api/nothing-here']) {
      const { headers } = await app.server.inject(url);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
    }
  });

  it('allow nothing but the app itself and the YouTube player', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain('frame-src https://www.youtube-nocookie.com');
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/\*/);
  });
});

describe('requests from other sites', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.server.close();
    app = undefined;
  });

  const build = async () => {
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
      modules: [
        {
          id: 'demo',
          routes: (instance) => {
            instance.post('/demo', async () => ({ changed: true }));
            instance.get('/demo', async () => ({ read: true }));
          },
        },
      ],
    });
    return app.server;
  };
  const post = (server: App['server'], headers: Record<string, string>) =>
    server.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { host: 'step-back.test', ...headers },
    });

  it('cannot change anything: a page of another site is refused', async () => {
    const server = await build();
    const refused = await post(server, { origin: 'https://evil.example' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('cross_origin');
    expect((await post(server, { origin: 'null' })).statusCode).toBe(403);
    // Same name, other port or scheme, is another site too.
    expect((await post(server, { origin: 'https://step-back.test:8443' })).statusCode).toBe(403);
  });

  it('the app itself, and tools that send no origin, can', async () => {
    const server = await build();
    expect((await post(server, { origin: 'https://step-back.test' })).statusCode).toBe(200);
    expect((await post(server, {})).statusCode).toBe(200);
  });

  it('reading is not restricted', async () => {
    const server = await build();
    const read = await server.inject({
      url: '/api/demo',
      headers: { host: 'step-back.test', origin: 'https://evil.example' },
    });
    expect(read.statusCode).toBe(200);
  });
});
