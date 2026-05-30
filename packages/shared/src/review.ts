import { z } from "zod";
import { MorphologySchema } from "./read";

// ---------------------------------------------------------------------------
// Vocabulary Review (Part 2) — shared domain contract
// ---------------------------------------------------------------------------
// Single source of truth for the FSRS-scheduled review feature, shared by the
// Lambda router + pure logic (infra/lambda/src/lib/review), the api-client wire
// schemas (packages/api-client), the web surface, and the Drizzle `$type`s on
// the `vocabulary_review_*` tables.
//
// CEFR and LearningLanguage are spelled as literal `z.enum`s (not
// `z.nativeEnum(...)`) for the same module-init-cycle reason documented in
// `./read.ts`: importing the runtime enums from `./index` here would risk them
// being `undefined` at module-init time. The literal string arrays match the
// enum values exactly.
// ---------------------------------------------------------------------------

const CefrEnum = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
const LearningLanguageEnum = z.enum(["ES", "DE", "TR"]);

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

// The three locally-graded item types built in Phase 1. Production-grade
// "use it" / listening / speaking are Phase 2 and intentionally absent here.
export const ReviewItemTypeSchema = z.enum(["cloze", "meaning", "recognition"]);
export type ReviewItemType = z.infer<typeof ReviewItemTypeSchema>;

// Normalized grading outcome. `partial` is a near-miss (accent-only mismatch or
// hint-assisted-correct) and maps to FSRS `Hard` in the scheduler.
export const ReviewOutcomeSchema = z.enum(["correct", "partial", "incorrect"]);
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;

// Card lifecycle. `new`/`learning`/`mature`/`leech` are scheduler-derived;
// `suspended`/`known` are user actions that eject a card from the queue.
export const VocabReviewStatusSchema = z.enum([
  "new",
  "learning",
  "mature",
  "leech",
  "suspended",
  "known",
]);
export type VocabReviewStatus = z.infer<typeof VocabReviewStatusSchema>;

// ---------------------------------------------------------------------------
// Occurrence — one surface form of a lemma, pooled from a `user_vocabulary`
// row + its saved deep `card`. Cloze/listening pick one occurrence per session.
// ---------------------------------------------------------------------------

export const OccurrenceSchema = z.object({
  surface: z.string().min(1),
  sentence: z.string().min(1),
  translation: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  contextualSense: z.string().min(1),
  whyThisForm: z.string().min(1).optional(),
  morphology: MorphologySchema.optional(),
  // Free-text grammar-point labels carried by this occurrence (e.g.
  // "ablative case"). Display + evidence only in Phase 1; reconciliation to a
  // canonical grammarPointKey is a future enhancement.
  grammarPoints: z.array(z.string().min(1)).default([]),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;

// ---------------------------------------------------------------------------
// FSRS state view — the scheduler facts surfaced to the UI (timestamps are
// ISO-8601 strings on the wire).
// ---------------------------------------------------------------------------

export const FsrsStateViewSchema = z.object({
  stability: z.number().nonnegative(),
  difficulty: z.number(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: VocabReviewStatusSchema,
  dueAt: z.string().min(1),
  lastReviewedAt: z.string().min(1).nullable(),
  nextIntervalDays: z.number().nonnegative().optional(),
});
export type FsrsStateView = z.infer<typeof FsrsStateViewSchema>;

// ---------------------------------------------------------------------------
// ReviewCard — one logical card per (user, language, lemma) with pooled
// occurrences and its scheduler state.
// ---------------------------------------------------------------------------

export const ReviewCardSchema = z.object({
  stateId: z.string().uuid(),
  lemma: z.string().min(1),
  language: LearningLanguageEnum,
  gloss: z.string().min(1),
  pos: z.string().min(1),
  cefr: CefrEnum.nullable(),
  freqRank: z.number().int().nonnegative().nullable(),
  isPhrase: z.boolean(),
  occurrences: z.array(OccurrenceSchema),
  fsrs: FsrsStateViewSchema,
});
export type ReviewCard = z.infer<typeof ReviewCardSchema>;

// ---------------------------------------------------------------------------
// SchedulerDelta — before→after of a single `applyReview`, shown in feedback.
// ---------------------------------------------------------------------------

export const SchedulerDeltaSchema = z.object({
  intervalFrom: z.number().nonnegative(),
  intervalTo: z.number().nonnegative(),
  stabilityFrom: z.number().nonnegative(),
  stabilityTo: z.number().nonnegative(),
  stateFrom: VocabReviewStatusSchema,
  stateTo: VocabReviewStatusSchema,
});
export type SchedulerDelta = z.infer<typeof SchedulerDeltaSchema>;

// ---------------------------------------------------------------------------
// MasteryDelta — "what moved" for one grammar-point label, [0,1], sourced from
// recency-weighted review evidence (the radar's currentMastery math).
// ---------------------------------------------------------------------------

export const MasteryDeltaSchema = z.object({
  grammarPoint: z.string().min(1),
  from: z.number().min(0).max(1),
  to: z.number().min(0).max(1),
});
export type MasteryDelta = z.infer<typeof MasteryDeltaSchema>;

// ---------------------------------------------------------------------------
// QueueBreakdown — the hub's per-language counts + projected item-type mix.
// ---------------------------------------------------------------------------

export const ItemTypeMixSchema = z.object({
  cloze: z.number().int().nonnegative(),
  meaning: z.number().int().nonnegative(),
  recognition: z.number().int().nonnegative(),
});
export type ItemTypeMix = z.infer<typeof ItemTypeMixSchema>;

export const QueueBreakdownSchema = z.object({
  due: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
  leech: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  mix: ItemTypeMixSchema,
});
export type QueueBreakdown = z.infer<typeof QueueBreakdownSchema>;
