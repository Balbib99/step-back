import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, renderRoute, stubApi, where } from '../test-support';

const renderCalendar = (search = '?fecha=2026-10-07') => renderRoute(`/calendario${search}`);

const rows = () => screen.queryAllByRole('article');
const rowNames = () => rows().map((row) => row.getAttribute('aria-label'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Calendario · day view', () => {
  it('shows a placeholder while loading, then the games of the selected day', async () => {
    renderCalendar();
    expect(screen.getByRole('status', { name: 'Cargando partidos' })).toBeInTheDocument();
    await screen.findAllByRole('article');
    expect(screen.queryByRole('status', { name: 'Cargando partidos' })).not.toBeInTheDocument();
  });

  it('starts on "Mis equipos": the games where a favourite plays, in start order', async () => {
    renderCalendar();
    await screen.findAllByRole('article');
    expect(rowNames()).toEqual([
      'Minnesota Timberwolves 104, Los Angeles Lakers 99, Final',
      'Boston Celtics 74, Philadelphia 76ers 78, Q3 4:12',
    ]);
  });

  it('shows the score and the winner, with the loser dimmed', async () => {
    renderCalendar();
    const [first] = await screen.findAllByRole('article');
    const scores = within(first!).getAllByLabelText(/puntos/);
    expect(scores.map((s) => s.textContent)).toEqual(['104', '99']);
    expect(scores[0]).not.toHaveClass('opacity-75');
    expect(scores[1]).toHaveClass('opacity-75');
  });

  it('marks a live game with its quarter and clock', async () => {
    renderCalendar();
    await screen.findAllByRole('article');
    const live = rows()[1]!;
    expect(within(live).getByText('Q3 4:12')).toHaveClass('text-live');
    expect(within(live).getByText('En juego')).toBeInTheDocument();
  });

  it('writes upcoming games with the Madrid start time and no score', async () => {
    renderCalendar('?fecha=2026-10-07&equipo=todos');
    await screen.findAllByRole('article');
    const other = rows().find((row) => row.getAttribute('aria-label')?.startsWith('Denver'))!;
    expect(within(other).getByText('22:30')).toBeInTheDocument();
    expect(within(other).queryByLabelText(/puntos/)).not.toBeInTheDocument();
    expect(other.getAttribute('aria-label')).toBe('Denver Nuggets en Golden State Warriors, 22:30');
  });

  it('uses short team names when the team is known and the full name when it is not', async () => {
    renderCalendar('?fecha=2026-10-08&equipo=todos');
    const [lions] = await screen.findAllByRole('article');
    expect(within(lions!).getByText('London Lions')).toBeInTheDocument(); // not in the NBA
    expect(within(lions!).getByText('Trail Blazers')).toBeInTheDocument(); // short name from /api/teams
  });
});

