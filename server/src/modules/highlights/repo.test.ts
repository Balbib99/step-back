import { highlightSchema } from '@step-back/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { openDb, type Db } from '../../core/db.js';
import { runMigrations } from '../../core/migrations.js';
import type { YoutubeVideo } from './adapter.js';
import { HIGHLIGHTS_MIGRATIONS } from './highlights-migrations.js';
import { createHighlightsRepo, type HighlightsRepo, type NewVideo } from './repo.js';

const NOW = Date.parse('2026-10-07T20:00:00Z');
const HOUR = 3_600_000;

const video = (ytId: string, extra: Partial<YoutubeVideo> = {}): YoutubeVideo => ({
  ytId,
  title: `Title ${ytId}`,
  publishedAt: NOW - HOUR,
  thumbnailUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
  isShort: false,
  ...extra,
});
const entry = (
  ytId: string,
  extra: Partial<Omit<NewVideo, 'video'>> & { video?: Partial<YoutubeVideo> } = {},
) => ({
  video: video(ytId, extra.video),
  kind: extra.kind ?? ('clip' as const),
  gameId: extra.gameId ?? null,
  teams: extra.teams ?? [],
  players: extra.players ?? [],
});

describe('HighlightsRepo', () => {
  let db: Db;
  let repo: HighlightsRepo;
  const all = () => repo.list({ limit: 50 }).highlights;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...HIGHLIGHTS_MIGRATIONS]);
    repo = createHighlightsRepo(db);
  });

  it('stores a video and gives it back as a valid Highlight, with this server as the thumbnail', () => {
    expect(
      repo.ingest(
        [
          entry('aaaaaaaaaaa', {
            kind: 'full_highlights',
            gameId: '42',
            teams: ['DEN', 'UTAH'],
            players: ['Aaron Gordon'],
          }),
        ],
        NOW,
      ),
    ).toBe(1);
    const [stored] = all();
    expect(() => highlightSchema.parse(stored)).not.toThrow();
    expect(stored).toMatchObject({
      ytId: 'aaaaaaaaaaa',
      kind: 'full_highlights',
      gameId: '42',
      isShort: false,
      teams: ['DEN', 'UTAH'],
      players: ['Aaron Gordon'],
      embedUrl: 'https://www.youtube-nocookie.com/embed/aaaaaaaaaaa',
      watchUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      publishedAt: new Date(NOW - HOUR).toISOString(),
    });
    expect(stored!.thumbnailUrl).toBe(`/api/highlights/${stored!.id}/thumb`);
    expect(JSON.stringify(stored)).not.toContain('ytimg');
  });

  it('never stores the same YouTube video twice', () => {
    repo.ingest([entry('aaaaaaaaaaa')], NOW);
    expect(repo.ingest([entry('aaaaaaaaaaa'), entry('bbbbbbbbbbb')], NOW)).toBe(1);
    expect(all()).toHaveLength(2);
  });

  it('clamps a publication date in the future', () => {
    repo.ingest([entry('aaaaaaaaaaa', { video: { publishedAt: NOW + 5 * HOUR } })], NOW);
    expect(all()[0]!.publishedAt).toBe(new Date(NOW).toISOString());
  });

  it('remembers a Short', () => {
    repo.ingest([entry('aaaaaaaaaaa', { video: { isShort: true } })], NOW);
    expect(all()[0]!.isShort).toBe(true);
  });

  describe('listing', () => {
    beforeEach(() => {
      repo.ingest(
        [
          entry('lal', { video: { publishedAt: NOW - 1 * HOUR }, teams: ['LAL'] }),
          entry('min', { video: { publishedAt: NOW - 2 * HOUR }, teams: ['MIN'] }),
          entry('both', { video: { publishedAt: NOW - 3 * HOUR }, teams: ['LAL', 'MIN'] }),
          entry('none', { video: { publishedAt: NOW - 4 * HOUR } }),
        ],
        NOW,
      );
    });
    const ids = (filter: Parameters<HighlightsRepo['list']>[0]) =>
      repo.list(filter).highlights.map((h) => h.ytId);

    it('lists newest first', () => {
      expect(ids({ limit: 10 })).toEqual(['lal', 'min', 'both', 'none']);
    });

    it('filters by team, each video once', () => {
      expect(ids({ limit: 10, teams: ['LAL'] })).toEqual(['lal', 'both']);
      expect(ids({ limit: 10, teams: ['LAL', 'MIN'] })).toEqual(['lal', 'min', 'both']);
      expect(ids({ limit: 10, teams: ['BOS'] })).toEqual([]);
    });

    it('pages by cursor without repeating or skipping', () => {
      const seen: string[] = [];
      let before: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = repo.list({ limit: 3, ...(before && { before }) });
        seen.push(...page.highlights.map((h) => h.ytId));
        if (!page.nextBefore) break;
        before = page.nextBefore;
      }
      expect(seen).toEqual(['lal', 'min', 'both', 'none']);
    });

    it('has no next page when the last one is full to the brim', () => {
      expect(repo.list({ limit: 4 }).nextBefore).toBeNull();
      expect(repo.list({ limit: 3 }).nextBefore).not.toBeNull();
    });
  });

  it('gives the videos of a game, the summary before the clips, and nothing for another game', () => {
    repo.ingest(
      [
        entry('clip1111111', { gameId: '7', video: { publishedAt: NOW - HOUR } }),
        entry('full1111111', {
          gameId: '7',
          kind: 'full_highlights',
          video: { publishedAt: NOW - 3 * HOUR },
        }),
        entry('other111111', { gameId: '8' }),
      ],
      NOW,
    );
    expect(repo.forGame('7').map((h) => h.ytId)).toEqual(['full1111111', 'clip1111111']);
    expect(repo.forGame('9')).toEqual([]);
  });

  it('knows where a thumbnail lives at YouTube, only for the app to fetch', () => {
    repo.ingest([entry('aaaaaaaaaaa')], NOW);
    const id = all()[0]!.id;
    expect(repo.mediaUrl(id)).toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
    expect(repo.mediaUrl(999)).toBeUndefined();
  });

  describe('linking late', () => {
    it('lists the game summaries without a game, and links them', () => {
      repo.ingest(
        [
          entry('full1111111', { kind: 'full_highlights' }),
          entry('clip1111111'),
          entry('linked11111', { kind: 'full_highlights', gameId: '1' }),
          entry('old11111111', {
            kind: 'full_highlights',
            video: { publishedAt: NOW - 30 * 24 * HOUR },
          }),
        ],
        NOW,
      );
      const pending = repo.unlinked(NOW - 7 * 24 * HOUR);
      expect(pending.map((p) => p.title)).toEqual(['Title full1111111']);

      repo.link(pending[0]!.id, '99');
      expect(repo.unlinked(NOW - 7 * 24 * HOUR)).toEqual([]);
      expect(repo.forGame('99')).toHaveLength(1);
    });
  });

  describe('purging', () => {
    it('deletes old videos with their labels, and says which', () => {
      repo.ingest(
        [
          entry('old11111111', { video: { publishedAt: NOW - 100 * 24 * HOUR }, teams: ['LAL'] }),
          entry('new11111111', { teams: ['LAL'] }),
        ],
        NOW,
      );
      const oldId = all().find((h) => h.ytId === 'old11111111')!.id;
      expect(repo.purge(NOW - 90 * 24 * HOUR)).toEqual([oldId]);
      expect(all().map((h) => h.ytId)).toEqual(['new11111111']);
      expect(db.prepare('SELECT COUNT(*) AS n FROM video_tags').get()).toEqual({ n: 1 });
    });
  });
});
