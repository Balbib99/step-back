import type { Logger } from '../../core/logger.js';
import type { HttpClient } from '../../core/http.js';
import { fetchTeams, fetchTeamSchedule } from './adapter.js';
import type { GamesRepo } from './repo.js';

/** ESPN season types: 1 preseason, 2 regular season, 3 playoffs (empty until they are scheduled). */
const SEASON_TYPES = [1, 2, 3] as const;

export interface CalendarResult {
  teams: number;
  games: number;
  failures: string[];
}

/**
 * Loads the 30 teams and every published game of `season`. ESPN only returns the current phase
 * from a team schedule unless asked, so each team is queried once per season type. A game shows
 * up in both teams' schedules; upserting by id merges them. A failing request does not stop the
 * others: whatever could be read is saved, and the failures are reported to the caller.
 */
export async function loadCalendar(deps: {
  http: HttpClient;
  repo: GamesRepo;
  logger: Logger;
  season: number;
}): Promise<CalendarResult> {
  const { http, repo, logger, season } = deps;

  const teams = await fetchTeams(http);
  repo.upsertTeams(teams);

  const failures: string[] = [];
  for (const team of teams) {
    for (const seasonType of SEASON_TYPES) {
      try {
        repo.upsertGames(await fetchTeamSchedule(http, team.id, season, seasonType));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${team.abbr} type ${seasonType}: ${message}`);
        logger.warn({ team: team.abbr, seasonType, err: message }, 'could not load team schedule');
      }
    }
  }

  const games = repo.countGames();
  logger.info({ teams: teams.length, games, failures: failures.length }, 'calendar loaded');
  return { teams: teams.length, games, failures };
}
