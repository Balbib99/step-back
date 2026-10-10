import type { Game, NewsItem, TeamPushSettings } from '@step-back/shared';

export type PushKind = 'reminder' | 'start' | 'end' | 'live';

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
/** A game still "live" after this long has a stuck status: its score is not worth showing. */
export const LIVE_FOR_MS = 6 * HOUR;
/** Reminders reach at most this far ahead (the largest option). */
export const MAX_REMINDER_MS = 60 * MINUTE;

/**
 * Which notifications are due right now. It looks only at the state of the games and the
 * settings, never at what was seen before: whether one was already sent is up to the event log.
 * A game between two teams with alerts on is one event, not two.
 *
 * The live score is the one event that repeats within a game: its key holds the score and the
 * period, so every change is a new event and the same state is sent once. `followed` are the
 * games asked for one by one, whichever teams play them.
 */
export function detectEvents(
  games: readonly Game[],
  settings: readonly TeamPushSettings[],
  now: number,
  followed: ReadonlySet<string> = new Set(),
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

    const wantsLive = teams.some((s) => s.live) || followed.has(game.id);
    const { home: homeSide, away: awaySide } = game;
    if (
      game.status === 'live' &&
      wantsLive &&
      sinceStart < LIVE_FOR_MS &&
      homeSide.score !== null &&
      awaySide.score !== null
    ) {
      events.push({
        key: `live:${game.id}:${awaySide.score}-${homeSide.score}:${game.period ?? 0}`,
        kind: 'live',
        game,
        reminderMinutes,
      });
    }
  }
  return events;
}

/** A news item is only news for a while: older ones are not sent, whenever they were stored. */
export const NEWS_FRESH_FOR_MS = 2 * HOUR;
/** Featured news is rare by design: past this many in a day, the rest are left out. */
export const MAX_NEWS_PER_DAY = 5;

export interface NewsEvent {
  key: string;
  item: NewsItem;
  /** The favourite teams it is about that asked for news. */
  teams: string[];
}

/**
 * Featured news that is due: from a priority source, recent, and about a favourite team that has
 * news turned on. Oldest first, so a burst keeps its order.
 */
export function detectNews(
  items: readonly NewsItem[],
  settings: readonly TeamPushSettings[],
  favorites: readonly string[],
  prioritySources: ReadonlySet<string>,
  now: number,
): NewsEvent[] {
  const wanted = new Set(
    settings.filter((s) => s.news && favorites.includes(s.team)).map((s) => s.team),
  );
  const events: NewsEvent[] = [];
  for (const item of items) {
    if (!prioritySources.has(item.sourceId)) continue;
    const age = now - Date.parse(item.publishedAt);
    if (age > NEWS_FRESH_FOR_MS) continue;
    const teams = item.teams.filter((team) => wanted.has(team));
    if (teams.length > 0) events.push({ key: `news:${item.id}`, item, teams });
  }
  return events.sort((a, b) => a.item.publishedAt.localeCompare(b.item.publishedAt));
}
