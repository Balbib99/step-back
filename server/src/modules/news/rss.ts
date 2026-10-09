import { XMLParser } from 'fast-xml-parser';
import type { HttpClient } from '../../core/http.js';
import { FeedFormatError, type FeedItem } from './feed-item.js';
import { cleanSummary, cleanTitle, decodeEntities, normalizeUrl } from './text.js';

/** Larger than any feed seen (Yahoo's, with full articles, is 0.5 MB). */
const MAX_BYTES = 5_000_000;
/** Reddit hands out 140 px square thumbnails for many posts: too small to show as a 16:9 picture. */
const MIN_IMAGE_WIDTH = 300;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  // Entities are decoded once, by `text.ts`, so that CDATA and escaped text end up the same.
  processEntities: false,
  isArray: (name) =>
    ['item', 'entry', 'link', 'category', 'media:thumbnail', 'media:content', 'enclosure'].includes(
      name,
    ),
});

type Node = Record<string, unknown>;

const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** The text of an element, whether or not it also has attributes. */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const inner = (value as Node)['#text'];
    if (typeof inner === 'string') return inner.trim();
  }
  return undefined;
}

const attr = (node: unknown, name: string): string | undefined => {
  const value = (node as Node | undefined)?.[`@_${name}`];
  return typeof value === 'string' ? decodeEntities(value) : undefined;
};

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

function usableImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const width = Number(new URL(url, 'https://x.invalid').searchParams.get('width'));
  if (Number.isFinite(width) && width > 0 && width < MIN_IMAGE_WIDTH) return undefined;
  return normalizeUrl(url);
}

function firstImageOf(html: string | undefined): string | undefined {
  const source = html && /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
  return source ? usableImage(decodeEntities(source)) : undefined;
}

function imageOf(node: Node, imageFromContent: boolean): string | undefined {
  for (const media of asArray(node['media:content'])) {
    const url = attr(media, 'url');
    const isImage =
      attr(media, 'medium') === 'image' ||
      attr(media, 'type')?.startsWith('image/') ||
      (url !== undefined && IMAGE_EXTENSION.test(url));
    if (isImage) {
      const usable = usableImage(url);
      if (usable) return usable;
    }
  }
  for (const thumbnail of asArray(node['media:thumbnail'])) {
    const usable = usableImage(attr(thumbnail, 'url'));
    if (usable) return usable;
  }
  for (const enclosure of asArray(node.enclosure)) {
    if (attr(enclosure, 'type')?.startsWith('image/')) {
      const usable = usableImage(attr(enclosure, 'url'));
      if (usable) return usable;
    }
  }
  if (imageFromContent) {
    return firstImageOf(textOf(node['content:encoded'])) ?? firstImageOf(textOf(node.description));
  }
  return undefined;
}

function dateOf(node: Node): number | null {
  const raw =
    textOf(node.pubDate) ??
    textOf(node['dc:date']) ??
    textOf(node.published) ??
    textOf(node.updated);
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : null;
}

function linkOf(node: Node): string | undefined {
  for (const link of asArray(node.link)) {
    // RSS: <link>url</link>. Atom: <link rel="alternate" href="url"/>, or no rel at all.
    const text = textOf(link);
    if (text) return text;
    const rel = attr(link, 'rel');
    if (!rel || rel === 'alternate') {
      const href = attr(link, 'href');
      if (href) return href;
    }
  }
  return undefined;
}

export interface ParseFeedOptions {
  /** Take the first picture inside the article text when the item has no media tags. */
  imageFromContent?: boolean;
}

/** Items of an RSS 2.0 or Atom feed. Items without a usable title or address are dropped. */
export function parseFeed(xml: string, options: ParseFeedOptions = {}): FeedItem[] {
  let document: Node;
  try {
    document = parser.parse(xml) as Node;
  } catch (error) {
    throw new FeedFormatError('feed is not valid XML', { cause: error });
  }

  const channel = (document.rss as Node | undefined)?.channel as Node | undefined;
  const feed = document.feed as Node | undefined;
  const entries = channel ? asArray(channel.item) : feed ? asArray(feed.entry) : undefined;
  if (!entries) throw new FeedFormatError('feed is neither RSS nor Atom');

  const items: FeedItem[] = [];
  for (const entry of entries as Node[]) {
    const url = normalizeUrl(decodeEntities(linkOf(entry) ?? ''));
    const title = cleanTitle(textOf(entry.title) ?? '');
    if (!url || !title) continue;
    const image = imageOf(entry, options.imageFromContent === true);
    items.push({
      url,
      title,
      // Atom `content` (Reddit's markup) is not a summary; only an explicit summary is used.
      summary: cleanSummary(textOf(entry.description) ?? textOf(entry.summary)),
      publishedAt: dateOf(entry),
      mediaKind: image ? 'image' : 'none',
      mediaUrl: image ?? null,
      embedUrl: null,
      durationSeconds: null,
      teamIds: [],
      playerNames: [],
    });
  }
  return items;
}

export interface FeedValidators {
  etag?: string | undefined;
  lastModified?: string | undefined;
}

export type FeedFetchResult =
  { kind: 'not-modified' } | { kind: 'items'; items: FeedItem[]; validators: FeedValidators };

/**
 * Downloads a feed, asking the source to answer "not modified" when nothing changed since the
 * given validators.
 */
export async function fetchFeed(
  http: HttpClient,
  url: string,
  options: ParseFeedOptions & {
    validators?: FeedValidators;
    /** For feeds that are not plain RSS or Atom articles (a YouTube channel). */
    parse?: (xml: string) => FeedItem[];
  } = {},
): Promise<FeedFetchResult> {
  const { validators, parse, ...parseOptions } = options;
  const headers: Record<string, string> = {
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
  };
  if (validators?.etag) headers['if-none-match'] = validators.etag;
  if (validators?.lastModified) headers['if-modified-since'] = validators.lastModified;

  const response = await http.get(url, { headers });
  if (response.status === 304) return { kind: 'not-modified' };
  if (response.body.length > MAX_BYTES)
    throw new FeedFormatError(`feed is larger than ${MAX_BYTES} bytes`);

  return {
    kind: 'items',
    items: parse ? parse(response.body) : parseFeed(response.body, parseOptions),
    validators: {
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
    },
  };
}
