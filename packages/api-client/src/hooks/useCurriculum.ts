import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { CurriculumResponseSchema } from '../schemas/curriculum';

export type CurriculumParams = { language?: string; level?: string; kind?: string };

export function useCurriculum({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: CurriculumParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'curriculum', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/curriculum${buildQueryString(params)}`);
      const json: unknown = await res.json();
      return CurriculumResponseSchema.parse(json);
    },
    enabled,
  });
}
