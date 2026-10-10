import type { NewsItem, TeamPushSettings } from '@step-back/shared';
import { describe, expect, it } from 'vitest';
import { detectEvents, detectNews } from './detector.js';
import { game, side, TIP_OFF } from './fixtures.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const settings = (team: string, extra: Partial<TeamPushSettings> = {}): TeamPushSettings => ({
  team,
  start: true,
  end: true,
  reminderMinutes: 30,
  news: false,
  live: false,
  ...extra,
});

const kinds = (events: ReturnType<typeof detectEvents>) => events.map((e) => e.key);

describe('detectEvents', () => {
  describe('reminder', () => {
    it('is due inside the chosen minutes before tip-off, not before', () => {
      const s = [settings('MIN')];
      expect(kinds(detectEvents([game()], s, TIP_OFF - 31 * MINUTE))).toEqual([]);
      expect(kinds(detectEvents([game()], s, TIP_OFF - 30 * MINUTE))).toEqual(['reminder:1001']);
      expect(kinds(detectEvents([game()], s, TIP_OFF - 1 * MINUTE))).toEqual(['reminder:1001']);
    });

    it('is not sent once the game should have started', () => {
      expect(kinds(detectEvents([game()], [settings('MIN')], TIP_OFF))).toEqual([]);
    });

    it('is off with 0 minutes', () => {
      const s = [settings('MIN', { reminderMinutes: 0 })];
      expect(detectEvents([game()], s, TIP_OFF - 10 * MINUTE)).toEqual([]);
    });
  });

  describe('start', () => {
    it('is due while the game is live', () => {
      const live = game({ status: 'live' });
      expect(kinds(detectEvents([live], [settings('MIN')], TIP_OFF + 2 * MINUTE))).toEqual([
        'start:1001',
      ]);
    });

    it('is no longer news an hour after tip-off', () => {
      const live = game({ status: 'live' });
      expect(detectEvents([live], [settings('MIN')], TIP_OFF + 61 * MINUTE)).toEqual([]);
    });

    it('is off when the team has it off', () => {
      const live = game({ status: 'live' });
      expect(detectEvents([live], [settings('MIN', { start: false })], TIP_OFF + MINUTE)).toEqual(
        [],
      );
    });
  });

  describe('end', () => {
    const final = game({
      status: 'final',
      away: side('MIN', 104, true),
      home: side('LAL', 99, false),
    });

    it('is due once the game is final', () => {
      expect(kinds(detectEvents([final], [settings('MIN')], TIP_OFF + 3 * HOUR))).toEqual([
        'end:1001',
      ]);
    });

    it('is not sent for a result that is hours old', () => {
      expect(detectEvents([final], [settings('MIN')], TIP_OFF + 9 * HOUR)).toEqual([]);
    });

    it('is off when the team has it off', () => {
      expect(detectEvents([final], [settings('MIN', { end: false })], TIP_OFF + 3 * HOUR)).toEqual(
        [],
      );
    });
  });

  describe('live score', () => {
    const playing = (away: number | null, home: number | null, period: number | null = 1) =>
      game({
        status: 'live',
        period,
        away: side('MIN', away),
        home: side('LAL', home),
      });
    const liveOn = [settings('MIN', { start: false, end: false, live: true })];

    it('is due while a game of a team with it on is live', () => {
      const events = detectEvents([playing(21, 18)], liveOn, TIP_OFF + 10 * MINUTE);
      expect(events).toMatchObject([{ kind: 'live', key: 'live:1001:21-18:1' }]);
    });

    it('is a new event with every change of the score or of the period, and the same one otherwise', () => {
      const key = (g: ReturnType<typeof playing>) =>
        detectEvents([g], liveOn, TIP_OFF + 10 * MINUTE)[0]!.key;
      expect(key(playing(21, 18))).toBe(key(playing(21, 18)));
      expect(key(playing(23, 18))).not.toBe(key(playing(21, 18)));
      expect(key(playing(21, 18, 2))).not.toBe(key(playing(21, 18, 1)));
    });

    it('goes with the start of the game, which is its own event', () => {
      const s = [settings('MIN', { live: true })];
      expect(kinds(detectEvents([playing(0, 0)], s, TIP_OFF + MINUTE))).toEqual([
        'start:1001',
        'live:1001:0-0:1',
      ]);
    });

    it('is off with the team setting off, and for a game nobody followed', () => {
      const off = [settings('MIN', { live: false })];
      const events = detectEvents([playing(21, 18)], off, TIP_OFF + 10 * MINUTE);
      expect(events.filter((e) => e.kind === 'live')).toEqual([]);
    });

    it('is on for a game followed one by one, whatever its teams ask', () => {
      const other = game({
        status: 'live',
        period: 2,
        away: side('DEN', 40),
        home: side('GS', 38),
      });
      const none = [settings('DEN', { start: false, end: false, live: false })];
      const events = detectEvents([other], none, TIP_OFF + 30 * MINUTE, new Set(['1001']));
      expect(kinds(events)).toEqual(['live:1001:40-38:2']);
    });

    it('is never for a game that has not started, is over, or has no score yet', () => {
      const at = TIP_OFF + 10 * MINUTE;
      const live = (events: ReturnType<typeof detectEvents>) =>
        events.filter((e) => e.kind === 'live');
      expect(live(detectEvents([game()], liveOn, TIP_OFF - 5 * MINUTE))).toEqual([]);
      const final = game({ status: 'final', away: side('MIN', 99), home: side('LAL', 98) });
      expect(live(detectEvents([final], liveOn, TIP_OFF + 3 * HOUR))).toEqual([]);
      expect(live(detectEvents([playing(null, null)], liveOn, at))).toEqual([]);
    });

    it('is dropped for a game whose status has been stuck on live for hours', () => {
      expect(detectEvents([playing(50, 48)], liveOn, TIP_OFF + 7 * HOUR)).toEqual([]);
    });
  });

  it('ignores games of teams without settings', () => {
    const other = game({ status: 'live' }, 'DEN', 'GS');
    expect(detectEvents([other], [settings('MIN')], TIP_OFF + MINUTE)).toEqual([]);
  });

  it('gives one event for a game between two favourites', () => {
    const live = game({ status: 'live' });
    const events = detectEvents([live], [settings('MIN'), settings('LAL')], TIP_OFF + MINUTE);
    expect(kinds(events)).toEqual(['start:1001']);
  });

  it('tells about a game when only one of its two favourites asks for it', () => {
    const live = game({ status: 'live' });
    const s = [settings('MIN', { start: false }), settings('LAL')];
    expect(kinds(detectEvents([live], s, TIP_OFF + MINUTE))).toEqual(['start:1001']);
  });

  it('uses the longest reminder asked for by the teams of a game', () => {
    const s = [settings('MIN', { reminderMinutes: 15 }), settings('LAL', { reminderMinutes: 60 })];
    expect(kinds(detectEvents([game()], s, TIP_OFF - 45 * MINUTE))).toEqual(['reminder:1001']);
  });

  it('says nothing about postponed or canceled games', () => {
    for (const status of ['postponed', 'canceled'] as const) {
      expect(detectEvents([game({ status })], [settings('MIN')], TIP_OFF - 10 * MINUTE)).toEqual(
        [],
      );
    }
  });
});

