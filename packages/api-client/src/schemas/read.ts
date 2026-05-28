import { z } from 'zod';
import {
  CefrLevel,
  DeepCardSchema,
  FlaggedMapSchema,
  READ_SOURCE_MAX_CHARS,
  READ_TEXT_MAX_CHARS,
  READ_TITLE_MAX_CHARS,
  SpanAnnotationsSchema,
  WordFlagSchema,
} from '@language-drill/shared';
import { LearningLanguageEnum } from './preferences';

// ---------------------------------------------------------------------------
// Read & Collect — wire schemas
// ---------------------------------------------------------------------------
// Typed contracts for the five `/read/*` endpoints. The hooks call
// `safeParse`/`parse` on the parsed JSON to guarantee the runtime shape
// matches the inferred TypeScript types — no `as` casts at the boundary.
// `LearningLanguageEnum`, `FlaggedMapSchema`, and the char-limit constants
// are imported from their authoritative sources so the client and server
// can never drift.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /read/annotate (streaming)
// ---------------------------------------------------------------------------
// The endpoint returns Server-Sent Events. Each frame's `data` payload is
// validated against the matching schema below before the client reducer
// touches it (Req 3.2, 3.8). The legacy single-shot `AnnotateResponseSchema`
// is gone — the streaming Lambda emits four distinct event types instead.

export const AnnotateRequestSchema = z.object({
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  language: LearningLanguageEnum,
});

export type AnnotateRequest = z.infer<typeof AnnotateRequestSchema>;

// `meta` — sent once at stream open. Carries the calibration the server
// applied AND the candidate count, so the client can render the progress
// strip with a meaningful denominator before any `flag` arrives.
export const AnnotateMetaEventSchema = z.object({
  calibration: z.object({
    cefr: z.nativeEnum(CefrLevel),
    top: z.number().int().nonnegative(),
  }),
  candidateCount: z.number().int().nonnegative(),
});

export type AnnotateMetaEvent = z.infer<typeof AnnotateMetaEventSchema>;

// `flag` — one per enriched word. Extends WordFlag with `matchedForm` so the
// client knows which token in the passage to tint. The cap of 120 matches the
// server-side `MatchedFormSchema` in `packages/ai/src/annotate.ts`.
export const AnnotateFlagEventSchema = WordFlagSchema.extend({
  matchedForm: z.string().min(1).max(120),
});

export type AnnotateFlagEvent = z.infer<typeof AnnotateFlagEventSchema>;

// `done` — terminal success event. `flaggedCount` lets the UI assert the
// stream finished cleanly (vs. closed without `done`/`error`, which the hook
// surfaces as an AI_UNAVAILABLE per Req 5.10).
export const AnnotateDoneEventSchema = z.object({
  flaggedCount: z.number().int().nonnegative(),
});

export type AnnotateDoneEvent = z.infer<typeof AnnotateDoneEventSchema>;

// `error` — terminal failure event. The four codes mirror the gates in the
// streaming handler (`infra/lambda/src/annotate-stream/handler.ts`); the
// client maps each to a specific UI surface.
export const AnnotateErrorEventSchema = z.object({
  code: z.enum([
    "AI_UNAVAILABLE",
    "VALIDATION_ERROR",
    "RATE_LIMIT_EXCEEDED",
    "UNSUPPORTED_LANGUAGE",
  ]),
  message: z.string(),
});

export type AnnotateErrorEvent = z.infer<typeof AnnotateErrorEventSchema>;

// ---------------------------------------------------------------------------
// POST /read/entries
// ---------------------------------------------------------------------------
// `bank` permits an empty array on the wire schema so the same shape can be
// reused for unit-test fixtures and forward-compat scenarios. The server
// independently enforces `bank.length >= 1` per Requirement 8.1, and the UI
// gates the save action on the same rule.

export const SaveReadEntryRequestSchema = z.object({
  language: LearningLanguageEnum,
  title: z.string().max(READ_TITLE_MAX_CHARS),
  source: z.string().max(READ_SOURCE_MAX_CHARS),
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  flagged: FlaggedMapSchema,
  bank: z.array(z.string().min(1)),
});

export type SaveReadEntryRequest = z.infer<typeof SaveReadEntryRequestSchema>;

export const SaveReadEntryResponseSchema = z.object({
  id: z.string().uuid(),
  pastedAt: z.string().datetime(),
});

export type SaveReadEntryResponse = z.infer<typeof SaveReadEntryResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /read/entries/:id/bank
// ---------------------------------------------------------------------------

export const UpdateBankRequestSchema = z.object({
  bank: z.array(z.string().min(1)),
});

