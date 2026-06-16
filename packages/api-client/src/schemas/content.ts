import { z } from 'zod';

export const ContentReviewStatusSchema = z.enum(['auto-approved', 'manual-approved']);

export const ContentExerciseSchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  type: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  contentJson: z.unknown(),
  coverageTags: z.unknown().nullable(),
  qualityScore: z.number().nullable(),
  generationSource: z.string().nullable(),
  modelId: z.string().nullable(),
  reviewStatus: ContentReviewStatusSchema,
  generatedAt: z.string().nullable(),
});
export type ContentExercise = z.infer<typeof ContentExerciseSchema>;
export const ContentExercisesResponseSchema = z.object({ items: z.array(ContentExerciseSchema), total: z.number() });

export const ContentTheorySchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  topicId: z.string().nullable(),
  contentJson: z.unknown(),
  qualityScore: z.number().nullable(),
  generationSource: z.string().nullable(),
  modelId: z.string().nullable(),
  reviewStatus: ContentReviewStatusSchema,
  generatedAt: z.string().nullable(),
});
export type ContentTheory = z.infer<typeof ContentTheorySchema>;
export const ContentTheoryResponseSchema = z.object({ items: z.array(ContentTheorySchema), total: z.number() });

export type ContentExerciseParams = {
  language?: string; level?: string; type?: string; grammarPoint?: string; q?: string;
  limit?: number; offset?: number;
};
export type ContentTheoryParams = {
  language?: string; level?: string; grammarPoint?: string; q?: string;
  limit?: number; offset?: number;
};
