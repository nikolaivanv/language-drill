import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PreferencesResponseSchema,
  type PreferencesResponse,
  UpdateLanguagesInputSchema,
  type UpdateLanguagesInput,
  UpdateLanguagesResponseSchema,
  type UpdateLanguagesResponse,
  UpdatePreferencesInputSchema,
  type UpdatePreferencesInput,
} from '../schemas/preferences';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useGetPreferences
// ---------------------------------------------------------------------------
// Hydrates the onboarding wizard in edit mode from
// `GET /profiles/preferences`. The response is validated against
// `PreferencesResponseSchema` so consumers receive strongly-typed data.
// `enabled` lets the new-user flow skip the call entirely.
// ---------------------------------------------------------------------------

export type UseGetPreferencesParams = {
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useGetPreferences({
  fetchFn,
  enabled = true,
}: UseGetPreferencesParams) {
  return useQuery<PreferencesResponse, Error>({
    queryKey: ['preferences'],
    queryFn: async () => {
      const response = await fetchFn('/profiles/preferences');
      const json: unknown = await response.json();
      return PreferencesResponseSchema.parse(json);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// useUpdateLanguages
// ---------------------------------------------------------------------------
// Slimmed PUT for the settings page: only sends profiles[] + primaryLanguage.
// On success invalidates both ['languageProfiles'] and ['preferences'] so
// downstream consumers (dashboard, settings) re-fetch coherently.
// ---------------------------------------------------------------------------

export type UpdateLanguagesArgs = UpdateLanguagesInput;

export function useUpdateLanguages({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<UpdateLanguagesResponse, Error, UpdateLanguagesArgs>({
    mutationFn: async (args) => {
      const payload = UpdateLanguagesInputSchema.parse(args);
      const response = await fetchFn('/profiles/languages', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const json: unknown = await response.json();
      return UpdateLanguagesResponseSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['languageProfiles'] });
      void queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdatePreferences
// ---------------------------------------------------------------------------
// Partial PATCH for the settings page: any subset of {goals, dailyMinutes,
// gentleNudges, notes}. On success invalidates ['preferences'] so the
// settings page refetches with the latest values.
// ---------------------------------------------------------------------------

export type UpdatePreferencesArgs = UpdatePreferencesInput;

export function useUpdatePreferences({
  fetchFn,
}: {
  fetchFn: AuthenticatedFetch;
}) {
  const queryClient = useQueryClient();
  return useMutation<PreferencesResponse, Error, UpdatePreferencesArgs>({
    mutationFn: async (args) => {
      const payload = UpdatePreferencesInputSchema.parse(args);
      const response = await fetchFn('/profiles/preferences', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const json: unknown = await response.json();
      return PreferencesResponseSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
}
