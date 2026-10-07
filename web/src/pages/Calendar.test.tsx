import type { Game, GameTeam, Team } from '@step-back/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { localDay } from '../lib/dates';

const side = (
  abbr: string,
  name: string,
  score: number | null = null,
  winner: boolean | null = null,
): GameTeam => ({
  teamId: abbr,
  abbr,
  name,
  score,
  record: null,
  winner,
  linescores: [],
});

function game(
  id: string,
  away: GameTeam,
  home: GameTeam,
  startUtc: string,
  extra: Partial<Game> = {},
): Game {
  return {
    id,
    season: 2027,
    seasonType: 'preseason',
    startUtc,
    status: 'scheduled',
    statusDetail: '',
    period: null,
    clock: null,
    venue: null,
    away,
    home,
    ...extra,
  };
}

const MIN = 'Minnesota Timberwolves';
const LAL = 'Los Angeles Lakers';

// Wednesday 7 October 2026 is "today" in these tests; weeks run Monday to Sunday.
const GAMES: Game[] = [
  // Both favourites, finished. 03:30 in Madrid on the 7th.
  game('final', side('MIN', MIN, 104, true), side('LAL', LAL, 99, false), '2026-10-07T01:30:00Z', {
    status: 'final',
    statusDetail: 'Final',
  }),
  // A favourite against a non-favourite, live. 18:00 in Madrid on the 7th.
  game(
    'live',
    side('BOS', 'Boston Celtics', 74),
    side('PHI', 'Philadelphia 76ers', 78),
    '2026-10-07T16:00:00Z',
    {
      status: 'live',
      period: 3,
      clock: '4:12',
      statusDetail: '4:12 - 3rd',
    },
  ),
  // No favourite, upcoming. 22:30 in Madrid on the 7th.
  game(
    'other',
    side('DEN', 'Denver Nuggets'),
    side('GS', 'Golden State Warriors'),
    '2026-10-07T20:30:00Z',
  ),
  // Against a club that is not in the NBA. 22:00 in Madrid on the 8th.
  game(
    'lions',
    side('LON', 'London Lions'),
    side('POR', 'Portland Trail Blazers'),
    '2026-10-08T20:00:00Z',
  ),
  // 00:30 in Madrid on Monday the 12th: next week, even though it is still Sunday in the US.
  game('next-week', side('SAC', 'Sacramento Kings'), side('LAL', LAL), '2026-10-11T22:30:00Z'),
  // Regular season, the week of the 19th.
  game('regular', side('MIN', MIN), side('IND', 'Indiana Pacers'), '2026-10-21T23:30:00Z', {
    seasonType: 'regular',
  }),
];

const TEAMS: Team[] = [
  ['MIN', MIN, 'Timberwolves'],
  ['LAL', LAL, 'Lakers'],
  ['PHI', 'Philadelphia 76ers', '76ers'],
  ['BOS', 'Boston Celtics', 'Celtics'],
  ['DEN', 'Denver Nuggets', 'Nuggets'],
  ['GS', 'Golden State Warriors', 'Warriors'],
  ['POR', 'Portland Trail Blazers', 'Trail Blazers'],
  ['SAC', 'Sacramento Kings', 'Kings'],
  ['IND', 'Indiana Pacers', 'Pacers'],
].map(([abbr, name, shortName]) => ({
  id: abbr!,
  abbr: abbr!,
  name: name!,
  shortName: shortName!,
  location: '',
  logoUrl: null,
}));

const CONFIG = {
  timeZone: 'Europe/Madrid',
  favoriteTeams: ['MIN', 'LAL', 'PHI'],
  features: { translation: false, push: false },
  vapidPublicKey: null,
  modules: [],
};
const HEALTH = {
  status: 'ok',
  time: '2026-10-07T10:00:00.000Z',
  uptimeSeconds: 1,
  modules: [],
  jobs: [],
};

let requests: string[] = [];
let gamesStatus: number[] = []; // responses to give to /api/games, then 200 once exhausted

function stubApi() {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes('/api/health')) return json(HEALTH);
      if (url.includes('/api/config')) return json(CONFIG);
      if (url.includes('/api/teams')) return json({ teams: TEAMS });
      if (url.includes('/api/games')) {
        const forced = gamesStatus.shift();
        if (forced && forced !== 200) return json({ error: 'boom' }, forced);
        const params = new URL(url, 'http://x').searchParams;
        const [from, to] = [params.get('from')!, params.get('to')!];
        const inRange = GAMES.filter((g) => {
          const day = localDay(g.startUtc, 'Europe/Madrid');
          return day >= from && day <= to;
        });
        return json({ games: inRange });
      }
      throw new Error(`unexpected request ${url}`);
    }),
  );
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderCalendar(search = '?fecha=2026-10-07') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/calendario${search}`]}>
        <AppRoutes />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rows = () => screen.queryAllByRole('article');
const rowNames = () => rows().map((row) => row.getAttribute('aria-label'));
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  gamesStatus = [];
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
    const before = requests.filter((r) => r.includes('/api/games')).length;

    await userEvent.click(screen.getByRole('button', { name: 'jue 8 oct' }));

    expect(where()).toContain('fecha=2026-10-08');
    expect(screen.getByText(/Tus equipos no juegan este día/)).toBeInTheDocument();
    expect(requests.filter((r) => r.includes('/api/games'))).toHaveLength(before);
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
    await waitFor(() => expect(requests).toContain('/api/games?from=2026-10-12&to=2026-10-18'));
    // The first request was for the week of the 5th to the 11th.
    expect(requests).toContain('/api/games?from=2026-10-05&to=2026-10-11');
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
    gamesStatus = [500];
    renderCalendar();
    expect(await screen.findByText(/No se pudo cargar el calendario/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText(/No se pudo cargar el calendario/)).not.toBeInTheDocument();
  });
});
