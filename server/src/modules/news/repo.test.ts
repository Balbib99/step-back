import { newsItemSchema } from '@step-back/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { openDb, type Db } from '../../core/db.js';
import { runMigrations } from '../../core/migrations.js';
import type { FeedItem } from './feed-item.js';
import { NEWS_MIGRATIONS } from './news-migrations.js';
import { createNewsRepo, parseCursor, type NewsRepo } from './repo.js';
import type { Tags } from './tagger.js';

const NOW = Date.parse('2026-10-07T20:00:00Z');
const HOUR = 3_600_000;

const item = (path: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  url: `https://example.com/${path}`,
  title: `Title ${path}`,
  summary: null,
  publishedAt: NOW - HOUR,
  mediaKind: 'none',
  mediaUrl: null,
  embedUrl: null,
  durationSeconds: null,
  teamIds: [],
  playerNames: [],
  ...extra,
});
const tags = (teams: string[] = [], players: string[] = []): Tags => ({ teams, players });
const entry = (path: string, extra: Partial<FeedItem> = {}, t: Tags = tags()) => ({
  item: item(path, extra),
  tags: t,
});

describe('NewsRepo', () => {
  let db: Db;
  let repo: NewsRepo;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...NEWS_MIGRATIONS]);
    repo = createNewsRepo(
      db,
      new Map([
        ['espn', 'ESPN'],
        ['gigantes', 'Gigantes del Basket'],
      ]),
    );
  });

  const all = () => repo.list({ limit: 50 }).news;

  describe('storing', () => {
    it('stores a new item and gives it back as a valid NewsItem', () => {
      const added = repo.ingest(
        'espn',
        'en',
        [
          entry(
            'a',
            {
              summary: 'Short summary',
              mediaKind: 'video',
              mediaUrl: 'https://cdn.example.com/a.jpg',
            },
            tags(['LAL'], ['LeBron James']),
          ),
        ],
        NOW,
      );
      expect(added).toBe(1);

      const [stored] = all();
      expect(() => newsItemSchema.parse(stored)).not.toThrow();
      expect(stored).toMatchObject({
        sourceId: 'espn',
        sourceName: 'ESPN',
        url: 'https://example.com/a',
        title: 'Title a',
        summary: 'Short summary',
        lang: 'en',
        publishedAt: new Date(NOW - HOUR).toISOString(),
        mediaKind: 'video',
        embedUrl: null,
        teams: ['LAL'],
        players: ['LeBron James'],
      });
      // The page never gets the third party's address: the picture comes from this server.
      expect(stored!.imageUrl).toBe(`/api/news/${stored!.id}/image`);
    });

    it('does not store the same address twice, whatever the source', () => {
      repo.ingest('espn', 'en', [entry('a')], NOW);
      const added = repo.ingest('gigantes', 'es', [entry('a'), entry('b')], NOW);
      expect(added).toBe(1);
      // Published at the same moment: the later one stored comes first.
      expect(all().map((n) => n.url)).toEqual(['https://example.com/b', 'https://example.com/a']);
    });

    it('does not tag again an item it already had', () => {
      repo.ingest('espn', 'en', [entry('a', {}, tags(['LAL']))], NOW);
      repo.ingest('espn', 'en', [entry('a', {}, tags(['MIN']))], NOW + 1);
      expect(all()[0]!.teams).toEqual(['LAL']);
    });

    it('drops a date in the future, so a wrong clock cannot pin an item to the top', () => {
      repo.ingest('espn', 'en', [entry('future', { publishedAt: NOW + 5 * HOUR })], NOW);
      expect(all()[0]!.publishedAt).toBe(new Date(NOW).toISOString());
    });

    it('dates an item without a date at the moment it was found', () => {
      repo.ingest('espn', 'en', [entry('undated', { publishedAt: null })], NOW);
      expect(all()[0]!.publishedAt).toBe(new Date(NOW).toISOString());
    });

    it('has no picture address for an item without media', () => {
      repo.ingest('espn', 'en', [entry('plain')], NOW);
      expect(all()[0]).toMatchObject({ mediaKind: 'none', imageUrl: null });
    });

    it('falls back to the source id when the source is no longer configured', () => {
      repo.ingest('old-source', 'en', [entry('a')], NOW);
      expect(all()[0]!.sourceName).toBe('old-source');
    });
  });

  describe('filtering', () => {
    beforeEach(() => {
      repo.ingest(
        'espn',
        'en',
        [
          entry('lal', { publishedAt: NOW - 1 * HOUR }, tags(['LAL'], ['LeBron James'])),
          entry('min', { publishedAt: NOW - 2 * HOUR }, tags(['MIN'])),
          entry('lal-min', { publishedAt: NOW - 3 * HOUR }, tags(['LAL', 'MIN'])),
          entry('clip', { publishedAt: NOW - 4 * HOUR, mediaKind: 'video' }, tags(['PHI'])),
          entry('league', { publishedAt: NOW - 5 * HOUR }),
        ],
        NOW,
      );
      repo.ingest(
        'gigantes',
        'es',
        [entry('es-lal', { publishedAt: NOW - 90 * 60_000 }, tags(['LAL']))],
        NOW,
      );
    });

    const urls = (filter: Parameters<NewsRepo['list']>[0]) =>
      repo.list(filter).news.map((n) => n.url.replace('https://example.com/', ''));

    it('lists newest first', () => {
      expect(urls({ limit: 50 })).toEqual(['lal', 'es-lal', 'min', 'lal-min', 'clip', 'league']);
    });

    it('filtering by Lakers returns only what is labelled LAL', () => {
      expect(urls({ limit: 50, teams: ['LAL'] })).toEqual(['lal', 'es-lal', 'lal-min']);
    });

    it('filtering by several teams returns what is about any of them, once each', () => {
      expect(urls({ limit: 50, teams: ['LAL', 'MIN'] })).toEqual([
        'lal',
        'es-lal',
        'min',
        'lal-min',
      ]);
    });

    it('returns nothing for a team with no news', () => {
      expect(urls({ limit: 50, teams: ['BOS'] })).toEqual([]);
    });

    it('filters by player, ignoring letter case', () => {
      expect(urls({ limit: 50, player: 'lebron james' })).toEqual(['lal']);
    });

    it('filters by language', () => {
      expect(urls({ limit: 50, lang: 'es' })).toEqual(['es-lal']);
      expect(urls({ limit: 50, lang: 'en' })).toHaveLength(5);
    });

    it('filters videos', () => {
      expect(urls({ limit: 50, media: 'video' })).toEqual(['clip']);
    });

    it('combines the filters', () => {
      expect(urls({ limit: 50, teams: ['LAL'], lang: 'en' })).toEqual(['lal', 'lal-min']);
    });
  });

  describe('paging by cursor', () => {
    beforeEach(() => {
      repo.ingest(
        'espn',
        'en',
        Array.from({ length: 7 }, (_, i) => entry(`n${i}`, { publishedAt: NOW - i * HOUR })),
        NOW,
      );
    });

    it('walks through everything in pages, without repeating or skipping', () => {
      const seen: string[] = [];
      let before: string | undefined;
      let pages = 0;
      do {
        const page = repo.list({ limit: 3, ...(before && { before }) });
        seen.push(...page.news.map((n) => n.url.replace('https://example.com/', '')));
        before = page.nextBefore ?? undefined;
        pages += 1;
      } while (before && pages < 10);

      expect(seen).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
      expect(pages).toBe(3);
    });

    it('has no next page when the last one is not full, or exactly full', () => {
      expect(repo.list({ limit: 10 }).nextBefore).toBeNull();
      expect(repo.list({ limit: 7 }).nextBefore).toBeNull();
      expect(repo.list({ limit: 6 }).nextBefore).not.toBeNull();
    });

    it('does not lose items published at the same moment', () => {
      repo.ingest(
        'espn',
        'en',
        ['t1', 't2', 't3', 't4'].map((p) => entry(p, { publishedAt: NOW - 10 * HOUR })),
        NOW,
      );
      const seen: string[] = [];
      let before: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = repo.list({ limit: 2, ...(before && { before }) });
        seen.push(...page.news.map((n) => n.url));
        if (!page.nextBefore) break;
        before = page.nextBefore;
      }
      expect(seen).toHaveLength(11);
      expect(new Set(seen).size).toBe(11);
    });
  });

  it('reads an item by id', () => {
    repo.ingest('espn', 'en', [entry('a')], NOW);
    const [stored] = all();
    expect(repo.get(stored!.id)).toEqual(stored);
    expect(repo.get(999)).toBeUndefined();
  });

  it('knows where an item picture lives at its source', () => {
    repo.ingest(
      'espn',
      'en',
      [entry('a', { mediaKind: 'image', mediaUrl: 'https://cdn.example.com/a.jpg' }), entry('b')],
      NOW,
    );
    const withPicture = all().find((n) => n.url.endsWith('/a'))!;
    const without = all().find((n) => n.url.endsWith('/b'))!;
    expect(repo.mediaUrl(withPicture.id)).toBe('https://cdn.example.com/a.jpg');
    expect(repo.mediaUrl(without.id)).toBeUndefined();
  });

  describe('what each source said last time', () => {
    it('is empty before the first time', () => {
      expect(repo.sourceState('yahoo')).toEqual({});
    });

    it('remembers the ETag and Last-Modified, and replaces them', () => {
      repo.saveSourceState('yahoo', {
        etag: 'W/"1"',
        lastModified: 'Wed, 07 Oct 2026 20:00:00 GMT',
      });
      expect(repo.sourceState('yahoo')).toEqual({
        etag: 'W/"1"',
        lastModified: 'Wed, 07 Oct 2026 20:00:00 GMT',
      });
      repo.saveSourceState('yahoo', { etag: 'W/"2"' });
      expect(repo.sourceState('yahoo')).toEqual({ etag: 'W/"2"' });
    });

    it('keeps each source apart', () => {
      repo.saveSourceState('yahoo', { etag: 'a' });
      expect(repo.sourceState('cbs')).toEqual({});
    });
  });

  describe('players ESPN has labelled', () => {
    it('learns them from the items that carry them', () => {
      repo.ingest(
        'espn',
        'en',
        [entry('a', { playerNames: ['LeBron James'] }, tags([], ['LeBron James']))],
        NOW,
      );
      expect(repo.knownPlayers()).toEqual(['LeBron James']);
    });

    it('does not learn from sources that do not label players', () => {
      repo.ingest('gigantes', 'es', [entry('a', {}, tags([], ['LeBron James']))], NOW);
      expect(repo.knownPlayers()).toEqual([]);
    });
  });

  describe('purging old news', () => {
    it('deletes what is older than the limit, with its labels, and says which', () => {
      repo.ingest(
        'espn',
        'en',
        [
          entry('old', { publishedAt: NOW - 100 * 24 * HOUR }, tags(['LAL'], ['LeBron James'])),
          entry('recent', { publishedAt: NOW - HOUR }, tags(['LAL'])),
        ],
        NOW,
      );
      const oldId = all().find((n) => n.url.endsWith('/old'))!.id;

      const removed = repo.purge(NOW - 90 * 24 * HOUR);

      expect(removed).toEqual([oldId]);
      expect(all().map((n) => n.url)).toEqual(['https://example.com/recent']);
      expect(db.prepare('SELECT COUNT(*) AS n FROM news_tags').get()).toEqual({ n: 1 });
    });

    it('forgets players nobody is tagged with any more', () => {
      repo.ingest(
        'espn',
        'en',
        [
          entry(
            'old',
            { publishedAt: NOW - 100 * 24 * HOUR, playerNames: ['Old Player'] },
            tags([], ['Old Player']),
          ),
          entry('new', { playerNames: ['New Player'] }, tags([], ['New Player'])),
        ],
        NOW,
      );
      repo.purge(NOW - 90 * 24 * HOUR);
      expect(repo.knownPlayers()).toEqual(['New Player']);
    });

    it('deletes nothing when nothing is old', () => {
      repo.ingest('espn', 'en', [entry('a')], NOW);
      expect(repo.purge(NOW - 90 * 24 * HOUR)).toEqual([]);
      expect(all()).toHaveLength(1);
    });
  });
});

describe('parseCursor', () => {
  it('reads the cursors the repo writes, and nothing else', () => {
    expect(parseCursor('1791400000000_42')).toEqual({ published: 1791400000000, id: 42 });
    for (const bad of ['', 'abc', '1_', '_2', '1_2_3', '1;DROP TABLE_2', '-1_2']) {
      expect(parseCursor(bad)).toBeUndefined();
    }
  });
});
