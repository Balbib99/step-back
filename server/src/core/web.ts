import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves the built web app (index.html, hashed assets in /assets, icons, manifest).
 * Files in /assets carry a hash of their content in their name, so they can be cached for a
 * year; everything else is revalidated each time, so a new release shows up on the next open.
 */
export async function registerWeb(server: FastifyInstance, webDir: string): Promise<void> {
  const root = resolve(webDir);
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`WEB_DIR ${root} has no index.html: was the web app built?`);
  }
  await server.register(fastifyStatic, {
    root,
    wildcard: false,
    cacheControl: false,
    setHeaders(response, path) {
      const hashed = path.replaceAll('\\', '/').includes('/assets/');
      response.header('cache-control', hashed ? IMMUTABLE : 'no-cache');
    },
  });
}

/**
 * The app is a single page: a link such as /calendario has no file behind it, so the server
 * answers with index.html and the router in the browser shows the right screen. A missing file
 * (/assets/x.js) or anything under /api is a real 404.
 */
export function wantsSinglePage(request: FastifyRequest): boolean {
  if (request.method !== 'GET') return false;
  const { pathname } = new URL(request.url, 'http://localhost');
  return !pathname.startsWith('/api/') && extname(pathname) === '';
}

export function sendSinglePage(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-cache').sendFile('index.html');
}
