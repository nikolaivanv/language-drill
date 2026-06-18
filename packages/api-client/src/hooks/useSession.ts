import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CreateSessionResponseSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
  CompleteSessionResponseSchema,
  type CompleteSessionResponse,
  ResumeSessionResponseSchema,
  type ResumeSessionResponse,
} from '../schemas/session';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useCreateSession
// ---------------------------------------------------------------------------
// Mutation that POSTs to `/sessions` to create a new practice session and
// returns the full ordered exercise manifest. The response is validated
// against `CreateSessionResponseSchema` so consumers receive strongly-typed
// data. Used by the `/drill` page to bootstrap a session on mount and on
// language/difficulty selector changes (Req 1.1, 7.4).
// ---------------------------------------------------------------------------

export type UseCreateSessionOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useCreateSession({ fetchFn }: UseCreateSessionOptions) {
  return useMutation<CreateSessionResponse, Error, CreateSessionRequest>({
    mutationFn: async (input) => {
      const response = await fetchFn('/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return CreateSessionResponseSchema.parse(json);
    },
  });
}

// ---------------------------------------------------------------------------
// useCompleteSession
// ---------------------------------------------------------------------------
// Mutation that POSTs to `/sessions/:sessionId/complete` to mark a practice
// session complete and retrieve the final summary (counts + duration). The
// response is validated against `CompleteSessionResponseSchema` so the
// SessionSummary screen receives strongly-typed data. Used by the `/drill`
// page when the learner finishes the last exercise (Req 3.3, 4.1, 7.4).
// ---------------------------------------------------------------------------

export type CompleteSessionParams = {
  sessionId: string;
};

export type UseCompleteSessionOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useCompleteSession({ fetchFn }: UseCompleteSessionOptions) {
  return useMutation<CompleteSessionResponse, Error, CompleteSessionParams>({
    mutationFn: async ({ sessionId }) => {
      const response = await fetchFn(`/sessions/${sessionId}/complete`, {
        method: 'POST',
      });
      const json: unknown = await response.json();
      return CompleteSessionResponseSchema.parse(json);
    },
  });
}

// ---------------------------------------------------------------------------
// useResumeSession
// ---------------------------------------------------------------------------
// Read-only query that fetches an in-progress session's manifest + attempt
// state from `GET /sessions/:sessionId`, so the drill page can resume it at the
// first unattempted exercise. `enabled` gates the fetch to the resume entry
// only. No staleTime: the attempt state must be fresh on each resume entry.
// ---------------------------------------------------------------------------
export type UseResumeSessionOptions = {
  sessionId: string;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useResumeSession({ sessionId, fetchFn, enabled = true }: UseResumeSessionOptions) {
  return useQuery<ResumeSessionResponse, Error>({
    queryKey: ['session-resume', sessionId],
    queryFn: async () => {
      const response = await fetchFn(`/sessions/${sessionId}`);
      const json: unknown = await response.json();
      return ResumeSessionResponseSchema.parse(json);
    },
    enabled,
  });
}
