import type { Game, TeamPushSettings } from '@step-back/shared';

export type PushKind = 'reminder' | 'start' | 'end';

export interface PushEvent {
  /** Unique per game and kind: what makes a notification go out once. */
  key: string;
  kind: PushKind;
  game: Game;
  /** For a reminder, the minutes asked for. */
  reminderMinutes: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * An event is only worth telling while it is news. After a long stop of the server, a game that
 * started hours ago is not announced and a result from yesterday is not sent.
 */
export const START_NEWS_FOR_MS = HOUR;
export const END_NEWS_FOR_MS = 8 * HOUR;
/** Reminders reach at most this far ahead (the largest option). */
export const MAX_REMINDER_MS = 60 * MINUTE;

/**
 * Which notifications are due right now. It looks only at the state of the games and the
 * settings, never at what was seen before: whether one was already sent is up to the event log.
 * A game between two teams with alerts on is one event, not two.
 */
export function detectEvents(
  games: readonly Game[],
  settings: readonly TeamPushSettings[],
  now: number,
): PushEvent[] {
  const events: PushEvent[] = [];
  for (const game of games) {
    const teams = settings.filter((s) => s.team === game.home.abbr || s.team === game.away.abbr);
    if (teams.length === 0) continue;

    const startsAt = Date.parse(game.startUtc);
    const sinceStart = now - startsAt;
    const wantsStart = teams.some((s) => s.start);
    const wantsEnd = teams.some((s) => s.end);
    const reminderMinutes = Math.max(...teams.map((s) => s.reminderMinutes));

    if (game.status === 'scheduled' && reminderMinutes > 0) {
      const until = startsAt - now;
      if (until > 0 && until <= reminderMinutes * MINUTE) {
        events.push({ key: `reminder:${game.id}`, kind: 'reminder', game, reminderMinutes });
      }
    } else if (game.status === 'live' && wantsStart && sinceStart < START_NEWS_FOR_MS) {
      events.push({ key: `start:${game.id}`, kind: 'start', game, reminderMinutes });
    } else if (game.status === 'final' && wantsEnd && sinceStart < END_NEWS_FOR_MS) {
      events.push({ key: `end:${game.id}`, kind: 'end', game, reminderMinutes });
    }
  }
  return events;
}
