import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage, VocabReviewStatus } from '@language-drill/shared';
import {
  ActiveLemmasSchema,
  BankResponseSchema,
  HubOverviewSchema,
  ReviewSummarySchema,
  WordDetailSchema,
  type ActiveLemmas,
  type BankResponse,
  type HubOverview,
  type ReviewSummary,
  type WordDetail,
} from '../schemas/review';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// Vocabulary Review — read hooks
// ---------------------------------------------------------------------------
// Each hook `parse`s the response against its wire schema so the runtime shape
// matches the inferred type — no `as` casts at the boundary. Query keys are
// per-language (the feature never blends languages) or per-id. Mutations in
// `useReviewMutations` invalidate these keys.
// ---------------------------------------------------------------------------

const STALE_TIME_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// useReviewOverview — GET /review/overview?language=<…>
// ---------------------------------------------------------------------------

export type UseReviewOverviewParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useReviewOverview({
  fetchFn,
  language,
  enabled = true,
}: UseReviewOverviewParams): UseQueryResult<HubOverview, Error> {
  return useQuery<HubOverview, Error>({
    queryKey: ['reviewOverview', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/review/overview?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return HubOverviewSchema.parse(json);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// useReviewSummary — GET /review/sessions/:id/summary
// ---------------------------------------------------------------------------
// `staleTime: Infinity` — a completed session's debrief is effectively
// immutable, so re-mounts hit cache.
// ---------------------------------------------------------------------------

export type UseReviewSummaryParams = {
  fetchFn: AuthenticatedFetch;
  sessionId: string | null;
  enabled?: boolean;
};

export function useReviewSummary({
  fetchFn,
  sessionId,
  enabled = true,
}: UseReviewSummaryParams): UseQueryResult<ReviewSummary, Error> {
  return useQuery<ReviewSummary, Error>({
    queryKey: ['reviewSummary', sessionId],
    queryFn: async () => {
      const response = await fetchFn(`/review/sessions/${sessionId}/summary`);
      const json: unknown = await response.json();
      return ReviewSummarySchema.parse(json);
    },
    enabled: enabled && sessionId !== null,
    staleTime: Infinity,
  });
}

// ---------------------------------------------------------------------------
// useVocabularyBank — GET /review/bank?language=&status=&q=
// ---------------------------------------------------------------------------

export type UseVocabularyBankParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  status?: VocabReviewStatus;
  q?: string;
  enabled?: boolean;
};

export function useVocabularyBank({
  fetchFn,
  language,
  status,
  q,
  enabled = true,
}: UseVocabularyBankParams): UseQueryResult<BankResponse, Error> {
  return useQuery<BankResponse, Error>({
    queryKey: ['vocabularyBank', language, status ?? null, q ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({ language });
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const response = await fetchFn(`/review/bank?${params.toString()}`);
      const json: unknown = await response.json();
      return BankResponseSchema.parse(json);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// useVocabularyWord — GET /review/words/:stateId
// ---------------------------------------------------------------------------
// `staleTime: Infinity` — the detail changes only via the word mutations,
// which invalidate this exact key.
// ---------------------------------------------------------------------------

export type UseVocabularyWordParams = {
  fetchFn: AuthenticatedFetch;
  stateId: string | null;
  enabled?: boolean;
};

export function useVocabularyWord({
  fetchFn,
  stateId,
  enabled = true,
}: UseVocabularyWordParams): UseQueryResult<WordDetail, Error> {
  return useQuery<WordDetail, Error>({
    queryKey: ['vocabularyWord', stateId],
    queryFn: async () => {
      const response = await fetchFn(`/review/words/${stateId}`);
      const json: unknown = await response.json();
      return WordDetailSchema.parse(json);
    },
    enabled: enabled && stateId !== null,
    staleTime: Infinity,
  });
}

// ---------------------------------------------------------------------------
// useActiveReviewLemmas — GET /review/active-lemmas?language=<…>
// ---------------------------------------------------------------------------
// Source for the Reading under-review highlight (Req 13.2).
// ---------------------------------------------------------------------------

export type UseActiveReviewLemmasParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useActiveReviewLemmas({
  fetchFn,
  language,
  enabled = true,
}: UseActiveReviewLemmasParams): UseQueryResult<ActiveLemmas, Error> {
  return useQuery<ActiveLemmas, Error>({
    queryKey: ['activeReviewLemmas', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/review/active-lemmas?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return ActiveLemmasSchema.parse(json);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
}
