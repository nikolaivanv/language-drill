import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { ActivitySessionListItemSchema } from '../schemas/admin-activity';

export type ActivitySessionsParams = {
  language?: string;
  userId?: string;
  all?: boolean;
  limit?: number;
  offset?: number;
};

export function useActivitySessions({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivitySessionsParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'sessions', params],
    queryFn: async () => {
      const qs = buildQueryString({
        language: params.language,
        userId: params.userId,
        all: params.all ? 'true' : undefined,
        limit: params.limit,
        offset: params.offset,
      });
      const res = await fetchFn(`/admin/activity/sessions${qs}`);
      const json: unknown = await res.json();
      return ActivitySessionListItemSchema.array().parse(json);
    },
    enabled,
  });
}
