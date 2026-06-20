import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CefrLevel,
  type DailyMinutes,
  type GoalId,
  type LearningLanguage,
} from '@language-drill/shared';
import {
  PreferencesResponseSchema,
  type PreferencesResponse,
  SavePreferencesInputSchema,
  type SavePreferencesInput,
  UpdateLanguagesInputSchema,
  type UpdateLanguagesInput,
  UpdateLanguagesResponseSchema,
  type UpdateLanguagesResponse,
  UpdatePreferencesInputSchema,
  type UpdatePreferencesInput,
} from '../schemas/preferences';
import type { LanguageProfilesResponse } from '../schemas/profile';
import { LanguageProfilesResponseSchema } from '../schemas/profile';
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
// useSavePreferences
// ---------------------------------------------------------------------------
// Single mutation entry point for the full onboarding payload. The hook owns
// two pieces of logic that the rest of the codebase relies on:
//
//   1. Non-primary A1 default (R3.8 / R7.1):
//      The wizard carries a flat list of selected languages plus the chosen
//      primary language and CEFR level. Here we expand that into the
//      `profiles[]` wire shape: the primary language gets the chosen level,
//      every other selected language gets `proficiencyLevel: A1` as the
//      placeholder default.
//
//   2. Notes-field whitespace normalisation (R4.6):
//      We convert CRLF -> LF first, then trim leading/trailing whitespace.
//      The order matters: trimming first would leave a stray '\r' behind on
//      values like "  hello\r\n"; normalising first then trimming yields the
//      expected "hello".
//
// The assembled payload is validated against `SavePreferencesInputSchema`
// before the network call. On success both `['languageProfiles']` and
// `['preferences']` query keys are invalidated so any downstream consumer
// (dashboard, settings) refetches coherently (R9.4).
// ---------------------------------------------------------------------------

export type SavePreferencesArgs = {
  /** Languages selected in Step 1, in selection order. */
  languages: LearningLanguage[];
  /** Primary language chosen in Step 2 (must be in `languages`). */
  primaryLanguage: LearningLanguage;
  /** CEFR level chosen in Step 2 for the primary language. */
  primaryLevel: CefrLevel;
  /** Goals chosen in Step 3. */
  goals: GoalId[];
  /** Raw notes text from Step 3 (un-normalised; CRLF tolerated). */
  notes: string;
  /** Daily minutes chosen in Step 4. */
  dailyMinutes: DailyMinutes;
  /** Gentle-nudges toggle from Step 4. */
  gentleNudges: boolean;
};

export type SavePreferencesResponse = {
  profiles: LanguageProfilesResponse['profiles'];
  preferences: PreferencesResponse;
};

export type UseSavePreferencesParams = {
  fetchFn: AuthenticatedFetch;
};

export function useSavePreferences({ fetchFn }: UseSavePreferencesParams) {
  const queryClient = useQueryClient();

  return useMutation<SavePreferencesResponse, Error, SavePreferencesArgs>({
    mutationFn: async (args) => {
      // 1. Build profiles[]: primary gets primaryLevel; non-primary default to A1.
      // Preserve selection order so the wire payload mirrors the wizard UI.
      const profiles = args.languages.map((language) => ({
        language,
        proficiencyLevel:
          language === args.primaryLanguage ? args.primaryLevel : CefrLevel.A1,
      }));

      // 2. Normalise notes: CRLF -> LF first, then trim. Order matters
      //    so trailing '\r' from CR-only line endings doesn't survive.
      const normalisedNotes = args.notes.replace(/\r\n/g, '\n').trim();

      // 3. Validate the wire payload before sending. ZodError bubbles up.
      const payload: SavePreferencesInput = SavePreferencesInputSchema.parse({
        profiles,
        primaryLanguage: args.primaryLanguage,
        goals: args.goals,
        dailyMinutes: args.dailyMinutes,
        gentleNudges: args.gentleNudges,
        notes: normalisedNotes,
      });

      // 4. PUT /profiles/languages and validate the response shape.
      const response = await fetchFn('/profiles/languages', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const json: unknown = await response.json();

      const profilesPart = LanguageProfilesResponseSchema.parse({
        profiles: (json as { profiles?: unknown }).profiles,
      });
      const preferencesPart = PreferencesResponseSchema.parse(
        (json as { preferences?: unknown }).preferences,
      );

      return {
        profiles: profilesPart.profiles,
        preferences: preferencesPart,
      };
    },
    onSuccess: () => {
      // 5. Invalidate sibling caches so the dashboard / settings reread.
      void queryClient.invalidateQueries({ queryKey: ['languageProfiles'] });
      void queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
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
