import { useMutation } from '@tanstack/react-query';
import {
  DeleteVocabularyCardResponseSchema,
  SaveVocabularyCardResponseSchema,
  type DeleteVocabularyCardResponse,
  type SaveVocabularyCardRequest,
  type SaveVocabularyCardResponse,
} from '../schemas/read';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useSaveVocabularyCard — POST /read/vocabulary
// ---------------------------------------------------------------------------
// Saves a resolved deep word/phrase card to the user's vocabulary bank (Req
// 8.4). The whole `DeepCard` is posted (it exists only transiently client-side);
// the server derives the lexical columns and snapshots the card. Returns the
// new record's `{ id }` so the caller can `useDeleteVocabularyCard` for undo.
//
// No query-cache effects: saving to vocabulary is independent of an entry's
// `spanAnnotations` (Req 11.7), and Part 1 has no vocabulary list query to
// invalidate. The "saved" highlight + toast (Req 8.4) are page state driven off
// the returned id. `createAuthenticatedFetch` throws on non-2xx (e.g. the
// server's 400 sentence-card rejection), surfacing as the mutation `error`.
// ---------------------------------------------------------------------------

export type UseSaveVocabularyCardOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSaveVocabularyCard({ fetchFn }: UseSaveVocabularyCardOptions) {
  return useMutation<
    SaveVocabularyCardResponse,
    Error,
    SaveVocabularyCardRequest
  >({
    mutationFn: async (input) => {
      const response = await fetchFn('/read/vocabulary', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return SaveVocabularyCardResponseSchema.parse(json);
    },
  });
}

// ---------------------------------------------------------------------------
// useDeleteVocabularyCard — DELETE /read/vocabulary/:id
// ---------------------------------------------------------------------------
// Undoes a just-saved card (Req 8.5). The variable is the vocabulary record id
// returned by `useSaveVocabularyCard`. Returns the deleted `{ id }`; the page
// reverts the in-passage "saved" style on success.
// ---------------------------------------------------------------------------

export type UseDeleteVocabularyCardOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useDeleteVocabularyCard({
  fetchFn,
}: UseDeleteVocabularyCardOptions) {
  return useMutation<DeleteVocabularyCardResponse, Error, string>({
    mutationFn: async (id) => {
      const response = await fetchFn(`/read/vocabulary/${id}`, {
        method: 'DELETE',
      });
      const json: unknown = await response.json();
      return DeleteVocabularyCardResponseSchema.parse(json);
    },
  });
}
