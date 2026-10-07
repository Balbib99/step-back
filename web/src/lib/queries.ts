import {
  configResponseSchema,
  gameHighlightsResponseSchema,
  gamesResponseSchema,
  healthResponseSchema,
  highlightsResponseSchema,
  newsResponseSchema,
  standingsResponseSchema,
  teamsResponseSchema,
} from '@step-back/shared';
import { QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchJson } from './api';
import { newsQuery, type NewsFilters } from './news';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
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
export function useNews(filters: NewsFilters) {
  return useInfiniteQuery({
    queryKey: ['news', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchJson(`/api/news${newsQuery(filters, pageParam)}`, newsResponseSchema, signal),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 5 * 60_000,
  });
}

/** Videos of the official NBA channel, newest first, a page at a time. */
export function useHighlights(teams: readonly string[]) {
  return useInfiniteQuery({
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
