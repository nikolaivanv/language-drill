import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { EmailPreferencesSchema, type EmailPreferences } from '../schemas/email';

export function useEmailPreferences({
  fetchFn,
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
}) {
  return useQuery<EmailPreferences, Error>({
    queryKey: ['emailPreferences'],
    queryFn: async () => {
      const res = await fetchFn('/me/email-preferences');
      const json: unknown = await res.json();
      return EmailPreferencesSchema.parse(json);
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
