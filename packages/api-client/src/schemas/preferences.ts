import { z } from 'zod';
import {
  CefrLevel,
  GOAL_IDS,
  Language,
  NOTES_MAX_LENGTH,
} from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Learning language enum
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target. Wire-format payloads must reject EN at the schema layer so the
// server and client agree on the ES/DE/TR-only learning set.
// ---------------------------------------------------------------------------

export const LearningLanguageEnum = z.enum([
  Language.ES,
  Language.DE,
  Language.TR,
]);

// ---------------------------------------------------------------------------
// GET /profiles/preferences response
// ---------------------------------------------------------------------------
// `primaryLanguage` and `dailyMinutes` are nullable because a freshly-created
// user has no `userPreferences` row yet — the server returns documented
// defaults (R9.2) where these two fields are `null`.
// ---------------------------------------------------------------------------

export const PreferencesResponseSchema = z.object({
  primaryLanguage: LearningLanguageEnum.nullable(),
  goals: z.array(z.enum(GOAL_IDS)),
  dailyMinutes: z
    .union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)])
    .nullable(),
  gentleNudges: z.boolean(),
  notes: z.string().max(NOTES_MAX_LENGTH),
});

export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /profiles/languages request body
// ---------------------------------------------------------------------------

export const LearningProfileSchema = z.object({
  language: LearningLanguageEnum,
  proficiencyLevel: z.nativeEnum(CefrLevel),
});

// ---------------------------------------------------------------------------
// PUT /profiles/languages — slimmed request + response
// ---------------------------------------------------------------------------

export const UpdateLanguagesInputSchema = z
  .object({
    profiles: z.array(LearningProfileSchema).min(1).max(3),
    primaryLanguage: LearningLanguageEnum,
  })
  .refine(
    (input) =>
      new Set(input.profiles.map((p) => p.language)).size ===
      input.profiles.length,
    { message: 'Duplicate languages are not allowed' },
  )
  .refine(
    (input) => input.profiles.some((p) => p.language === input.primaryLanguage),
    {
      message:
        'primaryLanguage must be one of the submitted profiles.languages',
      path: ['primaryLanguage'],
    },
  );

export type UpdateLanguagesInput = z.infer<typeof UpdateLanguagesInputSchema>;

export const UpdateLanguagesResponseSchema = z.object({
  profiles: z.array(LearningProfileSchema),
  primaryLanguage: LearningLanguageEnum,
});

export type UpdateLanguagesResponse = z.infer<
  typeof UpdateLanguagesResponseSchema
>;

// ---------------------------------------------------------------------------
// PATCH /profiles/preferences — partial request
// ---------------------------------------------------------------------------

export const UpdatePreferencesInputSchema = z
  .object({
    goals: z.array(z.enum(GOAL_IDS)).optional(),
    dailyMinutes: z
      .union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)])
      .optional(),
    gentleNudges: z.boolean().optional(),
    notes: z.string().max(NOTES_MAX_LENGTH).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdatePreferencesInput = z.infer<
  typeof UpdatePreferencesInputSchema
>;
