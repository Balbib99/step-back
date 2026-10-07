import { describe, expect, it, vi } from 'vitest';
import { createHttpClient, HttpError, type HttpClient } from '../../core/http.js';
import {
  countCharacters,
  createDeeplTranslator,
  deeplBaseUrl,
  QuotaExceededError,
  TranslationError,
} from './client.js';

const KEY = '279a2e9d-83b3-c416-7e2d-f721593e42a0';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** The real HTTP client over a fake network, so the request that goes out is the one checked. */
function setup(answer: (url: string, init: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    answer(String(url), init ?? {}),
  );
  const http = createHttpClient({
    userAgent: 'test',
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
    minIntervalMs: 0,
  });
  return { http, fetchMock };
}

describe('deeplBaseUrl', () => {
  it('sends a key of the old free plan (:fx) to api-free and any other key to api', () => {
    expect(deeplBaseUrl(`${KEY}:fx`)).toBe('https://api-free.deepl.com');
    expect(deeplBaseUrl(KEY)).toBe('https://api.deepl.com');
  });

  it('lets a setting override both, without a trailing slash', () => {
    expect(deeplBaseUrl(`${KEY}:fx`, 'https://api.deepl.com/')).toBe('https://api.deepl.com');
  });
});

describe('countCharacters', () => {
  it('counts what DeepL counts: characters, not UTF-16 units', () => {
    expect(countCharacters('hello')).toBe(5);
    expect(countCharacters('café')).toBe(4);
    expect(countCharacters('🏀 NBA')).toBe(5); // the emoji is one, though it is two UTF-16 units
  });
});

describe('createDeeplTranslator · translateToSpanish', () => {
  it('posts the texts to /v2/translate with the key in a header, English to Spanish', async () => {
    const { http, fetchMock } = setup(() =>
      json({
        translations: [
          { detected_source_language: 'EN', text: 'Los Lakers ganan' },
          { detected_source_language: 'EN', text: 'Un gran partido.' },
        ],
      }),
    );
    const translator = createDeeplTranslator({ http, apiKey: `${KEY}:fx` });

    const result = await translator.translateToSpanish(['Lakers win', 'A great game.']);

    expect(result).toEqual(['Los Lakers ganan', 'Un gran partido.']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      text: ['Lakers win', 'A great game.'],
      source_lang: 'EN',
      target_lang: 'ES',
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`DeepL-Auth-Key ${KEY}:fx`);
    expect(headers['content-type']).toBe('application/json');
    // The key travels in a header, never in the address.
    expect(url).not.toContain(KEY);
  });

  it('uses the address a setting gives', async () => {
    const { http, fetchMock } = setup(() => json({ translations: [{ text: 'Hola' }] }));
    await createDeeplTranslator({
      http,
      apiKey: KEY,
      baseUrl: 'https://api-free.deepl.com',
    }).translateToSpanish(['Hello']);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api-free.deepl.com/v2/translate');
  });

  it('turns DeepL status 456 (quota spent) into QuotaExceededError, without retrying', async () => {
    const { http, fetchMock } = setup(() => json({ message: 'Quota exceeded' }, 456));
    const translator = createDeeplTranslator({ http, apiKey: KEY });
    await expect(translator.translateToSpanish(['Hello'])).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns a rejected key into a TranslationError that says so', async () => {
    const { http } = setup(() => json({ message: 'Forbidden' }, 403));
    const failure = await createDeeplTranslator({ http, apiKey: KEY })
      .translateToSpanish(['Hello'])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TranslationError);
    expect((failure as TranslationError).status).toBe(403);
    expect((failure as TranslationError).message).toMatch(/rejected the API key/);
  });

  it('retries once on 429 and then gives the translation', async () => {
    let calls = 0;
    const { http } = setup(() =>
      ++calls === 1
        ? json({ message: 'Too many requests' }, 429)
        : json({ translations: [{ text: 'Hola' }] }),
    );
    expect(
      await createDeeplTranslator({ http, apiKey: KEY }).translateToSpanish(['Hello']),
    ).toEqual(['Hola']);
    expect(calls).toBe(2);
  });

  it('fails with a TranslationError after a server error and the one retry', async () => {
    const { http, fetchMock } = setup(() => json({ message: 'down' }, 503));
    await expect(
      createDeeplTranslator({ http, apiKey: KEY }).translateToSpanish(['Hello']),
    ).rejects.toThrow(/DeepL failed \(503\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails when DeepL answers with a different number of texts than were sent', async () => {
    const { http } = setup(() => json({ translations: [{ text: 'Uno' }] }));
    await expect(
      createDeeplTranslator({ http, apiKey: KEY }).translateToSpanish(['One', 'Two']),
    ).rejects.toThrow(/something unexpected/);
  });

  it('fails when DeepL answers with something that is not a translation', async () => {
    const { http } = setup(() => json({ hello: 'world' }));
    await expect(
      createDeeplTranslator({ http, apiKey: KEY }).translateToSpanish(['One']),
    ).rejects.toThrow(/something unexpected/);
  });

  it('does not put the key in an error message', async () => {
    const { http } = setup(() => json({ message: 'Forbidden' }, 403));
    const failure = (await createDeeplTranslator({ http, apiKey: KEY })
      .translateToSpanish(['Hello'])
      .catch((error: unknown) => error)) as Error;
    expect(failure.message).not.toContain(KEY);
  });
});

describe('createDeeplTranslator · usage', () => {
  it('reads the characters used and allowed from /v2/usage', async () => {
    const { http, fetchMock } = setup(() =>
      json({ character_count: 180118, character_limit: 1000000 }),
    );
    const usage = await createDeeplTranslator({ http, apiKey: KEY }).usage();
    expect(usage).toEqual({ used: 180118, limit: 1000000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepl.com/v2/usage');
    expect((init.headers as Record<string, string>).authorization).toBe(`DeepL-Auth-Key ${KEY}`);
  });

  it('fails when the answer lacks the numbers', async () => {
    const { http } = setup(() => json({ character_count: 5 }));
    await expect(createDeeplTranslator({ http, apiKey: KEY }).usage()).rejects.toThrow(
      /something unexpected/,
    );
  });

  it('lets an HttpError that is not a status through', async () => {
    const http = {
      getJson: vi.fn().mockRejectedValue(new TypeError('boom')),
    } as unknown as HttpClient;
    await expect(createDeeplTranslator({ http, apiKey: KEY }).usage()).rejects.toThrow('boom');
    expect(new HttpError('x', 'y')).toBeInstanceOf(Error);
  });
});
