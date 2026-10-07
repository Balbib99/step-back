import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GamesRepo } from '../games/repo.js';
import { ImageUnavailableError, type ImageStore } from '../news/images.js';
import { parseCursor } from '../news/repo.js';
import type { HighlightsRepo } from './repo.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const query = z.object({
  team: z
    .string()
    .transform((value) => value.split(',').map((team) => team.trim().toUpperCase()))
    .pipe(
      z
        .array(
          z.string().regex(/^[A-Z]{2,5}$/, 'team must be abbreviations such as MIN or MIN,LAL'),
        )
        .min(1)
        .max(30),
    )
    .optional(),
  before: z
    .string()
    .refine((value) => parseCursor(value) !== undefined, 'before is not a valid cursor')
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT, `limit cannot be more than ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
});

export function registerHighlightsRoutes(
  app: FastifyInstance,
  repo: HighlightsRepo,
  games: GamesRepo,
  thumbnails: ImageStore,
): void {
  // Newest first; `nextBefore` of a page is the `before` of the next one.
  app.get('/highlights', async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_query',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    const { team, before, limit } = parsed.data;
    return repo.list({ limit, ...(team && { teams: team }), ...(before && { before }) });
  });

  // A game without videos answers with an empty list, not an error: the screen says "aún sin jugadas".
  app.get<{ Params: { id: string } }>('/games/:id/highlights', async (request, reply) => {
    const game = games.game(request.params.id);
    if (!game) return reply.code(404).send({ error: 'not_found' });
    return { game, highlights: repo.forGame(game.id) };
  });

  app.get<{ Params: { id: string } }>('/highlights/:id/thumb', async (request, reply) => {
    if (!/^\d{1,12}$/.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    try {
      const image = await thumbnails.get(Number(request.params.id));
      if (!image) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('content-type', image.type)
        .header('cache-control', 'public, max-age=604800, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(image.bytes));
    } catch (error) {
      if (error instanceof ImageUnavailableError) {
        return reply.code(502).send({ error: 'image_unavailable' });
      }
      throw error;
    }
  });
}
