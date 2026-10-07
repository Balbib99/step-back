import type { Migration } from '../../core/migrations.js';

/** News items from every source, their labels, and what is known about each source's feed. */
export const NEWS_MIGRATIONS: Migration[] = [
  {
    id: 4,
    name: 'news',
    sql: `
-- Module news. Only the headline, a short summary and the address of the picture are kept: the
-- article itself stays at its source. url is unique (normalised), which removes duplicates.
CREATE TABLE news_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id        TEXT    NOT NULL,
  url              TEXT    NOT NULL UNIQUE,
  title            TEXT    NOT NULL,
  summary          TEXT,
  lang             TEXT    NOT NULL CHECK (lang IN ('en', 'es')),
  published_utc    INTEGER NOT NULL,
  fetched_at       INTEGER NOT NULL,
  media_kind       TEXT    NOT NULL DEFAULT 'none' CHECK (media_kind IN ('none', 'image', 'video')),
  media_url        TEXT,
  embed_url        TEXT,
  media_duration_s INTEGER
);

CREATE INDEX news_items_published ON news_items (published_utc DESC, id DESC);

CREATE TABLE news_tags (
  news_id INTEGER NOT NULL REFERENCES news_items (id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL CHECK (kind IN ('team', 'player')),
  ref     TEXT    NOT NULL,
  PRIMARY KEY (news_id, kind, ref)
) WITHOUT ROWID;

CREATE INDEX news_tags_ref ON news_tags (kind, ref);

-- The ETag and Last-Modified of each feed, so an unchanged feed costs almost nothing.
CREATE TABLE news_source_state (
  source_id     TEXT PRIMARY KEY,
  etag          TEXT,
  last_modified TEXT
);

-- Players ESPN has labelled in its news. Other sources do not label players, so their texts are
-- searched for these names.
CREATE TABLE news_players (
  name TEXT PRIMARY KEY
) WITHOUT ROWID;
`,
  },
];
