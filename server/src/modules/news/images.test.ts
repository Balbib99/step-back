import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '../../core/http.js';
import { createLogger } from '../../core/logger.js';
import { createImageStore, ImageUnavailableError } from './images.js';

// The pictures of the news are fetched from addresses that third parties write. A picture address
// must not be able to make the server call something inside its own network, directly or through
// a redirect.

const logger = createLogger({ env: 'test', logLevel: 'info' });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const INTERNAL = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'step-back-images-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(
  respond: (url: string) => Response,
  names: Record<string, string[]> = {},
  mediaUrl = 'https://pics.example.com/a.png',
) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    requested.push(String(url));
    return respond(String(url));
  }) as unknown as typeof fetch;
  const asked: string[] = [];
  const store = createImageStore({
    dir,
    http: createHttpClient({
      userAgent: 'test',
      fetch: fetchMock,
      minIntervalMs: 0,
      retries: 2,
      sleep: async () => undefined,
    }),
    repo: { mediaUrl: () => mediaUrl },
    logger,
    resolve: async (host) => {
      asked.push(host);
      return names[host] ?? ['93.184.216.34'];
    },
  });
  return { store, requested, asked };
}

const redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } });

describe('the picture store, with addresses written by third parties', () => {
  it('downloads a picture from a public https address', async () => {
    const { store, requested } = setup(() => new Response(PNG));
    expect((await store.get(1))?.type).toBe('image/png');
    expect(requested).toEqual(['https://pics.example.com/a.png']);
  });

  it('follows a redirect to another public address, and checks it too', async () => {
    const { store, requested, asked } = setup((url) =>
      url.includes('pics.') ? redirect('https://cdn.example.net/real.png') : new Response(PNG),
    );
    expect((await store.get(1))?.type).toBe('image/png');
    expect(requested).toEqual([
      'https://pics.example.com/a.png',
      'https://cdn.example.net/real.png',
    ]);
    expect(asked).toEqual(['pics.example.com', 'cdn.example.net']);
  });

  it('refuses a redirect to an internal http service, and never calls it', async () => {
    const { store, requested } = setup((url) =>
      url.startsWith('https://pics.')
        ? redirect('http://127.0.0.1:8080/cam/snapshot.png')
        : new Response(INTERNAL),
    );
    await expect(store.get(1)).rejects.toBeInstanceOf(ImageUnavailableError);
    expect(requested).toEqual(['https://pics.example.com/a.png']);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a redirect to a name that resolves inside the network', async () => {
    const { store, requested } = setup(
      (url) =>
        url.startsWith('https://pics.')
          ? redirect('https://cam.example.org/x.png')
          : new Response(INTERNAL),
      { 'cam.example.org': ['10.0.0.1'] },
    );
    await expect(store.get(1)).rejects.toBeInstanceOf(ImageUnavailableError);
    expect(requested).toEqual(['https://pics.example.com/a.png']);
  });

  it('refuses a first address whose name resolves to 10.0.0.1', async () => {
    const { store, requested } = setup(() => new Response(INTERNAL), {
      'pics.example.com': ['10.0.0.1'],
    });
    await expect(store.get(1)).rejects.toBeInstanceOf(ImageUnavailableError);
    expect(requested).toEqual([]);
  });

  it.each([
    'https://localhost./a.png',
    'https://router.lan./a.png',
    'https://127.0.0.1.nip.io/a.png',
  ])('refuses %s', async (address) => {
    const { store, requested } = setup(
      () => new Response(INTERNAL),
      { '127.0.0.1.nip.io': ['127.0.0.1'] },
      address,
    );
    await expect(store.get(1)).rejects.toBeInstanceOf(ImageUnavailableError);
    expect(requested).toEqual([]);
  });

  it('gives up after three redirects', async () => {
    const { store, requested } = setup((url) => redirect(`${url}x`));
    await expect(store.get(1)).rejects.toBeInstanceOf(ImageUnavailableError);
    expect(requested).toHaveLength(4);
  });

  it('does not retry a refusal: it is not a failure of the other side', async () => {
    const { store, requested } = setup(() => redirect('http://127.0.0.1/x.png'));
    await expect(store.get(1)).rejects.toBeInstanceOf(ImageUnavailableError);
    expect(requested).toHaveLength(1);
  });
});
