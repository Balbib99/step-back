import {
  configResponseSchema,
  gamesResponseSchema,
  healthResponseSchema,
  standingsResponseSchema,
  teamsResponseSchema,
} from '@step-back/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { fetchJson } from './api';

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
