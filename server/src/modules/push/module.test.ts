import { pushSettingsSchema } from '@step-back/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { buildApp, type App } from '../../core/app.js';
import { loadConfig } from '../../core/config.js';
import { gamesModule } from '../games/index.js';
import { createGamesRepo } from '../games/repo.js';
import { game, TIP_OFF } from './fixtures.js';
import { createPushModule, PUSH_JOB_ID } from './index.js';
import type { PushProvider } from './sender.js';

const MINUTE = 60_000;

let app: App | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await app?.server.close();
  app = undefined;
});

const vapidEnv = () => {
  const keys = webpush.generateVAPIDKeys();
  return {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'mailto:owner@example.com',
  };
};

async function build(options: { push?: boolean; provider?: PushProvider } = {}) {
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      ...(options.push === false ? {} : vapidEnv()),
    }),
    modules: [
      gamesModule,
      createPushModule(options.provider ? { provider: options.provider } : {}),
    ],
  });
  return app;
}

const subscription = (n = 1) => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: `p${n}`, auth: `a${n}` },
});

describe('push routes', () => {
  it('stores a subscription and removes it', async () => {
    const { server, db } = await build();
    const count = () =>
      (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;

    const created = await server.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: subscription(),
    });
    expect(created.statusCode).toBe(201);
    expect(count()).toBe(1);

    // The same browser again (the app does this each time it is opened): no duplicate.
    await server.inject({ method: 'POST', url: '/api/push/subscribe', payload: subscription() });
    expect(count()).toBe(1);

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/push/subscribe',
      payload: { endpoint: subscription().endpoint },
    });
    expect(removed.statusCode).toBe(200);
    expect(count()).toBe(0);
  });

  it('refuses a subscription that is malformed or not over HTTPS', async () => {
    const { server } = await build();
    const post = (payload: unknown) =>
      server.inject({ method: 'POST', url: '/api/push/subscribe', payload: payload as object });

    expect((await post({ endpoint: 'https://push.example/1' })).statusCode).toBe(400);
    expect(
      (await post({ endpoint: 'not a url', keys: { p256dh: 'p', auth: 'a' } })).statusCode,
    ).toBe(400);
    expect(
      (await post({ endpoint: 'http://push.example/1', keys: { p256dh: 'p', auth: 'a' } }))
        .statusCode,
    ).toBe(400);
  });

  it('serves settings for each favourite with defaults, and keeps what is changed', async () => {
    const { server } = await build();
    const first = pushSettingsSchema.parse((await server.inject('/api/push/settings')).json());
    expect(first.teams.map((t) => t.team)).toEqual(['MIN', 'LAL', 'PHI']);
    expect(first.teams[0]).toEqual({ team: 'MIN', start: true, end: true, reminderMinutes: 30 });

    const updated = await server.inject({
      method: 'PUT',
      url: '/api/push/settings',
      payload: { teams: [{ team: 'LAL', start: false, end: true, reminderMinutes: 0 }] },
    });
    expect(updated.statusCode).toBe(200);

    const after = pushSettingsSchema.parse((await server.inject('/api/push/settings')).json());
    expect(after.teams.find((t) => t.team === 'LAL')).toEqual({
      team: 'LAL',
      start: false,
      end: true,
      reminderMinutes: 0,
    });
    expect(after.teams.find((t) => t.team === 'MIN')?.start).toBe(true); // untouched
  });

  it('refuses settings for a team that is not a favourite, or a reminder that is not offered', async () => {
    const { server } = await build();
    const put = (teams: unknown[]) =>
      server.inject({ method: 'PUT', url: '/api/push/settings', payload: { teams } });
    const ok = { start: true, end: true, reminderMinutes: 30 };

    expect((await put([{ team: 'BOS', ...ok }])).statusCode).toBe(400);
    expect((await put([{ team: 'MIN', ...ok, reminderMinutes: 7 }])).statusCode).toBe(400);
    expect(
      (
        await put([
          { team: 'MIN', ...ok },
          { team: 'MIN', ...ok },
        ])
      ).statusCode,
    ).toBe(400);
  });

  it('answers 503 when the server has no VAPID keys, and schedules nothing', async () => {
    const { server, scheduler } = await build({ push: false });
    for (const request of [
      { method: 'GET' as const, url: '/api/push/settings' },
      { method: 'POST' as const, url: '/api/push/subscribe', payload: subscription() },
    ]) {
      const response = await server.inject(request);
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe('push_disabled');
    }
    expect(scheduler.jobIds()).not.toContain(PUSH_JOB_ID);
  });
});

describe('the test notification', () => {
  const post = (server: App['server'], endpoint: string) =>
    server.inject({ method: 'POST', url: '/api/push/test', payload: { endpoint } });
  const subscribe = (server: App['server'], n: number) =>
    server.inject({ method: 'POST', url: '/api/push/subscribe', payload: subscription(n) });
  const failing = (statusCode: number): PushProvider => ({
    send: async () => {
      throw Object.assign(new Error('push service refused'), { statusCode });
    },
  });
  const count = (db: App['db']) =>
    (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;

  it('sends one notification to the device that asks, and to no other', async () => {
    const sent: { endpoint: string; title: string }[] = [];
    const provider: PushProvider = {
      send: async (s, payload) => void sent.push({ endpoint: s.endpoint, title: payload.title }),
    };
    const { server } = await build({ provider });
    await subscribe(server, 1);
    await subscribe(server, 2);

    expect((await post(server, subscription(2).endpoint)).statusCode).toBe(200);
    expect(sent).toEqual([{ endpoint: subscription(2).endpoint, title: 'Notificación de prueba' }]);
  });

  it('says so when the device is not subscribed', async () => {
    const { server } = await build({ provider: { send: async () => undefined } });
    expect((await post(server, 'https://push.example/unknown')).statusCode).toBe(404);
  });

  it('drops a subscription the push service says is gone, and answers 410', async () => {
    const { server, db } = await build({ provider: failing(410) });
    await subscribe(server, 1);
    expect((await post(server, subscription().endpoint)).statusCode).toBe(410);
    expect(count(db)).toBe(0);
  });

  it('answers 502 when the push service fails, and keeps the subscription', async () => {
    const { server, db } = await build({ provider: failing(503) });
    await subscribe(server, 1);
    expect((await post(server, subscription().endpoint)).statusCode).toBe(502);
    expect(count(db)).toBe(1);
  });
});

describe('the push job', () => {
  it('sends the start of a favourite game once, however many times it runs', async () => {
    const sent: string[] = [];
    const provider: PushProvider = { send: async (_s, payload) => void sent.push(payload.title) };
    const { server, db, scheduler } = await build({ provider });
    await server.inject({ method: 'POST', url: '/api/push/subscribe', payload: subscription() });
    createGamesRepo(db).upsertGames([game({ status: 'live' })]);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TIP_OFF + 2 * MINUTE);
    await scheduler.runNow(PUSH_JOB_ID);
    await scheduler.runNow(PUSH_JOB_ID);
    vi.setSystemTime(TIP_OFF + 5 * MINUTE);
    await scheduler.runNow(PUSH_JOB_ID);

    expect(sent).toEqual(['¡Empieza! MIN @ LAL']);
  });

  it('is part of the health report', async () => {
    const provider: PushProvider = { send: async () => undefined };
    const { server } = await build({ provider });
    const health = (await server.inject('/api/health')).json();
    expect(health.jobs.map((j: { id: string }) => j.id)).toContain(PUSH_JOB_ID);
  });
});
