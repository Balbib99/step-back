import {
  pushSettingsSchema,
  pushSubscriptionSchema,
  pushTestSchema,
  pushUnsubscribeSchema,
} from '@step-back/shared';
import type { FastifyInstance } from 'fastify';
import type { PushRepo } from './repo.js';
import type { PushProvider } from './sender.js';

export function registerPushRoutes(
  app: FastifyInstance,
  deps: {
    repo: PushRepo;
    favorites: readonly string[];
    enabled: boolean;
    provider: PushProvider | undefined;
  },
): void {
  const { repo, favorites, enabled, provider } = deps;

  // Without VAPID keys nothing can be sent, so nothing is stored either.
  app.addHook('preHandler', async (_request, reply) => {
    if (enabled) return;
    return reply.code(503).send({
      error: 'push_disabled',
      message: 'Las notificaciones no están activadas en el servidor.',
    });
  });

  const invalid = (
    reply: { code(status: number): { send(body: unknown): unknown } },
    message: string,
  ) => reply.code(400).send({ error: 'invalid_request', message });

  // Saving the same browser twice is fine: the keys are refreshed.
  app.post('/push/subscribe', async (request, reply) => {
    const parsed = pushSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'La suscripción no es válida.');
    if (!parsed.data.endpoint.startsWith('https://')) {
      return invalid(reply, 'La suscripción debe usar HTTPS.');
    }
    repo.saveSubscription(parsed.data);
    return reply.code(201).send({ subscribed: true });
  });

  app.delete('/push/subscribe', async (request, reply) => {
    const parsed = pushUnsubscribeSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'Falta la suscripción que se quiere borrar.');
    repo.deleteSubscription(parsed.data.endpoint);
    return { subscribed: false };
  });

  // Sends one notification to the browser that asks, so the owner can see that it all works.
  app.post('/push/test', async (request, reply) => {
    const parsed = pushTestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'Falta el dispositivo al que enviar la prueba.');
    const subscription = repo.subscriptions().find((s) => s.endpoint === parsed.data.endpoint);
    if (!subscription || !provider) {
      return reply.code(404).send({
        error: 'not_subscribed',
        message:
          'Este dispositivo no está suscrito. Desactiva y vuelve a activar las notificaciones.',
      });
    }
    try {
      await provider.send(
        subscription,
        {
          title: 'Notificación de prueba',
          body: 'Si ves esto, los avisos de step-back funcionan.',
          url: '/ajustes',
          tag: 'test',
        },
        5 * 60,
      );
    } catch (error) {
      const status = (error as { statusCode?: unknown } | null)?.statusCode;
      if (status === 404 || status === 410) {
        repo.deleteSubscription(subscription.endpoint);
        return reply.code(410).send({
          error: 'subscription_gone',
          message:
            'El navegador ya no acepta avisos. Desactiva y vuelve a activar las notificaciones.',
        });
      }
      request.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'push test failed',
      );
      return reply.code(502).send({
        error: 'push_failed',
        message: 'El servicio de notificaciones no respondió. Inténtalo de nuevo.',
      });
    }
    return { sent: true };
  });

  app.get('/push/settings', async () => ({ teams: repo.settings(favorites) }));

  // Teams left out keep what they had. Only favourites have settings.
  app.put('/push/settings', async (request, reply) => {
    const parsed = pushSettingsSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'Los ajustes no son válidos.');
    const teams = parsed.data.teams.map((s) => s.team);
    if (teams.some((team) => !favorites.includes(team)) || new Set(teams).size !== teams.length) {
      return invalid(reply, 'Solo se pueden ajustar los equipos favoritos, una vez cada uno.');
    }
    repo.saveSettings(parsed.data.teams);
    return { teams: repo.settings(favorites) };
  });
}
