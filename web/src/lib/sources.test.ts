import type { HealthResponse, JobStatus } from '@step-back/shared';
import { describe, expect, it } from 'vitest';
import { GRACE_MS, problemText, sourceProblem } from './sources';

const NOW = new Date('2026-10-08T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const job = (id: string, extra: Partial<JobStatus> = {}): JobStatus => ({
  id,
  status: 'ok',
  lastRunAt: ago(60_000),
  lastSuccessAt: ago(60_000),
  error: null,
  ...extra,
});
const failing = (id: string, lastGoodMs: number | null): JobStatus =>
  job(id, {
    status: 'error',
    error: 'boom',
    lastSuccessAt: lastGoodMs === null ? null : ago(lastGoodMs),
  });
const health = (...jobs: JobStatus[]): HealthResponse => ({
  status: jobs.some((j) => j.status === 'error') ? 'degraded' : 'ok',
  time: NOW.toISOString(),
  uptimeSeconds: 1,
  modules: [],
  jobs,
});

describe('sourceProblem', () => {
  it('is nothing while everything answers, and before the first health reading', () => {
    expect(sourceProblem(health(job('games:refresh')), ['games'], NOW)).toBeUndefined();
    expect(sourceProblem(undefined, ['games'], NOW)).toBeUndefined();
  });

  it('is nothing for one failed attempt after a recent good answer', () => {
    const h = health(failing('games:refresh', GRACE_MS - 60_000));
    expect(sourceProblem(h, ['games'], NOW)).toBeUndefined();
  });

  it('names the source once its last good answer is old', () => {
    const h = health(failing('standings:refresh', GRACE_MS + 60_000));
    expect(sourceProblem(h, ['standings'], NOW)).toEqual({
      sources: ['la clasificación de ESPN'],
      lastGoodAt: ago(GRACE_MS + 60_000),
    });
  });

  it('counts a source that has never answered', () => {
    const problem = sourceProblem(health(failing('highlights:refresh', null)), ['highlights'], NOW);
    expect(problem).toEqual({ sources: ['el canal de la NBA en YouTube'], lastGoodAt: null });
  });

  it('only speaks of the sections it is asked about', () => {
    const h = health(failing('standings:refresh', 3_600_000), failing('news:yahoo', 3_600_000));
    expect(sourceProblem(h, ['games'], NOW)).toBeUndefined();
    expect(sourceProblem(h, ['news'], NOW)?.sources).toEqual(['Yahoo Sports']);
  });

  it('lists every failing source of a section, and the oldest last good answer', () => {
    const h = health(
      failing('news:espn', 2 * 3_600_000),
      failing('news:reddit', 5 * 3_600_000),
      job('news:cbs'),
    );
    expect(sourceProblem(h, ['news'], NOW)).toEqual({
      sources: ['ESPN', 'r/nba'],
      lastGoodAt: ago(5 * 3_600_000),
    });
  });

  it('puts the calendar and the scores of ESPN together as one source of games', () => {
    const h = health(failing('games:calendar', 3_600_000), failing('games:refresh', 3_600_000));
    expect(sourceProblem(h, ['games'], NOW)?.sources).toEqual([
      'el calendario de ESPN',
      'los marcadores de ESPN',
    ]);
  });

  it('ignores jobs that are not a source (housekeeping, cleanup, quota, push)', () => {
    const h = health(
      failing('core:cleanup', 3_600_000),
      failing('translation:quota', 3_600_000),
      failing('push:dispatch', 3_600_000),
      failing('news:cleanup', 3_600_000),
    );
    for (const section of ['games', 'standings', 'news', 'highlights'] as const) {
      expect(sourceProblem(h, [section], NOW)).toBeUndefined();
    }
  });
});

describe('problemText', () => {
  it('says which source, and how old what is on screen is', () => {
    expect(problemText({ sources: ['ESPN'], lastGoodAt: 'x' }, 'hace 2 h')).toBe(
      'No se está pudiendo actualizar desde ESPN. Lo que ves puede no estar al día (último dato correcto: hace 2 h).',
    );
  });

  it('lists several sources with a final "y"', () => {
    expect(
      problemText({ sources: ['ESPN', 'Yahoo Sports', 'r/nba'], lastGoodAt: null }, null),
    ).toBe(
      'No se está pudiendo actualizar desde ESPN, Yahoo Sports y r/nba. Puede que lo que ves esté vacío o incompleto.',
    );
  });
});
