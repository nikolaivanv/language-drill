import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  GenerateReadingTextResponseSchema,
  type GenerateReadingTextRequest,
  type GenerateReadingTextResponse,
} from '../schemas/read';

export type UseGenerateReadingTextOptions = { fetchFn: AuthenticatedFetch };

export function useGenerateReadingText({ fetchFn }: UseGenerateReadingTextOptions) {
  return useMutation<
    GenerateReadingTextResponse,
    Error,
    GenerateReadingTextRequest
  >({
    mutationFn: async (input) => {
      const response = await fetchFn('/read/generate', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return GenerateReadingTextResponseSchema.parse(json);
    },
  });
}
