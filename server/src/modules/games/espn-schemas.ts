import { z } from 'zod';

// What the adapter reads from ESPN, and nothing more. Everything else in the payload is ignored,
// so ESPN adding fields is harmless; ESPN renaming or dropping one of these fails loudly (see
// EspnFormatError in adapter.ts). Shapes differ slightly between the scoreboard and team schedule
// endpoints (score is a string in one and an object in the other); both are covered here.

const status = z.object({
  clock: z.number().optional(),
  displayClock: z.string().optional(),
  period: z.number().optional(),
  type: z.object({
    name: z.string(),
    state: z.enum(['pre', 'in', 'post']),
    completed: z.boolean().optional(),
    detail: z.string().optional(),
    shortDetail: z.string().optional(),
  }),
});

const score = z.union([
  z.string(),
  z.object({ value: z.number().optional(), displayValue: z.string().optional() }),
]);

const linescore = z.object({ value: z.number().optional(), displayValue: z.string().optional() });

const record = z.object({
  type: z.string().optional(),
  summary: z.string().optional(),
  displayValue: z.string().optional(),
});

const competitor = z.object({
  homeAway: z.enum(['home', 'away']),
  winner: z.boolean().optional(),
  score: score.optional(),
  linescores: z.array(linescore).optional(),
  // The scoreboard calls it `records`, the team schedule `record`.
  records: z.array(record).optional(),
  record: z.array(record).optional(),
  team: z.object({
    id: z.string(),
    abbreviation: z.string(),
    displayName: z.string(),
  }),
});

const competition = z.object({
  venue: z.object({ fullName: z.string().optional() }).optional(),
  competitors: z.array(competitor).length(2),
  status: status.optional(),
});

export const espnEvent = z.object({
  id: z.string(),
  date: z.string(),
  season: z.object({ year: z.number(), type: z.number().optional() }),
  /** Only the schedule endpoint carries the season type here; the scoreboard puts it in `season`. */
  seasonType: z.object({ type: z.number().optional() }).optional(),
  status: status.optional(),
  competitions: z.array(competition).min(1),
});

export const espnScoreboard = z.object({ events: z.array(espnEvent) });
export const espnSchedule = z.object({ events: z.array(espnEvent) });

const espnTeam = z.object({
  id: z.string(),
  abbreviation: z.string(),
  displayName: z.string(),
  shortDisplayName: z.string(),
  location: z.string(),
  logos: z.array(z.object({ href: z.string(), rel: z.array(z.string()).optional() })).optional(),
});

export const espnTeams = z.object({
  sports: z
    .array(
      z.object({ leagues: z.array(z.object({ teams: z.array(z.object({ team: espnTeam })) })) }),
    )
    .min(1),
});

export type EspnEvent = z.infer<typeof espnEvent>;
export type EspnStatus = z.infer<typeof status>;
export type EspnTeam = z.infer<typeof espnTeam>;
