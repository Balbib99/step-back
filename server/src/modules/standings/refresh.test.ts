import { describe, expect, it, vi } from 'vitest';
import { readEspnFixture } from '../../../test/fixtures/espn/read.js';
import { openDb } from '../../core/db.js';
import { CORE_MIGRATIONS } from '../../core/core-migrations.js';
import { HttpError, type HttpClient } from '../../core/http.js';
import { createLogger } from '../../core/logger.js';
import { runMigrations } from '../../core/migrations.js';
import { createStandingsRepo } from './repo.js';
import { MAX_AGE_MS, refreshStandings, shouldRefresh } from './refresh.js';
import { STANDINGS_MIGRATIONS } from './standings-migrations.js';

const MINUTE = 60_000;
const NOW = Date.parse('2026-10-07T20:00:00Z');
const ago = (ms: number) => NOW - ms;

describe('shouldRefresh', () => {
  it('downloads the first time', () => {
    expect(shouldRefresh({ now: NOW, lastFetchedAt: undefined, lastFinalAt: undefined })).toBe(
      true,
    );
  });

  it('waits when nothing has happened and the table is recent', () => {
    expect(
      shouldRefresh({ now: NOW, lastFetchedAt: ago(10 * MINUTE), lastFinalAt: undefined }),
    ).toBe(false);
    expect(
      shouldRefresh({
        now: NOW,
        lastFetchedAt: ago(59 * MINUTE),
        lastFinalAt: ago(5 * 60 * MINUTE),
      }),
    ).toBe(false);
  });

  it('downloads again once an hour has passed, whatever happens', () => {
    expect(
      shouldRefresh({ now: NOW, lastFetchedAt: ago(MAX_AGE_MS), lastFinalAt: undefined }),
    ).toBe(true);
    expect(
      shouldRefresh({
        now: NOW,
        lastFetchedAt: ago(MAX_AGE_MS + 1),
        lastFinalAt: ago(10 * 60 * MINUTE),
      }),
    ).toBe(true);
  });

  it('downloads two minutes after a game ended since the last download', () => {
    const lastFetchedAt = ago(10 * MINUTE);
    // The game ended 3 minutes ago, after the last download (10 minutes ago).
    expect(shouldRefresh({ now: NOW, lastFetchedAt, lastFinalAt: ago(3 * MINUTE) })).toBe(true);
  });

  it('gives ESPN a moment before the first look after a game ends', () => {
    // Downloaded 1 minute ago, and a game ended 30 seconds ago: too soon.
    expect(shouldRefresh({ now: NOW, lastFetchedAt: ago(MINUTE), lastFinalAt: ago(30_000) })).toBe(
      false,
    );
  });

  it('keeps looking every five minutes for half an hour after a game ends, in case ESPN was late', () => {
    // The game ended 20 minutes ago and the last download came after it (15 min ago): look again.
    expect(
      shouldRefresh({ now: NOW, lastFetchedAt: ago(6 * MINUTE), lastFinalAt: ago(20 * MINUTE) }),
    ).toBe(true);
    // ...but not more often than every 5 minutes.
    expect(
      shouldRefresh({ now: NOW, lastFetchedAt: ago(4 * MINUTE), lastFinalAt: ago(20 * MINUTE) }),
    ).toBe(false);
  });

  it('stops the extra looks after half an hour', () => {
    // The table was downloaded 20 minutes ago, after a game that ended 45 minutes ago.
    expect(
      shouldRefresh({ now: NOW, lastFetchedAt: ago(20 * MINUTE), lastFinalAt: ago(45 * MINUTE) }),
    ).toBe(false);
  });
});

describe('refreshStandings', () => {
  const logger = createLogger({ env: 'test', logLevel: 'info' });

  function setup(payload: () => unknown) {
    const db = openDb(':memory:');
    runMigrations(db, [...CORE_MIGRATIONS, ...STANDINGS_MIGRATIONS]);
    const repo = createStandingsRepo(db);
    const http = { get: vi.fn(), getJson: vi.fn(async () => payload()) } as unknown as HttpClient;
    return { repo, http };
  }

  it('downloads the standings and stores them', async () => {
    const { repo, http } = setup(() => readEspnFixture('standings-2025-26.json'));
    const result = await refreshStandings({ http, repo, logger, now: NOW });

    expect(result).toEqual({ conferences: 2, teams: 30, seasonType: 'regular' });
    expect(repo.get()).toHaveLength(2);
    expect(repo.lastFetchedAt()).toBe(NOW);
  });

  it('keeps the previous table when ESPN fails, instead of leaving nothing', async () => {
    const { repo, http } = setup(() => readEspnFixture('standings-2025-26.json'));
    await refreshStandings({ http, repo, logger, now: 1_000 });

    (http.getJson as ReturnType<typeof vi.fn>).mockRejectedValue(
      new HttpError('HTTP 503', 'x', 503),
    );
    await expect(refreshStandings({ http, repo, logger, now: 2_000 })).rejects.toThrow(/503/);

    expect(repo.get()[0]?.entries).toHaveLength(15);
    expect(repo.lastFetchedAt()).toBe(1_000);
  });

  it('keeps the previous table when ESPN changes its format', async () => {
    const { repo, http } = setup(() => readEspnFixture('standings-2025-26.json'));
    await refreshStandings({ http, repo, logger, now: 1_000 });

    (http.getJson as ReturnType<typeof vi.fn>).mockResolvedValue({ children: [] });
    await expect(refreshStandings({ http, repo, logger, now: 2_000 })).rejects.toThrow(
      /format changed/,
    );

    expect(repo.get()).toHaveLength(2);
    expect(repo.lastFetchedAt()).toBe(1_000);
  });
});
