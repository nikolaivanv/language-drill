import { z } from 'zod';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import { LearningLanguageEnum } from './preferences';

// ---------------------------------------------------------------------------
// GET /sessions/today response
// ---------------------------------------------------------------------------
// The dashboard timeline's wire contract. The endpoint is read-only and either
// hydrates from today's existing practice_sessions row or composes a fresh
// 5-item plan from the exercise pool. Render branches are decided client-side
// from the discriminated nullables (`summary`, `code`):
//
//   - items.length === 5, every status === 'queued'  → standard timeline
//   - items.length === 5, mixed                       → first queued is next-up
//   - items.length === 5, every status === 'done',
//                          summary != null            → AllDoneCard
//   - items.length === 0, code === 'INSUFFICIENT_POOL' → PoolNotReadyCard
// ---------------------------------------------------------------------------

export const TodayPlanItemStatusEnum = z.enum(['done', 'queued']);

export type TodayPlanItemStatus = z.infer<typeof TodayPlanItemStatusEnum>;

export const TodayPlanItemSchema = z.object({
  // 1-based plan position (1..5).
  index: z.number().int().min(1).max(5),
  // Exercise type used to pick a typed renderer downstream.
  type: z.nativeEnum(ExerciseType),
  // Topic from exercises.content_json->>'topicHint' — null when the seed row
  // doesn't carry one (the timeline falls back to the type label).
  topicHint: z.string().nullable(),
  difficulty: z.nativeEnum(CefrLevel),
  // Size of the underlying drill (e.g. cloze=4 items). Always ≥ 1.
  itemCount: z.number().int().min(1),
  // Static integer estimate from ESTIMATED_MINUTES_BY_TYPE.
  estimatedMinutes: z.number().int().min(1),
  status: TodayPlanItemStatusEnum,
});

export type TodayPlanItem = z.infer<typeof TodayPlanItemSchema>;

export const TodayPlanSummarySchema = z.object({
  itemCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  // Wall-clock minutes the user actually spent on the completed session;
  // distinct from totalEstimatedMinutes, which is the planning estimate.
  durationMinutes: z.number().int().nonnegative(),
});

export type TodayPlanSummary = z.infer<typeof TodayPlanSummarySchema>;

export const TodayPlanResponseSchema = z.object({
  language: LearningLanguageEnum,
  generatedAt: z.string().datetime(),
  totalEstimatedMinutes: z.number().int().nonnegative(),
  items: z.array(TodayPlanItemSchema).max(5),
  // Present only when every item is `done` AND the session has completed —
  // drives the AllDoneCard.
  summary: TodayPlanSummarySchema.nullable(),
  // Present only when items.length < 5 because the pool is empty/insufficient.
  code: z.literal('INSUFFICIENT_POOL').nullable(),
});

export type TodayPlanResponse = z.infer<typeof TodayPlanResponseSchema>;
