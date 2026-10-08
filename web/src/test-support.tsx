import type {
  BoxscoreResponse,
  Game,
  PlayerLine,
  GameTeam,
  Highlight,
  NewsItem,
  TeamPushSettings,
  TeamWithCrest,
} from '@step-back/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes } from './App';
import { localDay } from './lib/dates';
import { createQueryClient } from './lib/queries';

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

const NO_STATS = {
  minutes: null,
  points: null,
  rebounds: null,
  assists: null,
  steals: null,
  blocks: null,
  turnovers: null,
  fouls: null,
  fieldGoals: null,
  threePointers: null,
  freeThrows: null,
  plusMinus: null,
};

/** A player line. By default he started and played 30 minutes. */
export function player(
  id: string,
  shortName: string,
  points: number,
  extra: Partial<PlayerLine> = {},
) {
  return {
    ...NO_STATS,
    id,
    name: shortName,
    shortName,
    jersey: '1',
    position: 'G',
    starter: true,
    played: true,
    reason: null,
    minutes: 30,
    points,
    rebounds: 5,
    assists: 4,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 3,
    fieldGoals: '8-15',
    threePointers: '2-5',
    freeThrows: '4-4',
    plusMinus: 7,
    ...extra,
  };
}

/** A small box score for the final of MIN-LAL: each team with two starters, a bench player and one who did not play. */
export function boxscoreOf(gameId: string, away = 'MIN', home = 'LAL'): BoxscoreResponse {
  const team = (abbr: string, names: [string, string, string, string], scores: number[]) => ({
    teamId: abbr,
    abbr,
    players: [
      player(`${abbr}1`, names[0], scores[0]!),
      player(`${abbr}2`, names[1], scores[1]!, { position: 'F', plusMinus: -3 }),
      player(`${abbr}3`, names[2], scores[2]!, { starter: false, minutes: 12 }),
      player(`${abbr}4`, names[3], 0, {
        ...NO_STATS,
        starter: false,
        played: false,
        reason: "COACH'S DECISION",
      }),
    ],
    totals: {
      ...NO_STATS,
      points: scores.reduce((a, b) => a + b, 0),
      rebounds: 30,
      assists: 20,
      steals: 6,
      blocks: 2,
      turnovers: 11,
      fouls: 15,
      fieldGoals: '30-70',
      threePointers: '8-25',
      freeThrows: '12-15',
    },
  });
  return {
    gameId,
    away: team(away, ['A. Edwards', 'R. Gobert', 'N. Reid', 'J. McLaughlin'], [28, 12, 9]),
    home: team(home, ['L. Doncic', 'A. Reaves', 'J. Hayes', 'D. Finney-Smith'], [30, 18, 6]),
    updatedAt: '2026-10-07T10:00:00.000Z',
  };
}

export const CONFIG = {
  timeZone: 'Europe/Madrid',
  favoriteTeams: ['MIN', 'LAL', 'PHI'],
  features: { translation: false, push: false },
  vapidPublicKey: null,
  modules: [],
};

/** The server with notifications on (a real VAPID public key is 65 bytes in base64url). */
export const PUSH_CONFIG = {
  ...CONFIG,
  features: { translation: false, push: true },
  vapidPublicKey:
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
};

const OFF = { start: false, end: false, reminderMinutes: 0, news: false } as const;

/** The three favourites with their alerts on, then two other teams with none. */
export const PUSH_DEFAULTS: TeamPushSettings[] = [
  ...['MIN', 'LAL', 'PHI'].map((team) => ({
    team,
    start: true,
    end: true,
    reminderMinutes: 30 as const,
    news: false,
  })),
  { team: 'BOS', ...OFF },
  { team: 'DEN', ...OFF },
];

export const HEALTH = {
  status: 'ok',
  time: '2026-10-07T10:00:00.000Z',
  uptimeSeconds: 1,
  modules: [],
  jobs: [],
};

