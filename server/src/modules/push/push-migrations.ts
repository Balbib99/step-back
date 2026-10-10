import type { Migration } from '../../core/migrations.js';

/** Web Push: who to notify, about what, and what has already been sent. */
export const PUSH_MIGRATIONS: Migration[] = [
  {
    id: 7,
    name: 'push',
    sql: `
-- Module push. Unlike most tables this one is not recoverable from a source, so it is part of
-- the backup (SPEC.md, open questions).

-- One row per browser that accepted notifications. Deleted when the push service says it is gone.
CREATE TABLE push_subscriptions (
  endpoint   TEXT    PRIMARY KEY,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

-- What to be told about, per favourite team. A team with no row uses the defaults.
CREATE TABLE push_settings (
  team             TEXT    PRIMARY KEY,
  start            INTEGER NOT NULL CHECK (start IN (0, 1)),
  "end"            INTEGER NOT NULL CHECK ("end" IN (0, 1)),
  reminder_minutes INTEGER NOT NULL CHECK (reminder_minutes >= 0)
);

-- A notification already sent (or being sent), by event key such as "end:401810001".
-- It is what makes a restart or a retry not repeat a notification.
CREATE TABLE push_log (
  event_key TEXT    PRIMARY KEY,
  sent_at   INTEGER NOT NULL
);
`,
  },
  {
    id: 8,
    name: 'push-news',
    sql: `
-- Featured news per favourite team; off until the owner turns it on.
ALTER TABLE push_settings ADD COLUMN news INTEGER NOT NULL DEFAULT 0 CHECK (news IN (0, 1));
`,
  },
  {
    id: 9,
    name: 'push-live',
    sql: `
-- Live score as one notification that updates in place. NULL means "not chosen yet": a favourite
-- team has it on, any other team off. It is a column that can be empty on purpose, so that the
-- favourites saved before this existed also get the default.
ALTER TABLE push_settings ADD COLUMN live INTEGER CHECK (live IS NULL OR live IN (0, 1));

-- Games the owner asked to follow from the game screen, whatever teams play them. They are
-- forgotten a day after they were asked for.
CREATE TABLE push_follows (
  game_id    TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`,
  },
];
