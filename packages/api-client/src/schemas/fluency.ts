import { z } from 'zod';
import { LearningLanguageEnum } from './preferences';
import { ExerciseResponseSchema } from './exercise';
import { FLUENCY_ELIGIBLE_TYPES } from '@language-drill/shared';

// Eligible-type enum for the optional fluency `types` filter — derived from the
// shared single source of truth so it stays in lockstep with the backend.
export const FluencySessionTypeEnum = z.enum(
  FLUENCY_ELIGIBLE_TYPES as unknown as [string, ...string[]],
);

// Request body for POST /fluency/session
export const FluencySessionRequestSchema = z.object({
  language: LearningLanguageEnum,
  count: z.number().int().min(1).max(20).optional(),
  types: z.array(FluencySessionTypeEnum).nonempty().optional(),
});
export type FluencySessionRequest = z.infer<typeof FluencySessionRequestSchema>;

// Response body for POST /fluency/session
export const FluencySessionResponseSchema = z.object({
  language: LearningLanguageEnum,
  exercises: z.array(ExerciseResponseSchema),
});
export type FluencySessionResponse = z.infer<typeof FluencySessionResponseSchema>;

// Request body for POST /fluency/attempts
export const FluencyAttemptRequestSchema = z.object({
  exerciseId: z.string().uuid(),
  answer: z.string().min(1),
  latencyMs: z.number().int().positive(),
});
export type FluencyAttemptRequest = z.infer<typeof FluencyAttemptRequestSchema>;

// Response body for POST /fluency/attempts
export const FluencyAttemptResponseSchema = z.object({
  correct: z.boolean(),
  correctAnswer: z.string(),
  latencyMs: z.number().int().nonnegative(),
});
export type FluencyAttemptResponse = z.infer<typeof FluencyAttemptResponseSchema>;

// Response body for GET /fluency/stats
export const FluencyWeekBucketSchema = z.object({
  weeksAgo: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  medianLatencyMs: z.number().nullable(),
  accuracy: z.number().min(0).max(1),
});

export const FluencyStatsResponseSchema = z.object({
  language: LearningLanguageEnum,
  totalAttempts: z.number().int().nonnegative(),
  overallAccuracy: z.number().min(0).max(1),
  overallMedianLatencyMs: z.number().nullable(),
  weeks: z.array(FluencyWeekBucketSchema),
});
export type FluencyStatsResponse = z.infer<typeof FluencyStatsResponseSchema>;
export type FluencyWeekBucket = z.infer<typeof FluencyWeekBucketSchema>;
