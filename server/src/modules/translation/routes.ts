import type { FastifyInstance } from 'fastify';
import { TranslateRequestError, type TranslationService } from './service.js';

export function registerTranslationRoutes(app: FastifyInstance, service: TranslationService): void {
  // Translates the title and summary of an English item into Spanish. Only when pressed, never by itself.
  app.post<{ Params: { id: string } }>('/news/:id/translate', async (request, reply) => {
    if (!/^\d{1,12}$/.test(request.params.id)) {
      return reply.code(404).send({ error: 'not_found', message: 'Esa noticia no existe.' });
    }
    try {
      return await service.translate(Number(request.params.id));
    } catch (error) {
      if (error instanceof TranslateRequestError) {
        return reply.code(error.status).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  // How much of the quota is used, so the screen can warn and turn the buttons off.
  app.get('/translation/status', async () => service.status());
}
