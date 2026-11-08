import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { PhraseAudioResponseSchema, type PhraseAudioResponse } from '../schemas/exercise';

export type UsePhraseAudioOptions = { fetchFn: AuthenticatedFetch };

/** On-demand audio for the corrected sentence on a drill result card. */
export function usePhraseAudio({ fetchFn }: UsePhraseAudioOptions) {
  return useMutation<PhraseAudioResponse, Error, { exerciseId: string; submissionId: string }>({
    mutationFn: async ({ exerciseId, submissionId }) => {
      const response = await fetchFn(
        `/exercises/${exerciseId}/submissions/${submissionId}/audio`,
        { method: 'POST' },
      );
      const json: unknown = await response.json();
      return PhraseAudioResponseSchema.parse(json);
    },
  });
}
