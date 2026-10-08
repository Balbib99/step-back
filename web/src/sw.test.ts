import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServiceWorker } from '../vite-plugin-sw';

// The service worker is a plain script. It is run here against a fake storage (`caches`), a fake
// network and fake events, so every route and fallback can be tried without a browser.

const ORIGIN = 'https://step-back.test';
const PRECACHE = [
  '/',
  '/assets/index-abc.js',
  '/assets/index-abc.css',
  '/icons/icon-192.png',
  '/manifest.webmanifest',
];

// Like the real Cache, a path such as "/" means that path on this site.
const keyOf = (request: string | { url: string }) => {
  const url = typeof request === 'string' ? request : request.url;
  return url.startsWith('/') ? `${ORIGIN}${url}` : url;
};

class FakeCache {
  entries = new Map<string, Response>();
  async put(request: string | { url: string }, response: Response) {
    this.entries.set(keyOf(request), response);
  }
  async match(request: string | { url: string }) {
    return this.entries.get(keyOf(request))?.clone();
  }
  async delete(request: string | { url: string }) {
    return this.entries.delete(keyOf(request));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async addAll(urls: string[]) {
    for (const url of urls) this.entries.set(`${ORIGIN}${url}`, new Response(`stored ${url}`));
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

type Handler = (request: { url: string; method: string }) => Response | Promise<Response>;

function load(options: { precache?: string[]; build?: string } = {}) {
  const listeners = new Map<string, (event: never) => void>();
  const caches = new FakeCaches();
  const network = {
    handler: (async () => new Response('', { status: 404 })) as Handler,
    requests: [] as string[],
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: never) => void) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async (): Promise<FakeClient[]> => []),
      openWindow: vi.fn(async () => undefined),
    },
    registration: { showNotification: vi.fn(async () => undefined) },
  };
  const fetchFake = async (request: { url: string; method: string }) => {
    network.requests.push(request.url);
    return network.handler(request);
  };
  const template = readFileSync(resolve(import.meta.dirname, '../sw/sw.js'), 'utf8');
  const source = renderServiceWorker(
    template,
    options.precache ?? PRECACHE,
    options.build ?? 'build1',
  );
  new Function('self', 'caches', 'fetch', source)(self, caches, fetchFake);

  /** Sends a request through the worker; undefined when the worker lets the browser handle it. */
  async function request(
    path: string,
    init: { method?: string; mode?: string; origin?: string } = {},
  ): Promise<{ response: Response | undefined; waits: Promise<unknown>[]; handled: boolean }> {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    const event = {
      request: {
        url: `${init.origin ?? ORIGIN}${path}`,
        method: init.method ?? 'GET',
        mode: init.mode ?? 'cors',
      },
      respondWith: (promise: Promise<Response>) => (answer = promise),
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    };
    listeners.get('fetch')!(event as never);
    const response = answer ? await answer : undefined;
    // The worker saves copies after answering. The fake storage works in microtasks only, so
    // letting them run is enough for the copy to be there (a request that never answers is not awaited).
    for (let tick = 0; tick < 50; tick++) await Promise.resolve();
    return { response, waits, handled: answer !== undefined };
  }

  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    } as never);
    await Promise.all(waits);
  };

  /** Delivers an event to the worker and waits for what it asked to wait for. */
  const dispatch = async (type: string, event: object) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    } as never);
    await Promise.all(waits);
  };

  return { self, caches, network, request, lifecycle, dispatch };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const SAVED_AT = 'x-step-back-saved-at';
const FROM_STORAGE = 'x-step-back-from-storage';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('installing and updating', () => {
  it('stores the whole app shell and takes over at once', async () => {
    const worker = load();
    await worker.lifecycle('install');
    const shell = worker.caches.stores.get('step-back-shell-build1')!;
    expect([...shell.entries.keys()].map((url) => url.replace(ORIGIN, ''))).toEqual(PRECACHE);
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });

  it('on activation removes the shells of older builds and keeps data and pictures', async () => {
    const worker = load({ build: 'build2' });
    for (const name of [
      'step-back-shell-build1',
      'step-back-shell-build2',
      'step-back-data-v1',
      'step-back-pictures-v1',
      'another-site',
    ]) {
      await worker.caches.open(name);
    }
    await worker.lifecycle('activate');
    expect([...worker.caches.stores.keys()].sort()).toEqual([
      'another-site',
      'step-back-data-v1',
      'step-back-pictures-v1',
      'step-back-shell-build2',
    ]);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });
});

