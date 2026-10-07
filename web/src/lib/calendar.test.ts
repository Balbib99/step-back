import type { Game, GameTeam } from '@step-back/shared';
import { describe, expect, it } from 'vitest';
import { favouritesPlaying, filterGames, groupByDay, involves } from './calendar';

const side = (abbr: string): GameTeam => ({
  teamId: abbr,
  abbr,
  name: abbr,
  score: null,
  record: null,
  winner: null,
  linescores: [],
});

const game = (
  id: string,
  away: string,
  home: string,
  startUtc: string,
  seasonType: Game['seasonType'] = 'preseason',
): Game => ({
  id,
  season: 2027,
  seasonType,
  startUtc,
  status: 'scheduled',
  statusDetail: '',
  period: null,
  clock: null,
  venue: null,
  home: side(home),
  away: side(away),
});

const games = [
  game('1', 'MIN', 'LAL', '2026-10-07T01:30:00Z'),
  game('2', 'BOS', 'PHI', '2026-10-07T16:00:00Z'),
  game('3', 'DEN', 'GS', '2026-10-07T20:30:00Z'),
  game('4', 'MIN', 'IND', '2026-10-21T23:30:00Z', 'regular'),
];
const favorites = ['MIN', 'LAL', 'PHI'];

describe('filterGames', () => {
  it('"mis" keeps the games where a favourite plays, home or away', () => {
    const ids = filterGames(games, { team: 'mis', phase: undefined, favorites }).map((g) => g.id);
    expect(ids).toEqual(['1', '2', '4']);
  });

  it('"todos" keeps everything', () => {
    expect(filterGames(games, { team: 'todos', phase: undefined, favorites })).toHaveLength(4);
  });

  it('one team keeps only its games', () => {
    expect(
      filterGames(games, { team: 'PHI', phase: undefined, favorites }).map((g) => g.id),
    ).toEqual(['2']);
    expect(
      filterGames(games, { team: 'MIN', phase: undefined, favorites }).map((g) => g.id),
    ).toEqual(['1', '4']);
  });

  it('filters by phase: preseason, or the regular season together with playoffs', () => {
    expect(filterGames(games, { team: 'todos', phase: 'pretemporada', favorites })).toHaveLength(3);
    expect(
      filterGames(games, { team: 'todos', phase: 'temporada', favorites }).map((g) => g.id),
    ).toEqual(['4']);
    const playoffs = [game('9', 'MIN', 'LAL', '2027-04-20T00:00:00Z', 'playoffs')];
    expect(filterGames(playoffs, { team: 'todos', phase: 'temporada', favorites })).toHaveLength(1);
  });

  it('combines team and phase', () => {
    expect(
      filterGames(games, { team: 'MIN', phase: 'temporada', favorites }).map((g) => g.id),
    ).toEqual(['4']);
  });
});

describe('groupByDay', () => {
  it('groups by the local day of the time zone', () => {
    // 01:30 UTC on the 7th is 03:30 in Madrid; 23:30 UTC on the 21st is already the 22nd there.
    const days = groupByDay(games, 'Europe/Madrid');
    expect([...days.keys()]).toEqual(['2026-10-07', '2026-10-22']);
    expect(days.get('2026-10-07')).toHaveLength(3);
  });

  it('puts the same game on a different day in another zone', () => {
    const days = groupByDay(games, 'America/New_York');
    expect([...days.keys()]).toEqual(['2026-10-06', '2026-10-07', '2026-10-21']);
  });
});

describe('favouritesPlaying', () => {
  it('lists the favourites that play, in the configured order, without repeats', () => {
    expect(favouritesPlaying(games.slice(0, 2), favorites)).toEqual(['MIN', 'LAL', 'PHI']);
    expect(favouritesPlaying([games[2]!], favorites)).toEqual([]);
    expect(favouritesPlaying([], favorites)).toEqual([]);
  });

  it('knows when a team is involved', () => {
    expect(involves(games[0]!, ['LAL'])).toBe(true);
    expect(involves(games[0]!, ['GS'])).toBe(false);
  });
});
