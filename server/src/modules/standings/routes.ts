import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StandingsRepo } from './repo.js';

const query = z.object({
  conference: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(['east', 'west'], { message: 'must be east or west' }))
    .optional(),
});

export function registerStandingsRoutes(app: FastifyInstance, repo: StandingsRepo): void {
  // Both conferences by default, or one with ?conference=east|west. Before the first download
  // the list is empty (the screen says so) rather than an error.
  app.get('/standings', async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_query',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    return { standings: repo.get(parsed.data.conference) };
  });
}
