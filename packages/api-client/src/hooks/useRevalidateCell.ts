import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { RevalidateResponseSchema, type RevalidateRequest, type RevalidateResponse } from '../schemas/revalidate';

export function useRevalidateCell({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<RevalidateResponse, Error, RevalidateRequest>({
    mutationFn: async (body) => {
      const res = await fetchFn('/admin/revalidate', { method: 'POST', body: JSON.stringify(body) });
      const json: unknown = await res.json();
      return RevalidateResponseSchema.parse(json);
    },
  });
}
