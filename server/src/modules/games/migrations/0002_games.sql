-- Module `games`: teams and games, as served by ESPN.

CREATE TABLE teams (
  id         TEXT PRIMARY KEY,
  abbr       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  short_name TEXT NOT NULL,
  location   TEXT NOT NULL,
  logo_url   TEXT
);

-- No foreign keys to teams: a preseason game can be against a club that is not in the NBA
-- (e.g. London Lions), so each side carries its own name.
CREATE TABLE games (
  id              TEXT PRIMARY KEY,
  season          INTEGER NOT NULL,
  season_type     TEXT NOT NULL CHECK (season_type IN ('preseason', 'regular', 'playoffs')),
  start_utc       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'final', 'postponed', 'canceled')),
  status_detail   TEXT NOT NULL,
  period          INTEGER,
  clock           TEXT,
  venue           TEXT,

  home_team_id    TEXT NOT NULL,
  home_abbr       TEXT NOT NULL,
  home_name       TEXT NOT NULL,
  home_score      INTEGER,
  home_record     TEXT,
  home_winner     INTEGER,
  home_linescores TEXT NOT NULL DEFAULT '[]',

  away_team_id    TEXT NOT NULL,
  away_abbr       TEXT NOT NULL,
  away_name       TEXT NOT NULL,
  away_score      INTEGER,
  away_record     TEXT,
  away_winner     INTEGER,
  away_linescores TEXT NOT NULL DEFAULT '[]',

  updated_at      INTEGER NOT NULL
);

-- start_utc is always an ISO 8601 UTC string, so range queries compare as text.
CREATE INDEX games_start ON games (start_utc);
CREATE INDEX games_home ON games (home_abbr, start_utc);
CREATE INDEX games_away ON games (away_abbr, start_utc);
