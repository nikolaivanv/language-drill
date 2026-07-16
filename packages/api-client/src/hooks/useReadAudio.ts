import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ReadAudioResponseSchema, type ReadAudioResponse } from '../schemas/read';

export type UseReadAudioOptions = { fetchFn: AuthenticatedFetch };

export function useReadAudio({ fetchFn }: UseReadAudioOptions) {
  return useMutation<ReadAudioResponse, Error, { entryId: string }>({
    mutationFn: async ({ entryId }) => {
      const response = await fetchFn(`/read/${entryId}/audio`, { method: 'POST' });
      const json: unknown = await response.json();
      return ReadAudioResponseSchema.parse(json);
    },
  });
}
