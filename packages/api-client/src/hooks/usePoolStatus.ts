import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { PoolStatusItemSchema } from '../schemas/pool-status';

export type PoolStatusParams = { language?: string; level?: string };

export function usePoolStatus({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: PoolStatusParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'pool-status', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/pool-status${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return PoolStatusItemSchema.array().parse(json);
    },
    enabled,
  });
}
