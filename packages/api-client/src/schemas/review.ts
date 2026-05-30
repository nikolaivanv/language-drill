import { z } from 'zod';
import {
  DeepCardSchema,
  FsrsStateViewSchema,
  MasteryDeltaSchema,
  OccurrenceSchema,
  QueueBreakdownSchema,
  ReviewItemTypeSchema,
  ReviewOutcomeSchema,
  SchedulerDeltaSchema,
  VocabReviewStatusSchema,
} from '@language-drill/shared';
import { LearningLanguageEnum } from './preferences';

// ---------------------------------------------------------------------------
// Vocabulary Review (Part 2) — wire schemas
// ---------------------------------------------------------------------------
// Typed contracts for the `/review/*` endpoints. Hooks `safeParse`/`parse` the
// parsed JSON so the runtime shape matches the inferred types — no `as` casts
// at the boundary. Enumerations, the occurrence/card/delta/breakdown shapes,
// and the FSRS view are imported from `@language-drill/shared` so client and
// server can never drift; these mirror the Lambda `routes/review.ts` responses.
// ---------------------------------------------------------------------------

const CefrEnum = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

// ---------------------------------------------------------------------------
// GET /review/overview
// ---------------------------------------------------------------------------

export const HubOverviewSchema = z.object({
  breakdown: QueueBreakdownSchema,
  estimatedMinutes: z.number(),
  nextDueAt: z.string().nullable(),
});
export type HubOverview = z.infer<typeof HubOverviewSchema>;

// ---------------------------------------------------------------------------
// POST /review/sessions
// ---------------------------------------------------------------------------

// Mirrors the server `ReviewFilter` union (focused-subset selectors).
export const ReviewFilterSchema = z.union([
  z.literal('all'),
  z.literal('new'),
  z.literal('leech'),
  z.object({ readEntryId: z.string().min(1) }),
  z.object({ grammarPoint: z.string().min(1) }),
]);
export type ReviewFilter = z.infer<typeof ReviewFilterSchema>;

export const StartReviewSessionRequestSchema = z.object({
  language: LearningLanguageEnum,
  filter: ReviewFilterSchema.optional(),
});
export type StartReviewSessionRequest = z.infer<typeof StartReviewSessionRequestSchema>;

// One queued item: card identity + the selected item type and (for cloze) the
// occurrence to test. The answer is graded server-side from `stateId`.
export const ReviewItemSchema = z.object({
  stateId: z.string().uuid(),
  lemma: z.string().min(1),
  language: LearningLanguageEnum,
  itemType: ReviewItemTypeSchema,
  gloss: z.string().min(1),
  pos: z.string().min(1),
  cefr: CefrEnum.nullable(),
  freqRank: z.number().int().nonnegative().nullable(),
  occurrence: OccurrenceSchema.nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const StartReviewSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  items: z.array(ReviewItemSchema),
});
export type StartReviewSessionResponse = z.infer<typeof StartReviewSessionResponseSchema>;

// ---------------------------------------------------------------------------
// POST /review/items/:stateId/submit
// ---------------------------------------------------------------------------

export const SubmitReviewItemRequestSchema = z.object({
  itemType: ReviewItemTypeSchema,
  answer: z.string(),
  surface: z.string().min(1).optional(),
  hintsUsed: z.number().int().nonnegative().optional(),
  sessionId: z.string().uuid().optional(),
});
export type SubmitReviewItemRequest = z.infer<typeof SubmitReviewItemRequestSchema>;

export const ReviewItemResultSchema = z.object({
  outcome: ReviewOutcomeSchema,
  correctAnswer: z.string(),
  schedulerDelta: SchedulerDeltaSchema,
  masteryDeltas: z.array(MasteryDeltaSchema),
});
export type ReviewItemResult = z.infer<typeof ReviewItemResultSchema>;

// ---------------------------------------------------------------------------
// GET /review/sessions/:id/summary
// ---------------------------------------------------------------------------

export const ReviewSummaryItemSchema = z.object({
  lemma: z.string().min(1),
  surface: z.string().nullable(),
  itemType: ReviewItemTypeSchema,
  outcome: ReviewOutcomeSchema,
});
export type ReviewSummaryItem = z.infer<typeof ReviewSummaryItemSchema>;

export const ReviewSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  promoted: z.array(z.string()),
  lapsed: z.array(z.string()),
  newCards: z.number().int().nonnegative(),
  items: z.array(ReviewSummaryItemSchema),
  grammarDeltas: z.array(MasteryDeltaSchema),
  nextDueAt: z.string().nullable(),
  durationSeconds: z.number().nonnegative(),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

// ---------------------------------------------------------------------------
// GET /review/bank
// ---------------------------------------------------------------------------

export const BankRowSchema = z.object({
  stateId: z.string().uuid(),
  lemma: z.string().min(1),
  gloss: z.string().min(1),
  pos: z.string().min(1),
  cefr: CefrEnum.nullable(),
  status: VocabReviewStatusSchema,
  stability: z.number().nonnegative(),
  dueAt: z.string().min(1),
});
export type BankRow = z.infer<typeof BankRowSchema>;

export const BankResponseSchema = z.object({
  rows: z.array(BankRowSchema),
});
export type BankResponse = z.infer<typeof BankResponseSchema>;

// ---------------------------------------------------------------------------
// GET /review/words/:stateId
// ---------------------------------------------------------------------------

export const WordHistoryEntrySchema = z.object({
  itemType: ReviewItemTypeSchema,
  surface: z.string().nullable(),
  outcome: ReviewOutcomeSchema,
  rating: z.number().int(),
  reviewedAt: z.string().min(1),
});
export type WordHistoryEntry = z.infer<typeof WordHistoryEntrySchema>;

export const WordDetailSchema = z.object({
  stateId: z.string().uuid(),
  lemma: z.string().min(1),
  language: LearningLanguageEnum,
  gloss: z.string().min(1),
  pos: z.string(),
  cefr: CefrEnum.nullable(),
  freqRank: z.number().int().nonnegative().nullable(),
  isPhrase: z.boolean(),
  deepCard: DeepCardSchema.nullable(),
  occurrences: z.array(OccurrenceSchema),
  fsrs: FsrsStateViewSchema,
  grammarPoints: z.array(z.string()),
  history: z.array(WordHistoryEntrySchema),
});
export type WordDetail = z.infer<typeof WordDetailSchema>;

// ---------------------------------------------------------------------------
// PATCH / DELETE /review/words/:stateId
// ---------------------------------------------------------------------------

export const UpdateWordRequestSchema = z.object({
  action: z.enum(['suspend', 'unsuspend', 'mark_known', 'reset']),
});
export type UpdateWordRequest = z.infer<typeof UpdateWordRequestSchema>;

export const UpdateWordResponseSchema = z.object({
  stateId: z.string().uuid(),
  status: VocabReviewStatusSchema,
  dueAt: z.string().min(1),
});
export type UpdateWordResponse = z.infer<typeof UpdateWordResponseSchema>;

export const DeleteWordResponseSchema = z.object({
  ok: z.boolean(),
});
export type DeleteWordResponse = z.infer<typeof DeleteWordResponseSchema>;

// ---------------------------------------------------------------------------
// GET /review/active-lemmas
// ---------------------------------------------------------------------------

export const ActiveLemmasSchema = z.object({
  lemmas: z.array(z.string()),
  surfaces: z.array(z.string()),
});
export type ActiveLemmas = z.infer<typeof ActiveLemmasSchema>;
