import type { Conference, ConferenceStandings, SeasonType, StandingEntry } from '@step-back/shared';
import type { Db } from '../../core/db.js';
import type { ParsedConference } from './adapter.js';

export interface StandingsRepo {
  /** Replaces the stored table of each given conference, all of it or nothing. */
  replace(tables: readonly ParsedConference[], fetchedAt: number): void;
  /** The stored tables, east first; one conference only when asked. */
  get(conference?: Conference): ConferenceStandings[];
  /** When the standings were last downloaded (epoch ms), if ever. */
  lastFetchedAt(): number | undefined;
}

type Row = Record<string, string | number | null>;

const COLUMNS = [
  'conference',
  'team_id',
  'season',
  'season_type',
  'rank',
  'abbr',
  'name',
  'wins',
  'losses',
  'win_pct',
  'games_behind',
  'streak',
  'home',
  'road',
  'last10',
  'conference_record',
  'division_record',
  'clincher',
  'points_for',
  'points_against',
  'updated_at',
];

const entryOf = (row: Row): StandingEntry => ({
  teamId: row.team_id as string,
  abbr: row.abbr as string,
  name: row.name as string,
  rank: row.rank as number,
  wins: row.wins as number,
  losses: row.losses as number,
  winPct: row.win_pct as number,
  gamesBehind: row.games_behind as number,
  streak: row.streak as string | null,
  home: row.home as string | null,
  road: row.road as string | null,
  last10: row.last10 as string | null,
  conferenceRecord: row.conference_record as string | null,
  divisionRecord: row.division_record as string | null,
  clincher: row.clincher as string | null,
  pointsFor: row.points_for as number | null,
  pointsAgainst: row.points_against as number | null,
});

export function createStandingsRepo(db: Db): StandingsRepo {
  const clear = db.prepare('DELETE FROM standings WHERE conference = ?');
  const insert = db.prepare(
    `INSERT INTO standings (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
  );
  const lastFetched = db.prepare('SELECT MAX(updated_at) AS at FROM standings');

  const replaceAll = db.transaction((tables: readonly ParsedConference[], fetchedAt: number) => {
    for (const table of tables) {
      clear.run(table.conference);
      for (const e of table.entries) {
        insert.run(
          table.conference,
          e.teamId,
          table.season,
          table.seasonType,
          e.rank,
          e.abbr,
          e.name,
          e.wins,
          e.losses,
          e.winPct,
          e.gamesBehind,
          e.streak,
          e.home,
          e.road,
          e.last10,
          e.conferenceRecord,
          e.divisionRecord,
          e.clincher,
          e.pointsFor,
          e.pointsAgainst,
          fetchedAt,
        );
      }
    }
  });

  return {
    replace: (tables, fetchedAt) => replaceAll(tables, fetchedAt),
    get(conference) {
      const rows = (
        conference
          ? db
              .prepare('SELECT * FROM standings WHERE conference = ? ORDER BY rank, name')
              .all(conference)
          : db.prepare('SELECT * FROM standings ORDER BY conference, rank, name').all()
      ) as Row[];

      const tables = new Map<string, ConferenceStandings>();
      for (const row of rows) {
        const key = row.conference as string;
        let table = tables.get(key);
        if (!table) {
          table = {
            conference: key as Conference,
            season: row.season as number,
            seasonType: row.season_type as SeasonType,
            updatedAt: new Date(row.updated_at as number).toISOString(),
            entries: [],
          };
          tables.set(key, table);
        }
        table.entries.push(entryOf(row));
      }
      return [...tables.values()];
    },
    lastFetchedAt() {
      const { at } = lastFetched.get() as { at: number | null };
      return at ?? undefined;
    },
  };
}
