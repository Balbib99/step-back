import type { Game } from '@step-back/shared';
import type { Logger } from '../../core/logger.js';
import type { HttpClient } from '../../core/http.js';
import { localDay } from './dates.js';
import { fetchScoreboard } from './adapter.js';
import type { GamesRepo } from './repo.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** How often to look again, depending on what is going on (SPEC-games). */
export const REFRESH = {
  /** A game is being played: scores change every minute or so. */
  live: 30 * SECOND,
  /** A game is about to start (or should have): catch the tip-off quickly. */
  imminent: 60 * SECOND,
  /** Games today or tomorrow, or only just finished. */
  active: 10 * MINUTE,
  /** Nothing close by. */
  idle: HOUR,
} as const;

/** A game this close to tip-off (or past it while still "scheduled") is being watched closely. */
const IMMINENT_BEFORE_MS = 20 * MINUTE;
const OVERDUE_AFTER_MS = 3 * HOUR;
const ACTIVE_BEFORE_MS = 48 * HOUR;
const ACTIVE_AFTER_MS = 6 * HOUR;

/** ESPN files the scoreboard by US Eastern day, whatever the zone the app shows. */
const ESPN_TIME_ZONE = 'America/New_York';

/** Games worth looking at to decide the pace: a window around `now`. */
export function refreshWindow(now: Date): { fromUtc: string; toUtc: string } {
  return {
    fromUtc: new Date(now.getTime() - ACTIVE_AFTER_MS).toISOString(),
    toUtc: new Date(now.getTime() + ACTIVE_BEFORE_MS).toISOString(),
  };
}

const startOf = (game: Game) => Date.parse(game.startUtc);

/** A game that is on, or is about to be, or should have started and has not been reported as on. */
function isHot(game: Game, now: Date): boolean {
  if (game.status === 'live') return true;
  if (game.status !== 'scheduled') return false;
  const untilTipOff = startOf(game) - now.getTime();
  return untilTipOff <= IMMINENT_BEFORE_MS && untilTipOff >= -OVERDUE_AFTER_MS;
}

/** Milliseconds to wait before asking ESPN again. */
export function nextRefreshDelayMs(games: readonly Game[], now: Date): number {
  if (games.some((game) => game.status === 'live')) return REFRESH.live;
  if (games.some((game) => isHot(game, now))) return REFRESH.imminent;

  const { fromUtc, toUtc } = refreshWindow(now);
  const nearby = games.some((game) => game.startUtc >= fromUtc && game.startUtc <= toUtc);
  return nearby ? REFRESH.active : REFRESH.idle;
}

/**
 * Which ESPN scoreboard days to download. While games are on, only the days those games belong
 * to; otherwise yesterday, today and tomorrow (Eastern), which also catches late finishes and
 * newly published games.
 */
export function espnDaysToFetch(games: readonly Game[], now: Date): string[] {
  const hot = games.filter((game) => isHot(game, now));
  const instants =
    hot.length > 0
      ? hot.map((game) => new Date(game.startUtc))
      : [-24, 0, 24].map((hours) => new Date(now.getTime() + hours * HOUR));
  return [...new Set(instants.map((instant) => localDay(instant, ESPN_TIME_ZONE)))].sort();
}

export interface RefreshResult {
  days: string[];
  games: number;
  failures: string[];
}

/** Downloads the scoreboard of each day and stores the games. A failing day does not stop the rest. */
export async function refreshScoreboards(deps: {
  http: HttpClient;
  repo: GamesRepo;
  logger: Logger;
  now: Date;
}): Promise<RefreshResult> {
  const { http, repo, logger, now } = deps;
  const { fromUtc, toUtc } = refreshWindow(now);
  const days = espnDaysToFetch(repo.games({ fromUtc, toUtc }), now);

  let games = 0;
  const failures: string[] = [];
  for (const day of days) {
    try {
      const fetched = await fetchScoreboard(http, day);
      repo.upsertGames(fetched);
      games += fetched.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${day}: ${message}`);
      logger.warn({ day, err: message }, 'could not refresh the scoreboard');
    }
  }
  return { days, games, failures };
}

/** The wait before the next refresh, read from what is stored right now. */
export function refreshDelayFromStore(repo: GamesRepo, now: Date = new Date()): number {
  const { fromUtc, toUtc } = refreshWindow(now);
  return nextRefreshDelayMs(repo.games({ fromUtc, toUtc }), now);
}