describe('what the worker leaves alone', () => {
  it.each([
    ['a POST', '/api/news/1/translate', { method: 'POST' }],
    ['another site', '/api/games', { origin: 'https://other.example' }],
    ['the health check', '/api/health', {}],
    ['a file that is not part of the app', '/something-else.txt', {}],
  ])('does not answer %s', async (_name, path, init) => {
    const worker = load();
    const result = await worker.request(path, init);
    expect(result.handled).toBe(false);
  });

  it('never stores the health check, so the app can tell the server is down', async () => {
    const worker = load();
    worker.network.handler = () => json({ status: 'ok' });
    await worker.request('/api/health');
    expect([...worker.caches.stores.keys()]).toEqual([]);
  });
});

describe('the app shell', () => {
  it('answers a stored file without the network', async () => {
    const worker = load();
    await worker.lifecycle('install');
    const { response } = await worker.request('/assets/index-abc.js');
    expect(await response!.text()).toBe('stored /assets/index-abc.js');
    expect(worker.network.requests).toEqual([]);
  });
});

describe('screens (navigations)', () => {
  const open = (worker: ReturnType<typeof load>) =>
    worker.request('/calendario', { mode: 'navigate' });

  it('uses the network when there is one, and keeps its page as the shell', async () => {
    const worker = load();
    await worker.lifecycle('install');
    worker.network.handler = () => new Response('fresh page');
    const { response, waits } = await open(worker);
    await Promise.all(waits);

    expect(await response!.text()).toBe('fresh page');
    const shell = worker.caches.stores.get('step-back-shell-build1')!;
    expect(await (await shell.match('/'))!.text()).toBe('fresh page');
  });

  it('opens the stored shell when there is no connection', async () => {
    const worker = load();
    await worker.lifecycle('install');
    worker.network.handler = () => {
      throw new TypeError('Failed to fetch');
    };
    const { response } = await open(worker);
    expect(await response!.text()).toBe('stored /');
  });

  it('opens the stored shell when the network takes more than three seconds', async () => {
    const worker = load();
    await worker.lifecycle('install');
    worker.network.handler = () => new Promise(() => undefined); // never answers
    const pending = open(worker);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await (await pending).response!.text()).toBe('stored /');
  });

  it('does not store an error page as the shell', async () => {
    const worker = load();
    await worker.lifecycle('install');
    worker.network.handler = () => new Response('Unauthorized', { status: 401 });
    const { response, waits } = await open(worker);
    await Promise.all(waits);
    expect(response!.status).toBe(401);
    const shell = worker.caches.stores.get('step-back-shell-build1')!;
    expect(await (await shell.match('/'))!.text()).toBe('stored /');
  });

  it('fails like a browser would when there is neither network nor shell', async () => {
    const worker = load();
    worker.network.handler = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(open(worker)).rejects.toThrow('Failed to fetch');
  });
});

