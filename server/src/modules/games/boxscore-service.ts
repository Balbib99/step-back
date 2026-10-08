import type { BoxscoreResponse, Game } from '@step-back/shared';
import type { KvCache } from '../../core/cache.js';
import type { HttpClient } from '../../core/http.js';
import type { Logger } from '../../core/logger.js';
import { fetchBoxscore } from './boxscore.js';
import type { GamesRepo } from './repo.js';

/** While a game is on the numbers move every minute; a finished game is only corrected now and then. */
export const LIVE_TTL_SECONDS = 30;
export const FINAL_TTL_SECONDS = 60 * 60;

// The version is part of the key: an entry kept by an older shape of the data is never served.
const keyOf = (gameId: string) => `boxscore:v2:${gameId}`;

export class BoxscoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The player numbers are not available right now', { cause });
    this.name = 'BoxscoreUnavailableError';
  }
}

export interface BoxscoreService {
  /** Undefined when there is no such game. */
  get(gameId: string): Promise<BoxscoreResponse | undefined>;
}

export function createBoxscoreService(deps: {
  http: HttpClient;
  cache: KvCache;
  repo: GamesRepo;
  logger: Logger;
  now?: () => number;
}): BoxscoreService {
  const { http, cache, repo, logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const inFlight = new Map<string, Promise<BoxscoreResponse>>();

  async function load(game: Game): Promise<BoxscoreResponse> {
    const cached = cache.get<BoxscoreResponse>(keyOf(game.id));
    if (cached && !cached.stale) return cached.value;
    try {
      const fresh = await fetchBoxscore(http, game, new Date(now()).toISOString());
      cache.set(
        keyOf(game.id),
        fresh,
        game.status === 'live' ? LIVE_TTL_SECONDS : FINAL_TTL_SECONDS,
      );
      return fresh;
    } catch (error) {
      // A failing source still shows the last numbers it gave.
      if (cached) return cached.value;
      logger.warn(
        { game: game.id, err: error instanceof Error ? error.message : String(error) },
        'could not get the player numbers',
      );
      throw new BoxscoreUnavailableError(error);
    }
  }

  return {
    get: async (gameId) => {
      const game = repo.game(gameId);
      if (!game) return undefined;
      // Nothing to ask ESPN before tip-off.
      if (game.status !== 'live' && game.status !== 'final') {
        return { gameId, away: null, home: null, updatedAt: new Date(now()).toISOString() };
      }
      let pending = inFlight.get(gameId);
      if (!pending) {
        pending = load(game).finally(() => inFlight.delete(gameId));
        inFlight.set(gameId, pending);
      }
      return pending;
    },
  };
}
