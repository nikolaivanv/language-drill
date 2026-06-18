import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { GenerationStatsSchema } from '../schemas/pool-status';

export function useGenerationStats({
  fetchFn, enabled = true,
}: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'generation-stats'],
    queryFn: async () => {
      const res = await fetchFn('/admin/generation-stats');
      const json: unknown = await res.json();
      return GenerationStatsSchema.parse(json);
    },
    enabled,
  });
}
