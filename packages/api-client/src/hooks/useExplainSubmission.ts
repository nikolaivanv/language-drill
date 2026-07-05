import { useMutation } from '@tanstack/react-query';
import { ExplainResponseSchema, type ExplainResponse } from '../schemas/exercise';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useExplainSubmission
// ---------------------------------------------------------------------------
// Mutation wrapping `POST /exercises/:id/submissions/:submissionId/explain`
// (Task 3). Consumed by `<ExplainWhy>` (Task 5) via
// `mutate/mutateAsync({ exerciseId, submissionId })` → `data.explanation`.
// `fetchFn` is obtained the same way every other authenticated hook in this
// package obtains it — passed in by the caller (see `useSubmitAnswer` /
// `useSubmitFreeWriting`) rather than pulled from context, since this
// package has no fetch-context provider.
// ---------------------------------------------------------------------------

export type ExplainSubmissionParams = {
  exerciseId: string;
  submissionId: string;
};

export type UseExplainSubmissionOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useExplainSubmission({ fetchFn }: UseExplainSubmissionOptions) {
  return useMutation<ExplainResponse, Error, ExplainSubmissionParams>({
    mutationFn: async ({ exerciseId, submissionId }) => {
      const response = await fetchFn(
        `/exercises/${exerciseId}/submissions/${submissionId}/explain`,
        { method: 'POST' },
      );
      const json: unknown = await response.json();
      return ExplainResponseSchema.parse(json);
    },
  });
}
