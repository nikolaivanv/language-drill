import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ActivitySessionsPageSchema } from '../schemas/admin-activity';

export type ActivityRisk = 'abandoned' | 'low_score' | 'flagged';

export type ActivitySessionsParams = {
  user?: string;
  from?: string;
  to?: string;
  risk?: ActivityRisk[];
  /** Only sessions with ≥1 scored-but-imperfect answer (AND-composed with risk). */
  hasIncorrect?: boolean;
  limit?: number;
  offset?: number;
};

export function useActivitySessions({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivitySessionsParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'sessions', params],
    queryFn: async () => {
      // buildQueryString can't emit repeated params, so build manually.
      const sp = new URLSearchParams();
      if (params.user) sp.set('user', params.user);
      if (params.from) sp.set('from', params.from);
      if (params.to) sp.set('to', params.to);
      for (const r of params.risk ?? []) sp.append('risk', r);
      if (params.hasIncorrect) sp.set('hasIncorrect', 'true');
      if (params.limit != null) sp.set('limit', String(params.limit));
      if (params.offset != null) sp.set('offset', String(params.offset));
      const qs = sp.toString() ? `?${sp.toString()}` : '';
      const res = await fetchFn(`/admin/activity/sessions${qs}`);
      const json: unknown = await res.json();
      return ActivitySessionsPageSchema.parse(json);
    },
    enabled,
  });
}
