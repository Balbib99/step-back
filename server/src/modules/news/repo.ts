import type { NewsItem, NewsLang, NewsMediaKind } from '@step-back/shared';
import type { Db } from '../../core/db.js';
import type { FeedItem } from './feed-item.js';
import type { Tags } from './tagger.js';

export interface NewsFilter {
  /** Only items about any of these teams (abbreviations). */
  teams?: readonly string[];
  player?: string;
  lang?: NewsLang;
  /** Only items whose media is of this kind. */
  media?: Exclude<NewsMediaKind, 'none'>;
  /** Cursor from a previous page: only older items. */
  before?: string;
  limit: number;
}

export interface NewsRepo {
  /** Stores the items that are new (by address) with their labels; returns how many were new. */
  ingest(
    sourceId: string,
    lang: NewsLang,
    entries: readonly { item: FeedItem; tags: Tags }[],
    now: number,
  ): number;
  list(filter: NewsFilter): { news: NewsItem[]; nextBefore: string | null };
  get(id: number): NewsItem | undefined;
  /** Where the picture of an item lives at its source. */
  mediaUrl(id: number): string | undefined;
  /** The ETag and Last-Modified a feed gave last time. */
  sourceState(sourceId: string): { etag?: string; lastModified?: string };
  saveSourceState(
    sourceId: string,
    state: { etag?: string | undefined; lastModified?: string | undefined },
  ): void;
  /** Names of players that ESPN has labelled. */
  knownPlayers(): string[];
  /** Removes items published before `olderThan` (epoch ms); returns their ids. */
  purge(olderThan: number): number[];
}

type Row = {
  id: number;
  source_id: string;
  url: string;
  title: string;
  summary: string | null;
  lang: NewsLang;
  published_utc: number;
  media_kind: NewsMediaKind;
  media_url: string | null;
  embed_url: string | null;
  media_duration_s: number | null;
};

export const newsImagePath = (id: number) => `/api/news/${id}/image`;

/** `published_id`: opaque to the client, it only hands it back. */
const cursorOf = (row: Pick<Row, 'published_utc' | 'id'>) => `${row.published_utc}_${row.id}`;

export function parseCursor(cursor: string): { published: number; id: number } | undefined {
  const match = /^(\d{1,15})_(\d{1,12})$/.exec(cursor);
  return match ? { published: Number(match[1]), id: Number(match[2]) } : undefined;
}

