import { z } from 'zod';

export const LanguageProfileSchema = z.object({
  language: z.string(),
  proficiencyLevel: z.string(),
});

export const LanguageProfilesResponseSchema = z.object({
  profiles: z.array(LanguageProfileSchema),
});

export type LanguageProfileResponse = z.infer<typeof LanguageProfileSchema>;
export type LanguageProfilesResponse = z.infer<typeof LanguageProfilesResponseSchema>;
