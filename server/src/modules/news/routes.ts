import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ImageUnavailableError, type ImageStore } from './images.js';
import { parseCursor, type NewsRepo } from './repo.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const teamList = z
  .string()
  .transform((value) => value.split(',').map((team) => team.trim().toUpperCase()))
  .pipe(
    z
      .array(z.string().regex(/^[A-Z]{2,5}$/, 'team must be abbreviations such as MIN or MIN,LAL'))
      .min(1)
      .max(30),
  );

const newsQuery = z.object({
  team: teamList.optional(),
  player: z.string().trim().min(1).max(80).optional(),
  lang: z.enum(['en', 'es'], { message: 'lang must be en or es' }).optional(),
  media: z.enum(['video'], { message: 'media must be video' }).optional(),
  shorts: z
    .enum(['only', 'exclude', 'include'], { message: 'shorts must be only, exclude or include' })
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

export function registerNewsRoutes(app: FastifyInstance, repo: NewsRepo, images: ImageStore): void {
  // Newest first; `nextBefore` of a page is the `before` of the next one.
  app.get('/news', async (request, reply) => {
    const parsed = newsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_query',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    const { team, player, lang, media, shorts, before, limit } = parsed.data;
    return repo.list({
      limit,
      ...(team && { teams: team }),
      ...(player && { player }),
      ...(lang && { lang }),
      ...(media && { media }),
      ...(shorts && { shorts }),
      ...(before && { before }),
    });
  });

  app.get<{ Params: { id: string } }>('/news/:id', async (request, reply) => {
    const item = /^\d{1,12}$/.test(request.params.id)
      ? repo.get(Number(request.params.id))
      : undefined;
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return item;
  });

  app.get<{ Params: { id: string } }>('/news/:id/image', async (request, reply) => {
    if (!/^\d{1,12}$/.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    try {
      const image = await images.get(Number(request.params.id));
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