describe('data (/api)', () => {
  const data = (worker: ReturnType<typeof load>) => worker.caches.stores.get('step-back-data-v1')!;

  it('gives the live answer when online, and keeps a copy with the moment it was saved', async () => {
    const worker = load();
    worker.network.handler = () => json({ games: [1] });
    const { response } = await worker.request('/api/games?date=2026-10-07');

    expect(await response!.json()).toEqual({ games: [1] });
    expect(response!.headers.get(FROM_STORAGE)).toBeNull();
    const copy = await data(worker).match(`${ORIGIN}/api/games?date=2026-10-07`);
    expect(await copy!.json()).toEqual({ games: [1] });
    expect(copy!.headers.get(SAVED_AT)).toBe(String(Date.now()));
  });

  it('gives the last copy, marked, when there is no connection', async () => {
    const worker = load();
    worker.network.handler = () => json({ games: [1] });
    await worker.request('/api/games');
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    worker.network.handler = () => {
      throw new TypeError('Failed to fetch');
    };
    const { response } = await worker.request('/api/games');

    expect(await response!.json()).toEqual({ games: [1] });
    expect(response!.headers.get(FROM_STORAGE)).toBe('1');
    // The moment it was saved, five minutes ago: the app says "actualizado hace 5 min".
    expect(Number(response!.headers.get(SAVED_AT))).toBe(Date.now() - 5 * 60_000);
  });

  it('always shows the latest when online, never a stale copy first', async () => {
    const worker = load();
    worker.network.handler = () => json({ score: 78 });
    await worker.request('/api/games');
    worker.network.handler = () => json({ score: 80 });
    const { response } = await worker.request('/api/games');
    expect(await response!.json()).toEqual({ score: 80 });
  });

  it('replaces the copy with the newer answer', async () => {
    const worker = load();
    worker.network.handler = () => json({ score: 78 });
    await worker.request('/api/games');
    worker.network.handler = () => json({ score: 80 });
    await worker.request('/api/games');
    expect(await (await data(worker).match(`${ORIGIN}/api/games`))!.json()).toEqual({ score: 80 });
    expect(data(worker).entries.size).toBe(1);
  });

  it('keeps each address apart, query included', async () => {
    const worker = load();
    worker.network.handler = (request) => json({ url: request.url });
    await worker.request('/api/games?date=2026-10-07');
    await worker.request('/api/games?date=2026-10-08');
    expect(data(worker).entries.size).toBe(2);
  });

  it('stores the configuration too, which every screen needs to open offline', async () => {
    const worker = load();
    worker.network.handler = () => json({ timeZone: 'Europe/Madrid' });
    await worker.request('/api/config');
    expect(data(worker).entries.has(`${ORIGIN}/api/config`)).toBe(true);
  });

  describe('when the network is slow', () => {
    it('uses the copy after four seconds, and the slow answer still refreshes it', async () => {
      const worker = load();
      worker.network.handler = () => json({ score: 78 });
      await worker.request('/api/games');

      let finish!: (response: Response) => void;
      worker.network.handler = () => new Promise<Response>((resolve) => (finish = resolve));
      const pending = worker.request('/api/games');
      await vi.advanceTimersByTimeAsync(4000);
      const { response, waits } = await pending;

      expect(await response!.json()).toEqual({ score: 78 });
      expect(response!.headers.get(FROM_STORAGE)).toBe('1');

      finish(json({ score: 80 }));
      await Promise.all(waits);
      expect(await (await data(worker).match(`${ORIGIN}/api/games`))!.json()).toEqual({
        score: 80,
      });
    });

    it('waits for the answer when there is no copy to use instead', async () => {
      const worker = load();
      let finish!: (response: Response) => void;
      worker.network.handler = () => new Promise<Response>((resolve) => (finish = resolve));
      const pending = worker.request('/api/games');
      await vi.advanceTimersByTimeAsync(10_000);
      finish(json({ score: 80 }));
      expect(await (await pending).response!.json()).toEqual({ score: 80 });
    });
  });

  describe('when the server fails', () => {
    it('uses the copy instead of a server error', async () => {
      const worker = load();
      worker.network.handler = () => json({ games: [1] });
      await worker.request('/api/games');
      worker.network.handler = () => json({ error: 'internal_error' }, 500);

      const { response } = await worker.request('/api/games');
      expect(await response!.json()).toEqual({ games: [1] });
      expect(response!.headers.get(FROM_STORAGE)).toBe('1');
    });

    it('gives the error itself when there is no copy, and stores nothing', async () => {
      const worker = load();
      worker.network.handler = () => json({ error: 'internal_error' }, 500);
      const { response } = await worker.request('/api/games');
      expect(response!.status).toBe(500);
      expect(await response!.json()).toEqual({ error: 'internal_error' });
      expect(data(worker).entries.size).toBe(0);
    });

    it.each([400, 401, 404])(
      'does not store a %s, and does not hide it with an old copy',
      async (status) => {
        const worker = load();
        worker.network.handler = () => json({ games: [1] });
        await worker.request('/api/games');
        worker.network.handler = () => json({ error: 'nope' }, status);

        const { response } = await worker.request('/api/games');
        expect(response!.status).toBe(status);
        // The good copy is still there for when there is no connection.
        expect(await (await data(worker).match(`${ORIGIN}/api/games`))!.json()).toEqual({
          games: [1],
        });
      },
    );

    it('fails when there is neither network nor copy', async () => {
      const worker = load();
      worker.network.handler = () => {
        throw new TypeError('Failed to fetch');
      };
      await expect(worker.request('/api/games')).rejects.toThrow('Failed to fetch');
    });
  });

  it('keeps at most 150 answers, dropping the oldest', async () => {
    const worker = load();
    worker.network.handler = (request) => json({ url: request.url });
    for (let day = 0; day < 155; day++) await worker.request(`/api/games?n=${day}`);
    const urls = [...data(worker).entries.keys()];
    expect(urls).toHaveLength(150);
    expect(urls[0]).toBe(`${ORIGIN}/api/games?n=5`);
    expect(urls.at(-1)).toBe(`${ORIGIN}/api/games?n=154`);
  });

  it('an address asked for again counts as the newest, not the oldest', async () => {
    const worker = load();
    worker.network.handler = (request) => json({ url: request.url });
    for (let day = 0; day < 150; day++) await worker.request(`/api/games?n=${day}`);
    await worker.request('/api/games?n=0'); // asked for again
    await worker.request('/api/games?n=150'); // one more: the oldest now is n=1
    const urls = [...data(worker).entries.keys()];
    expect(urls).toContain(`${ORIGIN}/api/games?n=0`);
    expect(urls).not.toContain(`${ORIGIN}/api/games?n=1`);
  });
});

