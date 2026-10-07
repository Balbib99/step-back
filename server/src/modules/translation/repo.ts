import type { Db } from '../../core/db.js';

export interface StoredTranslation {
  title: string;
  summary: string | null;
}

export interface TranslationsRepo {
  /** The translation, unless it is older than `maxAgeMs` (the cleanup removes those too). */
  get(newsId: number, now: number, maxAgeMs: number): StoredTranslation | undefined;
  save(newsId: number, translation: StoredTranslation, chars: number, now: number): void;
  /** Deletes translations created before `olderThan` (epoch ms); returns how many. */
  purge(olderThan: number): number;
}

export function createTranslationsRepo(db: Db): TranslationsRepo {
  return {
    get(newsId, now, maxAgeMs) {
      const row = db
        .prepare('SELECT title, summary FROM translations WHERE news_id = ? AND created_at > ?')
        .get(newsId, now - maxAgeMs) as StoredTranslation | undefined;
      return row ? { title: row.title, summary: row.summary } : undefined;
    },

    save(newsId, translation, chars, now) {
      db.prepare(
        `INSERT INTO translations (news_id, lang, title, summary, chars, created_at)
         VALUES (?, 'es', ?, ?, ?, ?)
         ON CONFLICT (news_id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
           chars = excluded.chars, created_at = excluded.created_at`,
      ).run(newsId, translation.title, translation.summary, chars, now);
    },

    purge(olderThan) {
      return db.prepare('DELETE FROM translations WHERE created_at < ?').run(olderThan).changes;
    },
  };
}
