import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, type HttpClient } from '../../core/http.js';
import type { Logger } from '../../core/logger.js';
import { isPng } from './crests.js';

/** Shown at 38-100 px, so 160 px covers a 2x screen; ESPN resizes them for us (~10 KB each). */
const WIDTH = 160;
const HEIGHT = 116;
const MAX_BYTES = 300_000;
/** A photo is looked at again after this long (they change at the start of a season). */
export const HEADSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** A player ESPN has no photo for is not asked about again for this long. */
const MISSING_FOR_MS = 60 * 60_000;

/** ESPN's player ids are plain numbers; anything else never reaches the network. */
export const isPlayerId = (value: string) => /^\d{1,10}$/.test(value);

/** Where the app serves a player's photo from: this server, never the third party. */
export const headshotPath = (playerId: string) => `/api/players/${playerId}/headshot`;

export const headshotSourceUrl = (playerId: string) =>
  `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=${WIDTH}&h=${HEIGHT}`;

export class HeadshotUnavailableError extends Error {
  constructor(playerId: string, cause?: unknown) {
    super(`Could not get the photo of player ${playerId}`, { cause });
    this.name = 'HeadshotUnavailableError';
  }
}

export interface HeadshotStore {
  /** The photo as PNG bytes: from disk, or downloaded the first time. Undefined when ESPN has none. */
  get(playerId: string): Promise<Uint8Array | undefined>;
}

/**
 * Photos are fetched from ESPN once and kept on disk, like the crests: the phone never talks to a
 * third party (no IP leaks) and the photos also work offline.
 */
export function createHeadshotStore(deps: {
  dir: string;
  http: HttpClient;
  logger: Logger;
  now?: () => number;
}): HeadshotStore {
  const { dir, http, logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const inFlight = new Map<string, Promise<Uint8Array | undefined>>();
  const missing = new Map<string, number>();
  const fileOf = (id: string) => join(dir, `${id}.png`);

  function readCached(id: string): { bytes: Uint8Array; fresh: boolean } | undefined {
    try {
      const bytes = new Uint8Array(readFileSync(fileOf(id)));
      const fresh = now() - statSync(fileOf(id)).mtimeMs < HEADSHOT_MAX_AGE_MS;
      return { bytes, fresh };
    } catch {
      return undefined;
    }
  }

  async function download(id: string): Promise<Uint8Array | undefined> {
    try {
      const { body } = await http.getBytes(headshotSourceUrl(id));
      if (!isPng(body) || body.length > MAX_BYTES) throw new Error('not a photo');
      mkdirSync(dir, { recursive: true });
      // Write to a temporary file first so a crash never leaves half an image behind.
      const temporary = `${fileOf(id)}.${process.pid}.tmp`;
      writeFileSync(temporary, body);
      renameSync(temporary, fileOf(id));
      return body;
    } catch (error) {
      // ESPN has no photo for this player (a two-way contract, a rookie): not an error.
      if (error instanceof HttpError && (error.status === 404 || error.status === 403)) {
        missing.set(id, now());
        return undefined;
      }
      logger.warn(
        { player: id, err: error instanceof Error ? error.message : String(error) },
        'photo download failed',
      );
      throw new HeadshotUnavailableError(id, error);
    }
  }

  return {
    get: async (id) => {
      const cached = readCached(id);
      if (cached?.fresh) return cached.bytes;
      const missedAt = missing.get(id);
      if (missedAt !== undefined && now() - missedAt < MISSING_FOR_MS) return cached?.bytes;

      let pending = inFlight.get(id);
      if (!pending) {
        pending = download(id).finally(() => inFlight.delete(id));
        inFlight.set(id, pending);
      }
      try {
        return await pending;
      } catch (error) {
        // An old photo is better than none when ESPN is not answering.
        if (cached) return cached.bytes;
        throw error;
      }
    },
  };
}
