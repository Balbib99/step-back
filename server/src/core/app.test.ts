import { configResponseSchema, healthResponseSchema } from '@step-back/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from './app.js';
import { loadConfig } from './config.js';
import type { AppModule } from './modules.js';

const baseEnv = { NODE_ENV: 'test', DB_PATH: ':memory:' };

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
});

async function build(modules: AppModule[] = [], env: Record<string, string> = {}) {
  const config = loadConfig({ ...baseEnv, ...env });
  app = await buildApp({
    config,
    modules,
    fetch: vi.fn(async () => {
      throw new Error('tests must not hit the network');
    }),
  });
  return app;
}

const demoModule = (overrides: Partial<AppModule> = {}): AppModule => ({
  id: 'demo',
  migrations: [{ id: 900, name: 'demo', sql: 'CREATE TABLE demo_items (id INTEGER PRIMARY KEY);' }],
  routes: (instance) => {
    instance.get('/demo', async () => ({ hello: 'world' }));
  },
  jobs: () => [{ id: 'demo:refresh', every: 60_000, run: () => undefined }],
  ...overrides,
});

describe('GET /api/health', () => {
  it('reports ok with no modules', async () => {
    const { server } = await build();
    const response = await server.inject('/api/health');
    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body).toMatchObject({ status: 'ok', modules: [], jobs: [] });
  });

  it('lists registered jobs as pending until they have run', async () => {
    const { server } = await build([demoModule()]);
    const body = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(body.modules).toEqual(['demo']);
    expect(body.jobs).toEqual([
      { id: 'demo:refresh', status: 'pending', lastRunAt: null, lastSuccessAt: null, error: null },
    ]);
    expect(body.status).toBe('ok');
  });

  it('turns degraded, with the error, when a job fails, while the server keeps answering 200', async () => {
    const failing = demoModule({
      jobs: () => [
        {
          id: 'demo:refresh',
          every: 60_000,
          run: () => {
            throw new Error('ESPN is down');
          },
        },
      ],
    });
    const { server, scheduler } = await build([failing]);
    await scheduler.runNow('demo:refresh');

    const response = await server.inject('/api/health');
    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe('degraded');
    expect(body.jobs[0]).toMatchObject({ status: 'error', error: 'ESPN is down' });
  });

  it('recovers to ok and keeps the last success time once the job works again', async () => {
    let fail = true;
    const flaky = demoModule({
      jobs: () => [
        {
          id: 'demo:refresh',
          every: 60_000,
          run: () => {
            if (fail) throw new Error('boom');
          },
        },
      ],
    });
    const { server, scheduler } = await build([flaky]);
    await scheduler.runNow('demo:refresh');
    fail = false;
    await scheduler.runNow('demo:refresh');

    const body = healthResponseSchema.parse((await server.inject('/api/health')).json());
    expect(body.status).toBe('ok');
    expect(body.jobs[0]?.lastSuccessAt).not.toBeNull();
    expect(body.jobs[0]?.error).toBeNull();
  });
});

describe('GET /api/config', () => {
  it('returns the display settings and favourites from the environment', async () => {
    const { server } = await build([], { FAVORITE_TEAMS: 'MIN,LAL,PHI' });
    const body = configResponseSchema.parse((await server.inject('/api/config')).json());
    expect(body).toEqual({
      timeZone: 'Europe/Madrid',
      favoriteTeams: ['MIN', 'LAL', 'PHI'],
      features: { translation: false, push: false },
      vapidPublicKey: null,
      modules: [],
    });
  });

  it('enables features from configured keys and never leaks the secrets', async () => {
    const { server } = await build([], {
      DEEPL_API_KEY: 'deepl-secret-key',
      VAPID_PUBLIC_KEY: 'public-vapid-key',
      VAPID_PRIVATE_KEY: 'private-vapid-secret',
      VAPID_SUBJECT: 'mailto:me@example.com',
    });
    const response = await server.inject('/api/config');
    const body = configResponseSchema.parse(response.json());
    expect(body.features).toEqual({ translation: true, push: true });
    expect(body.vapidPublicKey).toBe('public-vapid-key');
    expect(response.body).not.toContain('deepl-secret-key');
    expect(response.body).not.toContain('private-vapid-secret');
  });
});

describe('module registration', () => {
  it('mounts module routes under /api', async () => {
    const { server } = await build([demoModule()]);
    const response = await server.inject('/api/demo');
    expect(response.json()).toEqual({ hello: 'world' });
  });

  it('applies module migrations alongside the core ones', async () => {
    const { db } = await build([demoModule()]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(['kv_cache', 'job_runs', 'demo_items']));
  });

  it('hands every module the shared context', async () => {
    let seen: unknown;
    await build([
      demoModule({
        routes: (_instance, context) => {
          seen = context;
        },
      }),
    ]);
    expect(seen).toMatchObject({
      config: expect.any(Object),
      db: expect.any(Object),
      cache: expect.any(Object),
      http: expect.any(Object),
      jobRuns: expect.any(Object),
    });
  });

  it('rejects two modules with the same id', async () => {
    await expect(build([demoModule(), demoModule()])).rejects.toThrow(/Duplicate module id/);
  });

  it('rejects two modules whose migrations share an id', async () => {
    const clash = demoModule({ id: 'other' });
    await expect(build([demoModule(), clash])).rejects.toThrow(/Duplicate migration id/);
  });

  it('answers unknown routes with a JSON 404', async () => {
    const { server } = await build();
    const response = await server.inject('/api/nope');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('hides internal error details from clients', async () => {
    const { server } = await build([
      demoModule({
        routes: (instance) => {
          instance.get('/boom', async () => {
            throw new Error('database password is hunter2');
          });
        },
      }),
    ]);
    const response = await server.inject('/api/boom');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('hunter2');
    expect(response.json()).toMatchObject({ error: 'internal_error' });
  });
});
