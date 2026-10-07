import { z } from 'zod';

// What the adapter reads from ESPN's standings, and nothing more. Statistics are found by their
// `type` (wins, playoffseed, lasttengames...) rather than by their display names.

const stat = z.object({
  type: z.string(),
  value: z.number().optional(),
  displayValue: z.string().optional(),
  summary: z.string().optional(),
});

const entry = z.object({
  team: z.object({ id: z.string(), abbreviation: z.string(), displayName: z.string() }),
  stats: z.array(stat),
});

const conference = z.object({
  /** "East" or "West". */
  abbreviation: z.string(),
  standings: z.object({
    season: z.number(),
    seasonType: z.number(),
    entries: z.array(entry),
  }),
});

export const espnStandings = z.object({ children: z.array(conference) });

export type EspnStat = z.infer<typeof stat>;
export type EspnStandingEntry = z.infer<typeof entry>;
