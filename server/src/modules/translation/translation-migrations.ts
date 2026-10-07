import type { Migration } from '../../core/migrations.js';

/** Spanish versions of news items, kept for a few days only so a second press costs nothing. */
export const TRANSLATION_MIGRATIONS: Migration[] = [
  {
    id: 6,
    name: 'translations',
    sql: `
-- Module translation. This is not an archive: a row is deleted after 7 days, and with its news
-- item when that is purged.
CREATE TABLE translations (
  news_id    INTEGER PRIMARY KEY REFERENCES news_items (id) ON DELETE CASCADE,
  lang       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  summary    TEXT,
  chars      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
];
