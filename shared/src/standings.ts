import { z } from 'zod';
import { seasonTypeSchema } from './games.js';

export const conferenceSchema = z.enum(['east', 'west']);

export const standingEntrySchema = z.object({
  teamId: z.string(),
  abbr: z.string(),
  name: z.string(),
  /** Position in the conference, 1 to 15. */
  rank: z.number().int().min(1),
  wins: z.number().int(),
  losses: z.number().int(),
  /** Win percentage, 0 to 1. */
  winPct: z.number(),
  /** Games behind the leader of the conference; 0 for the leader. */
  gamesBehind: z.number(),
  /** "W3" or "L1". */
  streak: z.string().nullable(),
  home: z.string().nullable(),
  road: z.string().nullable(),
  last10: z.string().nullable(),
  /** Record against teams of its own conference, such as "31-21". */
  conferenceRecord: z.string().nullable(),
  divisionRecord: z.string().nullable(),
  /**
   * ESPN's mark of what the team has secured: z best record, y division title, x playoffs,
   * xp play-in, pb play-in berth, e eliminated, * other.
   */
  clincher: z.string().nullable(),
  pointsFor: z.number().nullable(),
  pointsAgainst: z.number().nullable(),
});

export const conferenceStandingsSchema = z.object({
  conference: conferenceSchema,
  /** Season by its ending year: 2027 is 2026-27. */
  season: z.number().int(),
  /**
   * Which games the table counts. In preseason ESPN answers with the preseason record, which is
   * not the official standings: the screen must say so.
   */
  seasonType: seasonTypeSchema,
  /** When the server last downloaded this table, ISO 8601 UTC. */
  updatedAt: z.string(),
  /** In rank order. */
  entries: z.array(standingEntrySchema),
});

export const standingsResponseSchema = z.object({ standings: z.array(conferenceStandingsSchema) });

export type Conference = z.infer<typeof conferenceSchema>;
export type StandingEntry = z.infer<typeof standingEntrySchema>;
export type ConferenceStandings = z.infer<typeof conferenceStandingsSchema>;
export type StandingsResponse = z.infer<typeof standingsResponseSchema>;
