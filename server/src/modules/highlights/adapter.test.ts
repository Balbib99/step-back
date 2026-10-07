import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../../core/http.js';
import {
  fetchYoutubeFeed,
  NBA_CHANNEL_ID,
  NBA_FEED_URL,
  parseYoutubeFeed,
  YoutubeFormatError,
} from './adapter.js';

const fixture = () =>
  readFileSync(
    new URL('../../../test/fixtures/highlights/nba-channel.atom.xml', import.meta.url),
    'utf8',
  );

describe('parseYoutubeFeed (real feed of the official NBA channel)', () => {
  const videos = parseYoutubeFeed(fixture());

  it('is the NBA channel, by the id the app uses', () => {
    expect(fixture()).toContain(`<yt:channelId>${NBA_CHANNEL_ID.slice(2)}</yt:channelId>`);
    expect(fixture()).toContain('<title>NBA</title>');
    expect(NBA_FEED_URL).toBe(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${NBA_CHANNEL_ID}`,
    );
  });

  it('reads the 15 videos with id, title, date and thumbnail', () => {
    expect(videos).toHaveLength(15);
    for (const video of videos) {
      expect(video.ytId).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(video.title.length).toBeGreaterThan(5);
      expect(video.publishedAt).toBeGreaterThan(Date.parse('2026-01-01'));
      expect(video.thumbnailUrl).toMatch(/^https:\/\/i\d?\.ytimg\.com\/vi\/.+\.jpg$/);
    }
    expect(videos[0]).toMatchObject({
      ytId: 'LMiAmRw64L8',
      title: '“Oh you’re trying to do that pass that Jokic did”',
    });
  });

  it('knows which ones are Shorts, and which are ordinary videos', () => {
    expect(videos[0]!.isShort).toBe(true);
    expect(videos.some((v) => !v.isShort)).toBe(true);
  });

  it('decodes the entities in titles', () => {
    expect(videos.find((v) => v.title.startsWith('Yaxel is still'))!.title).toContain(
      'Steph & Draymond',
    );
  });
});

describe('parseYoutubeFeed · format changes fail loudly', () => {
  it('rejects what is not a feed', () => {
    expect(() => parseYoutubeFeed('<html>Not found</html>')).toThrow(YoutubeFormatError);
    expect(() => parseYoutubeFeed('<html>Not found</html>')).toThrow(/no <feed>/);
  });

  it('rejects a feed whose entries are all unreadable, instead of calling the channel empty', () => {
    const xml =
      '<feed><entry><title>No id</title><published>2026-10-07T10:00:00+00:00</published></entry></feed>';
    expect(() => parseYoutubeFeed(xml)).toThrow(/no entry is readable/);
  });

  it('accepts a channel with no videos', () => {
    expect(parseYoutubeFeed('<feed><title>NBA</title></feed>')).toEqual([]);
  });

  it('skips an entry with a bad id or no date, keeping the rest', () => {
    const entry = (id: string, date: string) =>
      `<entry><yt:videoId>${id}</yt:videoId><title>T ${id}</title><published>${date}</published></entry>`;
    const xml = `<feed xmlns:yt="y">${entry('abcdefghijk', '2026-10-07T10:00:00+00:00')}${entry('short', '2026-10-07T10:00:00+00:00')}${entry('lmnopqrstuv', 'nope')}</feed>`;
    expect(parseYoutubeFeed(xml).map((v) => v.ytId)).toEqual(['abcdefghijk']);
  });
});

describe('fetchYoutubeFeed', () => {
  it('asks for the NBA channel feed and parses it', async () => {
    const get = vi.fn(async () => ({ status: 200, body: fixture(), headers: new Headers() }));
    const videos = await fetchYoutubeFeed({ get } as unknown as HttpClient);
    expect(videos).toHaveLength(15);
    expect(get).toHaveBeenCalledWith(NBA_FEED_URL, expect.anything());
  });
});
