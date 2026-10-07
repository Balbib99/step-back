import { describe, expect, it, vi } from 'vitest';
import { readNewsFixture } from '../../../test/fixtures/news/read.js';
import { HttpError, type HttpClient } from '../../core/http.js';
import { FeedFormatError } from './feed-item.js';
import { fetchFeed, parseFeed } from './rss.js';

const feed = (name: string, options = {}) => parseFeed(readNewsFixture(name), options);

describe('parseFeed · Yahoo Sports (real RSS, pictures inside the article text)', () => {
  const items = feed('yahoo.rss.xml', { imageFromContent: true });

  it('reads every item with title, address, summary and date', () => {
    expect(items).toHaveLength(8);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(5);
      expect(item.url).toMatch(/^https:\/\/sports\.yahoo\.com\//);
      expect(item.publishedAt).toBeGreaterThan(Date.parse('2026-01-01'));
    }
    expect(items[0]).toMatchObject({
      title:
        'LeBron James, Nick Nurse shoot down rumor LeBron called out Embiid for being late to practice',
      summary: 'Wherever LeBron James goes, drama follows.',
    });
  });

  it('takes the first picture of the article text, only when asked to', () => {
    const withPicture = items.filter((item) => item.mediaKind === 'image');
    expect(withPicture.length).toBeGreaterThan(0);
    expect(withPicture[0]!.mediaUrl).toMatch(/^https:\/\/media\.zenfs\.com\/.+\.jpg$/);
    expect(items.filter((item) => item.mediaKind === 'none').length).toBeGreaterThan(0);

    for (const item of feed('yahoo.rss.xml')) expect(item.mediaKind).toBe('none');
  });
});

describe('parseFeed · CBS Sports (real RSS with an enclosure picture)', () => {
  const items = feed('cbs.rss.xml');

  it('reads the items, trimming the whitespace CBS puts around every value', () => {
    expect(items).toHaveLength(8);
    expect(items[0]!.title).toBe(
      'Eight pressing NBA questions for 2026-27 season: Will Knicks repeat? Can 76ers finally break through?',
    );
    expect(items[0]!.url).toBe(
      'https://www.cbssports.com/nba/news/pressing-nba-questions-2026-27-season-knicks-repeat-76ers-break-through',
    );
  });

  it('uses the enclosure as the picture', () => {
    expect(items[0]).toMatchObject({ mediaKind: 'image' });
    expect(items[0]!.mediaUrl).toMatch(/^https:\/\/sportshub\.cbsistatic\.com\/.+\.png$/);
  });

  it('decodes entities in the title', () => {
    expect(items.find((i) => i.title.startsWith('Dodgers take NLDS'))!.title).toContain(
      "Pete Prisco's",
    );
  });
});