export function newsItem(id: number, extra: Partial<NewsItem> = {}): NewsItem {
  return {
    id,
    sourceId: 'espn',
    sourceName: 'ESPN',
    url: `https://www.espn.com/story/${id}`,
    title: `Titular ${id}`,
    summary: null,
    lang: 'en',
    // Newer items have lower ids: 10:00 Madrid on the 7th minus an hour per id.
    publishedAt: new Date(Date.parse('2026-10-07T08:00:00Z') - id * 3_600_000).toISOString(),
    mediaKind: 'none',
    imageUrl: null,
    embedUrl: null,
    durationSeconds: null,
    teams: [],
    players: [],
    ...extra,
  };
}

/** A small feed that covers every kind of post. */
export const NEWS: NewsItem[] = [
  newsItem(1, {
    title: 'Lakers ganan en la prórroga',
    summary: 'LeBron lidera la remontada.',
    lang: 'es',
    sourceId: 'gigantes',
    sourceName: 'Gigantes del Basket',
    teams: ['LAL'],
    players: ['LeBron James'],
  }),
  newsItem(2, {
    title: 'Game Highlights: Timberwolves vs. Lakers',
    mediaKind: 'video',
    imageUrl: '/api/news/2/image',
    teams: ['MIN', 'LAL'],
  }),
  newsItem(3, {
    title: 'Embiid vuelve a entrenar',
    mediaKind: 'image',
    imageUrl: '/api/news/3/image',
    teams: ['PHI'],
    players: ['Joel Embiid'],
  }),
  newsItem(4, { title: 'Rumores del mercado de fichajes', sourceName: 'Yahoo Sports' }),
  newsItem(5, { title: 'Nuggets contra Warriors', teams: ['DEN', 'GS'] }),
];

export function highlight(id: number, extra: Partial<Highlight> = {}): Highlight {
  const ytId = `video${String(id).padStart(6, '0')}`;
  return {
    id,
    ytId,
    title: `Jugada ${id}`,
    publishedAt: new Date(Date.parse('2026-10-07T08:00:00Z') - id * 3_600_000).toISOString(),
    kind: 'clip',
    gameId: null,
    thumbnailUrl: `/api/highlights/${id}/thumb`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}`,
    watchUrl: `https://www.youtube.com/watch?v=${ytId}`,
    isShort: false,
    teams: [],
    players: [],
    ...extra,
  };
}

/** A small channel feed: a game summary, two clips and a loose one. */
export const HIGHLIGHTS: Highlight[] = [
  highlight(1, {
    title: 'LAKERS at WARRIORS | FULL GAME HIGHLIGHTS',
    kind: 'full_highlights',
    gameId: 'final',
    teams: ['LAL', 'GS'],
  }),
  highlight(2, { title: 'Embiid vuelve a anotar', teams: ['PHI'] }),
  highlight(3, { title: 'Timberwolves clip', teams: ['MIN'] }),
  highlight(4, { title: 'Top 5 plays of the night' }),
];

const entry = (rank: number, abbr: string, name: string, wins: number, losses: number) => ({
  teamId: abbr,
  abbr,
  name,
  rank,
  wins,
  losses,
  winPct: wins / (wins + losses),
  gamesBehind: rank - 1,
  streak: wins > losses ? 'W2' : 'L1',
  home: '2-1',
  road: '1-1',
  last10: `${wins}-${losses}`,
  conferenceRecord: '2-1',
  divisionRecord: '1-0',
  clincher: null,
  pointsFor: 110,
  pointsAgainst: 105,
});

/** A short table per conference (the real one has 15 teams), ranked 1 to N. */
export function standingsTable(
  conference: 'east' | 'west',
  seasonType: 'preseason' | 'regular',
  ranks?: number[],
) {
  const teams: [string, string][] =
    conference === 'west'
      ? [
          ['DEN', 'Denver Nuggets'],
          ['MIN', MIN],
          ['LAL', LAL],
          ['POR', 'Portland Trail Blazers'],
        ]
      : [
          ['BOS', 'Boston Celtics'],
          ['PHI', 'Philadelphia 76ers'],
          ['IND', 'Indiana Pacers'],
        ];
  return {
    conference,
    season: 2027,
    seasonType,
    updatedAt: '2026-10-07T09:50:00.000Z',
    entries: teams.map(([abbr, name], i) => entry(ranks?.[i] ?? i + 1, abbr, name, 4 - i, i)),
  };
}

