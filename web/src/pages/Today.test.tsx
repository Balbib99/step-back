import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, game, renderRoute, side, stubApi } from '../test-support';

/** Wednesday 7 October 2026, 12:00 in Madrid. */
const setNow = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};

beforeEach(() => {
  setNow('2026-10-07T10:00:00Z');
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const cards = () => screen.queryAllByRole('article');
const names = () => cards().map((card) => card.getAttribute('aria-label'));
const heading = (name: string | RegExp) => screen.getByRole('heading', { level: 2, name });

describe('Hoy · loading and errors', () => {
  it('shows a placeholder while the games load', () => {
    renderRoute('/');
    expect(screen.getByRole('status', { name: 'Cargando partidos' })).toBeInTheDocument();
  });

  it('says so, with a way to retry, when the games cannot be loaded', async () => {
    api.gamesStatus = [500];
    renderRoute('/');
    expect(await screen.findByText(/No se pudieron cargar los partidos/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findAllByRole('article')).not.toHaveLength(0);
    expect(screen.queryByText(/No se pudieron cargar los partidos/)).not.toBeInTheDocument();
  });

  it('explains what is missing when the configuration cannot be loaded', async () => {
    api.config = 'down';
    renderRoute('/');
    expect(await screen.findByText(/No se pudo cargar tu configuración/)).toBeInTheDocument();
  });
});

describe('Hoy · the games of today', () => {
  it('asks for today and the next two weeks in a single request', async () => {
    renderRoute('/');
    await screen.findAllByRole('article');
    expect(api.requests).toContain('/api/games?from=2026-10-07&to=2026-10-21');
  });

  it('shows the games of your teams first, live ones before the rest', async () => {
    renderRoute('/');
    await screen.findAllByRole('article');
    expect(heading('Tus equipos')).toBeInTheDocument();
    expect(names().slice(0, 2)).toEqual([
      'Boston Celtics 74, Philadelphia 76ers 78, Q3 4:12', // live
      'Minnesota Timberwolves 104, Los Angeles Lakers 99, Final',
    ]);
  });

  it('puts the other games in "Más partidos", with their count', async () => {
    renderRoute('/');
    await screen.findAllByRole('article');
    const title = heading(/Más partidos/);
    expect(title).toHaveTextContent('1');
    expect(names()[2]).toBe('Denver Nuggets en Golden State Warriors, 22:30');
  });

  it('subtitles the page with the local day', async () => {
    renderRoute('/');
    expect(await screen.findByText('mié 7 oct')).toBeInTheDocument();
  });
});

describe('Hoy · a game of your teams as two jerseys', () => {
  it('paints each lane with its own team palette', async () => {
    renderRoute('/');
    await screen.findAllByRole('article');
    const finalGame = cards().find((card) =>
      card.getAttribute('aria-label')?.startsWith('Minnesota'),
    )!;

    const min = finalGame.querySelector<HTMLElement>('[data-team="MIN"]')!;
    const lal = finalGame.querySelector<HTMLElement>('[data-team="LAL"]')!;
    expect(min.style.getPropertyValue('--field')).toBe('#0C2340');
    expect(min.style.getPropertyValue('--numeral')).toBe('#78BE20');
    expect(lal.style.getPropertyValue('--field')).toBe('#552583');
    expect(lal.style.getPropertyValue('--numeral')).toBe('#FDB927');
    // The abbreviation is repeated big and cropped, as the lettering on a jersey.
    expect(min).toHaveAttribute('data-chest', 'MIN');
  });

  it('shows crest, full name, record and score of each team, with the loser dimmed', async () => {
    renderRoute('/');
    await screen.findAllByRole('article');
    const finalGame = cards().find((card) =>
      card.getAttribute('aria-label')?.startsWith('Minnesota'),
    )!;

    expect(within(finalGame).getByText('Minnesota Timberwolves')).toBeInTheDocument();
    expect(within(finalGame).getByText('1-0')).toBeInTheDocument();
    expect(within(finalGame).getByText('0-1')).toBeInTheDocument();
    expect(finalGame.querySelector('img[src="/api/crests/MIN.png"]')).not.toBeNull();
    const [winner, loser] = within(finalGame).getAllByLabelText(/puntos/);
    expect([winner!.textContent, loser!.textContent]).toEqual(['104', '99']);
    expect(winner).not.toHaveClass('opacity-75');
    expect(loser).toHaveClass('opacity-75');
  });

  it('says the phase, the status and the venue', async () => {
    renderRoute('/');
    await screen.findAllByRole('article');
    const finalGame = cards().find((card) =>
      card.getAttribute('aria-label')?.startsWith('Minnesota'),
    )!;
    expect(within(finalGame).getByText('Pretemporada')).toBeInTheDocument();
    expect(within(finalGame).getByText('Final')).toBeInTheDocument();
    expect(within(finalGame).getByText('Target Center')).toBeInTheDocument();
  });

  it('marks the game that is on with its quarter and clock', async () => {
    renderRoute('/');
    await screen.findAllByRole('article');
    const live = cards()[0]!;
    expect(within(live).getByText('Q3 4:12')).toBeInTheDocument();
  });

  it('shows no score for a game that has not started, only its time', async () => {
    api.games = [
      game(
        'soon',
        side('MIN', 'Minnesota Timberwolves'),
        side('IND', 'Indiana Pacers'),
        '2026-10-07T17:00:00Z',
      ),
    ];
    renderRoute('/');
    const [card] = await screen.findAllByRole('article');
    expect(within(card!).queryByLabelText(/puntos/)).not.toBeInTheDocument();
    expect(within(card!).getByText('19:00')).toBeInTheDocument(); // 17:00 UTC is 19:00 in Madrid
  });
});

describe('Hoy · when your teams do not play today', () => {
  beforeEach(() => {
    // Thursday 8 October in Madrid: only the London Lions game is on.
    setNow('2026-10-08T10:00:00Z');
  });

  it('says so and shows when each of your teams plays next, against whom', async () => {
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: 'Tus equipos no juegan hoy' }),
    ).toBeInTheDocument();

    // Lakers: next week, at home against the Kings.
    expect(screen.getByText('lun 12 oct · 00:30')).toBeInTheDocument();
    expect(screen.getByText('vs Sacramento Kings')).toBeInTheDocument();
    // Timberwolves: the regular season opener, as the visitor at Indiana, so "en".
    expect(screen.getByText('jue 22 oct · 01:30')).toBeInTheDocument();
    expect(screen.getByText('en Indiana Pacers')).toBeInTheDocument();
    // 76ers: nothing in the next two weeks.
    expect(
      screen.getByText(/Sin partidos programados en las próximas 2 semanas/),
    ).toBeInTheDocument();
  });

  it('still shows the games of other teams below', async () => {
    renderRoute('/');
    await screen.findByRole('heading', { name: /Más partidos/ });
    expect(names()).toEqual(['London Lions en Portland Trail Blazers, 22:00']);
  });

  it('shows no lanes of "Tus equipos" at all', async () => {
    renderRoute('/');
    await screen.findByRole('heading', { name: 'Tus equipos no juegan hoy' });
    expect(screen.queryByRole('heading', { name: 'Tus equipos' })).not.toBeInTheDocument();
  });
});

describe('Hoy · when one of your teams plays and another does not', () => {
  it('lists the next game of the team that does not, under "Próximo partido"', async () => {
    api.games = [
      game(
        'lakers-today',
        side('LAL', 'Los Angeles Lakers'),
        side('GS', 'Golden State Warriors'),
        '2026-10-07T20:00:00Z',
      ),
      game(
        'phi-next',
        side('PHI', 'Philadelphia 76ers'),
        side('NY', 'New York Knicks'),
        '2026-10-09T23:30:00Z',
      ),
    ];
    renderRoute('/');
    await screen.findAllByRole('article');
    expect(heading('Tus equipos')).toBeInTheDocument();
    expect(heading('Próximo partido')).toBeInTheDocument();
    expect(screen.getByText('sáb 10 oct · 01:30')).toBeInTheDocument(); // 23:30 UTC on the 9th
  });
});

describe('Hoy · an empty day', () => {
  it('says there are no games at all', async () => {
    api.games = [];
    renderRoute('/');
    expect(await screen.findByText('Hoy no hay partidos de la NBA.')).toBeInTheDocument();
  });
});
