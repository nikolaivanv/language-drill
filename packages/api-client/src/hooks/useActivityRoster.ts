import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { ActivityRosterItemSchema } from '../schemas/admin-activity';

export type ActivityRosterParams = { limit?: number; offset?: number };

export function useActivityRoster({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivityRosterParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'roster', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/activity/roster${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return ActivityRosterItemSchema.array().parse(json);
    },
    enabled,
  });
}
