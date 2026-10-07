import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, renderRoute, stubApi, where } from '../test-support';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const section = (name: string) => screen.getByRole('region', { name });

describe('Partido', () => {
  it('shows a placeholder while loading, then the game', async () => {
    renderRoute('/partido/final');
    expect(screen.getByRole('status', { name: 'Cargando partido' })).toBeInTheDocument();
    await screen.findByRole('article', {
      name: 'Minnesota Timberwolves 104, Los Angeles Lakers 99, Final',
    });
    expect(screen.queryByRole('status', { name: 'Cargando partido' })).not.toBeInTheDocument();
  });

  it('gives the phase, the day and the time in the configured time zone', async () => {
    renderRoute('/partido/final');
    // 01:30 UTC on the 7th is 03:30 in Madrid.
    expect(await screen.findByText('Pretemporada · mié 7 oct · 03:30')).toBeInTheDocument();
  });

  it('shows the game card without making it a link to itself', async () => {
    renderRoute('/partido/final');
    await screen.findByRole('article', { name: /Minnesota Timberwolves 104/ });
    expect(screen.queryByRole('link', { name: /Ver el partido/ })).not.toBeInTheDocument();
  });

  it('shows the points of each quarter once the game has started', async () => {
    api.games = api.games.map((g) =>
      g.id === 'final'
        ? {
            ...g,
            away: { ...g.away, linescores: [25, 30, 20, 29] },
            home: { ...g.home, linescores: [22, 28, 24, 25, 5] },
          }
        : g,
    );
    renderRoute('/partido/final');
    const table = await screen.findByRole('table', { name: 'Puntos por cuarto' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Equipo', 'Q1', 'Q2', 'Q3', 'Q4', 'PR1', 'Total']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['MIN25302029–104', 'LAL22282425599']);
  });

  it('has no table for a game that has not started', async () => {
    renderRoute('/partido/other');
    await screen.findByRole('article');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  describe('the videos of the game', () => {
    it('shows the summary linked to it', async () => {
      renderRoute('/partido/final');
      await screen.findByRole('article', { name: /Minnesota/ });
      const videos = await within(section('Jugadas del partido')).findAllByRole('article');
      expect(videos.map((v) => v.getAttribute('aria-label'))).toEqual([
        'LAKERS at WARRIORS | FULL GAME HIGHLIGHTS',
      ]);
    });

    it('says "aún sin jugadas" for a finished game with none, not an error', async () => {
      api.highlights = [];
      renderRoute('/partido/final');
      expect(await screen.findByText(/Aún sin jugadas de este partido/)).toBeInTheDocument();
      expect(screen.queryByText(/No se pudo/)).not.toBeInTheDocument();
    });

    it('says they will come when the game is over, for one that is not', async () => {
      renderRoute('/partido/other');
      expect(
        await screen.findByText('Las jugadas aparecerán cuando termine el partido.'),
      ).toBeInTheDocument();
    });
  });

  describe('related news', () => {
    it('shows the news about either team, three at most', async () => {
      renderRoute('/partido/final'); // MIN against LAL
      await screen.findByRole('article', { name: /Minnesota/ });
      const news = await within(section('Noticias relacionadas')).findAllByRole('article');
      expect(news.map((n) => n.getAttribute('aria-label'))).toEqual(
        [
          'Lakers ganan en la prórroga',
          'Game Highlights: Timberwolves vs. Lakers',
          'Embiid vuelve a entrenar',
        ]
          .slice(0, 2)
          .concat([]),
      );
      expect(api.requests.filter((u) => u.startsWith('/api/news?')).at(-1)).toContain(
        'team=MIN%2CLAL',
      );
    });

    it('says there is none when neither team has news', async () => {
      api.news = [];
      renderRoute('/partido/final');
      expect(
        await screen.findByText('Todavía no hay noticias de estos equipos.'),
      ).toBeInTheDocument();
    });

    it('opens the news of a player in the news screen', async () => {
      const user = userEvent.setup();
      renderRoute('/partido/final');
      await user.click(await screen.findByRole('button', { name: 'Ver noticias de LeBron James' }));
      expect(where()).toBe('/noticias?equipo=todos&jugador=LeBron%20James');
    });
  });

  it('links to the two teams', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/final');
    await user.click(await screen.findByRole('link', { name: 'Ver Timberwolves' }));
    expect(where()).toBe('/equipo/MIN');
  });

  it('says the game does not exist, with no retry button, for an unknown one', async () => {
    renderRoute('/partido/nope');
    expect(await screen.findByText(/Ese partido no existe/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('goes back to the home screen when it was opened directly', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/final');
    await screen.findByRole('article', { name: /Minnesota/ });
    await user.click(screen.getByRole('button', { name: /Volver/ }));
    await waitFor(() => expect(where()).toBe('/'));
  });
});

describe('opening a game from the other screens', () => {
  it('Hoy: pressing a game card opens it', async () => {
    const user = userEvent.setup();
    renderRoute('/');
    await user.click(
      await screen.findByRole('link', {
        name: 'Ver el partido: Minnesota Timberwolves 104, Los Angeles Lakers 99, Final',
      }),
    );
    expect(where()).toBe('/partido/final');
  });

  it('Calendario: pressing a row opens the game, and going back returns to the same day', async () => {
    const user = userEvent.setup();
    renderRoute('/calendario?fecha=2026-10-07');
    await user.click(
      await screen.findByRole('link', {
        name: 'Ver el partido: Boston Celtics 74, Philadelphia 76ers 78, Q3 4:12',
      }),
    );
    expect(where()).toBe('/partido/live');

    await user.click(await screen.findByRole('button', { name: /Volver/ }));
    await waitFor(() => expect(where()).toBe('/calendario?fecha=2026-10-07'));
  });
});
