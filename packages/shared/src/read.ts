import { z } from "zod";
import type { CefrLevel } from "./index";

// ---------------------------------------------------------------------------
// Read & Collect — shared constants
// ---------------------------------------------------------------------------
// Single source of truth for client + server limits applied to the Read &
// Collect feature. Importing from here keeps the Lambda router, the Next.js
// page, and any future mobile client in lockstep with the wire contract.
//
// Note: `CefrLevel` is imported as a type only. Importing the runtime enum
// here would create a module-init cycle with `./index` (which re-exports
// from this file), leading to `CefrLevel` being `undefined` when
// `z.nativeEnum(CefrLevel)` evaluates at module-init time. The literal
// string array below matches the enum values exactly. Mirrors the same
// defense used in `./onboarding.ts` for `Language`.
// ---------------------------------------------------------------------------

export const READ_TEXT_MAX_CHARS = 2000;
export const READ_TITLE_MAX_CHARS = 120;
export const READ_SOURCE_MAX_CHARS = 200;
export const READ_PREVIEW_CHARS = 120;
export const READ_HISTORY_LIMIT = 50;

// Frequency-rank ceilings per CEFR band. Words with a corpus rank rarer than
// the user's ceiling are candidates for annotation. Numbers are calibrated
// against typical word-frequency lists (Spanish/German/Turkish corpora).
//
// The `satisfies Record<CefrLevel, number>` clause forces a compile error if
// a future `CefrLevel` enum member is added without a corresponding rank.
export const READ_CEFR_TOP_RANK = {
  A1: 750,
  A2: 1500,
  B1: 3000,
  B2: 5000,
  C1: 8000,
  C2: 12000,
} as const satisfies Record<CefrLevel, number>;

// ---------------------------------------------------------------------------
// WordFlag — a single annotated word entry produced by the Claude pass
// ---------------------------------------------------------------------------

export const WordFlagSchema = z.object({
  lemma: z.string().min(1),
  pos: z.string().min(1),
  gloss: z.string().min(1),
  example: z.string().min(1),
  freq: z.number().int().nonnegative(),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
});

export type WordFlag = z.infer<typeof WordFlagSchema>;

// ---------------------------------------------------------------------------
// FlaggedMap — keyed by the lowercased surface form found in the passage
// ---------------------------------------------------------------------------

export const FlaggedMapSchema = z.record(z.string().min(1), WordFlagSchema);

export type FlaggedMap = z.infer<typeof FlaggedMapSchema>;
