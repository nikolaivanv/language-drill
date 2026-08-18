import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import {
  DiversityResponseSchema,
  type DiversityQuery,
} from '../schemas/diversity';

export function useDiversity({
  fetchFn,
  params = {},
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  params?: DiversityQuery;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['admin', 'diversity', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/diversity${buildQueryString(params)}`);
      const json: unknown = await res.json();
      return DiversityResponseSchema.parse(json);
    },
    enabled,
  });
}
