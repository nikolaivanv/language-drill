import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  EmailPreferencesSchema,
  UpdateWeeklySummaryInputSchema,
  type EmailPreferences,
  type UpdateWeeklySummaryInput,
} from '../schemas/email';

export function useUpdateWeeklySummary({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<EmailPreferences, Error, UpdateWeeklySummaryInput>({
    mutationFn: async (args) => {
      const payload = UpdateWeeklySummaryInputSchema.parse(args);
      const res = await fetchFn('/email/weekly-summary', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const json: unknown = await res.json();
      return EmailPreferencesSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emailPreferences'] });
    },
  });
}
