import type { HttpClient } from '../../core/http.js';
import type { Logger } from '../../core/logger.js';
import { fetchStandings } from './adapter.js';
import type { StandingsRepo } from './repo.js';

const MINUTE = 60_000;

/** Even with nothing happening, look again every hour. */
export const MAX_AGE_MS = 60 * MINUTE;
/** A game that just ended changes the table, but ESPN takes a moment to update it. */
const AFTER_FINAL_FIRST_LOOK_MS = 2 * MINUTE;
/** For this long after a game ends, keep looking in case ESPN was slow. */
const AFTER_FINAL_WATCH_MS = 30 * MINUTE;
const AFTER_FINAL_RETRY_MS = 5 * MINUTE;

/**
 * Whether it is time to download the standings again.
 * - never downloaded, or a full hour old: yes;
 * - a game ended since the last download: yes, after 2 minutes;
 * - a game ended in the last 30 minutes: yes every 5 minutes, because ESPN may have been late.
 */
export function shouldRefresh(input: {
  now: number;
  lastFetchedAt: number | undefined;
  lastFinalAt: number | undefined;
}): boolean {
  const { now, lastFetchedAt, lastFinalAt } = input;
  if (lastFetchedAt === undefined) return true;
  const age = now - lastFetchedAt;
  if (age >= MAX_AGE_MS) return true;
  if (lastFinalAt === undefined) return false;
  if (lastFinalAt > lastFetchedAt && age >= AFTER_FINAL_FIRST_LOOK_MS) return true;
  return now - lastFinalAt <= AFTER_FINAL_WATCH_MS && age >= AFTER_FINAL_RETRY_MS;
}

export async function refreshStandings(deps: {
  http: HttpClient;
  repo: StandingsRepo;
  logger: Logger;
  now: number;
}): Promise<{ conferences: number; teams: number; seasonType: string }> {
  const { http, repo, logger, now } = deps;
  const tables = await fetchStandings(http);
  repo.replace(tables, now);
  const teams = tables.reduce((total, table) => total + table.entries.length, 0);
  const seasonType = tables[0]?.seasonType ?? 'unknown';
  logger.info({ conferences: tables.length, teams, seasonType }, 'standings refreshed');
  return { conferences: tables.length, teams, seasonType };
}
