import type { TranslationResponse, TranslationStatus } from '@step-back/shared';
import type { KvCache } from '../../core/cache.js';
import type { Logger } from '../../core/logger.js';
import type { NewsRepo } from '../news/repo.js';
import {
  countCharacters,
  QuotaExceededError,
  TranslationError,
  type Translator,
  type Usage,
} from './client.js';
import type { TranslationsRepo } from './repo.js';

const DAY_MS = 24 * 60 * 60_000;
/** A translation is kept this long, only so pressing the button again costs nothing. */
export const CACHE_DAYS = 7;
/** How long a reading of the quota is trusted before asking DeepL again. */
const USAGE_TTL_SECONDS = 5 * 60;
const USAGE_KEY = 'translation:usage';
/** From this fraction of the quota used, `/api/health` says so. */
export const WARN_FRACTION = 0.9;

/** A request the app refuses, with the status and the message the screen shows. */
export class TranslateRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TranslateRequestError';
  }
}

export interface TranslationService {
  status(): Promise<TranslationStatus>;
  translate(newsId: number): Promise<TranslationResponse>;
  /** Reads the quota from DeepL now. Throws when it is at 90 % or more, for the health check. */
  checkQuota(): Promise<void>;
}

const QUOTA_MESSAGE =
  'Se ha agotado el crédito de traducción de DeepL. Las noticias siguen disponibles en su idioma original.';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createTranslationService(deps: {
  /** Undefined when there is no API key. */
  translator: Translator | undefined;
  news: NewsRepo;
  repo: TranslationsRepo;
  cache: KvCache;
  logger: Logger;
  now?: () => number;
}): TranslationService {
  const { translator, news, repo, cache, logger } = deps;
  const now = deps.now ?? Date.now;
  const inFlight = new Map<number, Promise<TranslationResponse>>();

  /** The quota, from the short cache or from DeepL; undefined when DeepL cannot be asked. */
  async function usage(fresh = false): Promise<Usage | undefined> {
    if (!translator) return undefined;
    const cached = cache.get<Usage>(USAGE_KEY);
    if (cached && !cached.stale && !fresh) return cached.value;
    try {
      const value = await translator.usage();
      cache.set(USAGE_KEY, value, USAGE_TTL_SECONDS);
      return value;
    } catch (error) {
      logger.warn({ err: messageOf(error) }, 'could not read the DeepL quota');
      return cached?.value; // the last reading, even if old, is better than none
    }
  }

  /** Adds what was just spent to the cached reading, so the next check does not use a stale one. */
  function spend(chars: number): void {
    const cached = cache.get<Usage>(USAGE_KEY);
    if (cached) {
      cache.set(USAGE_KEY, { ...cached.value, used: cached.value.used + chars }, USAGE_TTL_SECONDS);
    }
  }

  async function run(newsId: number): Promise<TranslationResponse> {
    if (!translator) {
      throw new TranslateRequestError(
        503,
        'translation_disabled',
        'La traducción no está configurada en el servidor.',
      );
    }
    const item = news.get(newsId);
    if (!item) throw new TranslateRequestError(404, 'not_found', 'Esa noticia no existe.');
    if (item.lang === 'es') {
      throw new TranslateRequestError(400, 'already_spanish', 'Esa noticia ya está en español.');
    }

    // A translation already made costs nothing, so it is served even when the quota is spent.
    const stored = repo.get(newsId, now(), CACHE_DAYS * DAY_MS);
    if (stored) return { ...stored, cached: true };

    const texts = item.summary ? [item.title, item.summary] : [item.title];
    const chars = texts.reduce((sum, text) => sum + countCharacters(text), 0);

    const known = await usage();
    if (known && known.used + chars > known.limit) {
      throw new TranslateRequestError(429, 'quota_exceeded', QUOTA_MESSAGE);
    }

    let translated: string[];
    try {
      translated = await translator.translateToSpanish(texts);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        // DeepL knows better than the reading we had: remember that it is spent.
        const limit = known?.limit ?? 0;
        cache.set(USAGE_KEY, { used: limit, limit }, USAGE_TTL_SECONDS);
        throw new TranslateRequestError(429, 'quota_exceeded', QUOTA_MESSAGE);
      }
      logger.warn({ newsId, err: messageOf(error) }, 'translation failed');
      const badKey =
        error instanceof TranslationError && (error.status === 401 || error.status === 403);
      throw new TranslateRequestError(
        502,
        'translation_failed',
        badKey
          ? 'La clave de DeepL no es válida. Revisa DEEPL_API_KEY en el servidor.'
          : 'DeepL no responde ahora mismo. Inténtalo de nuevo en un rato.',
      );
    }

    const translation = { title: translated[0]!, summary: translated[1] ?? null };
    repo.save(newsId, translation, chars, now());
    spend(chars);
    return { ...translation, cached: false };
  }

  return {
    async status() {
      if (!translator) {
        return { enabled: false, used: null, limit: null, percent: null, blocked: false };
      }
      const known = await usage();
      if (!known) return { enabled: true, used: null, limit: null, percent: null, blocked: false };
      const percent =
        known.limit > 0 ? Math.min(100, Math.floor((known.used / known.limit) * 100)) : 100;
      return {
        enabled: true,
        used: known.used,
        limit: known.limit,
        percent,
        blocked: known.used >= known.limit,
      };
    },

    translate(newsId) {
      // Two presses at once translate once.
      let pending = inFlight.get(newsId);
      if (!pending) {
        pending = run(newsId).finally(() => inFlight.delete(newsId));
        inFlight.set(newsId, pending);
      }
      return pending;
    },

    async checkQuota() {
      const known = await usage(true);
      if (!known) throw new Error('No se pudo leer la cuota de DeepL');
      const fraction = known.limit > 0 ? known.used / known.limit : 1;
      if (fraction >= WARN_FRACTION) {
        const percent = Math.min(100, Math.floor(fraction * 100));
        throw new Error(
          fraction >= 1
            ? `El crédito de traducción de DeepL está agotado (${known.used} de ${known.limit} caracteres)`
            : `El crédito de traducción de DeepL va por el ${percent} % (${known.used} de ${known.limit} caracteres)`,
        );
      }
    },
  };
}
