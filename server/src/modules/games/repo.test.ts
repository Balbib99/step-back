import type { Game } from '@step-back/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { openDb } from '../../core/db.js';
import { runMigrations } from '../../core/migrations.js';
import { loadMigrationsFromDir, CORE_MIGRATIONS_DIR } from '../../core/migrations.js';
import { parseSchedule, parseScoreboard, parseTeams } from './adapter.js';
import { gamesModule } from './index.js';
import { createGamesRepo, type GamesRepo } from './repo.js';

const finals = () => parseScoreboard(readEspnFixture('scoreboard-final.json'));
const scheduled = () => parseScoreboard(readEspnFixture('scoreboard-scheduled.json'));

describe('GamesRepo', () => {
  let repo: GamesRepo;

  beforeEach(() => {
    const db = openDb(':memory:');
    runMigrations(db, [
      ...loadMigrationsFromDir(CORE_MIGRATIONS_DIR),
      ...(gamesModule.migrations ?? []),
    ]);
    repo = createGamesRepo(db, () => 1_000);
  });

  it('gives back exactly the games it was given, whatever their state', () => {
    const games = [
      ...finals(),
      ...scheduled(),
      ...parseScoreboard(readEspnFixture('scoreboard-live.synthetic.json')),
      ...parseScoreboard(readEspnFixture('scoreboard-postponed.json')),
    ];
    repo.upsertGames(games);
    // The synthetic live game is the same game (same id) as one scheduled game: the last one wins.
    const expected = [...new Map(games.map((game) => [game.id, game])).values()];
    expect(expected.length).toBeLessThan(games.length);
    for (const game of expected) expect(repo.game(game.id)).toEqual(game);
  });

  it('keeps a game against a club outside the NBA', () => {
    const lions = parseSchedule(readEspnFixture('schedule-por-preseason.json')).find(
      (g) => g.id === '401914130',
    ) as Game;
    repo.upsertGames([lions]);
    expect(repo.game('401914130')?.away).toMatchObject({ abbr: 'LON', name: 'London Lions' });
  });

  it('is idempotent: loading the same games again adds nothing', () => {
    repo.upsertGames(finals());
    repo.upsertGames(finals());
    expect(repo.countGames()).toBe(4);
  });

  it('follows a game from scheduled to live to final, replacing the old values', () => {
    const [base] = scheduled() as [Game];
    const [live] = parseScoreboard(readEspnFixture('scoreboard-live.synthetic.json')) as [Game];
    expect(live.id).toBe(base.id);

    repo.upsertGames([base]);
    expect(repo.game(base.id)).toMatchObject({ status: 'scheduled', home: { score: null } });

    repo.upsertGames([live]);
    expect(repo.game(base.id)).toMatchObject({
      status: 'live',
      period: 3,
      clock: '4:12',
      home: { score: 78, winner: null, linescores: [24, 30, 24] },
    });

    const final: Game = {
      ...live,
      status: 'final',
      statusDetail: 'Final',
      period: null,
      clock: null,
      home: { ...live.home, score: 101, winner: true, linescores: [24, 30, 24, 23] },
      away: { ...live.away, score: 96, winner: false, linescores: [27, 25, 22, 22] },
    };
    repo.upsertGames([final]);
    expect(repo.game(base.id)).toEqual(final);
    expect(repo.countGames()).toBe(1);
  });

  it('tells a lost game (winner false) apart from an unplayed one (winner null)', () => {
    repo.upsertGames([...finals(), ...scheduled()]);
    const lost = repo.game('401898390')!; // LAL lost at GS
    expect(lost.away.winner).toBe(false);
    expect(repo.game(scheduled()[0]!.id)?.away.winner).toBeNull();
  });

  it('lists games in start order and filters by UTC range, half-open', () => {
    repo.upsertGames([...scheduled(), ...finals()]);
    const all = repo.games({});
    expect(all.map((g) => g.startUtc)).toEqual([...all.map((g) => g.startUtc)].sort());

    const range = repo.games({
      fromUtc: '2026-10-07T00:00:00.000Z',
      toUtc: '2026-10-07T02:00:00.000Z',
    });
    // 00:00 and 01:00 are in, 02:00 is out.
    expect(range.map((g) => g.id)).toEqual(['401898389', '401914128']);
  });

  it('filters by team whether it plays home or away', () => {
    repo.upsertGames([...scheduled(), ...finals()]);
    const lakers = repo.games({ teamAbbr: 'LAL' });
    expect(lakers.map((g) => [g.away.abbr, g.home.abbr])).toEqual([
      ['LAL', 'GS'],
      ['SAC', 'LAL'],
    ]);
  });

  it('honours the limit', () => {
    repo.upsertGames(scheduled());
    expect(repo.games({ limit: 2 })).toHaveLength(2);
  });

  it('returns undefined for an unknown game', () => {
    expect(repo.game('nope')).toBeUndefined();
  });

  it('stores teams, ordered by name, and updates them on a second load', () => {
    const teams = parseTeams(readEspnFixture('teams.json'));
    repo.upsertTeams(teams);
    const stored = repo.teams();
    expect(stored).toHaveLength(30);
    expect(stored.map((t) => t.name)).toEqual([...stored.map((t) => t.name)].sort());

    repo.upsertTeams([{ ...teams[0]!, logoUrl: 'https://example.com/new.png' }]);
    expect(repo.teams()).toHaveLength(30);
    expect(repo.teams().find((t) => t.id === teams[0]!.id)?.logoUrl).toBe(
      'https://example.com/new.png',
    );
  });
});
