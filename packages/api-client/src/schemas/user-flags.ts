import { z } from 'zod';

export const FlagCategoryEnum = z.enum([
  'wrong_answer',
  'misleading_explanation',
  'confusing_prompt',
  'other',
]);
export type FlagCategory = z.infer<typeof FlagCategoryEnum>;

export const FlagExerciseRequestSchema = z.object({
  submissionId: z.string().uuid(),
  category: FlagCategoryEnum,
  note: z.string().trim().max(1000).optional(),
});
export type FlagExerciseRequest = z.infer<typeof FlagExerciseRequestSchema>;

export const FlagExerciseResponseSchema = z.object({
  id: z.string(),
  status: z.literal('open'),
  createdAt: z.string(),
});
export type FlagExerciseResponse = z.infer<typeof FlagExerciseResponseSchema>;

export const UserFlagQueueItemSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'resolved_rejected', 'resolved_dismissed']),
  category: FlagCategoryEnum,
  note: z.string().nullable(),
  createdAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  exerciseId: z.string(),
  submissionId: z.string(),
  exercise: z.object({
    language: z.string().nullable(),
    level: z.string().nullable(),
    type: z.string().nullable(),
    grammarPointKey: z.string().nullable(),
    reviewStatus: z.string().nullable(),
    contentJson: z.unknown(),
  }),
  userAnswer: z.unknown(),
  evaluation: z.unknown(),
});
export type UserFlagQueueItem = z.infer<typeof UserFlagQueueItemSchema>;

export const UserFlagsResponseSchema = z.object({
  items: z.array(UserFlagQueueItemSchema),
  total: z.number(),
});
export type UserFlagsResponse = z.infer<typeof UserFlagsResponseSchema>;

export const ResolveUserFlagOutcomeSchema = z.enum(['rejected', 'dismissed', 'already_resolved', 'not_found']);
export const ResolveUserFlagResponseSchema = z.object({ outcome: ResolveUserFlagOutcomeSchema });
export type ResolveUserFlagOutcome = z.infer<typeof ResolveUserFlagOutcomeSchema>;
