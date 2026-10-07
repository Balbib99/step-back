import { isIP } from 'node:net';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Decodes the entities feeds use (&amp; &#8217; &#x27; ...), once. Unknown ones stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|br)>|<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const SUMMARY_MAX = 280;

// WordPress feeds end every description with a line pointing back to the site.
const BACKLINK =
  /\s*(The post .{1,300} appeared first on .{1,100}\.?|La entrada .{1,300} se publicó primero en .{1,100}\.?)$/i;

/** A short plain-text summary, or null when nothing useful is left. */
export function cleanSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = stripHtml(raw).replace(BACKLINK, '').trim();
  if (text.length === 0) return null;
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > SUMMARY_MAX / 2 ? lastSpace : SUMMARY_MAX).trimEnd()}…`;
}

/** The title as plain text on one line. */
export const cleanTitle = (raw: string): string => stripHtml(raw);

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|ocid$|guccounter$|guce_)/i;

/**
 * The same article is often published with different tracking parameters or a trailing slash.
 * Normalising the address is what lets `url` identify an article.
 */
export function normalizeUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith('/'))
    url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

/**
 * A picture address the server may fetch: https, and a public host name. Feeds are written by
 * third parties, so they must not be able to make the server call an address inside the network.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return false;
  if (!host.includes('.')) return false; // "caddy", "localhost": names that only exist inside
  return !/\.(local|localhost|internal|lan|home|intranet)$/.test(host);
}
