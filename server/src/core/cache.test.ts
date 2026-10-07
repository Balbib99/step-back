import { beforeEach, describe, expect, it } from 'vitest';
import { createKvCache, type KvCache } from './cache.js';
import { openDb } from './db.js';
import { CORE_MIGRATIONS } from './core-migrations.js';
import { runMigrations } from './migrations.js';

describe('KvCache', () => {
  let clock = 1_000_000;
  let cache: KvCache;

  beforeEach(() => {
    clock = 1_000_000;
    const db = openDb(':memory:');
    runMigrations(db, CORE_MIGRATIONS);
    cache = createKvCache(db, () => clock);
  });

  it('returns undefined for unknown keys', () => {
    expect(cache.get('nope')).toBeUndefined();
  });

  it('round-trips JSON values', () => {
    cache.set('espn:scoreboard', { games: [{ id: '1' }] }, 60);
    expect(cache.get('espn:scoreboard')).toEqual({
      value: { games: [{ id: '1' }] },
      fetchedAt: 1_000_000,
      stale: false,
    });
  });

  it('flags an entry as stale after its ttl but keeps it readable', () => {
    cache.set('k', 'v', 60);
    clock += 59_999;
    expect(cache.get('k')?.stale).toBe(false);
    clock += 1;
    expect(cache.get('k')).toMatchObject({ value: 'v', stale: true });
  });

  it('never expires an entry stored without a ttl', () => {
    cache.set('k', 'v');
    clock += 365 * 24 * 3600 * 1000;
    expect(cache.get('k')?.stale).toBe(false);
  });

  it('overwrites a key and refreshes its timestamp', () => {
    cache.set('k', 'old', 10);
    clock += 20_000;
    cache.set('k', 'new', 10);
    expect(cache.get('k')).toMatchObject({ value: 'new', stale: false, fetchedAt: clock });
  });

  it('purges only expired entries', () => {
    cache.set('short', 1, 10);
    cache.set('long', 2, 1000);
    cache.set('forever', 3);
    clock += 11_000;
    expect(cache.purgeExpired()).toBe(1);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBeDefined();
    expect(cache.get('forever')).toBeDefined();
  });

  it('deletes a key', () => {
    cache.set('k', 'v');
    cache.delete('k');
    expect(cache.get('k')).toBeUndefined();
  });
});
