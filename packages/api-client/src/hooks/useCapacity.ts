import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { CapacityResponseSchema } from '../schemas/capacity';

export function useCapacity({
  fetchFn, enabled = true,
}: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'capacity'],
    queryFn: async () => {
      const res = await fetchFn('/admin/capacity');
      const json: unknown = await res.json();
      return CapacityResponseSchema.parse(json);
    },
    enabled,
  });
}
