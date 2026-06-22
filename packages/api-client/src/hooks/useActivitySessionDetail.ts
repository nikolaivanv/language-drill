import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ActivitySessionDetailSchema } from '../schemas/admin-activity';

export function useActivitySessionDetail({
  fetchFn, sessionId, enabled = true,
}: { fetchFn: AuthenticatedFetch; sessionId: string | null; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'session', sessionId],
    queryFn: async () => {
      const res = await fetchFn(`/admin/activity/sessions/${sessionId!}`);
      const json: unknown = await res.json();
      return ActivitySessionDetailSchema.parse(json);
    },
    enabled: enabled && !!sessionId,
  });
}
