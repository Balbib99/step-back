import { z } from 'zod';

/** The numbers of one player in one game, or the totals of a team. Null where there is none. */
export const statLineSchema = z.object({
  minutes: z.number().int().nullable(),
  points: z.number().int().nullable(),
  rebounds: z.number().int().nullable(),
  assists: z.number().int().nullable(),
  steals: z.number().int().nullable(),
  blocks: z.number().int().nullable(),
  turnovers: z.number().int().nullable(),
  fouls: z.number().int().nullable(),
  /** Made-attempted, such as "7-15". */
  fieldGoals: z.string().nullable(),
  threePointers: z.string().nullable(),
  freeThrows: z.string().nullable(),
  /** Points scored minus allowed while he was on court. */
  plusMinus: z.number().int().nullable(),
});

export const playerLineSchema = statLineSchema.extend({
  id: z.string(),
  name: z.string(),
  /** "A. Edwards". */
  shortName: z.string(),
  jersey: z.string().nullable(),
  /** "G", "F", "C"... */
  position: z.string().nullable(),
  /** Where the app serves his photo from, or null when the source has none. */
  photoUrl: z.string().nullable().default(null),
  starter: z.boolean(),
  /** False for a player who has not been on court: all his numbers are null. */
  played: z.boolean(),
  /** Why he did not play, when the source says ("COACH'S DECISION"). */
  reason: z.string().nullable(),
});

export const teamBoxscoreSchema = z.object({
  teamId: z.string(),
  abbr: z.string(),
  /** Starters first, then the bench, then those who did not play. */
  players: z.array(playerLineSchema),
  totals: statLineSchema,
});

export const boxscoreResponseSchema = z.object({
  gameId: z.string(),
  /** Null while the source has no numbers for that team (a game that has not started). */
  away: teamBoxscoreSchema.nullable(),
  home: teamBoxscoreSchema.nullable(),
  /** ISO 8601 UTC: when the server got these numbers. */
  updatedAt: z.string(),
});

export type StatLine = z.infer<typeof statLineSchema>;
export type PlayerLine = z.infer<typeof playerLineSchema>;
export type TeamBoxscore = z.infer<typeof teamBoxscoreSchema>;
export type BoxscoreResponse = z.infer<typeof boxscoreResponseSchema>;
