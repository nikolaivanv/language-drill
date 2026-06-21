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
  // 1-based plan position (1..DAILY_GOAL_MAX_ITEMS).
  index: z.number().int().min(1).max(12),
  // Exercise type used to pick a typed renderer downstream.
  type: z.nativeEnum(ExerciseType),
  // Topic from exercises.content_json->>'topicHint' — null when the seed row
  // doesn't carry one (the timeline falls back to the type label).
  topicHint: z.string().nullable(),
  // Curriculum grammar point this item drills, and its display name resolved
  // server-side. The timeline subtitle prefers grammarPointName over the
  // free-text topicHint (decision D5). `.default(null)` keeps payloads from an
  // older API deploy (which omits these fields) parseable.
  grammarPointKey: z.string().nullable().default(null),
  grammarPointName: z.string().nullable().default(null),
  difficulty: z.nativeEnum(CefrLevel),
  // Size of the underlying drill (e.g. cloze=4 items). Always ≥ 1.
  itemCount: z.number().int().min(1),
  // Static integer estimate from ESTIMATED_MINUTES_BY_TYPE.
  estimatedMinutes: z.number().int().min(1),
  status: TodayPlanItemStatusEnum,
  // Dominant driver for this item: 'new' (never seen), 'reinforce' (in
  // progress), 'review' (solid mastery but stale), 'error-fix' (≥2 recent
  // errors on this point). Nullable for backward-compat with older API deploys
  // (.default(null)); the current API computes a reason on every item (both
  // fresh and hydrated paths).
  reason: z.enum(['new', 'reinforce', 'review', 'error-fix']).nullable().default(null),
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

// Free-writing block — present on a language's cadence day when an approved
// free-writing exercise exists for the user's level. Drives the dashboard's
// free-writing timeline block. `.default(null)` (below) keeps payloads that
// omit the field (older API deploys) parseable.
export const FreeWritingPlanBlockSchema = z.object({
  estimatedMinutes: z.number().int().min(1),
});

export type FreeWritingPlanBlock = z.infer<typeof FreeWritingPlanBlockSchema>;

export const TodayPlanResponseSchema = z.object({
  language: LearningLanguageEnum,
  generatedAt: z.string().datetime(),
  totalEstimatedMinutes: z.number().int().nonnegative(),
  items: z.array(TodayPlanItemSchema).max(12),
  // Present only when every item is `done` AND the session has completed —
  // drives the AllDoneCard.
  summary: TodayPlanSummarySchema.nullable(),
  // Present only when items.length < 5 because the pool is empty/insufficient.
  code: z.literal('INSUFFICIENT_POOL').nullable(),
  // The in-progress today-session id when one exists and is not yet completed —
  // drives the timeline's "continue" link. Null on a fresh plan or a completed
  // session. `.default(null)` keeps older payloads (pre-resume API) parseable.
  resumeSessionId: z.string().nullable().default(null),
  // Present on a language's free-writing cadence day; null otherwise. Defaulted
  // so a response that omits the key still parses.
  freeWriting: FreeWritingPlanBlockSchema.nullable().default(null),
});

export type TodayPlanResponse = z.infer<typeof TodayPlanResponseSchema>;
