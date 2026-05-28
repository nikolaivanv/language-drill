import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AnnotateSpanResponseSchema,
  type AnnotateSpanRequest,
  type DeepCard,
  type ReadEntryResponse,
} from '../schemas/read';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useReadAnnotateSpan — POST /read/annotate-span
// ---------------------------------------------------------------------------
// The client trigger for the on-demand deep annotation. Posts the full passage
// plus the selected span's character offsets (Req 3.4); the server resolves the
// span type, calls Sonnet, and returns one `DeepCard`. `createAuthenticatedFetch`
// throws on a non-2xx (carrying `.status`/`.body`), so a 429/502/400 surfaces as
// the mutation's `error` — the card UI renders an inline error + retry (Req 9.4).
//
// On success, when the span belongs to a SAVED History entry (`entryId` set),
// the resolved card is written through into the `['readEntry', entryId]` cache's
// `spanAnnotations` keyed by "start:end". This means a repeat tap on the same
// span within the session renders from cache with no new model call (Req 3.5),
// and it mirrors the server's durable write-back so the page reads the same
// shape it would on reopen (Req 11.4). An unsaved passage carries no `entryId`
// (and no entry cache), so nothing is written — its cards live only in the page
// reducer's session state (Req 11.2).
// ---------------------------------------------------------------------------

export type UseReadAnnotateSpanOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useReadAnnotateSpan({ fetchFn }: UseReadAnnotateSpanOptions) {
  const queryClient = useQueryClient();

  return useMutation<DeepCard, Error, AnnotateSpanRequest>({
    mutationFn: async (input) => {
      const response = await fetchFn('/read/annotate-span', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return AnnotateSpanResponseSchema.parse(json);
    },
    onSuccess: (card, { entryId, start, end }) => {
      // Only saved entries have a write-through cache. Skip for unsaved text.
      if (!entryId) return;
      const existing = queryClient.getQueryData<ReadEntryResponse>([
        'readEntry',
        entryId,
      ]);
      // Nothing to merge into if the entry isn't cached (e.g. tapped before the
      // entry query settled) — the durable server write-back still persisted it.
      if (!existing) return;

      const key = `${start}:${end}`;
      queryClient.setQueryData<ReadEntryResponse>(['readEntry', entryId], {
        ...existing,
        spanAnnotations: { ...(existing.spanAnnotations ?? {}), [key]: card },
      });
    },
  });
}
