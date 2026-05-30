import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { LearningLanguage, ReviewItemType } from '@language-drill/shared';
import {
  DeleteWordResponseSchema,
  ReviewItemResultSchema,
  StartReviewSessionResponseSchema,
  UpdateWordResponseSchema,
  type DeleteWordResponse,
  type ReviewFilter,
  type ReviewItemResult,
  type StartReviewSessionResponse,
  type UpdateWordRequest,
  type UpdateWordResponse,
} from '../schemas/review';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// Vocabulary Review — write hooks
// ---------------------------------------------------------------------------
// Each `parse`s the response against its wire schema and invalidates the read
// caches a write can move (Req 14.2, 14.5): overview counts, the bank list, the
// touched word detail, and the Reading active-lemmas highlight.
// ---------------------------------------------------------------------------

export type UseReviewMutationOptions = {
  fetchFn: AuthenticatedFetch;
};

// ---------------------------------------------------------------------------
// useStartReviewSession — POST /review/sessions
// ---------------------------------------------------------------------------

export type StartReviewSessionParams = {
  language: LearningLanguage;
  filter?: ReviewFilter;
};

export function useStartReviewSession({
  fetchFn,
}: UseReviewMutationOptions): UseMutationResult<
  StartReviewSessionResponse,
  Error,
  StartReviewSessionParams
> {
  const queryClient = useQueryClient();
  return useMutation<StartReviewSessionResponse, Error, StartReviewSessionParams>({
    mutationFn: async ({ language, filter }) => {
      const body: StartReviewSessionParams = { language };
      if (filter !== undefined) body.filter = filter;
      const response = await fetchFn('/review/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return StartReviewSessionResponseSchema.parse(json);
    },
    onSuccess: () => {
      // Ensuring state for new lemmas can change the bank + overview.
      queryClient.invalidateQueries({ queryKey: ['reviewOverview'] });
      queryClient.invalidateQueries({ queryKey: ['vocabularyBank'] });
      queryClient.invalidateQueries({ queryKey: ['activeReviewLemmas'] });
    },
  });
}

// ---------------------------------------------------------------------------
// useSubmitReviewItem — POST /review/items/:stateId/submit
// ---------------------------------------------------------------------------

export type SubmitReviewItemParams = {
  stateId: string;
  itemType: ReviewItemType;
  answer: string;
  surface?: string;
  hintsUsed?: number;
  sessionId?: string;
};

export function useSubmitReviewItem({
  fetchFn,
}: UseReviewMutationOptions): UseMutationResult<
  ReviewItemResult,
  Error,
  SubmitReviewItemParams
> {
  const queryClient = useQueryClient();
  return useMutation<ReviewItemResult, Error, SubmitReviewItemParams>({
    mutationFn: async ({ stateId, itemType, answer, surface, hintsUsed, sessionId }) => {
      const body: Omit<SubmitReviewItemParams, 'stateId'> = { itemType, answer };
      if (surface !== undefined) body.surface = surface;
      if (hintsUsed !== undefined) body.hintsUsed = hintsUsed;
      if (sessionId !== undefined) body.sessionId = sessionId;
      const response = await fetchFn(`/review/items/${stateId}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return ReviewItemResultSchema.parse(json);
    },
    onSuccess: (_result, { stateId }) => {
      // The graded item advanced the card's scheduler state + evidence.
      queryClient.invalidateQueries({ queryKey: ['reviewOverview'] });
      queryClient.invalidateQueries({ queryKey: ['vocabularyBank'] });
      queryClient.invalidateQueries({ queryKey: ['activeReviewLemmas'] });
      queryClient.invalidateQueries({ queryKey: ['vocabularyWord', stateId] });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateVocabularyWord — PATCH /review/words/:stateId
// ---------------------------------------------------------------------------

export type UpdateVocabularyWordParams = {
  stateId: string;
  action: UpdateWordRequest['action'];
};

export function useUpdateVocabularyWord({
  fetchFn,
}: UseReviewMutationOptions): UseMutationResult<
  UpdateWordResponse,
  Error,
  UpdateVocabularyWordParams
> {
  const queryClient = useQueryClient();
  return useMutation<UpdateWordResponse, Error, UpdateVocabularyWordParams>({
    mutationFn: async ({ stateId, action }) => {
      const response = await fetchFn(`/review/words/${stateId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      const json: unknown = await response.json();
      return UpdateWordResponseSchema.parse(json);
    },
    onSuccess: (_result, { stateId }) => {
      // suspend / unsuspend / mark-known / reset all move status + eligibility.
      queryClient.invalidateQueries({ queryKey: ['reviewOverview'] });
      queryClient.invalidateQueries({ queryKey: ['vocabularyBank'] });
      queryClient.invalidateQueries({ queryKey: ['activeReviewLemmas'] });
      queryClient.invalidateQueries({ queryKey: ['vocabularyWord', stateId] });
    },
  });
}

// ---------------------------------------------------------------------------
// useDeleteVocabularyWord — DELETE /review/words/:stateId
// ---------------------------------------------------------------------------

export type DeleteVocabularyWordParams = {
  stateId: string;
};

export function useDeleteVocabularyWord({
  fetchFn,
}: UseReviewMutationOptions): UseMutationResult<
  DeleteWordResponse,
  Error,
  DeleteVocabularyWordParams
> {
  const queryClient = useQueryClient();
  return useMutation<DeleteWordResponse, Error, DeleteVocabularyWordParams>({
    mutationFn: async ({ stateId }) => {
      const response = await fetchFn(`/review/words/${stateId}`, { method: 'DELETE' });
      const json: unknown = await response.json();
      return DeleteWordResponseSchema.parse(json);
    },
    onSuccess: (_result, { stateId }) => {
      queryClient.invalidateQueries({ queryKey: ['reviewOverview'] });
      queryClient.invalidateQueries({ queryKey: ['vocabularyBank'] });
      queryClient.invalidateQueries({ queryKey: ['activeReviewLemmas'] });
      queryClient.removeQueries({ queryKey: ['vocabularyWord', stateId] });
    },
  });
}
