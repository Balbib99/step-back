import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../core/config.js';
import { addDays, isRealDate, localDaysRangeUtc } from './dates.js';
import type { GamesRepo } from './repo.js';

const MAX_RANGE_DAYS = 400;

const day = z.string().refine(isRealDate, 'must be a real date as YYYY-MM-DD');

const gamesQuery = z
  .object({
    date: day.optional(),
    from: day.optional(),
    to: day.optional(),
    team: z
      .string()
      .regex(/^[A-Za-z]{2,5}$/, 'must be a team abbreviation such as MIN')
      .transform((abbr) => abbr.toUpperCase())
      .optional(),
  })
  .refine((q) => !(q.date && (q.from || q.to)), {
    message: 'date cannot be combined with from or to',
  })
  .refine((q) => q.date || q.from || q.to || q.team, {
    message: 'give date, from/to or team',
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, { message: 'from must not be after to' })
  .refine((q) => !(q.from && q.to) || addDays(q.from, MAX_RANGE_DAYS) >= q.to, {
    message: `the range cannot exceed ${MAX_RANGE_DAYS} days`,
  });

/**
 * Days are local days of the configured time zone (Europe/Madrid by default), the same ones the
 * app shows, not the US Eastern days ESPN groups games by.
 */
export function registerGamesRoutes(app: FastifyInstance, repo: GamesRepo, config: Config): void {
  app.get('/teams', async () => ({ teams: repo.teams() }));

  app.get('/games', async (request, reply) => {
    const parsed = gamesQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_query',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    const { date, from, to, team } = parsed.data;

    let fromUtc: string | undefined;
    let toUtc: string | undefined;
    if (date) {
      ({ fromUtc, toUtc } = localDaysRangeUtc(date, date, config.timeZone));
    } else {
      if (from) fromUtc = localDaysRangeUtc(from, from, config.timeZone).fromUtc;
      if (to) toUtc = localDaysRangeUtc(to, to, config.timeZone).toUtc;
    }

    return {
      games: repo.games({
        ...(fromUtc && { fromUtc }),
        ...(toUtc && { toUtc }),
        ...(team && { teamAbbr: team }),
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/games/:id', async (request, reply) => {
    const game = repo.game(request.params.id);
    if (!game) return reply.code(404).send({ error: 'not_found' });
    return game;
  });
}