describe('Calendario · week and day strip', () => {
  it('shows the seven days of the week, marks today and the selected day', async () => {
    renderCalendar('?fecha=2026-10-08');
    await screen.findByRole('group', { name: 'Días de la semana' });
    const strip = screen.getByRole('group', { name: 'Días de la semana' });
    expect(within(strip).getAllByRole('button')).toHaveLength(7);
    const today = within(strip).getByRole('button', { name: /^mié 7 oct, hoy/ });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(within(strip).getByRole('button', { name: /^jue 8 oct/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('tells which days your teams play, from the already loaded week', async () => {
    renderCalendar();
    await screen.findAllByRole('article');
    const strip = screen.getByRole('group', { name: 'Días de la semana' });
    expect(
      within(strip).getByRole('button', { name: /^mié 7 oct, hoy, juegan 3 de tus equipos/ }),
    ).toBeInTheDocument();
    // The 8th has only a non-favourite game: no mention.
    expect(within(strip).getByRole('button', { name: 'jue 8 oct' })).toBeInTheDocument();
  });

  it('changes day without asking the server again', async () => {
    renderCalendar();
    await screen.findAllByRole('article');
    const before = api.requests.filter((r) => r.includes('/api/games')).length;

    await userEvent.click(screen.getByRole('button', { name: 'jue 8 oct' }));

    expect(where()).toContain('fecha=2026-10-08');
    expect(screen.getByText(/Tus equipos no juegan este día/)).toBeInTheDocument();
    expect(api.requests.filter((r) => r.includes('/api/games'))).toHaveLength(before);
  });

  it('keeps today out of the address, and goes back to it with "Hoy"', async () => {
    renderCalendar('?fecha=2026-10-08');
    await screen.findByRole('button', { name: 'Ir a hoy' });
    await userEvent.click(screen.getByRole('button', { name: 'Ir a hoy' }));
    expect(where()).toBe('/calendario');
    expect(screen.queryByRole('button', { name: 'Ir a hoy' })).not.toBeInTheDocument();
  });

  it('moves a week at a time and loads that week', async () => {
    renderCalendar();
    await screen.findAllByRole('article');

    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));

    expect(where()).toContain('fecha=2026-10-14');
    await waitFor(() => expect(api.requests).toContain('/api/games?from=2026-10-12&to=2026-10-18'));
    // The first request was for the week of the 5th to the 11th.
    expect(api.requests).toContain('/api/games?from=2026-10-05&to=2026-10-11');
  });

  it('puts a game that is Sunday night in the US on the following Madrid Monday', async () => {
    renderCalendar('?fecha=2026-10-14');
    await userEvent.click(await screen.findByRole('button', { name: /^lun 12 oct/ }));
    expect(rowNames()).toEqual(['Sacramento Kings en Los Angeles Lakers, 00:30']);
  });

  it('falls back to today when the address has an invalid date', async () => {
    renderCalendar('?fecha=2026-02-30');
    await screen.findAllByRole('article');
    expect(rowNames()).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^mié 7 oct, hoy/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('writes the month of the selected day', async () => {
    renderCalendar();
    expect(await screen.findByText('Octubre 2026')).toBeInTheDocument();
  });
});

describe('Calendario · filters', () => {
  it('"Todos" shows every game of the day and is kept in the address', async () => {
    renderCalendar();
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(rows()).toHaveLength(3);
    expect(where()).toContain('equipo=todos');
  });

  it('a team chip shows only that team, and "Mis equipos" is the default left out of the address', async () => {
    renderCalendar();
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'PHI' }));
    expect(rowNames()).toEqual(['Boston Celtics 74, Philadelphia 76ers 78, Q3 4:12']);
    expect(where()).toContain('equipo=PHI');

    await userEvent.click(screen.getByRole('button', { name: 'Mis equipos' }));
    expect(where()).not.toContain('equipo');
    expect(rows()).toHaveLength(2);
  });

  it('filters by phase and the chip can be pressed again to clear it', async () => {
    renderCalendar('?fecha=2026-10-07&equipo=todos');
    await screen.findAllByRole('article');

    await userEvent.click(screen.getByRole('button', { name: 'Temporada' }));
    expect(screen.getByText('No hay partidos de esta fase este día.')).toBeInTheDocument();
    expect(where()).toContain('fase=temporada');

    await userEvent.click(screen.getByRole('button', { name: 'Temporada' })); // toggle off
    expect(rows()).toHaveLength(3);
    expect(where()).not.toContain('fase');
  });

  it('offers a way out when the phase filter empties the day', async () => {
    renderCalendar('?fecha=2026-10-07&equipo=todos&fase=temporada');
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar filtro de fase' }));
    expect(rows()).toHaveLength(3);
  });

  it('keeps the filters when changing day', async () => {
    renderCalendar('?fecha=2026-10-07&equipo=MIN');
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: /^vie 9 oct/ }));
    expect(where()).toContain('equipo=MIN');
    expect(where()).toContain('fecha=2026-10-09');
  });
});

describe('Calendario · empty states', () => {
  it('says so when there are no games that day at all', async () => {
    renderCalendar('?fecha=2026-10-06');
    expect(await screen.findByText('No hay partidos este día.')).toBeInTheDocument();
  });

  it('explains when your teams do not play, counts the other games, and offers to show them', async () => {
    renderCalendar('?fecha=2026-10-08');
    expect(await screen.findByText(/Tus equipos no juegan este día\./)).toBeInTheDocument();
    expect(screen.getByText(/Hay 1 partido en total\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver todos' }));

    expect(rowNames()).toEqual(['London Lions en Portland Trail Blazers, 22:00']);
    expect(where()).toContain('equipo=todos');
  });

  it('names the team when a single team does not play', async () => {
    renderCalendar('?fecha=2026-10-08&equipo=MIN');
    expect(await screen.findByText(/MIN no juega este día\./)).toBeInTheDocument();
  });
});

describe('Calendario · errors', () => {
  it('says the calendar could not be loaded, and loads it when asked to retry', async () => {
    api.gamesStatus = [500];
    renderCalendar();
    expect(await screen.findByText(/No se pudo cargar el calendario/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText(/No se pudo cargar el calendario/)).not.toBeInTheDocument();
  });
});
