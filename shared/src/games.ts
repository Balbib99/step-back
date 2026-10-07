import { z } from 'zod';

export const seasonTypeSchema = z.enum(['preseason', 'regular', 'playoffs']);
export const gameStatusSchema = z.enum(['scheduled', 'live', 'final', 'postponed', 'canceled']);

export const teamSchema = z.object({
  /** ESPN team id. */
  id: z.string(),
  /** ESPN abbreviation; also the key of the team palettes (MIN, LAL, GS, NY, ...). */
  abbr: z.string(),
  name: z.string(),
  shortName: z.string(),
  location: z.string(),
  logoUrl: z.string().nullable(),
});

export const gameTeamSchema = z.object({
  teamId: z.string(),
  abbr: z.string(),
  /** Full name. Needed because a game can be against a team that is not in the NBA (a preseason game against a club from London). */
  name: z.string(),
  /** Null until the game is live or final (a scheduled game has no 0-0 score). */
  score: z.number().int().nullable(),
  /** Overall record such as "1-0", when the source gives it. */
  record: z.string().nullable(),
  /** Null until the game is final. */
  winner: z.boolean().nullable(),
  /** Points per period (quarters, then overtimes). Empty before tip-off. */
  linescores: z.array(z.number().int()),
});

export const gameSchema = z.object({
  /** ESPN event id. */
  id: z.string(),
  /** Season by its ending year: 2027 is 2026-27. */
  season: z.number().int(),
  seasonType: seasonTypeSchema,
  /** ISO 8601 UTC. */
  startUtc: z.string(),
  status: gameStatusSchema,
  /** The source's short description: "Final", "4:12 - 3rd", "10/7 - 7:00 PM EDT". */
  statusDetail: z.string(),
  /** Current period while live, else null. */
  period: z.number().int().nullable(),
  /** Clock of the current period while live ("4:12"), else null. */
  clock: z.string().nullable(),
  venue: z.string().nullable(),
  home: gameTeamSchema,
  away: gameTeamSchema,
});

export type SeasonType = z.infer<typeof seasonTypeSchema>;
export type GameStatus = z.infer<typeof gameStatusSchema>;
export type Team = z.infer<typeof teamSchema>;
export type GameTeam = z.infer<typeof gameTeamSchema>;
export type Game = z.infer<typeof gameSchema>;

/** 2027 -> "2026-27". */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(-2)}`;
}
