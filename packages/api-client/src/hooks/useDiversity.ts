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
      const queryParams: Record<string, string | number | undefined> = {
        ...params,
        issuesOnly: params.issuesOnly ? 'true' : undefined,
      };
      const res = await fetchFn(`/admin/diversity${buildQueryString(queryParams)}`);
      const json: unknown = await res.json();
      return DiversityResponseSchema.parse(json);
    },
    enabled,
  });
}
