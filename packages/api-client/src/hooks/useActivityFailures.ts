import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { ActivityFailureItemSchema } from '../schemas/admin-activity';

export type ActivityFailuresParams = {
  language?: string;
  level?: string;
  type?: string;
  grammarPointKey?: string;
  windowDays?: number;
  minAttempts?: number;
  limit?: number;
};

export function useActivityFailures({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivityFailuresParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'failures', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/activity/failures${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return ActivityFailureItemSchema.array().parse(json);
    },
    enabled,
  });
}
