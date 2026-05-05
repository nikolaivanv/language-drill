import { useMutation } from '@tanstack/react-query';
import {
  AnnotateResponseSchema,
  type AnnotateRequest,
  type AnnotateResponse,
} from '../schemas/read';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useReadAnnotate
// ---------------------------------------------------------------------------
// POSTs to `/read/annotate` and parses the response with AnnotateResponseSchema.
// Annotation is read-only with respect to entries (the route writes only a
// `usage_events` row server-side), so this mutation does NOT invalidate any
// query-cache keys. The page-level reducer drives the UI state directly from
// `mutation.data` / `mutation.error`.
// ---------------------------------------------------------------------------

export type UseReadAnnotateOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useReadAnnotate({ fetchFn }: UseReadAnnotateOptions) {
  return useMutation<AnnotateResponse, Error, AnnotateRequest>({
    mutationFn: async (body) => {
      const response = await fetchFn('/read/annotate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return AnnotateResponseSchema.parse(json);
    },
  });
}
