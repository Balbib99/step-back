import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, HEALTH, renderRoute, stubApi } from '../test-support';

// The notice on each screen, against a health report where one source has been failing.

const NOW = '2026-10-07T10:00:00.000Z';
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const HOUR = 3_600_000;

const failingJob = (id: string, lastGoodMs: number | null) => ({
  id,
  status: 'error' as const,
  lastRunAt: NOW,
  lastSuccessAt: lastGoodMs === null ? null : ago(lastGoodMs),
  error: 'boom',
});
const withJobs = (...jobs: ReturnType<typeof failingJob>[]) => {
  api.health = { ...HEALTH, status: 'degraded', jobs };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const notice = () => screen.findByText(/No se está pudiendo actualizar desde/);

describe('the notice of a failing source', () => {
  it('is not there when all is well', async () => {
    renderRoute('/clasificacion');
    await screen.findByRole('list');
    expect(screen.queryByText(/No se está pudiendo actualizar/)).not.toBeInTheDocument();
  });

  it('Clasificación says its source is down and how old the table is', async () => {
    withJobs(failingJob('standings:refresh', 2 * HOUR));
    renderRoute('/clasificacion');
    expect(await notice()).toHaveTextContent(
      'No se está pudiendo actualizar desde la clasificación de ESPN. Lo que ves puede no estar al día (último dato correcto: hace 2 h).',
    );
  });

  it('Noticias names each source of news that is down, and Clasificación says nothing about it', async () => {
    withJobs(failingJob('news:yahoo', 3 * HOUR), failingJob('news:reddit', 4 * HOUR));
    renderRoute('/noticias');
    expect(await notice()).toHaveTextContent('desde Yahoo Sports y r/nba');
  });

  it('a section does not speak of another one', async () => {
    withJobs(failingJob('news:yahoo', 3 * HOUR));
    renderRoute('/clasificacion');
    await screen.findByRole('list');
    expect(screen.queryByText(/No se está pudiendo actualizar/)).not.toBeInTheDocument();
  });

  it.each([
    ['/', 'games:refresh', 'los marcadores de ESPN'],
    ['/calendario', 'games:calendar', 'el calendario de ESPN'],
    ['/jugadas', 'highlights:refresh', 'el canal de la NBA en YouTube'],
    ['/partido/final', 'games:refresh', 'los marcadores de ESPN'],
    ['/equipo/MIN', 'games:refresh', 'los marcadores de ESPN'],
    ['/equipo/MIN', 'news:espn', 'ESPN'],
  ])('%s shows it for %s', async (route, job, source) => {
    withJobs(failingJob(job, HOUR));
    renderRoute(route);
    expect(await notice()).toHaveTextContent(`desde ${source}`);
  });

  it('a source that has never answered says the section may be empty', async () => {
    withJobs(failingJob('highlights:refresh', null));
    renderRoute('/jugadas');
    expect(await notice()).toHaveTextContent('Puede que lo que ves esté vacío o incompleto.');
  });

  it('one failed attempt after a recent good answer is not worth a notice', async () => {
    withJobs(failingJob('standings:refresh', 5 * 60_000));
    renderRoute('/clasificacion');
    await screen.findByRole('list');
    expect(screen.queryByText(/No se está pudiendo actualizar/)).not.toBeInTheDocument();
  });

  it('does not hide the content: the stored table is still there', async () => {
    withJobs(failingJob('standings:refresh', 2 * HOUR));
    renderRoute('/clasificacion');
    await notice();
    expect(
      await screen.findByRole('list', { name: 'Clasificación del Oeste' }),
    ).toBeInTheDocument();
  });
});
