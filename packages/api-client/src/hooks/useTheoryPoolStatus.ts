import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { PoolStatusTheoryItemSchema } from '../schemas/theory';

export type TheoryPoolStatusParams = { language?: string; level?: string };

export function useTheoryPoolStatus({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: TheoryPoolStatusParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'theory', 'pool-status', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/theory/pool-status${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return PoolStatusTheoryItemSchema.array().parse(json);
    },
    enabled,
  });
}
