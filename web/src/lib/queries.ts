import { configResponseSchema, healthResponseSchema } from '@step-back/shared';
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
