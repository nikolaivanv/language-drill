import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  FlagExerciseResponseSchema,
  UserFlagsResponseSchema,
  ResolveUserFlagResponseSchema,
  type FlagCategory,
  type ResolveUserFlagOutcome,
} from '../schemas/user-flags';

export type UserFlagStatus = 'open' | 'resolved_rejected' | 'resolved_dismissed' | 'all';

export function useFlagExercise({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<
    { id: string; status: 'open'; createdAt: string },
    Error,
    { exerciseId: string; submissionId: string; category: FlagCategory; note?: string }
  >({
    mutationFn: async ({ exerciseId, submissionId, category, note }) => {
      const body: Record<string, unknown> = { submissionId, category };
      if (note !== undefined && note !== '') body.note = note;
      const res = await fetchFn(`/exercises/${exerciseId}/flag`, { method: 'POST', body: JSON.stringify(body) });
      const json: unknown = await res.json();
      return FlagExerciseResponseSchema.parse(json);
    },
  });
}

export function useUserFlagsQueue({
  fetchFn, status = 'open', enabled = true,
}: { fetchFn: AuthenticatedFetch; status?: UserFlagStatus; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'user-flags', status],
    queryFn: async () => {
      const res = await fetchFn(`/admin/flags?status=${status}`);
      const json: unknown = await res.json();
      return UserFlagsResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useResolveUserFlag({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveUserFlagOutcome, Error, { id: string; action: 'reject' | 'dismiss' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/flags/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveUserFlagResponseSchema.parse(json).outcome;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'user-flags'] });
    },
  });
}