describe('detectNews', () => {
  const NOW = Date.parse('2026-10-08T12:00:00Z');
  const FAVORITES = ['MIN', 'LAL', 'PHI'];
  const PRIORITY = new Set(['espn']);

  const item = (id: number, extra: Partial<NewsItem> = {}): NewsItem => ({
    id,
    sourceId: 'espn',
    sourceName: 'ESPN',
    url: `https://www.espn.com/story/${id}`,
    title: `Titular ${id}`,
    summary: null,
    lang: 'en',
    publishedAt: new Date(NOW - 10 * MINUTE).toISOString(),
    mediaKind: 'none',
    imageUrl: null,
    embedUrl: null,
    durationSeconds: null,
    short: false,
    teams: ['MIN'],
    players: [],
    ...extra,
  });
  const on = [settings('MIN', { news: true })];
  const due = (items: NewsItem[], s = on) => detectNews(items, s, FAVORITES, PRIORITY, NOW);

  it('is due for a recent item of a priority source about a team with news on', () => {
    expect(due([item(1)]).map((e) => e.key)).toEqual(['news:1']);
  });

  it('is off by default and when the team has it off', () => {
    expect(due([item(1)], [settings('MIN')])).toEqual([]);
  });

  it('ignores sources that are not priority', () => {
    expect(due([item(1, { sourceId: 'reddit' })])).toEqual([]);
  });

  it('ignores items about other teams, and items about no team', () => {
    expect(due([item(1, { teams: ['BOS'] }), item(2, { teams: [] })])).toEqual([]);
  });

  it('is not sent once it is old, however recently it was stored', () => {
    const old = item(1, { publishedAt: new Date(NOW - 3 * HOUR).toISOString() });
    expect(due([old])).toEqual([]);
  });

  it('only counts favourites: news is not available for any other team', () => {
    const other = [settings('BOS', { news: true })];
    expect(due([item(1, { teams: ['BOS'] })], other)).toEqual([]);
  });

  it('names the teams that asked, and gives the oldest first', () => {
    const s = [settings('MIN', { news: true }), settings('LAL', { news: true })];
    const events = due(
      [
        item(2, { teams: ['LAL', 'MIN', 'BOS'] }),
        item(1, { publishedAt: new Date(NOW - 30 * MINUTE).toISOString() }),
      ],
      s,
    );
    expect(events.map((e) => e.key)).toEqual(['news:1', 'news:2']);
    expect(events[1]!.teams).toEqual(['LAL', 'MIN']);
  });
});
