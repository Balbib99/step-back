import {
  DEFAULT_REMINDER_MINUTES,
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
  /** One entry per given team, in that order; a team never saved uses the defaults. */
  settings(teams: readonly string[]): TeamPushSettings[];
  saveSettings(settings: TeamPushSettings[]): void;
  /** Marks an event as sent. False when it already was: the caller must not send it again. */
  claim(eventKey: string): boolean;
  /** Takes the mark back, so a failed send is tried again. */
  release(eventKey: string): void;
  /** Forgets events older than `before` (epoch ms). */
  purgeLog(before: number): number;
}

type Row = Record<string, string | number>;

export const DEFAULT_SETTINGS = {
  start: true,
  end: true,
  reminderMinutes: DEFAULT_REMINDER_MINUTES,
} as const;

export function createPushRepo(db: Db, now: () => number = () => Date.now()): PushRepo {
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
    INSERT INTO push_settings (team, start, "end", reminder_minutes) VALUES (?, ?, ?, ?)
    ON CONFLICT (team) DO UPDATE SET start = excluded.start, "end" = excluded."end",
      reminder_minutes = excluded.reminder_minutes
  `);
  const insertLog = db.prepare('INSERT OR IGNORE INTO push_log (event_key, sent_at) VALUES (?, ?)');
  const deleteLog = db.prepare('DELETE FROM push_log WHERE event_key = ?');
  const purgeLog = db.prepare('DELETE FROM push_log WHERE sent_at < ?');

  const saveAll = db.transaction((settings: TeamPushSettings[]) => {
    for (const s of settings) {
      upsertSettings.run(s.team, Number(s.start), Number(s.end), s.reminderMinutes);
    }
  });

  return {
    saveSubscription: ({ endpoint, keys }) =>
      void upsertSubscription.run(endpoint, keys.p256dh, keys.auth, now()),
    deleteSubscription: (endpoint) => deleteSubscription.run(endpoint).changes > 0,
    subscriptions: () => selectSubscriptions.all() as StoredSubscription[],
    settings: (teams) => {
      const stored = new Map((selectSettings.all() as Row[]).map((row) => [row.team, row]));
      return teams.map((team) => {
        const row = stored.get(team);
        if (!row) return { team, ...DEFAULT_SETTINGS };
        return {
          team,
          start: row.start === 1,
          end: row.end === 1,
          reminderMinutes: row.reminder_minutes as TeamPushSettings['reminderMinutes'],
        };
      });
    },
    saveSettings: (settings) => saveAll(settings),
    claim: (eventKey) => insertLog.run(eventKey, now()).changes === 1,
    release: (eventKey) => void deleteLog.run(eventKey),
    purgeLog: (before) => purgeLog.run(before).changes,
  };
}
