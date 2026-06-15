import { z } from 'zod';
import { Language, CefrLevel, ExerciseType } from '@language-drill/shared';
import { DictationResultSchema, EvaluationResultSchema } from './exercise';

// ---------------------------------------------------------------------------
// DebriefItem — one entry per exercise in the session manifest, in manifest
// order. `status === 'skipped'` items have null userAnswer/score/evaluation
// (Req 2.3); `'correct'` and `'incorrect'` items have the most-recent
// submission's data (Req 2.2, 2.4).
// ---------------------------------------------------------------------------

export const DebriefItemStatusSchema = z.enum([
  'correct',
  'incorrect',
  'skipped',
]);

export type DebriefItemStatus = z.infer<typeof DebriefItemStatusSchema>;

export const DebriefItemSchema = z.object({
  exerciseId: z.string().uuid(),
  type: z.nativeEnum(ExerciseType),
  // Nullable: see ExerciseResponseSchema. Used by review-item-card to surface
  // the theory pill in retrospect when the grammar point has an explainer.
  grammarPointKey: z.string().nullable(),
  // contentJson is type-discriminated by `type`; consumers narrow via
  // isClozeContent / isTranslationContent / isVocabRecallContent type guards
  // from @language-drill/shared.
  contentJson: z.unknown(),
  status: DebriefItemStatusSchema,
  userAnswer: z.string().nullable(),
  score: z.number().min(0).max(1).nullable(),
  // DictationResultSchema FIRST: a dictation result matches it (carries
  // `kind: 'dictation'` + the required diff/differences/criteria); a plain
  // evaluation result fails it and falls through to EvaluationResultSchema.
  // Mirrors parseSubmitResult's discrimination (exercise.ts).
  evaluation: z.union([DictationResultSchema, EvaluationResultSchema]).nullable(),
});

export type DebriefItem = z.infer<typeof DebriefItemSchema>;

// ---------------------------------------------------------------------------
// DebriefResponse — the full payload returned by GET /sessions/:id/debrief.
// Counts are non-negative integers; timestamps are ISO 8601 strings.
// `items` is manifest-ordered (Req 2.1).
// ---------------------------------------------------------------------------

export const DebriefResponseSchema = z.object({
  id: z.string().uuid(),
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationSeconds: z.number().int().nonnegative(),
  exerciseCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  attemptedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  items: z.array(DebriefItemSchema),
});

export type DebriefResponse = z.infer<typeof DebriefResponseSchema>;
