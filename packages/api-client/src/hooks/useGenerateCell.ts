import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { GenerateCellResponseSchema, type GenerateCellRequest, type GenerateCellResponse } from '../schemas/generate';

export function useGenerateCell({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<GenerateCellResponse, Error, GenerateCellRequest>({
    mutationFn: async (body) => {
      const res = await fetchFn('/admin/generate', { method: 'POST', body: JSON.stringify(body) });
      const json: unknown = await res.json();
      return GenerateCellResponseSchema.parse(json);
    },
  });
}
