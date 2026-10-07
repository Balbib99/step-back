import type { Migration } from '../../core/migrations.js';

/** The current standings of each conference. */
export const STANDINGS_MIGRATIONS: Migration[] = [
  {
    id: 3,
    name: 'standings',
    sql: `
-- Module standings: one snapshot per conference, replaced whole each time ESPN is read.
-- season_type says what the table counts (preseason games until the regular season starts).
CREATE TABLE standings (
  conference         TEXT    NOT NULL CHECK (conference IN ('east', 'west')),
  team_id            TEXT    NOT NULL,
  season             INTEGER NOT NULL,
  season_type        TEXT    NOT NULL CHECK (season_type IN ('preseason', 'regular', 'playoffs')),
  rank               INTEGER NOT NULL,
  abbr               TEXT    NOT NULL,
  name               TEXT    NOT NULL,
  wins               INTEGER NOT NULL,
  losses             INTEGER NOT NULL,
  win_pct            REAL    NOT NULL,
  games_behind       REAL    NOT NULL,
  streak             TEXT,
  home               TEXT,
  road               TEXT,
  last10             TEXT,
  conference_record  TEXT,
  division_record    TEXT,
  clincher           TEXT,
  points_for         REAL,
  points_against     REAL,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (conference, team_id)
);

CREATE INDEX standings_rank ON standings (conference, rank);
`,
  },
];
