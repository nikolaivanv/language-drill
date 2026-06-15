import { useMutation } from '@tanstack/react-query';
import { StartMyParagraphSchema, type StartMyParagraphResponse } from '../schemas/writing-helper';
import type { AuthenticatedFetch } from '../fetchClient';

export type UseStartMyParagraphOptions = {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
};

// A mutation, not a query: the opener is a side-effecting insert into the
// composer, and each click/regenerate must produce a fresh sentence — there is
// nothing to cache. Every call re-bills the shared `writing_helper` bucket.
export function useStartMyParagraph({ exerciseId, fetchFn }: UseStartMyParagraphOptions) {
  return useMutation<StartMyParagraphResponse, Error>({
    mutationFn: async () => {
      const response = await fetchFn(`/exercises/${exerciseId}/start-my-paragraph`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return StartMyParagraphSchema.parse(json);
    },
  });
}
