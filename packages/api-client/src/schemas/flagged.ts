import { z } from 'zod';

export const ResolveOutcomeSchema = z.enum([
  'approved', 'rejected', 'demoted', 'not_found', 'already_resolved',
]);
export type ResolveOutcome = z.infer<typeof ResolveOutcomeSchema>;

export const ResolveResponseSchema = z.object({ outcome: ResolveOutcomeSchema });

export const FlaggedReasonSchema = z.object({ code: z.string(), detail: z.string().optional() });
export type FlaggedReason = z.infer<typeof FlaggedReasonSchema>;

export const FlaggedExerciseSchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  type: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  contentJson: z.unknown(),
  qualityScore: z.number().nullable(),
  flaggedReasons: z.array(FlaggedReasonSchema),
  generatedAt: z.string().nullable(),
});
export type FlaggedExercise = z.infer<typeof FlaggedExerciseSchema>;
export const FlaggedExercisesResponseSchema = z.object({
  items: z.array(FlaggedExerciseSchema),
  total: z.number(),
});

export const FlaggedTheorySchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  topicId: z.string().nullable(),
  contentJson: z.unknown(),
  qualityScore: z.number().nullable(),
  flaggedReasons: z.array(FlaggedReasonSchema),
  generatedAt: z.string().nullable(),
});
export type FlaggedTheory = z.infer<typeof FlaggedTheorySchema>;
export const FlaggedTheoryResponseSchema = z.object({
  items: z.array(FlaggedTheorySchema),
  total: z.number(),
});

export type FlaggedExerciseFilters = {
  language?: string; level?: string; type?: string; grammarPoint?: string;
};
export type FlaggedTheoryFilters = {
  language?: string; level?: string; grammarPoint?: string;
};
