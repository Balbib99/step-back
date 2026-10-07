import { XMLParser } from 'fast-xml-parser';
import type { HttpClient } from '../../core/http.js';
import { decodeEntities, stripHtml } from '../news/text.js';

/** The official NBA channel (verified 2026-10-08: its feed is titled "NBA"). */
export const NBA_CHANNEL_ID = 'UCWJ2lWNubArHWmf3FIHbfcQ';
export const NBA_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${NBA_CHANNEL_ID}`;

export class YoutubeFormatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`YouTube feed format changed: ${message}`, options);
    this.name = 'YoutubeFormatError';
  }
}

/** One video of the channel feed. */
export interface YoutubeVideo {
  ytId: string;
  title: string;
  /** Epoch ms. */
  publishedAt: number;
  thumbnailUrl: string | null;
  /** Shorts are vertical clips: the feed links them as /shorts/<id>. */
  isShort: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  processEntities: false,
  isArray: (name) => name === 'entry' || name === 'link',
});

type Node = Record<string, unknown>;
const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim();
  const inner = (value as Node | undefined)?.['#text'];
  return typeof inner === 'string' ? inner.trim() : undefined;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The videos of a YouTube channel feed (Atom). The feed holds only the channel's latest 15, so a
 * video that is not read soon enough is gone: the job reads it often.
 */
export function parseYoutubeFeed(xml: string): YoutubeVideo[] {
  let document: Node;
  try {
    document = parser.parse(xml) as Node;
  } catch (error) {
    throw new YoutubeFormatError('not valid XML', { cause: error });
  }
  const feed = document.feed as Node | undefined;
  if (!feed) throw new YoutubeFormatError('there is no <feed>');
  const entries = ((feed.entry as Node[] | undefined) ?? []) as Node[];

  const videos: YoutubeVideo[] = [];
  for (const entry of entries) {
    const ytId = text(entry['yt:videoId']);
    const title = stripHtml(text(entry.title) ?? '');
    const published = Date.parse(text(entry.published) ?? '');
    if (!ytId || !VIDEO_ID.test(ytId) || !title || !Number.isFinite(published)) continue;

    const group = entry['media:group'] as Node | undefined;
    const thumbnail = (group?.['media:thumbnail'] as Node | undefined)?.['@_url'];
    const links = (entry.link as Node[] | undefined) ?? [];
    const href = links.map((link) => String(link['@_href'] ?? '')).find(Boolean) ?? '';

    videos.push({
      ytId,
      title,
      publishedAt: published,
      thumbnailUrl: typeof thumbnail === 'string' ? decodeEntities(thumbnail) : null,
      isShort: href.includes('/shorts/'),
    });
  }
  // A feed with entries that all failed to parse is a format change, not an empty channel.
  if (entries.length > 0 && videos.length === 0)
    throw new YoutubeFormatError('no entry is readable');
  return videos;
}

export async function fetchYoutubeFeed(http: HttpClient): Promise<YoutubeVideo[]> {
  const { body } = await http.get(NBA_FEED_URL, {
    headers: { accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
  });
  return parseYoutubeFeed(body);
}
