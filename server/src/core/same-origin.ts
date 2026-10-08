import type { FastifyInstance } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The browser sends the saved Caddy password on its own with any request to this site, including
 * one that another web page triggers (a hidden form, a script). Without a check, such a page
 * could change the notification settings or burn the translation credit. Every browser says
 * where a request that changes something comes from (the Origin header), so one that does not
 * come from this very site is refused. Requests with no Origin (curl, scripts) are not browsers
 * acting on a page and pass.
 */
export function registerSameOriginCheck(server: FastifyInstance): void {
  server.addHook('onRequest', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    const { origin, host } = request.headers;
    if (origin === undefined) return;
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      // "null" and anything unparseable are not this site.
    }
    if (originHost !== undefined && originHost === host) return;
    return reply.code(403).send({
      error: 'cross_origin',
      message: 'Esta petición no viene de la propia aplicación.',
    });
  });
}
