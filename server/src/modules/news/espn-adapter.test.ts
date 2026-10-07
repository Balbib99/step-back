import { describe, expect, it, vi } from 'vitest';
import { readEspnNews } from '../../../test/fixtures/news/read.js';
import type { HttpClient } from '../../core/http.js';
import { EspnFormatError } from '../espn-common.js';
import { ESPN_NEWS_URL, fetchEspnNews, parseEspnNews } from './espn-adapter.js';

describe('parseEspnNews (real ESPN news)', () => {
  const items = parseEspnNews(readEspnNews());
  const byTitle = (start: string) => items.find((item) => item.title.startsWith(start))!;

  it('reads every story and clip', () => {
    expect(items).toHaveLength(14);
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/www\.espn\.com\//);
      expect(item.publishedAt).toBeGreaterThan(Date.parse('2026-01-01'));
      expect(item.mediaUrl).not.toBeNull(); // ESPN gives a picture or thumbnail for every one
    }
  });

  it('shows a clip as a video through its thumbnail, with no embeddable player', () => {
    const clip = byTitle("Why Danny Green doesn't see Kyrie Irving");
    expect(clip).toMatchObject({ mediaKind: 'video', embedUrl: null });
    expect(clip.url).toContain('/video/clip/');
    expect(clip.mediaUrl).toMatch(/\.jpg$/);
  });

  it('shows a story as an image, using its header photo', () => {
    const story = byTitle("Trail Blazers' Dundon");
    expect(story.mediaKind).toBe('image');
    expect(story.url).toContain('/nba/story/');
  });

  it('does not repeat the headline as the summary of a clip', () => {
    expect(byTitle("Why Danny Green doesn't see Kyrie Irving").summary).toBeNull();
    expect(byTitle("Trail Blazers' Dundon").summary).toMatch(/season ticket holders/);
  });

  it("carries ESPN's own team and player labels", () => {
    expect(byTitle("Trail Blazers' Dundon").teamIds).toEqual(['22']);
    expect(byTitle("Why Danny Green doesn't see Kyrie Irving")).toMatchObject({
      teamIds: ['6'],
      playerNames: ['Kyrie Irving'],
    });
    expect(byTitle('Mike Breen apologizes').playerNames).toEqual(['LeBron James', 'Joel Embiid']);
  });

  it('treats a piece labelled with all 30 teams as about the league', () => {
    expect(byTitle('Basketball Power Index').teamIds).toEqual([]);
  });

  it('keeps a game clip labelled with both teams', () => {
    expect(byTitle('Denver Nuggets vs. Utah Jazz').teamIds).toEqual(['26', '7']);
  });
});

describe('parseEspnNews · format changes fail loudly', () => {
  it('reports where the payload stopped matching', () => {
    expect(() => parseEspnNews({ message: 'rate limited' })).toThrow(EspnFormatError);
    expect(() => parseEspnNews({ message: 'rate limited' })).toThrow(/news format changed/);
  });

  it('skips an item without an address instead of failing the whole feed', () => {
    const items = parseEspnNews({
      articles: [
        { type: 'Story', headline: 'No link', links: {} },
        {
          type: 'Story',
          headline: 'With link',
          links: { web: { href: 'https://www.espn.com/a' } },
        },
      ],
    });
    expect(items.map((i) => i.title)).toEqual(['With link']);
  });
});

describe('fetchEspnNews', () => {
  it('asks ESPN for the news and parses them', async () => {
    const getJson = vi.fn(async () => readEspnNews());
    const http = { getJson } as unknown as HttpClient;
    expect(await fetchEspnNews(http)).toHaveLength(14);
    expect(getJson).toHaveBeenCalledWith(ESPN_NEWS_URL, { params: { limit: 40 } });
  });
});
