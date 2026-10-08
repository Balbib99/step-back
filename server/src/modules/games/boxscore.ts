import type { BoxscoreResponse, Game, PlayerLine, StatLine, TeamBoxscore } from '@step-back/shared';
import { z } from 'zod';
import type { HttpClient } from '../../core/http.js';
import { parseWith } from '../espn-common.js';
import { ESPN_BASE } from './adapter.js';
import { headshotPath, isPlayerId } from './headshots.js';

// ESPN's game summary is ~450 KB with odds, plays and news; only `boxscore.players` is read.
const espnAthlete = z.object({
  athlete: z.object({
    id: z.string(),
    displayName: z.string(),
    shortName: z.string().optional(),
    jersey: z.string().optional(),
    headshot: z.object({ href: z.string() }).optional(),
    position: z.object({ abbreviation: z.string().optional() }).optional(),
  }),
  starter: z.boolean().optional(),
  didNotPlay: z.boolean().optional(),
  reason: z.string().optional(),
  stats: z.array(z.string()).optional(),
});

const espnTeamPlayers = z.object({
  team: z.object({ id: z.string(), abbreviation: z.string() }),
  statistics: z.array(
    z.object({
      // The column names, in the order of each athlete's `stats` and of `totals`.
      keys: z.array(z.string()),
      athletes: z.array(espnAthlete),
      totals: z.array(z.string()).optional(),
    }),
  ),
});

export const espnSummary = z.object({
  boxscore: z.object({ players: z.array(espnTeamPlayers).optional() }),
});

const NO_STATS: StatLine = {
  minutes: null,
  points: null,
  rebounds: null,
  assists: null,
  steals: null,
  blocks: null,
  turnovers: null,
  fouls: null,
  fieldGoals: null,
  threePointers: null,
  freeThrows: null,
  plusMinus: null,
};

/** "12" is 12; "", "--" and anything else are no number. "+5" and "-3" are numbers. */
function whole(value: string | undefined): number | null {
  if (value === undefined || !/^[+-]?\d+$/.test(value.trim())) return null;
  return Number(value);
}

/** "7-15" stays as it is; anything else is nothing. */
function shooting(value: string | undefined): string | null {
  return value !== undefined && /^\d+-\d+$/.test(value.trim()) ? value.trim() : null;
}

/** ESPN gives the numbers as a list; the list of names says which is which. */
function statLine(keys: readonly string[], values: readonly string[]): StatLine {
  const at = (key: string) => {
    const index = keys.indexOf(key);
    return index === -1 ? undefined : values[index];
  };
  return {
    minutes: whole(at('minutes')),
    points: whole(at('points')),
    rebounds: whole(at('rebounds')),
    assists: whole(at('assists')),
    steals: whole(at('steals')),
    blocks: whole(at('blocks')),
    turnovers: whole(at('turnovers')),
    fouls: whole(at('fouls')),
    fieldGoals: shooting(at('fieldGoalsMade-fieldGoalsAttempted')),
    threePointers: shooting(at('threePointFieldGoalsMade-threePointFieldGoalsAttempted')),
    freeThrows: shooting(at('freeThrowsMade-freeThrowsAttempted')),
    plusMinus: whole(at('plusMinus')),
  };
}

function toTeam(source: z.infer<typeof espnTeamPlayers>): TeamBoxscore | null {
  const group = source.statistics[0];
  if (!group) return null;
  const players: PlayerLine[] = group.athletes.map((entry) => {
    const { athlete } = entry;
    // Someone on the bench who has not entered yet has no numbers either, and no reason.
    const stats = entry.stats ?? [];
    const played = entry.didNotPlay !== true && stats.length > 0;
    return {
      id: athlete.id,
      name: athlete.displayName,
      shortName: athlete.shortName ?? athlete.displayName,
      jersey: athlete.jersey ?? null,
      position: athlete.position?.abbreviation ?? null,
      // Only players ESPN has a photo for; the photo itself is fetched when someone looks.
      photoUrl: athlete.headshot && isPlayerId(athlete.id) ? headshotPath(athlete.id) : null,
      starter: entry.starter === true,
      played,
      reason: entry.didNotPlay === true && entry.reason ? entry.reason : null,
      ...(played ? statLine(group.keys, stats) : NO_STATS),
    };
  });
  // Those who played keep ESPN's order (starters, then bench); those who did not go last.
  const ordered = [...players.filter((p) => p.played), ...players.filter((p) => !p.played)];
  const totals = group.totals?.some((value) => value !== '')
    ? { ...statLine(group.keys, group.totals), minutes: null, plusMinus: null }
    : NO_STATS;
  return { teamId: source.team.id, abbr: source.team.abbreviation, players: ordered, totals };
}

/**
 * The player numbers of a game, with each team on its side of the game as the app knows it.
 * A team that ESPN has no players for (the game has not started) comes out null.
 */
export function parseBoxscore(data: unknown, game: Game, updatedAt: string): BoxscoreResponse {
  const { boxscore } = parseWith(espnSummary, data, 'game summary');
  const teams = (boxscore.players ?? []).map(toTeam);
  const side = (teamId: string) => teams.find((team) => team?.teamId === teamId) ?? null;
  const away = side(game.away.teamId);
  const home = side(game.home.teamId);
  // Both or none: half a box score would look like a mistake.
  return away && home
    ? { gameId: game.id, away, home, updatedAt }
    : { gameId: game.id, away: null, home: null, updatedAt };
}

export async function fetchBoxscore(
  http: HttpClient,
  game: Game,
  updatedAt: string,
): Promise<BoxscoreResponse> {
  const data = await http.getJson(`${ESPN_BASE}/summary`, { params: { event: game.id } });
  return parseBoxscore(data, game, updatedAt);
}
