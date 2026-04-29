import { z } from 'zod';
import { CefrLevel, Language } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// GET /profiles/languages response
// ---------------------------------------------------------------------------
// `language` is typed as the full `Language` enum (not `LearningLanguage`)
// because the GET response can include EN — users may have an EN row from a
// pre-onboarding signup or a future translation-only assessment. Fields are
// validated as native enums end-to-end so consumers get strongly-typed data
// and can drop ad-hoc casts at the boundary.
// ---------------------------------------------------------------------------

export const LanguageProfileSchema = z.object({
  language: z.nativeEnum(Language),
  proficiencyLevel: z.nativeEnum(CefrLevel),
});

export const LanguageProfilesResponseSchema = z.object({
  profiles: z.array(LanguageProfileSchema),
});

export type LanguageProfileResponse = z.infer<typeof LanguageProfileSchema>;
export type LanguageProfilesResponse = z.infer<typeof LanguageProfilesResponseSchema>;
