import {
  DEFAULT_REMINDER_MINUTES,
  TEAM_ABBRS,
  type PushSubscriptionInput,
  type TeamPushSettings,
} from '@step-back/shared';
import type { Db } from '../../core/db.js';

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushRepo {
  saveSubscription(subscription: PushSubscriptionInput): void;
  /** True when there was such a subscription. */
  deleteSubscription(endpoint: string): boolean;
  subscriptions(): StoredSubscription[];
  /** One entry per NBA team, the favourites first; a team never saved uses the defaults. */
  settings(): TeamPushSettings[];
  saveSettings(settings: TeamPushSettings[]): void;
  /** Marks an event as sent. False when it already was: the caller must not send it again. */
  claim(eventKey: string): boolean;
  /** Takes the mark back, so a failed send is tried again. */
  release(eventKey: string): void;
  /** How many events whose key starts with `prefix` were claimed since `since` (epoch ms). */
  countClaimed(prefix: string, since: number): number;
  /** Forgets events older than `before` (epoch ms). */
  purgeLog(before: number): number;
}

type Row = Record<string, string | number>;

/** Favourites start with their alerts on; every other team with none, until the owner asks. */
export function defaultSettings(team: string, favorite: boolean): TeamPushSettings {
  return favorite
    ? { team, start: true, end: true, reminderMinutes: DEFAULT_REMINDER_MINUTES, news: false }
    : { team, start: false, end: false, reminderMinutes: 0, news: false };
}

export function createPushRepo(
  db: Db,
  favorites: readonly string[],
  now: () => number = () => Date.now(),
): PushRepo {
  const order = [...favorites, ...TEAM_ABBRS.filter((team) => !favorites.includes(team)).sort()];
  const upsertSubscription = db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `);
  const deleteSubscription = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const selectSubscriptions = db.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at, endpoint',
  );
  const selectSettings = db.prepare('SELECT * FROM push_settings');
  const upsertSettings = db.prepare(`
    INSERT INTO push_settings (team, start, "end", reminder_minutes, news) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (team) DO UPDATE SET start = excluded.start, "end" = excluded."end",
      reminder_minutes = excluded.reminder_minutes, news = excluded.news
  `);
  const insertLog = db.prepare('INSERT OR IGNORE INTO push_log (event_key, sent_at) VALUES (?, ?)');
  const deleteLog = db.prepare('DELETE FROM push_log WHERE event_key = ?');
  const purgeLog = db.prepare('DELETE FROM push_log WHERE sent_at < ?');
  const countClaimed = db.prepare(
    "SELECT COUNT(*) AS n FROM push_log WHERE event_key LIKE ? || '%' AND sent_at >= ?",
  );

  const saveAll = db.transaction((settings: TeamPushSettings[]) => {
    for (const s of settings) {
      upsertSettings.run(s.team, Number(s.start), Number(s.end), s.reminderMinutes, Number(s.news));
    }
  });

  return {
    saveSubscription: ({ endpoint, keys }) =>
      void upsertSubscription.run(endpoint, keys.p256dh, keys.auth, now()),
    deleteSubscription: (endpoint) => deleteSubscription.run(endpoint).changes > 0,
    subscriptions: () => selectSubscriptions.all() as StoredSubscription[],
    settings: () => {
      const stored = new Map((selectSettings.all() as Row[]).map((row) => [row.team, row]));
      return order.map((team) => {
        const row = stored.get(team);
        if (!row) return defaultSettings(team, favorites.includes(team));
        return {
          team,
          start: row.start === 1,
          end: row.end === 1,
          reminderMinutes: row.reminder_minutes as TeamPushSettings['reminderMinutes'],
          news: row.news === 1,
        };
      });
    },
    saveSettings: (settings) => saveAll(settings),
    claim: (eventKey) => insertLog.run(eventKey, now()).changes === 1,
    release: (eventKey) => void deleteLog.run(eventKey),
    countClaimed: (prefix, since) => (countClaimed.get(prefix, since) as { n: number }).n,
    purgeLog: (before) => purgeLog.run(before).changes,
  };
}