describe('pictures', () => {
  const pictures = (worker: ReturnType<typeof load>) =>
    worker.caches.stores.get('step-back-pictures-v1')!;
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it.each(['/api/crests/MIN.png', '/api/news/12/image', '/api/highlights/7/thumb'])(
    'downloads %s once and then answers it from storage',
    async (path) => {
      const worker = load();
      worker.network.handler = () =>
        new Response(PNG, { headers: { 'content-type': 'image/png' } });
      await worker.request(path);
      worker.network.handler = () => {
        throw new TypeError('Failed to fetch');
      };
      const { response } = await worker.request(path); // offline now
      expect(new Uint8Array(await response!.arrayBuffer())).toEqual(PNG);
      expect(response!.headers.get('content-type')).toBe('image/png');
      expect(pictures(worker).entries.size).toBe(1);
    },
  );

  it('does not ask the network again for a picture it has', async () => {
    const worker = load();
    worker.network.handler = () => new Response(PNG);
    await worker.request('/api/news/12/image');
    await worker.request('/api/news/12/image');
    expect(worker.network.requests).toEqual([`${ORIGIN}/api/news/12/image`]);
  });

  it('does not keep a picture that failed', async () => {
    const worker = load();
    worker.network.handler = () => json({ error: 'image_unavailable' }, 502);
    const { response } = await worker.request('/api/news/12/image');
    expect(response!.status).toBe(502);
    expect(pictures(worker).entries.size).toBe(0);
  });

  it('treats a news item as data, not as a picture', async () => {
    const worker = load();
    worker.network.handler = () => json({ id: 12 });
    await worker.request('/api/news/12');
    expect(worker.caches.stores.get('step-back-data-v1')!.entries.size).toBe(1);
    expect(worker.caches.stores.get('step-back-pictures-v1')).toBeUndefined();
  });

  it('keeps at most 100 pictures, dropping the oldest', async () => {
    const worker = load();
    worker.network.handler = () => new Response(PNG);
    for (let id = 1; id <= 105; id++) await worker.request(`/api/news/${id}/image`);
    const urls = [...pictures(worker).entries.keys()];
    expect(urls).toHaveLength(100);
    expect(urls[0]).toBe(`${ORIGIN}/api/news/6/image`);
  });
});

describe('notifications', () => {
  const pushOf = (data: unknown) => ({
    data: { json: () => (typeof data === 'string' ? JSON.parse(data) : data) },
  });
  const shown = (worker: ReturnType<typeof load>) =>
    worker.self.registration.showNotification.mock.calls[0] as unknown as [
      string,
      NotificationOptions,
    ];

  it('shows the message the server sent, and keeps where it leads', async () => {
    const worker = load();
    await worker.dispatch(
      'push',
      pushOf({
        title: 'Final: MIN 104 – 99 LAL',
        body: 'Gana Minnesota.',
        url: '/partido/42',
        tag: 'end:42',
      }),
    );
    const [title, options] = shown(worker);
    expect(title).toBe('Final: MIN 104 – 99 LAL');
    expect(options).toMatchObject({
      badge: '/icons/badge-96.png',
      body: 'Gana Minnesota.',
      tag: 'end:42',
      data: { url: '/partido/42' },
    });
  });

  it('still shows something when the message cannot be read', async () => {
    const worker = load();
    await worker.dispatch('push', { data: { json: () => JSON.parse('not json') } });
    expect(shown(worker)[0]).toBe('step-back');
    await worker.dispatch('push', {}); // a push with no data at all
    expect(worker.self.registration.showNotification).toHaveBeenCalledTimes(2);
  });

  it('never leads out of the app, whatever the message says', async () => {
    for (const url of ['https://evil.example/', '//evil.example/', 'javascript:alert(1)', 42]) {
      const worker = load();
      await worker.dispatch('push', pushOf({ title: 'x', url }));
      expect(shown(worker)[1]).toMatchObject({ data: { url: '/' } });
    }
  });

  const click = (worker: ReturnType<typeof load>, url: string) =>
    worker.dispatch('notificationclick', { notification: { close: vi.fn(), data: { url } } });

  it('opens the game in the window that is already open', async () => {
    const worker = load();
    const client: FakeClient = {
      url: `${ORIGIN}/calendario`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    worker.self.clients.matchAll.mockResolvedValue([client]);
    await click(worker, '/partido/42');
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith('/partido/42');
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window on the game when the app is closed', async () => {
    const worker = load();
    await click(worker, '/partido/42');
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/partido/42');
  });

  it('opens a window when the open one cannot be taken to the game', async () => {
    const worker = load();
    const client: FakeClient = {
      url: `${ORIGIN}/`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => {
        throw new Error('refused');
      }),
    };
    worker.self.clients.matchAll.mockResolvedValue([client]);
    await click(worker, '/partido/42');
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/partido/42');
  });

  it('closes the notification it was tapped on', async () => {
    const worker = load();
    const close = vi.fn();
    await worker.dispatch('notificationclick', { notification: { close, data: { url: '/' } } });
    expect(close).toHaveBeenCalled();
  });
});