/** What the fake server was asked, and what it should answer. Reset by `stubApi`. */
export const api = {
  requests: [] as string[],
  /** What /api/translation/status says. */
  translationStatus: {
    enabled: true,
    used: 0,
    limit: 1_000_000,
    percent: 0,
    blocked: false,
  } as object,
  /** How to answer a translation request; by default the title and summary prefixed with "ES: ". */
  translate: ((item: NewsItem) => ({
    status: 200,
    body: {
      title: `ES: ${item.title}`,
      summary: item.summary ? `ES: ${item.summary}` : null,
      cached: false,
    },
  })) as (item: NewsItem) => { status: number; body: object },
  /** Videos to answer /api/highlights with, or a status to fail with. */
  highlights: [] as Highlight[] | number,
  /** Page size of the fake /api/highlights. */
  highlightsPageSize: 20,
  /** News to answer /api/news with, or a status to fail with. */
  news: [] as NewsItem[] | number,
  /** Page size of the fake /api/news, to try paging with a small feed. */
  newsPageSize: 20,
  /** Tables to answer /api/standings with, or a status to fail with. */
  standings: [] as ReturnType<typeof standingsTable>[] | number,
  /** Statuses to answer /api/games with, one per request; 200 once exhausted. */
  gamesStatus: [] as number[],
  games: GAMES,
  config: CONFIG as object | 'down',
  /** What /api/health says; set `jobs` to make a source fail. */
  health: HEALTH as object,
  /** The box score to answer with, or a status to fail with; by default one for any game. */
  boxscore: 'default' as BoxscoreResponse | number | 'default',
  /** What /api/push/settings holds. */
  pushSettings: PUSH_DEFAULTS as TeamPushSettings[],
  /** Status to answer a push settings change with; 200 saves it. */
  pushSaveStatus: 200,
  /** Status to answer the test notification with. */
  pushTestStatus: 200,
  /** Bodies of the subscribe and unsubscribe requests, as `METHOD {json}`. */
  pushSubscriptions: [] as string[],
};

