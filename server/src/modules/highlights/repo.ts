import type { Highlight, HighlightKind } from '@step-back/shared';
import type { Db } from '../../core/db.js';
import { parseCursor } from '../news/repo.js';
import type { YoutubeVideo } from './adapter.js';

export interface HighlightFilter {
  teams?: readonly string[];
  /** Cursor from a previous page: only older videos. */
  before?: string;
  limit: number;
}

export interface NewVideo {
  video: YoutubeVideo;
  kind: HighlightKind;
  gameId: string | null;
  teams: readonly string[];
  players: readonly string[];
}

export interface HighlightsRepo {
  /** Stores the videos that are new (by YouTube id); returns how many were new. */
  ingest(videos: readonly NewVideo[], now: number): number;
  list(filter: HighlightFilter): { highlights: Highlight[]; nextBefore: string | null };
  /** The videos linked to a game, newest first. */
  forGame(gameId: string): Highlight[];
  get(id: number): Highlight | undefined;
  /** Where the thumbnail of a video lives at YouTube. */
  mediaUrl(id: number): string | undefined;
  /** Game summaries not yet linked to a game, published since `since` (epoch ms). */
  unlinked(since: number): { id: number; title: string; publishedAt: number }[];
  link(id: number, gameId: string): void;
  /** Removes videos published before `olderThan` (epoch ms); returns their ids. */
  purge(olderThan: number): number[];
}

type Row = {
  id: number;
  yt_id: string;
  title: string;
  published_utc: number;
  thumb_url: string | null;
  kind: HighlightKind;
  game_id: string | null;
  is_short: number;
};

export const thumbnailPath = (id: number) => `/api/highlights/${id}/thumb`;
export const embedUrlOf = (ytId: string) => `https://www.youtube-nocookie.com/embed/${ytId}`;
export const watchUrlOf = (ytId: string) => `https://www.youtube.com/watch?v=${ytId}`;

export function createHighlightsRepo(db: Db): HighlightsRepo {
  const insertVideo = db.prepare(`
    INSERT OR IGNORE INTO videos (yt_id, title, published_utc, fetched_at, thumb_url, kind, game_id, is_short)
    VALUES (@ytId, @title, @published, @fetchedAt, @thumb, @kind, @gameId, @isShort)
  `);
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO video_tags (video_id, kind, ref) VALUES (?, ?, ?)',
  );

  const toHighlights = (rows: readonly Row[]): Highlight[] => {
    const ids = rows.map((row) => row.id);
    const teams = new Map<number, string[]>();
    const players = new Map<number, string[]>();
    if (ids.length > 0) {
      const tags = db
        .prepare(
          `SELECT video_id, kind, ref FROM video_tags WHERE video_id IN (${ids.map(() => '?').join(',')}) ORDER BY ref`,
        )
        .all(...ids) as { video_id: number; kind: 'team' | 'player'; ref: string }[];
      for (const tag of tags) {
        const target = tag.kind === 'team' ? teams : players;
        target.set(tag.video_id, [...(target.get(tag.video_id) ?? []), tag.ref]);
      }
    }
    return rows.map((row) => ({
      id: row.id,
      ytId: row.yt_id,
      title: row.title,
      publishedAt: new Date(row.published_utc).toISOString(),
      kind: row.kind,
      gameId: row.game_id,
      thumbnailUrl: thumbnailPath(row.id),
      embedUrl: embedUrlOf(row.yt_id),
      watchUrl: watchUrlOf(row.yt_id),
      isShort: row.is_short === 1,
      teams: teams.get(row.id) ?? [],
      players: players.get(row.id) ?? [],
    }));
  };

  const ingestAll = db.transaction((videos: readonly NewVideo[], now: number) => {
    let added = 0;
    for (const { video, kind, gameId, teams, players } of videos) {
      const result = insertVideo.run({
        ytId: video.ytId,
        title: video.title,
        published: Math.min(video.publishedAt, now),
        fetchedAt: now,
        thumb: video.thumbnailUrl,
        kind,
        gameId,
        isShort: video.isShort ? 1 : 0,
      });
      if (result.changes === 0) continue;
      added += 1;
      const id = Number(result.lastInsertRowid);
      for (const team of teams) insertTag.run(id, 'team', team);
      for (const player of players) insertTag.run(id, 'player', player);
    }
    return added;
  });

  return {
    ingest: (videos, now) => ingestAll(videos, now),

    list(filter) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      const cursor = filter.before ? parseCursor(filter.before) : undefined;
      if (cursor) {
        where.push('(v.published_utc < ? OR (v.published_utc = ? AND v.id < ?))');
        params.push(cursor.published, cursor.published, cursor.id);
      }
      if (filter.teams && filter.teams.length > 0) {
        where.push(
          `EXISTS (SELECT 1 FROM video_tags t WHERE t.video_id = v.id AND t.kind = 'team' AND t.ref IN (${filter.teams.map(() => '?').join(',')}))`,
        );
        params.push(...filter.teams);
      }
      const rows = db
        .prepare(
          `SELECT v.* FROM videos v ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY v.published_utc DESC, v.id DESC LIMIT ?`,
        )
        .all(...params, filter.limit + 1) as Row[];
      const page = rows.slice(0, filter.limit);
      const last = page.at(-1);
      return {
        highlights: toHighlights(page),
        nextBefore: rows.length > filter.limit && last ? `${last.published_utc}_${last.id}` : null,
      };
    },

    forGame(gameId) {
      const rows = db
        .prepare(
          // The summary of the game first, then the clips.
          `SELECT * FROM videos WHERE game_id = ?
           ORDER BY (kind = 'full_highlights') DESC, published_utc DESC, id DESC`,
        )
        .all(gameId) as Row[];
      return toHighlights(rows);
    },

    get(id) {
      const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as Row | undefined;
      return row ? toHighlights([row])[0] : undefined;
    },

    mediaUrl(id) {
      const row = db.prepare('SELECT thumb_url FROM videos WHERE id = ?').get(id) as
        { thumb_url: string | null } | undefined;
      return row?.thumb_url ?? undefined;
    },

    unlinked(since) {
      return (
        db
          .prepare(
            `SELECT id, title, published_utc FROM videos
             WHERE kind = 'full_highlights' AND game_id IS NULL AND published_utc >= ?`,
          )
          .all(since) as { id: number; title: string; published_utc: number }[]
      ).map((row) => ({ id: row.id, title: row.title, publishedAt: row.published_utc }));
    },

    link(id, gameId) {
      db.prepare('UPDATE videos SET game_id = ? WHERE id = ?').run(gameId, id);
    },

    purge(olderThan) {
      return db.transaction(() => {
        const ids = (
          db.prepare('SELECT id FROM videos WHERE published_utc < ?').all(olderThan) as {
            id: number;
          }[]
        ).map((row) => row.id);
        db.prepare('DELETE FROM videos WHERE published_utc < ?').run(olderThan);
        return ids;
      })();
    },
  };
}
