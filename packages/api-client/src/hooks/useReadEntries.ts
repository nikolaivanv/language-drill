import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import {
  ReadEntriesResponseSchema,
  ReadEntryResponseSchema,
  type ReadEntriesResponse,
  type ReadEntryResponse,
} from '../schemas/read';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useReadEntries — GET /read/entries?language=<…>
// ---------------------------------------------------------------------------
// History list scoped to the active language. The response is capped at 50
// rows server-side; pagination is out of scope for v1. `staleTime: 60s`
// matches `useTodayPlan` — long enough to dedupe rapid remounts, short enough
// that a freshly-saved entry surfaces without a manual refresh once
// `useSaveReadEntry` invalidates the key.
// ---------------------------------------------------------------------------

const READ_ENTRIES_STALE_TIME_MS = 60 * 1000;

export type UseReadEntriesParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useReadEntries({
  fetchFn,
  language,
  enabled = true,
}: UseReadEntriesParams): UseQueryResult<ReadEntriesResponse, Error> {
  return useQuery<ReadEntriesResponse, Error>({
    queryKey: ['readEntries', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/read/entries?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return ReadEntriesResponseSchema.parse(json);
    },
    enabled,
    staleTime: READ_ENTRIES_STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// useReadEntry — GET /read/entries/:id
// ---------------------------------------------------------------------------
// Single-entry fetch. `staleTime: Infinity` is safe because the entry payload
// changes only via the bank-update mutation, which writes through this exact
// cache key (see `useUpdateReadBank`). Re-mounts within the same QueryClient
// hit cache and skip the network entirely.
// ---------------------------------------------------------------------------

export type UseReadEntryParams = {
  fetchFn: AuthenticatedFetch;
  id: string | null;
  enabled?: boolean;
};

export function useReadEntry({
  fetchFn,
  id,
  enabled = true,
}: UseReadEntryParams): UseQueryResult<ReadEntryResponse, Error> {
  return useQuery<ReadEntryResponse, Error>({
    queryKey: ['readEntry', id],
    queryFn: async () => {
      const response = await fetchFn(`/read/entries/${id}`);
      const json: unknown = await response.json();
      return ReadEntryResponseSchema.parse(json);
    },
    // Gate on a non-null id so the hook can be safely called with the
    // page-level `activeEntryId` reducer field, which is `null` until the
    // user opens or saves an entry.
    enabled: enabled && id !== null,
    staleTime: Infinity,
  });
}
