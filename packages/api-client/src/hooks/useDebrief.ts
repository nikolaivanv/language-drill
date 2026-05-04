import { useQuery } from '@tanstack/react-query';
import {
  DebriefResponseSchema,
  type DebriefResponse,
} from '../schemas/debrief';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useSessionDebrief
// ---------------------------------------------------------------------------
// Read-only query that fetches the post-session debrief payload from
// `GET /sessions/:sessionId/debrief`. The response is validated against
// `DebriefResponseSchema` so consumers receive strongly-typed data.
//
// `staleTime: Infinity` is safe because the payload is immutable once the
// session is completed (NFR Reliability — completedAt-keyed responses do not
// change). Re-mounts within the same QueryClient hit cache and skip the
// network entirely.
// ---------------------------------------------------------------------------

export type UseSessionDebriefOptions = {
  sessionId: string;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useSessionDebrief({
  sessionId,
  fetchFn,
  enabled = true,
}: UseSessionDebriefOptions) {
  return useQuery<DebriefResponse, Error>({
    queryKey: ['session-debrief', sessionId],
    queryFn: async () => {
      const response = await fetchFn(`/sessions/${sessionId}/debrief`);
      const json: unknown = await response.json();
      return DebriefResponseSchema.parse(json);
    },
    enabled,
    staleTime: Infinity,
  });
}