export function createNewsRepo(db: Db, sourceNames: ReadonlyMap<string, string>): NewsRepo {
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO news_items
      (source_id, url, title, summary, lang, published_utc, fetched_at, media_kind, media_url, embed_url, media_duration_s)
    VALUES (@sourceId, @url, @title, @summary, @lang, @published, @fetchedAt, @mediaKind, @mediaUrl, @embedUrl, @duration)
  `);
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO news_tags (news_id, kind, ref) VALUES (?, ?, ?)',
  );
  const insertPlayer = db.prepare('INSERT OR IGNORE INTO news_players (name) VALUES (?)');

  const tagsOf = (ids: readonly number[]) => {
    const teams = new Map<number, string[]>();
    const players = new Map<number, string[]>();
    if (ids.length === 0) return { teams, players };
    const rows = db
      .prepare(
        `SELECT news_id, kind, ref FROM news_tags WHERE news_id IN (${ids.map(() => '?').join(',')}) ORDER BY ref`,
      )
      .all(...ids) as { news_id: number; kind: 'team' | 'player'; ref: string }[];
    for (const row of rows) {
      const target = row.kind === 'team' ? teams : players;
      target.set(row.news_id, [...(target.get(row.news_id) ?? []), row.ref]);
    }
    return { teams, players };
  };

  const toItems = (rows: readonly Row[]): NewsItem[] => {
    const { teams, players } = tagsOf(rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      sourceName: sourceNames.get(row.source_id) ?? row.source_id,
      url: row.url,
      title: row.title,
      summary: row.summary,
      lang: row.lang,
      publishedAt: new Date(row.published_utc).toISOString(),
      mediaKind: row.media_kind,
      imageUrl: row.media_url ? newsImagePath(row.id) : null,
      embedUrl: row.embed_url,
      durationSeconds: row.media_duration_s,
      teams: teams.get(row.id) ?? [],
      players: players.get(row.id) ?? [],
    }));
  };

  const ingestAll = db.transaction(
    (
      sourceId: string,
      lang: NewsLang,
      entries: readonly { item: FeedItem; tags: Tags }[],
      now: number,
    ) => {
      let added = 0;
      for (const { item, tags } of entries) {
        // A date in the future (a wrong clock at the source) would pin the item to the top.
        const published = Math.min(item.publishedAt ?? now, now);
        const result = insertItem.run({
          sourceId,
          url: item.url,
          title: item.title,
          summary: item.summary,
          lang,
          published,
          fetchedAt: now,
          mediaKind: item.mediaKind,
          mediaUrl: item.mediaUrl,
          embedUrl: item.embedUrl,
          duration: item.durationSeconds,
        });
        if (result.changes === 0) continue; // already stored: a duplicate
        added += 1;
        const id = Number(result.lastInsertRowid);
        for (const team of tags.teams) insertTag.run(id, 'team', team);
        for (const player of tags.players) insertTag.run(id, 'player', player);
        // ESPN labels players itself; remember them so other sources' texts can be searched for them.
        if (item.playerNames.length > 0)
          for (const name of item.playerNames) insertPlayer.run(name);
      }
      return added;
    },
  );

  return {
    ingest: (sourceId, lang, entries, now) => ingestAll(sourceId, lang, entries, now),

    list(filter) {
      const where: string[] = [];
      const params: (string | number)[] = [];

      const cursor = filter.before ? parseCursor(filter.before) : undefined;
      if (cursor) {
        where.push('(n.published_utc < ? OR (n.published_utc = ? AND n.id < ?))');
        params.push(cursor.published, cursor.published, cursor.id);
      }
      if (filter.lang) {
        where.push('n.lang = ?');
        params.push(filter.lang);
      }
      if (filter.media) {
        where.push('n.media_kind = ?');
        params.push(filter.media);
      }
      if (filter.teams && filter.teams.length > 0) {
        where.push(
          `EXISTS (SELECT 1 FROM news_tags t WHERE t.news_id = n.id AND t.kind = 'team' AND t.ref IN (${filter.teams.map(() => '?').join(',')}))`,
        );
        params.push(...filter.teams);
      }
      if (filter.player) {
        where.push(
          "EXISTS (SELECT 1 FROM news_tags t WHERE t.news_id = n.id AND t.kind = 'player' AND t.ref = ? COLLATE NOCASE)",
        );
        params.push(filter.player);
      }

      const rows = db
        .prepare(
          `SELECT n.* FROM news_items n ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY n.published_utc DESC, n.id DESC LIMIT ?`,
        )
        .all(...params, filter.limit + 1) as Row[];

      const page = rows.slice(0, filter.limit);
      const last = page.at(-1);
      return {
        news: toItems(page),
        nextBefore: rows.length > filter.limit && last ? cursorOf(last) : null,
      };
    },

    get(id) {
      const row = db.prepare('SELECT * FROM news_items WHERE id = ?').get(id) as Row | undefined;
      return row ? toItems([row])[0] : undefined;
    },

    mediaUrl(id) {
      const row = db.prepare('SELECT media_url FROM news_items WHERE id = ?').get(id) as
        { media_url: string | null } | undefined;
      return row?.media_url ?? undefined;
    },

    sourceState(sourceId) {
      const row = db
        .prepare('SELECT etag, last_modified FROM news_source_state WHERE source_id = ?')
        .get(sourceId) as { etag: string | null; last_modified: string | null } | undefined;
      return {
        ...(row?.etag && { etag: row.etag }),
        ...(row?.last_modified && { lastModified: row.last_modified }),
      };
    },

    saveSourceState(sourceId, state) {
      db.prepare(
        `INSERT INTO news_source_state (source_id, etag, last_modified) VALUES (?, ?, ?)
         ON CONFLICT (source_id) DO UPDATE SET etag = excluded.etag, last_modified = excluded.last_modified`,
      ).run(sourceId, state.etag ?? null, state.lastModified ?? null);
    },

    knownPlayers() {
      return (db.prepare('SELECT name FROM news_players').all() as { name: string }[]).map(
        (row) => row.name,
      );
    },

    purge(olderThan) {
      const run = db.transaction(() => {
        const ids = (
          db.prepare('SELECT id FROM news_items WHERE published_utc < ?').all(olderThan) as {
            id: number;
          }[]
        ).map((row) => row.id);
        db.prepare('DELETE FROM news_items WHERE published_utc < ?').run(olderThan); // tags cascade
        // A player nobody is tagged with any more is forgotten (ESPN will label them again).
        db.prepare(
          "DELETE FROM news_players WHERE name NOT IN (SELECT ref FROM news_tags WHERE kind = 'player')",
        ).run();
        return ids;
      });
      return run();
    },
  };
}
