import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  FlaggedExercisesResponseSchema,
  FlaggedTheoryResponseSchema,
  ResolveResponseSchema,
  type FlaggedExerciseFilters,
  type FlaggedTheoryFilters,
  type ResolveOutcome,
} from '../schemas/flagged';

function queryString(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useFlaggedExercises({
  fetchFn, filters = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; filters?: FlaggedExerciseFilters; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'flagged', 'exercises', filters],
    queryFn: async () => {
      const res = await fetchFn(`/admin/flagged/exercises${queryString(filters)}`);
      const json: unknown = await res.json();
      return FlaggedExercisesResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useFlaggedTheory({
  fetchFn, filters = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; filters?: FlaggedTheoryFilters; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'flagged', 'theory', filters],
    queryFn: async () => {
      const res = await fetchFn(`/admin/flagged/theory${queryString(filters)}`);
      const json: unknown = await res.json();
      return FlaggedTheoryResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useResolveFlaggedExercise({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'approve' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/flagged/exercises/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'flagged', 'exercises'] });
    },
  });
}

export function useResolveFlaggedTheory({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'approve' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/flagged/theory/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'flagged', 'theory'] });
    },
  });
}
