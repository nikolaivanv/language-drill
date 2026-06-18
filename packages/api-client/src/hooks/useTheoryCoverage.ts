import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { TheoryCoverageResponseSchema } from '../schemas/theory';

export function useTheoryCoverage({
  fetchFn, enabled = true,
}: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'theory', 'coverage'],
    queryFn: async () => {
      const res = await fetchFn('/admin/theory/coverage');
      const json: unknown = await res.json();
      return TheoryCoverageResponseSchema.parse(json);
    },
    enabled,
  });
}
