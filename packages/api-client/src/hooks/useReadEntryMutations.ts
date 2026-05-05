import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import {
  SaveReadEntryResponseSchema,
  UpdateBankResponseSchema,
  type ReadEntryResponse,
  type SaveReadEntryRequest,
  type SaveReadEntryResponse,
  type UpdateBankResponse,
} from '../schemas/read';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useSaveReadEntry — POST /read/entries
// ---------------------------------------------------------------------------
// On success:
//   1. Invalidates ['readEntries', language] so the history list re-fetches
//      and the new entry appears at the top (Req 8.5, 10.6).
//   2. Pre-populates ['readEntry', id] with the just-saved payload so the
//      page can switch from "ephemeral" (annotated-but-not-persisted) to
//      "persisted" without a round-trip — the page reads the cache directly.
// ---------------------------------------------------------------------------

export type UseSaveReadEntryOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSaveReadEntry({ fetchFn }: UseSaveReadEntryOptions) {
  const queryClient = useQueryClient();

  return useMutation<SaveReadEntryResponse, Error, SaveReadEntryRequest>({
    mutationFn: async (input) => {
      const response = await fetchFn('/read/entries', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return SaveReadEntryResponseSchema.parse(json);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['readEntries', variables.language],
      });
      const ephemeralEntry: ReadEntryResponse = {
        id: data.id,
        language: variables.language,
        title: variables.title,
        source: variables.source,
        text: variables.text,
        flaggedWords: variables.flagged,
        bank: variables.bank,
        pastedAt: data.pastedAt,
      };
      queryClient.setQueryData(['readEntry', data.id], ephemeralEntry);
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateReadBank — PUT /read/entries/:id/bank
// ---------------------------------------------------------------------------
// Optimistic-update flow:
//   - onMutate snapshots ['readEntry', id] and writes through the new bank
//     immediately so the rail and popover render the change without waiting
//     on the server (Requirement 9.6).
//   - onError rolls back to the snapshot if the request fails (Requirement
//     11.6 — the inline error toast is the page's responsibility).
//   - onSuccess invalidates ['readEntries', language] to refresh saved counts
//     in the history list.
//
// `language` is required in the params because the entry list cache key is
// scoped per language; the URL alone doesn't carry it.
// ---------------------------------------------------------------------------

export type UpdateReadBankParams = {
  id: string;
  language: LearningLanguage;
  bank: string[];
};

type UpdateBankContext = {
  previousEntry: ReadEntryResponse | undefined;
};

export type UseUpdateReadBankOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useUpdateReadBank({ fetchFn }: UseUpdateReadBankOptions) {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateBankResponse,
    Error,
    UpdateReadBankParams,
    UpdateBankContext
  >({
    mutationFn: async ({ id, bank }) => {
      const response = await fetchFn(`/read/entries/${id}/bank`, {
        method: 'PUT',
        body: JSON.stringify({ bank }),
      });
      const json: unknown = await response.json();
      return UpdateBankResponseSchema.parse(json);
    },
    onMutate: async ({ id, bank }) => {
      // Cancel in-flight queries so they don't clobber the optimistic write.
      await queryClient.cancelQueries({ queryKey: ['readEntry', id] });
      const previousEntry = queryClient.getQueryData<ReadEntryResponse>([
        'readEntry',
        id,
      ]);
      if (previousEntry) {
        queryClient.setQueryData<ReadEntryResponse>(['readEntry', id], {
          ...previousEntry,
          bank,
        });
      }
      return { previousEntry };
    },
    onError: (_err, { id }, context) => {
      if (context?.previousEntry !== undefined) {
        queryClient.setQueryData(['readEntry', id], context.previousEntry);
      }
    },
    onSuccess: (_data, { language }) => {
      queryClient.invalidateQueries({
        queryKey: ['readEntries', language],
      });
    },
  });
}
