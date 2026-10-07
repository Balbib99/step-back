import { describe, expect, it, vi } from 'vitest';
import { createHttpClient, HttpError } from './http.js';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

// 204 and 304 responses cannot carry a body.
const reply = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(status === 204 || status === 304 ? null : body, { status, headers });

function setup(responses: Array<Response | Error>, overrides = {}) {
  const queue = [...responses];
  const fetchMock: FetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const client = createHttpClient({
    userAgent: 'step-back-test',
    fetch: fetchMock,
    sleep: async (ms) => void sleeps.push(ms),
    minIntervalMs: 0,
    ...overrides,
  });
  return { client, fetchMock, sleeps };
}

describe('createHttpClient', () => {
  it('sends the User-Agent and returns the body of a 2xx', async () => {
    const { client, fetchMock } = setup([reply(200, 'hello')]);
    const response = await client.get('https://example.com/a');
    expect(response).toMatchObject({ status: 200, body: 'hello' });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('user-agent')).toBe('step-back-test');
  });

  it('appends query params and skips undefined ones', async () => {
    const { client, fetchMock } = setup([reply(200, '{}')]);
    await client.get('https://example.com/scoreboard', {
      params: { dates: 20261006, x: undefined },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/scoreboard?dates=20261006');
  });

  it('parses JSON and reports invalid JSON as HttpError', async () => {
    const ok = setup([reply(200, '{"a":1}')]);
    await expect(ok.client.getJson('https://example.com/j')).resolves.toEqual({ a: 1 });
    const bad = setup([reply(200, '<html>')]);
    await expect(bad.client.getJson('https://example.com/j')).rejects.toThrow(/Invalid JSON/);
  });

  it('returns 304 instead of throwing so callers can use conditional requests', async () => {
    const { client } = setup([reply(304)]);
    await expect(client.get('https://example.com/feed')).resolves.toMatchObject({ status: 304 });
  });

  it('does not retry a 4xx', async () => {
    const { client, fetchMock } = setup([reply(404, 'nope')]);
    await expect(client.get('https://example.com/x')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx and network errors with exponential backoff, then succeeds', async () => {
    const { client, fetchMock, sleeps } = setup([
      reply(503),
      new TypeError('fetch failed'),
      reply(200, 'finally'),
    ]);
    await expect(client.get('https://example.com/x')).resolves.toMatchObject({ body: 'finally' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after the configured retries and throws the last error', async () => {
    const { client, fetchMock } = setup([reply(500), reply(502), reply(503)]);
    const error = await client.get('https://example.com/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('honours Retry-After on 429, capped at 30 s', async () => {
    const short = setup([reply(429, '', { 'retry-after': '2' }), reply(200, 'ok')]);
    await short.client.get('https://example.com/x');
    expect(short.sleeps).toEqual([2000]);

    const long = setup([reply(429, '', { 'retry-after': '3600' }), reply(200, 'ok')]);
    await long.client.get('https://example.com/x');
    expect(long.sleeps).toEqual([30_000]);
  });

  it('times out a request that never answers', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const client = createHttpClient({
      userAgent: 't',
      fetch: hanging,
      sleep: async () => undefined,
      minIntervalMs: 0,
      timeoutMs: 20,
      retries: 0,
    });
    await expect(client.get('https://example.com/slow')).rejects.toThrow(/Timed out after 20 ms/);
  });

  describe('per-host rate limit', () => {
    it('spaces consecutive requests to the same host', async () => {
      let clock = 0;
      const sleeps: number[] = [];
      const client = createHttpClient({
        userAgent: 't',
        fetch: async () => reply(200, 'ok'),
        minIntervalMs: 250,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
      });
      await client.get('https://example.com/1');
      await client.get('https://example.com/2');
      await client.get('https://example.com/3');
      expect(sleeps).toEqual([250, 250]);
    });

    it('does not delay requests to a different host', async () => {
      const sleeps: number[] = [];
      const client = createHttpClient({
        userAgent: 't',
        fetch: async () => reply(200, 'ok'),
        minIntervalMs: 250,
        now: () => 0,
        sleep: async (ms) => void sleeps.push(ms),
      });
      await client.get('https://a.example.com/');
      await client.get('https://b.example.com/');
      expect(sleeps).toEqual([]);
    });

    it('queues concurrent requests to the same host in order', async () => {
      const sleeps: number[] = [];
      const client = createHttpClient({
        userAgent: 't',
        fetch: async () => reply(200, 'ok'),
        minIntervalMs: 100,
        now: () => 0,
        sleep: async (ms) => void sleeps.push(ms),
      });
      await Promise.all([1, 2, 3].map((n) => client.get(`https://example.com/${n}`)));
      expect(sleeps).toEqual([100, 200]);
    });

    it('applies a per-host override', async () => {
      const sleeps: number[] = [];
      const client = createHttpClient({
        userAgent: 't',
        fetch: async () => reply(200, 'ok'),
        minIntervalMs: 0,
        hostIntervalsMs: { 'slow.example.com': 1000 },
        now: () => 0,
        sleep: async (ms) => void sleeps.push(ms),
      });
      await Promise.all([
        client.get('https://slow.example.com/1'),
        client.get('https://slow.example.com/2'),
      ]);
      expect(sleeps).toEqual([1000]);
    });
  });
});

describe('getBytes', () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 128]);

  it('returns binary content untouched, which reading it as text would corrupt', async () => {
    const { client } = setup([new Response(bytes, { status: 200 })]);
    const response = await client.getBytes('https://example.com/crest.png');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(bytes);
  });

  it('shares the retries and the errors of get', async () => {
    const retried = setup([reply(503), new Response(bytes, { status: 200 })]);
    expect((await retried.client.getBytes('https://example.com/a.png')).body).toEqual(bytes);
    expect(retried.sleeps).toEqual([500]);

    const missing = setup([reply(404)]);
    await expect(missing.client.getBytes('https://example.com/b.png')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('createHttpClient · postJson', () => {
  it('sends the body as JSON with a POST and reads the JSON answer', async () => {
    const { client, fetchMock } = setup([reply(200, '{"ok":true}')]);
    await expect(client.postJson('https://example.com/x', { a: [1, 2] })).resolves.toEqual({
      ok: true,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.com/x');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":[1,2]}');
    const headers = init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toBe('step-back-test');
  });

  it('lets the caller add headers, such as an authorization', async () => {
    const { client, fetchMock } = setup([reply(200, '{}')]);
    await client.postJson('https://example.com/x', {}, { headers: { authorization: 'Key abc' } });
    expect((fetchMock.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe(
      'Key abc',
    );
  });

  it('retries a 429 like a GET, but not a client error', async () => {
    const retried = setup([reply(429, '{}'), reply(200, '{"ok":1}')]);
    await expect(retried.client.postJson('https://example.com/x', {})).resolves.toEqual({ ok: 1 });
    expect(retried.fetchMock).toHaveBeenCalledTimes(2);

    const refused = setup([reply(456, '{}')]);
    await expect(refused.client.postJson('https://example.com/x', {})).rejects.toMatchObject({
      status: 456,
    });
    expect(refused.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with an HttpError when the answer is not JSON', async () => {
    const { client } = setup([reply(200, '<html>')]);
    await expect(client.postJson('https://example.com/x', {})).rejects.toBeInstanceOf(HttpError);
  });

  it('sends GET requests as GET with no body', async () => {
    const { client, fetchMock } = setup([reply(200, 'hi')]);
    await client.get('https://example.com/x');
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('GET');
    expect(fetchMock.mock.calls[0]![1]?.body).toBeUndefined();
  });
});
