import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../../core/logger.js';
import type { HttpClient } from '../../core/http.js';
import type { GamesRepo } from './repo.js';

/** Crests are shown at 26-64 px, so 128 px covers a 2x screen. */
const CREST_SIZE = 128;
const MAX_BYTES = 1_000_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class CrestUnavailableError extends Error {
  constructor(abbr: string, cause?: unknown) {
    super(`Could not get the crest of ${abbr}`, { cause });
    this.name = 'CrestUnavailableError';
  }
}

export interface CrestStore {
  /** The crest as PNG bytes: from disk, or downloaded the first time. Undefined for an unknown team. */
  get(abbr: string): Promise<Uint8Array | undefined>;
  /** Downloads the crests that are not on disk yet. One failure does not stop the others. */
  warm(): Promise<{ downloaded: number; failed: string[] }>;
}

export function isEspnImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'a.espncdn.com';
  } catch {
    return false;
  }
}

export const isPng = (bytes: Uint8Array) =>
  bytes.length > PNG_MAGIC.length &&
  bytes.length <= MAX_BYTES &&
  PNG_MAGIC.every((byte, index) => bytes[index] === byte);

/**
 * ESPN stores crests as 500 px PNGs (up to ~95 KB) and has an image service that returns them
 * at any size (3-12 KB at 128 px). Anything else is fetched as is.
 */
export function resizedCrestUrl(logoUrl: string): string {
  const url = new URL(logoUrl);
  if (url.hostname !== 'a.espncdn.com' || !url.pathname.startsWith('/i/teamlogos/')) return logoUrl;
  return `https://a.espncdn.com/combiner/i?img=${url.pathname}&w=${CREST_SIZE}&h=${CREST_SIZE}`;
}

export function createCrestStore(deps: {
  dir: string;
  http: HttpClient;
  repo: GamesRepo;
  logger: Logger;
}): CrestStore {
  const { dir, http, repo, logger } = deps;
  const inFlight = new Map<string, Promise<Uint8Array>>();
  const fileOf = (abbr: string) => join(dir, `${abbr}.png`);

  function readCached(abbr: string): Uint8Array | undefined {
    try {
      return new Uint8Array(readFileSync(fileOf(abbr)));
    } catch {
      return undefined;
    }
  }

  async function download(abbr: string, logoUrl: string): Promise<Uint8Array> {
    // Crests come from ESPN's image host and no other, whatever the team data says.
    const candidates = [resizedCrestUrl(logoUrl), logoUrl].filter(
      (url, index, all) => all.indexOf(url) === index && isEspnImageUrl(url),
    );
    let lastError: unknown;
    for (const url of candidates) {
      try {
        const { body } = await http.getBytes(url);
        if (!isPng(body)) throw new Error(`${url} did not return a PNG image`);
        mkdirSync(dir, { recursive: true });
        // Write to a temporary file first so a crash never leaves half an image behind.
        const temporary = `${fileOf(abbr)}.${process.pid}.tmp`;
        writeFileSync(temporary, body);
        renameSync(temporary, fileOf(abbr));
        return body;
      } catch (error) {
        lastError = error;
        logger.warn(
          { abbr, url, err: error instanceof Error ? error.message : String(error) },
          'crest download failed',
        );
      }
    }
    throw new CrestUnavailableError(abbr, lastError);
  }

  async function get(abbr: string): Promise<Uint8Array | undefined> {
    const cached = readCached(abbr);
    if (cached) return cached;

    const logoUrl = repo.teams().find((team) => team.abbr === abbr)?.logoUrl;
    if (!logoUrl) return undefined;

    let pending = inFlight.get(abbr);
    if (!pending) {
      pending = download(abbr, logoUrl).finally(() => inFlight.delete(abbr));
      inFlight.set(abbr, pending);
    }
    return pending;
  }

  return {
    get,
    async warm() {
      let downloaded = 0;
      const failed: string[] = [];
      for (const team of repo.teams()) {
        if (!team.logoUrl || readCached(team.abbr)) continue;
        try {
          await get(team.abbr);
          downloaded += 1;
        } catch {
          failed.push(team.abbr);
        }
      }
      return { downloaded, failed };
    },
  };
}
