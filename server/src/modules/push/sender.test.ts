import type { Game, NewsItem } from '@step-back/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { openDb } from '../../core/db.js';
import type { Logger } from '../../core/logger.js';
import { runMigrations } from '../../core/migrations.js';
import { game, TIP_OFF } from './fixtures.js';
import { messageFor } from './messages.js';
import { PUSH_MIGRATIONS } from './push-migrations.js';
import { createPushRepo, type PushRepo } from './repo.js';
import { createDispatcher, type PushProvider } from './sender.js';

const MINUTE = 60_000;

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const subscription = (n: number) => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: `p${n}`, auth: `a${n}` },
});

class Gone extends Error {
  constructor(readonly statusCode: number) {
    super(`push service answered ${statusCode}`);
  }
}

/** A push service in memory: records what it was asked to deliver and fails where told to. */
function fakeProvider(failures: Record<string, Error> = {}) {
  const sent: { endpoint: string; title: string; url: string; ttl: number }[] = [];
  const provider: PushProvider = {
    send: async (subscription, payload, ttl) => {
      const failure = failures[subscription.endpoint];
      if (failure) throw failure;
      sent.push({ endpoint: subscription.endpoint, title: payload.title, url: payload.url, ttl });
    },
  };
  return { provider, sent, failures };
}

