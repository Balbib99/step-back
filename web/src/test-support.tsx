import type { Game, GameTeam, TeamWithCrest } from '@step-back/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes } from './App';
import { localDay } from './lib/dates';

// Shared by the page tests: a small league, a fake server, and a way to render the app on a route.

export const side = (
  abbr: string,
  name: string,
  score: number | null = null,
  winner: boolean | null = null,
  record: string | null = null,
): GameTeam => ({ teamId: abbr, abbr, name, score, record, winner, linescores: [] });

export function game(
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

export const MIN = 'Minnesota Timberwolves';
export const LAL = 'Los Angeles Lakers';

// Wednesday 7 October 2026 is "today" in these tests; weeks run Monday to Sunday.
export const GAMES: Game[] = [
  // Both favourites, finished. 03:30 in Madrid on the 7th.
  game(
    'final',
    side('MIN', MIN, 104, true, '1-0'),
    side('LAL', LAL, 99, false, '0-1'),
    '2026-10-07T01:30:00Z',
    { status: 'final', statusDetail: 'Final', venue: 'Target Center' },
  ),
  // A favourite against a non-favourite, live. 18:00 in Madrid on the 7th.
  game(
    'live',
    side('BOS', 'Boston Celtics', 74),
    side('PHI', 'Philadelphia 76ers', 78),
    '2026-10-07T16:00:00Z',
    { status: 'live', period: 3, clock: '4:12', statusDetail: '4:12 - 3rd' },
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

export const TEAMS: TeamWithCrest[] = [
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
  crestUrl: `/api/crests/${abbr}.png`,
}));

export const CONFIG = {
  timeZone: 'Europe/Madrid',
  favoriteTeams: ['MIN', 'LAL', 'PHI'],
  features: { translation: false, push: false },
  vapidPublicKey: null,
  modules: [],
};

export const HEALTH = {
  status: 'ok',
  time: '2026-10-07T10:00:00.000Z',
  uptimeSeconds: 1,
  modules: [],
  jobs: [],
};

/** What the fake server was asked, and what it should answer. Reset by `stubApi`. */
export const api = {
  requests: [] as string[],
  /** Statuses to answer /api/games with, one per request; 200 once exhausted. */
  gamesStatus: [] as number[],
  games: GAMES,
  config: CONFIG as object | 'down',
};

export function stubApi() {
  api.requests = [];
  api.gamesStatus = [];
  api.games = GAMES;
  api.config = CONFIG;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      api.requests.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes('/api/health')) return json(HEALTH);
      if (url.includes('/api/config')) {
        if (api.config === 'down') throw new TypeError('network down');
        return json(api.config);
      }
      if (url.includes('/api/teams')) return json({ teams: TEAMS });
      if (url.includes('/api/games')) {
        const forced = api.gamesStatus.shift();
        if (forced && forced !== 200) return json({ error: 'boom' }, forced);
        const params = new URL(url, 'http://x').searchParams;
        const [from, to] = [params.get('from')!, params.get('to')!];
        const inRange = api.games.filter((g) => {
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

export const where = () => screen.getByTestId('where').textContent;

/** The whole app on a route, against the fake server. */
export function renderRoute(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
