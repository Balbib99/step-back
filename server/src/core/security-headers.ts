import type { FastifyInstance } from 'fastify';

/**
 * What the app needs from the browser, and nothing more. Everything is its own (`'self'`): the
 * scripts, styles, fonts and pictures are all served by this server, even news pictures and
 * thumbnails, which it downloads and passes on. The only outside content is the YouTube player.
 * Inline styles are allowed on elements only (React sets some colours that way), never as <style>
 * blocks, and no inline script at all.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  'frame-src https://www.youtube-nocookie.com',
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  // Not "no-referrer": the YouTube player refuses to play without knowing which site embeds it.
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

// HSTS is not here: it only makes sense over HTTPS, which Caddy ends (deploy/Caddyfile.example).
export function registerSecurityHeaders(server: FastifyInstance): void {
  server.addHook('onSend', async (_request, reply) => {
    reply.headers(SECURITY_HEADERS);
  });
}