export type UpdateBankRequest = z.infer<typeof UpdateBankRequestSchema>;

export const UpdateBankResponseSchema = z.object({
  id: z.string().uuid(),
  bank: z.array(z.string()),
});

export type UpdateBankResponse = z.infer<typeof UpdateBankResponseSchema>;

// ---------------------------------------------------------------------------
// GET /read/entries
// ---------------------------------------------------------------------------

export const ReadEntrySummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  source: z.string(),
  preview: z.string(),
  flaggedCount: z.number().int().nonnegative(),
  savedCount: z.number().int().nonnegative(),
  pastedAt: z.string().datetime(),
});

export type ReadEntrySummary = z.infer<typeof ReadEntrySummarySchema>;

export const ReadEntriesResponseSchema = z.object({
  entries: z.array(ReadEntrySummarySchema),
});

export type ReadEntriesResponse = z.infer<typeof ReadEntriesResponseSchema>;

// ---------------------------------------------------------------------------
// GET /read/entries/:id
// ---------------------------------------------------------------------------

export const ReadEntryResponseSchema = z.object({
  id: z.string().uuid(),
  language: LearningLanguageEnum,
  title: z.string(),
  source: z.string(),
  text: z.string(),
  flaggedWords: FlaggedMapSchema,
  bank: z.array(z.string()),
  // Deep cards resolved on this entry, keyed by "start:end" offsets. Optional:
  // older/unsaved entries carry none. `useReadAnnotateSpan` writes resolved
  // cards through here so a re-tapped span renders from cache without a new
  // model call (Req 3.5, 11.4); the annotated view reads it to render persisted
  // annotations on open (Req 11.3).
  spanAnnotations: SpanAnnotationsSchema.optional(),
  pastedAt: z.string().datetime(),
});

export type ReadEntryResponse = z.infer<typeof ReadEntryResponseSchema>;

// ---------------------------------------------------------------------------
// POST /read/annotate-span — on-demand deep annotation (Req 3.4, 10.4)
// ---------------------------------------------------------------------------
// Mirrors the server's `AnnotateSpanBodySchema` (`infra/lambda/src/routes/read.ts`):
// the full passage + the selected span's character offsets (so the model can
// resolve the contextual sense against the real sentence), plus an optional
// `entryId` present only for a saved History entry. The `start < end` /
// in-range cross-field invariant is enforced server-side, matching the
// server's post-`safeParse` check. The response is the shared `DeepCard`.

export const AnnotateSpanRequestSchema = z.object({
  language: LearningLanguageEnum,
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  entryId: z.string().uuid().optional(),
});

export type AnnotateSpanRequest = z.infer<typeof AnnotateSpanRequestSchema>;

// The deep-annotation response IS the shared deep-card union — the same schema
// the server returns and persists, so the client never re-derives the shape.
export const AnnotateSpanResponseSchema = DeepCardSchema;

export type AnnotateSpanResponse = z.infer<typeof AnnotateSpanResponseSchema>;

// ---------------------------------------------------------------------------
// POST /read/vocabulary — save a deep card to the bank (Req 8.1)
// ---------------------------------------------------------------------------
// Mirrors the server's `SaveVocabularyBodySchema`. The whole resolved card is
// posted (it lives only transiently client-side); the server derives the
// lexical columns and snapshots the card. Sentence cards are rejected
// server-side (Req 8.6) — the request schema accepts the full union so the
// client surfaces that rejection as a normal 400.

export const SaveVocabularyCardRequestSchema = z.object({
  language: LearningLanguageEnum,
  card: DeepCardSchema,
  sourceReadEntryId: z.string().uuid().optional(),
});

export type SaveVocabularyCardRequest = z.infer<
  typeof SaveVocabularyCardRequestSchema
>;

export const SaveVocabularyCardResponseSchema = z.object({
  id: z.string().uuid(),
});

export type SaveVocabularyCardResponse = z.infer<
  typeof SaveVocabularyCardResponseSchema
>;

// ---------------------------------------------------------------------------
// DELETE /read/vocabulary/:id — undo a save (Req 8.5)
// ---------------------------------------------------------------------------

export const DeleteVocabularyCardResponseSchema = z.object({
  id: z.string().uuid(),
});

export type DeleteVocabularyCardResponse = z.infer<
  typeof DeleteVocabularyCardResponseSchema
>;

// Re-export for hook consumers that want the shared building blocks without
// reaching back into `@language-drill/shared`.
export { WordFlagSchema, FlaggedMapSchema, DeepCardSchema };
export type { WordFlag, FlaggedMap, DeepCard } from '@language-drill/shared';
