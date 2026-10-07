import type { Game, GameTeam, Team } from '@step-back/shared';
import type { Db } from '../../core/db.js';

export interface GameFilter {
  /** Inclusive lower bound, ISO UTC. */
  fromUtc?: string;
  /** Exclusive upper bound, ISO UTC. */
  toUtc?: string;
  /** Team abbreviation: matches the game when the team plays at home or away. */
  teamAbbr?: string;
  limit?: number;
}

export interface GamesRepo {
  upsertTeams(teams: Team[]): void;
  upsertGames(games: Game[]): void;
  teams(): Team[];
  game(id: string): Game | undefined;
  games(filter: GameFilter): Game[];
  countGames(): number;
}

type Side = 'home' | 'away';

const SIDE_COLUMNS = (side: Side) =>
  ['team_id', 'abbr', 'name', 'score', 'record', 'winner', 'linescores'].map((c) => `${side}_${c}`);

const COLUMNS = [
  'id',
  'season',
  'season_type',
  'start_utc',
  'status',
  'status_detail',
  'period',
  'clock',
  'venue',
  ...SIDE_COLUMNS('home'),
  ...SIDE_COLUMNS('away'),
  'updated_at',
];

const UPSERT_GAME = `
  INSERT INTO games (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT (id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}
`;

const sideValues = (side: GameTeam) => [
  side.teamId,
  side.abbr,
  side.name,
  side.score,
  side.record,
  side.winner === null ? null : Number(side.winner),
  JSON.stringify(side.linescores),
];

type Row = Record<string, string | number | null>;

function sideOf(row: Row, side: Side): GameTeam {
  const winner = row[`${side}_winner`];
  return {
    teamId: row[`${side}_team_id`] as string,
    abbr: row[`${side}_abbr`] as string,
    name: row[`${side}_name`] as string,
    score: row[`${side}_score`] as number | null,
    record: row[`${side}_record`] as string | null,
    winner: winner === null ? null : winner === 1,
    linescores: JSON.parse(row[`${side}_linescores`] as string) as number[],
  };
}

function gameOf(row: Row): Game {
  return {
    id: row.id as string,
    season: row.season as number,
    seasonType: row.season_type as Game['seasonType'],
    startUtc: row.start_utc as string,
    status: row.status as Game['status'],
    statusDetail: row.status_detail as string,
    period: row.period as number | null,
    clock: row.clock as string | null,
    venue: row.venue as string | null,
    home: sideOf(row, 'home'),
    away: sideOf(row, 'away'),
  };
}

export function createGamesRepo(db: Db, now: () => number = Date.now): GamesRepo {
  const upsertTeam = db.prepare(`
    INSERT INTO teams (id, abbr, name, short_name, location, logo_url)
    VALUES (@id, @abbr, @name, @shortName, @location, @logoUrl)
    ON CONFLICT (id) DO UPDATE SET abbr = excluded.abbr, name = excluded.name,
      short_name = excluded.short_name, location = excluded.location, logo_url = excluded.logo_url
  `);
  const upsertGame = db.prepare(UPSERT_GAME);
  const selectTeams = db.prepare('SELECT * FROM teams ORDER BY name');
  const selectGame = db.prepare('SELECT * FROM games WHERE id = ?');
  const countGames = db.prepare('SELECT COUNT(*) AS n FROM games');

  const insertTeams = db.transaction((teams: Team[]) => {
    for (const team of teams) upsertTeam.run(team);
  });
  const insertGames = db.transaction((games: Game[]) => {
    const updatedAt = now();
    for (const g of games) {
      upsertGame.run(
        g.id,
        g.season,
        g.seasonType,
        g.startUtc,
        g.status,
        g.statusDetail,
        g.period,
        g.clock,
        g.venue,
        ...sideValues(g.home),
        ...sideValues(g.away),
        updatedAt,
      );
    }
  });

  return {
    upsertTeams: (teams) => insertTeams(teams),
    upsertGames: (games) => insertGames(games),
    teams: () =>
      (selectTeams.all() as Row[]).map((row) => ({
        id: row.id as string,
        abbr: row.abbr as string,
        name: row.name as string,
        shortName: row.short_name as string,
        location: row.location as string,
        logoUrl: row.logo_url as string | null,
      })),
    game: (id) => {
      const row = selectGame.get(id) as Row | undefined;
      return row ? gameOf(row) : undefined;
    },
    games: ({ fromUtc, toUtc, teamAbbr, limit = 2000 }) => {
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (fromUtc) {
        where.push('start_utc >= ?');
        params.push(fromUtc);
      }
      if (toUtc) {
        where.push('start_utc < ?');
        params.push(toUtc);
      }
      if (teamAbbr) {
        where.push('(home_abbr = ? OR away_abbr = ?)');
        params.push(teamAbbr, teamAbbr);
      }
      const sql = `SELECT * FROM games ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY start_utc, id LIMIT ?`;
      return (db.prepare(sql).all(...params, limit) as Row[]).map(gameOf);
    },
    countGames: () => (countGames.get() as { n: number }).n,
  };
}