describe('parseFeed · r/nba (real Atom)', () => {
  const items = feed('reddit.atom.xml');

  it('reads the entries with the link of the post, not the feed', () => {
    expect(items).toHaveLength(25);
    for (const item of items)
      expect(item.url).toMatch(/^https:\/\/www\.reddit\.com\/r\/nba\/comments\//);
  });

  it('takes media:thumbnail as the picture when it is big enough to show', () => {
    const withPicture = items.filter((item) => item.mediaKind === 'image');
    expect(withPicture.length).toBeGreaterThan(0);
    for (const item of withPicture) {
      const width = Number(new URL(item.mediaUrl!).searchParams.get('width') ?? 1000);
      expect(width).toBeGreaterThanOrEqual(300);
      expect(item.mediaUrl).not.toContain('&amp;'); // attribute entities decoded
    }
  });

  it('does not use 140 px square thumbnails: a small picture blown up would look broken', () => {
    const small = readNewsFixture('reddit.atom.xml').match(/width=140&amp;height=140/g) ?? [];
    expect(small.length).toBeGreaterThan(0); // the recording does contain some
    expect(items.every((item) => !item.mediaUrl?.includes('width=140'))).toBe(true);
  });

  it('does not take the post markup as a summary', () => {
    expect(items.every((item) => item.summary === null)).toBe(true);
  });
});

describe('parseFeed · Gigantes del Basket (real WordPress RSS, in Spanish)', () => {
  const items = feed('gigantes.rss.xml');

  it('reads the ten items of the NBA feed', () => {
    expect(items).toHaveLength(10);
    for (const item of items) expect(item.url).toMatch(/^https:\/\/www\.gigantes\.com\//);
  });

  it('decodes the entities WordPress writes in titles', () => {
    const russell = items.find((item) => item.title.includes('Russell'))!;
    expect(russell.title).toMatch(/^D’Angelo Russell se marcha a China/);
  });

  it('gives the summary without the "se publicó primero en" backlink', () => {
    for (const item of items) {
      expect(item.summary).not.toBeNull();
      expect(item.summary).not.toMatch(/se publicó primero en/);
    }
  });

  it('has no picture: the ones inside the text are magazine adverts, not the article', () => {
    expect(items.every((item) => item.mediaKind === 'none')).toBe(true);
  });
});

describe('parseFeed · what is not a feed', () => {
  it('rejects XML that is neither RSS nor Atom', () => {
    expect(() => parseFeed('<html><body>Access Restricted</body></html>')).toThrow(FeedFormatError);
    expect(() => parseFeed('<html></html>')).toThrow(/neither RSS nor Atom/);
  });

  it('drops the items without a usable title or address', () => {
    const xml = `<rss><channel>
      <item><title>Good</title><link>https://a.example.com/1</link></item>
      <item><title></title><link>https://a.example.com/2</link></item>
      <item><title>No link</title></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link></item>
    </channel></rss>`;
    expect(parseFeed(xml).map((i) => i.title)).toEqual(['Good']);
  });

  it('copes with a feed that has a single item', () => {
    const xml =
      '<rss><channel><item><title>One</title><link>https://a.example.com/1</link></item></channel></rss>';
    expect(parseFeed(xml)).toHaveLength(1);
  });
});

describe('fetchFeed', () => {
  const response = (status: number, body: string, headers: Record<string, string> = {}) => ({
    status,
    body,
    headers: new Headers(headers),
  });
  const clientAnswering = (answer: ReturnType<typeof response>) => {
    const get = vi.fn(async () => answer);
    return { get, http: { get } as unknown as HttpClient };
  };

  it('returns the items with the validators the source gave', async () => {
    const { http } = clientAnswering(
      response(200, readNewsFixture('cbs.rss.xml'), {
        etag: 'W/"abc"',
        'last-modified': 'Wed, 07 Oct 2026 20:00:00 GMT',
      }),
    );
    const result = await fetchFeed(http, 'https://x.example.com/feed');
    expect(result.kind).toBe('items');
    if (result.kind === 'items') {
      expect(result.items).toHaveLength(8);
      expect(result.validators).toEqual({
        etag: 'W/"abc"',
        lastModified: 'Wed, 07 Oct 2026 20:00:00 GMT',
      });
    }
  });

  it('asks the source to answer "not modified", and takes that answer', async () => {
    const { get, http } = clientAnswering(response(304, ''));
    const result = await fetchFeed(http, 'https://x.example.com/feed', {
      validators: { etag: 'W/"abc"', lastModified: 'Wed, 07 Oct 2026 20:00:00 GMT' },
    });
    expect(result).toEqual({ kind: 'not-modified' });
    expect(get).toHaveBeenCalledWith(
      'https://x.example.com/feed',
      expect.objectContaining({
        headers: expect.objectContaining({
          'if-none-match': 'W/"abc"',
          'if-modified-since': 'Wed, 07 Oct 2026 20:00:00 GMT',
        }),
      }),
    );
  });

  it('sends no conditions the first time', async () => {
    const { get, http } = clientAnswering(response(200, readNewsFixture('cbs.rss.xml')));
    await fetchFeed(http, 'https://x.example.com/feed');
    const headers = (
      get.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    )[1].headers;
    expect(headers).not.toHaveProperty('if-none-match');
    expect(headers).not.toHaveProperty('if-modified-since');
  });

  it('fails when the source answers with something that is not a feed (a block page)', async () => {
    const { http } = clientAnswering(response(200, '<html>Access Restricted</html>'));
    await expect(fetchFeed(http, 'https://x.example.com/feed')).rejects.toThrow(FeedFormatError);
  });

  it('lets an HTTP error through for the caller to report', async () => {
    const http = {
      get: vi.fn().mockRejectedValue(new HttpError('HTTP 403', 'x', 403)),
    } as unknown as HttpClient;
    await expect(fetchFeed(http, 'https://x.example.com/feed')).rejects.toThrow(/403/);
  });
});
