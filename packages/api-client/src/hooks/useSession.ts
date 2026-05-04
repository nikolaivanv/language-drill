import { useMutation } from '@tanstack/react-query';
import {
  CreateSessionResponseSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
  CompleteSessionResponseSchema,
  type CompleteSessionResponse,
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
