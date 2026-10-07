import type { Migration } from '../../core/migrations.js';

/** Videos of the official NBA channel, linked to games when they are a game's highlights. */
export const HIGHLIGHTS_MIGRATIONS: Migration[] = [
  {
    id: 5,
    name: 'highlights',
    sql: `
-- Module highlights. Only the address of the video and of its thumbnail are kept: videos are
-- embedded from YouTube, never downloaded. game_id is not a foreign key: a video can name a game
-- the app does not have.
CREATE TABLE videos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  yt_id         TEXT    NOT NULL UNIQUE,
  title         TEXT    NOT NULL,
  published_utc INTEGER NOT NULL,
  fetched_at    INTEGER NOT NULL,
  thumb_url     TEXT,
  kind          TEXT    NOT NULL CHECK (kind IN ('full_highlights', 'clip')),
  game_id       TEXT,
  is_short      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX videos_published ON videos (published_utc DESC, id DESC);
CREATE INDEX videos_game ON videos (game_id) WHERE game_id IS NOT NULL;

CREATE TABLE video_tags (
  video_id INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  kind     TEXT    NOT NULL CHECK (kind IN ('team', 'player')),
  ref      TEXT    NOT NULL,
  PRIMARY KEY (video_id, kind, ref)
) WITHOUT ROWID;

CREATE INDEX video_tags_ref ON video_tags (kind, ref);
`,
  },
];
