import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ResolveResponseSchema, type ResolveOutcome } from '../schemas/flagged';
import {
  ContentExercisesResponseSchema, ContentTheoryResponseSchema,
  type ContentExerciseParams, type ContentTheoryParams,
} from '../schemas/content';

function queryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useContentExercises({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ContentExerciseParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'content', 'exercises', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/content/exercises${queryString(params)}`);
      const json: unknown = await res.json();
      return ContentExercisesResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useContentTheory({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ContentTheoryParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'content', 'theory', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/content/theory${queryString(params)}`);
      const json: unknown = await res.json();
      return ContentTheoryResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useResolveContentExercise({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'demote' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/content/exercises/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'content', 'exercises'] }); },
  });
}

export function useResolveContentTheory({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'demote' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/content/theory/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'content', 'theory'] }); },
  });
}
