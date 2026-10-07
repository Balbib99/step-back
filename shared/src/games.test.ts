import { describe, expect, it } from 'vitest';
import { gameSchema, seasonLabel } from './games.js';

describe('seasonLabel', () => {
  it('turns the ending year into the usual label', () => {
    expect(seasonLabel(2027)).toBe('2026-27');
    expect(seasonLabel(2000)).toBe('1999-00');
  });
});

describe('gameSchema', () => {
  const side = {
    teamId: '1',
    abbr: 'ATL',
    name: 'Atlanta Hawks',
    score: null,
    record: null,
    winner: null,
    linescores: [],
  };
  const game = {
    id: '1',
    season: 2027,
    seasonType: 'preseason',
    startUtc: '2026-10-08T23:00:00.000Z',
    status: 'scheduled',
    statusDetail: '10/8 - 7:00 PM EDT',
    period: null,
    clock: null,
    venue: null,
    home: side,
    away: { ...side, teamId: '2', abbr: 'BOS', name: 'Boston Celtics' },
  };

  it('accepts a scheduled game and rejects unknown statuses', () => {
    expect(gameSchema.parse(game)).toEqual(game);
    expect(() => gameSchema.parse({ ...game, status: 'delayed' })).toThrow();
  });

  it('rejects fractional scores', () => {
    expect(() => gameSchema.parse({ ...game, home: { ...side, score: 10.5 } })).toThrow();
  });
});
