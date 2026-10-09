import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app has no password of its own: Caddy is the only door. These checks keep the Pi compose
// file from putting it back on a network that other apps use, or on a port of the host.

const compose = readFileSync(resolve(import.meta.dirname, '../../../deploy/compose.yaml'), 'utf8')
  .split(/\r?\n/)
  // The comments talk about the networks that are not allowed, so they do not count.
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** The lines of a top-level or service-level block, from its key to the next one at the same indent. */
function block(source: string, key: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex(
    (line) => line.trimEnd() === `${key}:` || line.endsWith(` ${key}:`),
  );
  if (start === -1) return [];
  const indent = lines[start]!.length - lines[start]!.trimStart().length;
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const own = line.length - line.trimStart().length;
    if (line.trim() && own <= indent) break;
    if (line.trim()) found.push(line);
  }
  return found;
}

describe('deploy/compose.yaml: who can reach the app', () => {
  it('puts the service on one network only, the private one it shares with Caddy', () => {
    const service = block(compose, 'networks').map((line) => line.trim());
    expect(service).toEqual(['- proxy']);
  });

  it('creates that network itself, with its own name, instead of joining a shared one', () => {
    const top = block(compose.split('\nnetworks:\n').slice(1).join('\nnetworks:\n'), 'proxy');
    const text = top.join('\n');
    expect(text).toContain('name: ${PROXY_NETWORK:-step-back-proxy}');
    expect(text).not.toContain('external');
  });

  it('is not on the network the other apps use', () => {
    expect(compose).not.toMatch(/\bedge\b/);
    expect(compose).not.toContain('CADDY_NETWORK');
  });

  it('publishes no port on the host, so the only way in is through Caddy', () => {
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(block(compose, 'expose').map((line) => line.trim())).toEqual(["- '3000'"]);
  });
});