describe('the dispatcher', () => {
  let db: ReturnType<typeof openDb>;
  let repo: PushRepo;
  let clock: number;
  let games: Game[];
  let news: NewsItem[];

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...PUSH_MIGRATIONS]);
    repo = createPushRepo(db, ['MIN', 'LAL', 'PHI'], () => clock);
    clock = TIP_OFF - 20 * MINUTE;
    games = [game()];
    news = [];
    repo.saveSubscription(subscription(1));
  });

  /** A dispatcher over the same database: building a new one is what a restart does. */
  const dispatcherWith = (provider: PushProvider) =>
    createDispatcher({
      repo,
      games: (from, to) => games.filter((g) => g.startUtc >= from && g.startUtc < to),
      news: () => news,
      provider,
      favorites: ['MIN', 'LAL', 'PHI'],
      prioritySources: new Set(['espn']),
      sourceName: () => 'ESPN',
      timeZone: 'Europe/Madrid',
      logger,
      now: () => clock,
    });

  it('sends the reminder, the start and the end of a game, each once, in order', async () => {
    const { provider, sent } = fakeProvider();
    const dispatcher = dispatcherWith(provider);

    await dispatcher.run(); // 20 min before
    clock = TIP_OFF + MINUTE;
    games = [game({ status: 'live' })];
    await dispatcher.run();
    clock = TIP_OFF + 3 * 60 * MINUTE;
    games = [game({ status: 'final' })];
    await dispatcher.run();

    expect(sent.map((s) => s.title)).toEqual([
      'MIN @ LAL · en 30 min',
      '¡Empieza! MIN @ LAL',
      'Final: MIN - – - LAL',
    ]);
  });

  it('does not repeat a notification when it runs again, nor after a restart', async () => {
    const { provider, sent } = fakeProvider();
    await dispatcherWith(provider).run();
    await dispatcherWith(provider).run();
    clock += 5 * MINUTE;
    await dispatcherWith(provider).run();
    expect(sent).toHaveLength(1);
  });

  it('opens the game: the notification carries its address', async () => {
    const { provider, sent } = fakeProvider();
    await dispatcherWith(provider).run();
    expect(sent[0]!.url).toBe('/partido/1001');
  });

  it('sends the reminder with a short life and the result with a long one', async () => {
    const { provider, sent } = fakeProvider();
    const dispatcher = dispatcherWith(provider);
    await dispatcher.run();
    clock = TIP_OFF + 3 * 60 * MINUTE;
    games = [game({ status: 'final' })];
    await dispatcher.run();
    expect(sent.map((s) => s.ttl)).toEqual([15 * 60, 6 * 60 * 60]);
  });

  it('sends to every browser', async () => {
    repo.saveSubscription(subscription(2));
    const { provider, sent } = fakeProvider();
    const result = await dispatcherWith(provider).run();
    expect(sent.map((s) => s.endpoint)).toEqual([
      'https://push.example/1',
      'https://push.example/2',
    ]);
    expect(result).toEqual({ events: 1, delivered: 2, removed: 0 });
  });

  it('removes a subscription the push service says is gone, and still reaches the rest', async () => {
    repo.saveSubscription(subscription(2));
    repo.saveSubscription(subscription(3));
    const { provider, sent } = fakeProvider({
      'https://push.example/1': new Gone(410),
      'https://push.example/2': new Gone(404),
    });
    const result = await dispatcherWith(provider).run();

    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/3']);
    expect(repo.subscriptions().map((s) => s.endpoint)).toEqual(['https://push.example/3']);
    expect(result.removed).toBe(2);
  });

  it('keeps a subscription whose delivery failed for another reason, and reaches the rest', async () => {
    repo.saveSubscription(subscription(2));
    const { provider, sent } = fakeProvider({ 'https://push.example/1': new Gone(500) });
    await dispatcherWith(provider).run();

    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/2']);
    expect(repo.subscriptions()).toHaveLength(2);
    // It was delivered somewhere, so it is not tried again: no repeats for the browser that got it.
    expect((await dispatcherWith(provider).run()).events).toBe(0);
  });

  it('tries again on the next run when nobody could be reached', async () => {
    const down = fakeProvider({ 'https://push.example/1': new Gone(503) });
    const first = await dispatcherWith(down.provider).run();
    expect(first.delivered).toBe(0);

    const up = fakeProvider();
    clock += 30_000;
    await dispatcherWith(up.provider).run();
    expect(up.sent).toHaveLength(1);
  });

  it('does not store a notification for later when there is no browser yet', async () => {
    repo.deleteSubscription('https://push.example/1');
    const { provider, sent } = fakeProvider();
    await dispatcherWith(provider).run();
    repo.saveSubscription(subscription(2));
    await dispatcherWith(provider).run();
    // The reminder was for a moment that passed with nobody to tell: it is not sent late.
    expect(sent).toEqual([]);
  });

  it('stops the alerts of a team when it is turned off in the settings', async () => {
    repo.saveSettings([
      { team: 'MIN', start: false, end: false, reminderMinutes: 0, news: false },
      { team: 'LAL', start: false, end: false, reminderMinutes: 0, news: false },
    ]);
    const { provider, sent } = fakeProvider();
    const dispatcher = dispatcherWith(provider);
    await dispatcher.run();
    clock = TIP_OFF + MINUTE;
    games = [game({ status: 'live' })];
    await dispatcher.run();
    expect(sent).toEqual([]);
  });

  it('says nothing about games of teams nobody asked for', async () => {
    games = [game({}, 'DEN', 'GS')];
    const { provider, sent } = fakeProvider();
    await dispatcherWith(provider).run();
    clock = TIP_OFF + MINUTE;
    games = [game({ status: 'live' }, 'DEN', 'GS')];
    await dispatcherWith(provider).run();
    expect(sent).toEqual([]);
  });

  it('tells the start and the end of a team that is not a favourite once it is asked', async () => {
    repo.saveSettings([{ team: 'DEN', start: true, end: true, reminderMinutes: 0, news: false }]);
    const { provider, sent } = fakeProvider();
    const dispatcher = dispatcherWith(provider);

    games = [game({}, 'DEN', 'GS')];
    await dispatcher.run(); // no reminder asked
    clock = TIP_OFF + MINUTE;
    games = [game({ status: 'live' }, 'DEN', 'GS')];
    await dispatcher.run();
    await dispatcher.run();
    clock = TIP_OFF + 3 * 60 * MINUTE;
    games = [game({ status: 'final' }, 'DEN', 'GS')];
    await dispatcher.run();

    expect(sent.map((s) => s.title)).toEqual(['¡Empieza! DEN @ GS', 'Final: DEN - – - GS']);
  });

  describe('featured news', () => {
    const story = (id: number, extra: Partial<NewsItem> = {}): NewsItem => ({
      id,
      sourceId: 'espn',
      sourceName: 'ESPN',
      url: `https://www.espn.com/story/${id}`,
      title: `Titular ${id}`,
      summary: null,
      lang: 'en',
      publishedAt: new Date(clock - 10 * MINUTE).toISOString(),
      mediaKind: 'none',
      imageUrl: null,
      embedUrl: null,
      durationSeconds: null,
      teams: ['MIN'],
      players: [],
      ...extra,
    });
    const newsOn = () =>
      repo.saveSettings([{ team: 'MIN', start: true, end: true, reminderMinutes: 0, news: true }]);

    beforeEach(() => {
      games = [];
    });

    it('is not sent unless the team has it on', async () => {
      news = [story(1)];
      const { provider, sent } = fakeProvider();
      await dispatcherWith(provider).run();
      expect(sent).toEqual([]);
    });

    it('sends the title once, and opens the news of the team', async () => {
      newsOn();
      news = [story(1)];
      const { provider, sent } = fakeProvider();
      await dispatcherWith(provider).run();
      await dispatcherWith(provider).run();
      expect(sent).toEqual([
        {
          endpoint: 'https://push.example/1',
          title: 'Titular 1',
          url: '/noticias?equipo=MIN',
          ttl: 7200,
        },
      ]);
    });

    it('sends at most five a day, then more the next day', async () => {
      newsOn();
      news = [1, 2, 3, 4, 5, 6, 7].map((id) => story(id));
      const { provider, sent } = fakeProvider();
      await dispatcherWith(provider).run();
      expect(sent).toHaveLength(5);

      clock += 25 * 60 * MINUTE; // the next day: only fresh items are sent
      news = [story(8)];
      await dispatcherWith(provider).run();
      expect(sent).toHaveLength(6);
    });

    it('does not use up the day on items that were already sent', async () => {
      newsOn();
      const { provider, sent } = fakeProvider();
      news = [story(1)];
      await dispatcherWith(provider).run();
      news = [story(1), story(2)];
      await dispatcherWith(provider).run();
      expect(sent.map((s) => s.title)).toEqual(['Titular 1', 'Titular 2']);
    });
  });
});

describe('the text of a notification', () => {
  const at = (extra = {}) => game({ ...extra });

  it('gives the local time of the tip-off in the reminder', () => {
    const message = messageFor(
      { key: 'reminder:1001', kind: 'reminder', game: at(), reminderMinutes: 30 },
      'Europe/Madrid',
    );
    expect(message.body).toContain('03:30'); // 01:30 UTC is 03:30 in Madrid in October
  });

  it('gives the score and the winner in the final', () => {
    const final = game({
      status: 'final',
      away: { ...game().away, score: 104, winner: true, name: 'Minnesota Timberwolves' },
      home: { ...game().home, score: 99, winner: false },
    });
    const message = messageFor(
      { key: 'end:1001', kind: 'end', game: final, reminderMinutes: 30 },
      'Europe/Madrid',
    );
    expect(message.title).toBe('Final: MIN 104 – 99 LAL');
    expect(message.body).toBe('Gana Minnesota Timberwolves.');
  });
});
