import type { Db } from './db.js';

export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  /** True once the ttl has elapsed. Stale values stay readable so a failing source can still be served. */
  stale: boolean;
}

export interface KvCache {
  get<T>(key: string): CacheEntry<T> | undefined;
  set(key: string, value: unknown, ttlSeconds?: number): void;
  delete(key: string): void;
  /** Removes entries past their ttl; returns how many were removed. */
  purgeExpired(): number;
}

interface Row {
  value: string;
  fetched_at: number;
  ttl_s: number | null;
}

export function createKvCache(db: Db, now: () => number = Date.now): KvCache {
  const select = db.prepare('SELECT value, fetched_at, ttl_s FROM kv_cache WHERE key = ?');
  const upsert = db.prepare(`
    INSERT INTO kv_cache (key, value, fetched_at, ttl_s) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET
      value = excluded.value, fetched_at = excluded.fetched_at, ttl_s = excluded.ttl_s
  `);
  const remove = db.prepare('DELETE FROM kv_cache WHERE key = ?');
  const purge = db.prepare(
    'DELETE FROM kv_cache WHERE ttl_s IS NOT NULL AND fetched_at + ttl_s * 1000 <= ?',
  );

  return {
    get<T>(key: string) {
      const row = select.get(key) as Row | undefined;
      if (!row) return undefined;
      const stale = row.ttl_s !== null && row.fetched_at + row.ttl_s * 1000 <= now();
      return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at, stale };
    },
    set(key, value, ttlSeconds) {
      upsert.run(key, JSON.stringify(value), now(), ttlSeconds ?? null);
    },
    delete(key) {
      remove.run(key);
    },
    purgeExpired() {
      return purge.run(now()).changes;
    },
  };
}
