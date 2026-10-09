import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpClient } from '../../core/http.js';
import type { Logger } from '../../core/logger.js';
import { resolvesToPublic, type Resolve } from '../../core/public-address.js';
import { isPublicHttpsUrl } from './text.js';

/** The CBS pictures are PNGs of 2-3 MB; anything much larger is not a news picture. */
const MAX_BYTES = 4_000_000;

export type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** What an image really is, from its first bytes. A source's word for it is not trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  const at = (offset: number, ...values: number[]) =>
    values.every((v, i) => bytes[offset + i] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

export class ImageUnavailableError extends Error {
  constructor(id: number, reason: string, cause?: unknown) {
    super(`Could not get the picture of item ${id}: ${reason}`, { cause });
    this.name = 'ImageUnavailableError';
  }
}

export interface NewsImage {
  bytes: Uint8Array;
  type: ImageType;
}

export interface ImageStore {
  /** The picture of an item: from disk, or downloaded the first time. Undefined when it has none. */
  get(id: number): Promise<NewsImage | undefined>;
  /** Deletes the pictures of removed items. */
  remove(ids: readonly number[]): void;
}

/**
 * Pictures are fetched from their source once and kept, so the phone never talks to a third party
 * (no IP leaks) and the pictures also work offline.
 */
export function createImageStore(deps: {
  dir: string;
  http: HttpClient;
  /** Where the picture of an item lives at its source. */
  repo: { mediaUrl(id: number): string | undefined };
  logger: Logger;
  /** Resolves host names, to refuse the ones that lead inside the network. Injectable for tests. */
  resolve?: Resolve;
}): ImageStore {
  const { dir, http, repo, logger, resolve } = deps;
  // The address and every redirect must be public https, both by name and by what it resolves to.
  const allowUrl = async (address: string) =>
    isPublicHttpsUrl(address) && (await resolvesToPublic(new URL(address).hostname, resolve));
  const inFlight = new Map<number, Promise<NewsImage>>();
  const fileOf = (id: number) => join(dir, `${id}.img`);

  function readCached(id: number): NewsImage | undefined {
    try {
      const bytes = new Uint8Array(readFileSync(fileOf(id)));
      const type = sniffImageType(bytes);
      return type ? { bytes, type } : undefined;
    } catch {
      return undefined;
    }
  }

  async function download(id: number, url: string): Promise<NewsImage> {
    if (!isPublicHttpsUrl(url))
      throw new ImageUnavailableError(id, 'the address is not a public https one');
    try {
      const { body } = await http.getBytes(url, { allowUrl });
      const type = sniffImageType(body);
      if (!type) throw new Error('not an image');
      if (body.length > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
      mkdirSync(dir, { recursive: true });
      const temporary = `${fileOf(id)}.${process.pid}.tmp`;
      writeFileSync(temporary, body);
      renameSync(temporary, fileOf(id));
      return { bytes: body, type };
    } catch (error) {
      logger.warn(
        { id, url, err: error instanceof Error ? error.message : String(error) },
        'news picture download failed',
      );
      throw new ImageUnavailableError(id, 'download failed', error);
    }
  }

  return {
    async get(id) {
      const cached = readCached(id);
      if (cached) return cached;
      const url = repo.mediaUrl(id);
      if (!url) return undefined;
      let pending = inFlight.get(id);
      if (!pending) {
        pending = download(id, url).finally(() => inFlight.delete(id));
        inFlight.set(id, pending);
      }
      return pending;
    },

    remove(ids) {
      for (const id of ids) rmSync(fileOf(id), { force: true });
    },
  };
}
