import type { TeamPushSettings } from '@step-back/shared';
import { describe, expect, it } from 'vitest';
import { detectEvents } from './detector.js';
import { game, side, TIP_OFF } from './fixtures.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const settings = (team: string, extra: Partial<TeamPushSettings> = {}): TeamPushSettings => ({
  team,
  start: true,
  end: true,
  reminderMinutes: 30,
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
