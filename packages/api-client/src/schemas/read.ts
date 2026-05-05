import { z } from 'zod';
import {
  CefrLevel,
  FlaggedMapSchema,
  READ_SOURCE_MAX_CHARS,
  READ_TEXT_MAX_CHARS,
  READ_TITLE_MAX_CHARS,
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
// POST /read/annotate
// ---------------------------------------------------------------------------

export const AnnotateRequestSchema = z.object({
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  language: LearningLanguageEnum,
});

export type AnnotateRequest = z.infer<typeof AnnotateRequestSchema>;

export const AnnotateResponseSchema = z.object({
  flagged: FlaggedMapSchema,
  calibration: z.object({
    cefr: z.nativeEnum(CefrLevel),
    top: z.number().int().nonnegative(),
  }),
});

export type AnnotateResponse = z.infer<typeof AnnotateResponseSchema>;

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
  pastedAt: z.string().datetime(),
});

export type ReadEntryResponse = z.infer<typeof ReadEntryResponseSchema>;

// Re-export for hook consumers that want the shared building blocks without
// reaching back into `@language-drill/shared`.
export { WordFlagSchema, FlaggedMapSchema };
export type { WordFlag, FlaggedMap } from '@language-drill/shared';