export function stubApi() {
  api.requests = [];
  api.gamesStatus = [];
  api.news = NEWS;
  api.highlights = HIGHLIGHTS;
  api.translationStatus = { enabled: true, used: 0, limit: 1_000_000, percent: 0, blocked: false };
  api.translate = (item) => ({
    status: 200,
    body: {
      title: `ES: ${item.title}`,
      summary: item.summary ? `ES: ${item.summary}` : null,
      cached: false,
    },
  });
  api.highlightsPageSize = 20;
  api.newsPageSize = 20;
  api.standings = [standingsTable('east', 'regular'), standingsTable('west', 'regular')];
  api.games = GAMES;
  api.config = CONFIG;
  api.boxscore = 'default';
  api.health = HEALTH;
  api.pushSettings = PUSH_DEFAULTS.map((team) => ({ ...team }));
  api.pushSaveStatus = 200;
  api.pushTestStatus = 200;
  api.pushSubscriptions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      api.requests.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes('/api/health')) return json(api.health);
      if (url.includes('/api/config')) {
        if (api.config === 'down') throw new TypeError('network down');
        return json(api.config);
      }
      if (url.includes('/api/teams')) return json({ teams: TEAMS });
      if (url.includes('/api/push/settings')) {
        if (init?.method === 'PUT') {
          if (api.pushSaveStatus !== 200) return json({ error: 'boom' }, api.pushSaveStatus);
          const { teams } = JSON.parse(String(init.body)) as { teams: TeamPushSettings[] };
          api.pushSettings = api.pushSettings.map((t) => teams.find((n) => n.team === t.team) ?? t);
        }
        return json({ teams: api.pushSettings });
      }
      if (url.includes('/api/push/test')) {
        api.pushSubscriptions.push(`${init?.method} ${String(init?.body)}`);
        if (api.pushTestStatus !== 200) {
          return json(
            { error: 'push_failed', message: 'El servicio de notificaciones no respondió.' },
            api.pushTestStatus,
          );
        }
        return json({ sent: true });
      }
      if (url.includes('/api/push/subscribe')) {
        api.pushSubscriptions.push(`${init?.method} ${String(init?.body)}`);
        return json({ subscribed: init?.method !== 'DELETE' }, init?.method === 'POST' ? 201 : 200);
      }
      if (init?.method === 'POST') api.requests.push(`POST ${url}`);
      const translating = /\/api\/news\/(\d+)\/translate/.exec(url);
      if (translating) {
        const item = (typeof api.news === 'number' ? [] : api.news).find(
          (n) => n.id === Number(translating[1]),
        );
        if (!item) return json({ error: 'not_found', message: 'Esa noticia no existe.' }, 404);
        const answer = api.translate(item);
        return json(answer.body, answer.status);
      }
      if (url.includes('/api/translation/status')) return json(api.translationStatus);
      const gameBoxscore = /\/api\/games\/([^/]+)\/boxscore/.exec(url);
      if (gameBoxscore) {
        if (typeof api.boxscore === 'number') return json({ error: 'boom' }, api.boxscore);
        const id = decodeURIComponent(gameBoxscore[1]!);
        const found = api.games.find((g) => g.id === id);
        if (!found) return json({ error: 'not_found' }, 404);
        if (api.boxscore !== 'default') return json(api.boxscore);
        return json(boxscoreOf(id, found.away.abbr, found.home.abbr));
      }
      const gameVideos = /\/api\/games\/([^/]+)\/highlights/.exec(url);
      if (gameVideos) {
        const game = api.games.find((g) => g.id === decodeURIComponent(gameVideos[1]!));
        if (!game) return json({ error: 'not_found' }, 404);
        const list = typeof api.highlights === 'number' ? [] : api.highlights;
        return json({ game, highlights: list.filter((h) => h.gameId === game.id) });
      }
      if (url.includes('/api/highlights')) {
        if (typeof api.highlights === 'number') return json({ error: 'boom' }, api.highlights);
        const params = new URL(url, 'http://x').searchParams;
        const wanted = params.get('team')?.split(',');
        const matching = api.highlights.filter(
          (h) => !wanted || h.teams.some((t) => wanted.includes(t)),
        );
        const start = Number(params.get('before') ?? 0);
        const size = Math.min(Number(params.get('limit') ?? 20), api.highlightsPageSize);
        return json({
          highlights: matching.slice(start, start + size),
          nextBefore: start + size < matching.length ? String(start + size) : null,
        });
      }
      if (url.includes('/api/news')) {
        if (typeof api.news === 'number') return json({ error: 'boom' }, api.news);
        const params = new URL(url, 'http://x').searchParams;
        const wantedTeams = params.get('team')?.split(',');
        const matching = api.news.filter(
          (n) =>
            (!wantedTeams || n.teams.some((t) => wantedTeams.includes(t))) &&
            (!params.get('player') || n.players.includes(params.get('player')!)) &&
            (!params.get('lang') || n.lang === params.get('lang')) &&
            (!params.get('media') || n.mediaKind === params.get('media')),
        );
        // The cursor is just the offset: the app only hands it back.
        const start = Number(params.get('before') ?? 0);
        const size = Math.min(Number(params.get('limit') ?? 20), api.newsPageSize);
        const page = matching.slice(start, start + size);
        return json({
          news: page,
          nextBefore: start + size < matching.length ? String(start + size) : null,
        });
      }
      if (url.includes('/api/standings')) {
        if (typeof api.standings === 'number') return json({ error: 'boom' }, api.standings);
        return json({ standings: api.standings });
      }
      if (url.includes('/api/games')) {
        const forced = api.gamesStatus.shift();
        if (forced && forced !== 200) return json({ error: 'boom' }, forced);
        const params = new URL(url, 'http://x').searchParams;
        const team = params.get('team');
        if (team) {
          const ofTeam = api.games.filter((g) => g.home.abbr === team || g.away.abbr === team);
          return json({ games: [...ofTeam].sort((a, b) => a.startUtc.localeCompare(b.startUtc)) });
        }
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
  // The real defaults of the app (such as networkMode), without retries so failures show at once.
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
