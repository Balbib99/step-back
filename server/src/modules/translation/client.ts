import { z } from 'zod';
import { HttpError, type HttpClient } from '../../core/http.js';

/** The quota is spent (DeepL answers 456): asking again will not help until it renews or grows. */
export class QuotaExceededError extends Error {
  constructor() {
    super('The translation quota is spent');
    this.name = 'QuotaExceededError';
  }
}

/** The provider failed or refused for another reason (wrong key, down, unexpected answer). */
export class TranslationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TranslationError';
  }
}

export interface Usage {
  /** Characters used so far. */
  used: number;
  /** Characters allowed. */
  limit: number;
}

/** A translation provider. DeepL is the only one today; the rest of the app only knows this. */
export interface Translator {
  /** Translates English texts into Spanish, in the same order. */
  translateToSpanish(texts: readonly string[]): Promise<string[]>;
  usage(): Promise<Usage>;
}

const translateResponse = z.object({ translations: z.array(z.object({ text: z.string() })) });
const usageResponse = z.object({ character_count: z.number(), character_limit: z.number() });

const FREE_URL = 'https://api-free.deepl.com';
const PAID_URL = 'https://api.deepl.com';

/**
 * Keys of the old free plan end in ":fx" and only work at api-free.deepl.com; any other key works
 * at api.deepl.com. `override` is for a key that follows neither rule.
 */
export function deeplBaseUrl(apiKey: string, override?: string): string {
  if (override) return override.replace(/\/+$/, '');
  return apiKey.endsWith(':fx') ? FREE_URL : PAID_URL;
}

/** The characters DeepL counts: code points of the text sent, not UTF-16 units. */
export const countCharacters = (text: string): number => [...text].length;

export function createDeeplTranslator(options: {
  http: HttpClient;
  apiKey: string;
  baseUrl?: string | undefined;
}): Translator {
  const { http, apiKey } = options;
  const base = deeplBaseUrl(apiKey, options.baseUrl);
  const headers = { authorization: `DeepL-Auth-Key ${apiKey}` };

  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 456) throw new QuotaExceededError();
        // The address is not part of the message: it is only noise for the owner, and the key is
        // never in it (it travels in a header).
        if (error.status === 401 || error.status === 403) {
          throw new TranslationError('DeepL rejected the API key', error.status, { cause: error });
        }
        throw new TranslationError(
          `DeepL failed${error.status ? ` (${error.status})` : ''}`,
          error.status,
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }

  return {
    translateToSpanish: (texts) =>
      call(async () => {
        const body = await http.postJson(
          `${base}/v2/translate`,
          // Titles and summaries are plain text; the source language is known from the news item.
          { text: texts, source_lang: 'EN', target_lang: 'ES' },
          { headers, retries: 1 },
        );
        const parsed = translateResponse.safeParse(body);
        if (!parsed.success || parsed.data.translations.length !== texts.length) {
          throw new TranslationError('DeepL answered with something unexpected');
        }
        return parsed.data.translations.map((translation) => translation.text);
      }),

    usage: () =>
      call(async () => {
        const body = await http.getJson(`${base}/v2/usage`, { headers });
        const parsed = usageResponse.safeParse(body);
        if (!parsed.success) throw new TranslationError('DeepL answered with something unexpected');
        return { used: parsed.data.character_count, limit: parsed.data.character_limit };
      }),
  };
}
