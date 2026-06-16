import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { PoolCellDetailSchema, type PoolCellQuery } from '../schemas/pool-cell';

export function usePoolCell({
  fetchFn, cell, enabled = true,
}: { fetchFn: AuthenticatedFetch; cell: PoolCellQuery; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'pool-cell', cell],
    queryFn: async () => {
      const res = await fetchFn(`/admin/pool-cell${buildQueryString({ ...cell })}`);
      const json: unknown = await res.json();
      return PoolCellDetailSchema.parse(json);
    },
    enabled,
  });
}
