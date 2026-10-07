import { conferenceStandingsSchema } from '@step-back/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { openDb } from '../../core/db.js';
import { runMigrations } from '../../core/migrations.js';
import { parseStandings } from './adapter.js';
import { createStandingsRepo, type StandingsRepo } from './repo.js';
import { STANDINGS_MIGRATIONS } from './standings-migrations.js';

const season = () => parseStandings(readEspnFixture('standings-2025-26.json'));
const preseason = () => parseStandings(readEspnFixture('standings-preseason.json'));

describe('StandingsRepo', () => {
  let repo: StandingsRepo;

  beforeEach(() => {
    const db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...STANDINGS_MIGRATIONS]);
    repo = createStandingsRepo(db);
  });

  it('is empty before the first download', () => {
    expect(repo.get()).toEqual([]);
    expect(repo.lastFetchedAt()).toBeUndefined();
  });

  it('gives back exactly what was stored, stamped with when it was downloaded', () => {
    const tables = season();
    repo.replace(tables, Date.parse('2026-10-07T18:00:00Z'));

    const stored = repo.get();
    expect(stored.map((t) => t.conference)).toEqual(['east', 'west']); // east first
    for (const [index, table] of stored.entries()) {
      expect(() => conferenceStandingsSchema.parse(table)).not.toThrow();
      expect(table.updatedAt).toBe('2026-10-07T18:00:00.000Z');
      expect(table.entries).toEqual(
        tables[
          index === 0
            ? tables.findIndex((t) => t.conference === 'east')
            : tables.findIndex((t) => t.conference === 'west')
        ]!.entries,
      );
    }
    expect(repo.lastFetchedAt()).toBe(Date.parse('2026-10-07T18:00:00Z'));
  });

  it('keeps the entries in rank order', () => {
    repo.replace(season(), 1);
    for (const table of repo.get()) {
      expect(table.entries.map((e) => e.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    }
  });

  it('returns a single conference when asked', () => {
    repo.replace(season(), 1);
    const [west] = repo.get('west');
    expect(repo.get('west')).toHaveLength(1);
    expect(west?.conference).toBe('west');
    expect(west?.entries[0]?.abbr).toBe('OKC');
  });

  it('replaces the previous table whole: nothing of the old one is left behind', () => {
    repo.replace(season(), 1_000);
    repo.replace(preseason(), 2_000);

    const stored = repo.get();
    for (const table of stored) {
      expect(table).toMatchObject({ season: 2027, seasonType: 'preseason' });
      expect(table.entries).toHaveLength(15);
    }
    expect(repo.lastFetchedAt()).toBe(2_000);
  });

  it('replaces both conferences in one go, or neither when something fails', () => {
    repo.replace(season(), 1_000);
    const broken = preseason();
    broken[1]!.entries.push({ ...broken[1]!.entries[0]! }); // the same team twice: a primary key clash
    expect(() => repo.replace(broken, 2_000)).toThrow();

    // The failure rolled everything back: the old season is still there, complete.
    for (const table of repo.get()) {
      expect(table).toMatchObject({ season: 2026, seasonType: 'regular' });
      expect(table.entries).toHaveLength(15);
    }
    expect(repo.lastFetchedAt()).toBe(1_000);
  });

  it('keeps null values null: a team with no streak or clinch mark', () => {
    repo.replace(preseason(), 1);
    const entries = repo.get().flatMap((t) => t.entries);
    expect(entries.every((e) => e.clincher === null)).toBe(true);
  });
});
