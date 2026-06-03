import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  AdminInvitesResponseSchema,
  CreateInvitesResponseSchema,
  type AdminInvite,
  type CreateInvitesResponse,
} from '../schemas/invites';

export type UseAdminInvitesParams = {
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useAdminInvites({
  fetchFn,
  enabled = true,
}: UseAdminInvitesParams) {
  return useQuery<AdminInvite[], Error>({
    queryKey: ['admin', 'invites'],
    queryFn: async () => {
      const response = await fetchFn('/admin/invites');
      const json: unknown = await response.json();
      return AdminInvitesResponseSchema.parse(json).items;
    },
    enabled,
  });
}

export type UseCreateInvitesParams = {
  fetchFn: AuthenticatedFetch;
};

export type CreateInvitesArgs = {
  count: number;
  expiresInDays?: number;
  note?: string;
};

export function useCreateInvites({ fetchFn }: UseCreateInvitesParams) {
  const queryClient = useQueryClient();
  return useMutation<CreateInvitesResponse, Error, CreateInvitesArgs>({
    mutationFn: async (body) => {
      const response = await fetchFn('/admin/invites', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return CreateInvitesResponseSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] });
    },
  });
}

export type UseRevokeInviteParams = {
  fetchFn: AuthenticatedFetch;
};

export function useRevokeInvite({ fetchFn }: UseRevokeInviteParams) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      await fetchFn(`/admin/invites/${id}/revoke`, { method: 'POST' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] });
    },
  });
}
