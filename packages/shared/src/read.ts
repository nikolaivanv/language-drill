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
  // Optional: the slimmed skim pass omits `example` (deep cards supply
  // examples). Stored entries that still carry an `example` stay valid.
  example: z.string().min(1).optional(),
  freq: z.number().int().nonnegative(),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
});

export type WordFlag = z.infer<typeof WordFlagSchema>;

// ---------------------------------------------------------------------------
// FlaggedMap — keyed by the lowercased surface form found in the passage
// ---------------------------------------------------------------------------

export const FlaggedMapSchema = z.record(z.string().min(1), WordFlagSchema);

export type FlaggedMap = z.infer<typeof FlaggedMapSchema>;

// ---------------------------------------------------------------------------
// Deep cards — the rich, on-demand annotation contract (Reading Part 1)
// ---------------------------------------------------------------------------
// The single authoritative contract for the Sonnet deep-annotation path,
// shared by the AI parser (packages/ai), the Hono route, the api-client wire
// schemas, and the Drizzle `$type` on `read_entries.span_annotations` and
// `user_vocabulary.card`. A `DeepCard` is one of three shapes discriminated on
// `type`; the server decides the span type from offsets and the model emits
// the matching shape.
//
// CEFR is spelled as a literal `z.enum` (not `z.nativeEnum(CefrLevel)`) for the
// same module-init-cycle reason documented above WordFlagSchema.
// ---------------------------------------------------------------------------

const CefrEnum = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

// Morpheme-level breakdown with a sentence-grounded "why this form" — the
// standout field for Turkish agglutination and German case/separable prefixes.
export const MorphologySchema = z.object({
  root: z.string().min(1),
  rootGloss: z.string().min(1),
  segments: z.array(
    z.object({
      morph: z.string().min(1),
      function: z.string().min(1),
    }),
  ),
  whyThisForm: z.string().min(1),
});

export type Morphology = z.infer<typeof MorphologySchema>;

// Inflection facts shown inline near the header (e.g. German gender + plural,
// Turkish root + plural).
export const InflectionSchema = z.object({
  forms: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
    }),
  ),
});

export type Inflection = z.infer<typeof InflectionSchema>;

export const DeepWordCardSchema = z.object({
  type: z.literal("word"),
  surface: z.string().min(1),
  lemma: z.string().min(1),
  pos: z.string().min(1),
  contextualSense: z.string().min(1),
  definition: z.string().min(1),
  definitionLabel: z.string().min(1),
  cefr: CefrEnum,
  freq: z.number().int().nonnegative(),
  inflection: InflectionSchema.optional(),
  morphology: MorphologySchema.optional(),
  synonyms: z
    .array(z.object({ word: z.string().min(1), note: z.string().min(1) }))
    .optional(),
  collocations: z
    .array(z.object({ phrase: z.string().min(1), gloss: z.string().min(1) }))
    .optional(),
  register: z.string().min(1).optional(),
  extraExample: z
    .object({ tl: z.string().min(1), en: z.string().min(1) })
    .optional(),
});

export type DeepWordCard = z.infer<typeof DeepWordCardSchema>;

export const DeepPhraseCardSchema = z.object({
  type: z.literal("phrase"),
  surface: z.string().min(1),
  citation: z.string().min(1).optional(),
  literal: z.string().min(1),
  idiomaticMeaning: z.string().min(1),
  register: z.string().min(1),
  example: z.object({ tl: z.string().min(1), en: z.string().min(1) }).optional(),
  synonyms: z
    .array(z.object({ phrase: z.string().min(1), note: z.string().min(1) }))
    .optional(),
});

export type DeepPhraseCard = z.infer<typeof DeepPhraseCardSchema>;

export const DeepSentenceCardSchema = z.object({
  type: z.literal("sentence"),
  surface: z.string().min(1),
  translation: z.string().min(1),
  breakdown: z.array(
    z.object({
      chunk: z.string().min(1),
      role: z.string().min(1),
      note: z.string().min(1),
    }),
  ),
  grammarNotes: z.array(z.string().min(1)),
});

export type DeepSentenceCard = z.infer<typeof DeepSentenceCardSchema>;

// Discriminated on `type` so a malformed/missing `type` is rejected and the
// downstream UI can switch layouts on the literal.
export const DeepCardSchema = z.discriminatedUnion("type", [
  DeepWordCardSchema,
  DeepPhraseCardSchema,
  DeepSentenceCardSchema,
]);

export type DeepCard = z.infer<typeof DeepCardSchema>;

// ---------------------------------------------------------------------------
// SpanAnnotations — `read_entries.span_annotations`, keyed by "start:end"
// character offsets so a reopened History entry renders its persisted deep
// cards without re-calling Claude.
// ---------------------------------------------------------------------------

export const SpanAnnotationsSchema = z.record(z.string().min(1), DeepCardSchema);

export type SpanAnnotations = z.infer<typeof SpanAnnotationsSchema>;
