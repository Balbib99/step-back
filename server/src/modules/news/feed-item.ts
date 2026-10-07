import type { NewsMediaKind } from '@step-back/shared';

/** One news item as any source gives it, before it is stored. */
export interface FeedItem {
  /** Normalised address of the article or video at its source; it identifies the item. */
  url: string;
  title: string;
  summary: string | null;
  /** Epoch ms, when the source says. */
  publishedAt: number | null;
  mediaKind: NewsMediaKind;
  /** The picture (or the thumbnail of a video) at the source. */
  mediaUrl: string | null;
  /** A page-embeddable player; none of the current sources give one. */
  embedUrl: string | null;
  durationSeconds: number | null;
  /** ESPN's own team ids, when the source labels teams itself. */
  teamIds: string[];
  /** Players the source labels itself. */
  playerNames: string[];
}

export class FeedFormatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FeedFormatError';
  }
}
