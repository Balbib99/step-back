import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../core/config.js';
import { addDays, isRealDate, localDaysRangeUtc } from './dates.js';
import { CrestUnavailableError, type CrestStore } from './crests.js';
import { BoxscoreUnavailableError, type BoxscoreService } from './boxscore-service.js';
import { HeadshotUnavailableError, isPlayerId, type HeadshotStore } from './headshots.js';
import type { GamesRepo } from './repo.js';

const MAX_RANGE_DAYS = 400;

export const crestPath = (abbr: string) => `/api/crests/${abbr}.png`;

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
export function registerGamesRoutes(
  app: FastifyInstance,
  repo: GamesRepo,
  config: Config,
  crests: CrestStore,
  boxscores: BoxscoreService,
  headshots: HeadshotStore,
): void {
  app.get('/teams', async () => ({
    teams: repo.teams().map((team) => ({ ...team, crestUrl: crestPath(team.abbr) })),
  }));

  // Crests are downloaded from ESPN once, shrunk and kept on disk; the browser never talks to ESPN.
  app.get<{ Params: { file: string } }>('/crests/:file', async (request, reply) => {
    const abbr = /^([A-Za-z]{2,5}).png$/.exec(request.params.file)?.[1]?.toUpperCase();
    if (!abbr) return reply.code(404).send({ error: 'not_found' });
    try {
      const image = await crests.get(abbr);
      if (!image) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('content-type', 'image/png')
        .header('cache-control', 'public, max-age=604800')
        .send(Buffer.from(image));
    } catch (error) {
      if (error instanceof CrestUnavailableError) {
        return reply.code(502).send({ error: 'crest_unavailable' });
      }
      throw error;
    }
  });

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

  // The numbers of each player. Asked of ESPN only when someone looks, and kept for a short time.
  app.get<{ Params: { id: string } }>('/games/:id/boxscore', async (request, reply) => {
    try {
      const boxscore = await boxscores.get(request.params.id);
      if (!boxscore) return reply.code(404).send({ error: 'not_found' });
      return boxscore;
    } catch (error) {
      if (error instanceof BoxscoreUnavailableError) {
        return reply.code(502).send({
          error: 'boxscore_unavailable',
          message: 'No se pudieron obtener las estadísticas. Inténtalo más tarde.',
        });
      }
      throw error;
    }
  });

  // Player photos are downloaded from ESPN once, kept on disk and served from here.
  app.get<{ Params: { id: string } }>('/players/:id/headshot', async (request, reply) => {
    if (!isPlayerId(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    try {
      const photo = await headshots.get(request.params.id);
      if (!photo) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('content-type', 'image/png')
        .header('cache-control', 'public, max-age=604800')
        .send(Buffer.from(photo));
    } catch (error) {
      if (error instanceof HeadshotUnavailableError) {
        return reply.code(502).send({ error: 'headshot_unavailable' });
      }
      throw error;
    }
  });
}
