import {
  boxscoreResponseSchema,
  configResponseSchema,
  gameHighlightsResponseSchema,
  gamesResponseSchema,
  healthResponseSchema,
  highlightsResponseSchema,
  newsResponseSchema,
  pushSettingsSchema,
  standingsResponseSchema,
  teamsResponseSchema,
  translationResponseSchema,
  translationStatusSchema,
} from '@step-back/shared';
import type { PushSettings, TeamPushSettings } from '@step-back/shared';
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { fetchJson, postJson, sendJson } from './api';
import { newsQuery, type NewsFilters } from './news';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // "always": ask even with no connection. The service worker answers from its stored copy;
      // the default would pause every query offline and leave the screen loading for ever.
      queries: { retry: 1, staleTime: 30_000, networkMode: 'always' },
      mutations: { networkMode: 'always' },
    },
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchJson('/api/health', healthResponseSchema, signal),
    refetchInterval: 60_000,
  });
}

/** Time zone, favourites and feature flags. Changes only when the server is reconfigured. */
export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: ({ signal }) => fetchJson('/api/config', configResponseSchema, signal),
    staleTime: 5 * 60_000,
  });
}

/** The 30 teams: names and crests. Practically static. */
export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: ({ signal }) => fetchJson('/api/teams', teamsResponseSchema, signal),
    staleTime: 60 * 60_000,
  });
}

/** Both conference tables. The server refreshes them every few minutes at most. */
export function useStandings() {
  return useQuery({
    queryKey: ['standings'],
    queryFn: ({ signal }) => fetchJson('/api/standings', standingsResponseSchema, signal),
    refetchInterval: 5 * 60_000,
  });
}

/** Every game between two local days, both included. Refreshes faster while a game is live. */
export function useGamesRange(from: string, to: string) {
  return useQuery({
    queryKey: ['games', from, to],
    queryFn: ({ signal }) =>
      fetchJson(
        `/api/games?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        gamesResponseSchema,
        signal,
      ),
    refetchInterval: (query) =>
      query.state.data?.games.some((game) => game.status === 'live') ? 30_000 : 5 * 60_000,
  });
}

/** News, newest first, a page at a time. A new set of filters starts again from the first page. */
export function useNews(filters: NewsFilters, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: ['news', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchJson(`/api/news${newsQuery(filters, pageParam)}`, newsResponseSchema, signal),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 5 * 60_000,
  });
}

/** Videos of the official NBA channel, newest first, a page at a time. */
export function useHighlights(teams: readonly string[], enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: ['highlights', teams],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (teams.length > 0) params.set('team', teams.join(','));
      if (pageParam) params.set('before', pageParam);
      return fetchJson(`/api/highlights?${params.toString()}`, highlightsResponseSchema, signal);
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    // A summary comes out a while after the game: look again every few minutes.
    refetchInterval: 5 * 60_000,
  });
}

/** The videos linked to one game; an empty list while there are none yet. */
export function useGameHighlights(gameId: string) {
  return useQuery({
    queryKey: ['game-highlights', gameId],
    queryFn: ({ signal }) =>
      fetchJson(
        `/api/games/${encodeURIComponent(gameId)}/highlights`,
        gameHighlightsResponseSchema,
        signal,
      ),
    refetchInterval: 5 * 60_000,
  });
}

/** How much of the translation quota is used. Only asked when the server has translation on. */
export function useTranslationStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['translation-status'],
    queryFn: ({ signal }) => fetchJson('/api/translation/status', translationStatusSchema, signal),
    enabled,
    staleTime: 60_000,
  });
}

/** Translates one news item into Spanish. Only ever called by pressing the button. */
export function useTranslate(newsId: number) {
  return useMutation({
    mutationFn: () => postJson(`/api/news/${newsId}/translate`, translationResponseSchema),
  });
}

/** Every game of one team (preseason and season), oldest first. */
export function useTeamGames(abbr: string) {
  return useQuery({
    queryKey: ['team-games', abbr],
    queryFn: ({ signal }) =>
      fetchJson(`/api/games?team=${encodeURIComponent(abbr)}`, gamesResponseSchema, signal),
    refetchInterval: (query) =>
      query.state.data?.games.some((game) => game.status === 'live') ? 30_000 : 5 * 60_000,
  });
}

const PUSH_SETTINGS_KEY = ['push-settings'];

/** What to be notified about, per favourite team. Only asked when the server has push on. */
export function usePushSettings(enabled: boolean) {
  return useQuery({
    queryKey: PUSH_SETTINGS_KEY,
    queryFn: ({ signal }) => fetchJson('/api/push/settings', pushSettingsSchema, signal),
    enabled,
    staleTime: 60_000,
  });
}

/** Saves the settings of some teams. The screen shows the change at once and goes back if it fails. */
export function useSavePushSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (teams: TeamPushSettings[]) =>
      sendJson('PUT', '/api/push/settings', { teams }, pushSettingsSchema),
    onMutate: async (changed) => {
      await client.cancelQueries({ queryKey: PUSH_SETTINGS_KEY });
      const before = client.getQueryData<PushSettings>(PUSH_SETTINGS_KEY);
      if (before) {
        client.setQueryData<PushSettings>(PUSH_SETTINGS_KEY, {
          teams: before.teams.map((t) => changed.find((c) => c.team === t.team) ?? t),
        });
      }
      return { before };
    },
    onError: (_error, _team, context) => {
      if (context?.before) client.setQueryData(PUSH_SETTINGS_KEY, context.before);
    },
    onSuccess: (saved) => client.setQueryData(PUSH_SETTINGS_KEY, saved),
  });
}

/** The numbers of each player of a game that has started; looked at again every half minute while it is on. */
export function useBoxscore(gameId: string, enabled: boolean, live = false) {
  return useQuery({
    queryKey: ['boxscore', gameId],
    queryFn: ({ signal }) =>
      fetchJson(
        `/api/games/${encodeURIComponent(gameId)}/boxscore`,
        boxscoreResponseSchema,
        signal,
      ),
    enabled,
    refetchInterval: live ? 30_000 : false,
  });
}
