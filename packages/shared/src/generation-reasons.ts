/**
 * Canonical reason vocabulary for the exercise-generation pipeline.
 *
 * The generation validator records *why* a draft was rejected or flagged in two
 * places — `generation_jobs.rejection_reason_counts` (a per-cell frequency map)
 * and `exercises.flagged_reasons` (a per-exercise list). Historically both were
 * flat `string[]` arrays that concatenated canonical tags, free-form model
 * prose, and value-interpolated deterministic strings. Because the frequency
 * map keyed on the reason *string*, every unique model sentence / interpolated
 * token became its own bucket, giving `rejection_reason_counts` unbounded
 * cardinality and defeating `GROUP BY reason`.
 *
 * This module is the single source of truth that fixes that: an enum-constrained
 * `code` (the bounded analytics key) is separated from the free-form `detail`
 * (the prose / interpolated values, retained for human review). Reason emitters
 * (`routing.ts`, `deterministic-checks.ts`, `validate-and-insert.ts` in
 * `packages/db`) reference these codes instead of inline string literals; the
 * frequency map keys on `code` only.
 *
 * Scope: the exercise-generation pipeline. The parallel theory-generation
 * pipeline keeps its own string-based reasons for now; these types live in
 * `@language-drill/shared` so a future migration can reuse them.
 */

/**
 * Canonical reason codes. Every value is a stable kebab-case string so the set
 * of possible `rejection_reason_counts` / `flagged_reasons` keys is bounded and
 * documented. Interpolated values and free-form prose live in
 * {@link GenerationReason.detail}, never in the code itself.
 *
 * The members partition into two branches by where they arise in
 * `routeValidationResult`, plus deterministic-check and synthetic-failure codes:
 *
 * - Reject branch (drafts discarded without a row): {@link LowQualityReject},
 *   {@link ContextSpoilsAnswer}, {@link CulturalIssue},
 *   {@link VowelHarmonyAllomorph}, {@link ParserFailure},
 *   {@link ValidatorParseFailure}, {@link SeedTargetMismatch}. These are the
 *   only codes that can key `generation_jobs.rejection_reason_counts`.
 * - Flag branch (drafts inserted with `review_status = 'flagged'`):
 *   {@link LowQualityFlag}, {@link Ambiguous}, {@link LevelMismatch},
 *   {@link GrammarPointMismatch}, {@link MalformedSurfaceForm},
 *   {@link ValidatorNote}.
 */
export enum GenerationReasonCode {
  // -- Reject branch --------------------------------------------------------
  /** qualityScore < 0.5 → rejected. */
  LowQualityReject = "low-quality-reject",
  /** instructions/context give away the answer → hard veto. */
  ContextSpoilsAnswer = "context-spoils-answer",
  /** Validator `culturalIssues` entry → hard veto. `detail` holds the prose. */
  CulturalIssue = "cultural-issue",
  /**
   * Deterministic Turkish vowel-harmony error → rejected. `detail` holds the
   * interpolated `expected …, got …` allomorph values.
   */
  VowelHarmonyAllomorph = "vowel-harmony-allomorph",
  /** Every retry slot produced a generator parse failure (retry exhausted). */
  ParserFailure = "parser-failure",
  /** The validator returned a malformed tool call on first validation. */
  ValidatorParseFailure = "validator-parse-failure",
  /**
   * A seeded `vocab_recall` draft's `expectedWord` didn't normalize-match its
   * curated seed word — the model drifted off the target. Applied by
   * `vocabSeedMismatch` (`packages/db`) after the LLM routing decision.
   */
  SeedTargetMismatch = "seed-target-mismatch",

  // -- Flag branch ----------------------------------------------------------
  /** 0.5 <= qualityScore < 0.7 → flagged. */
  LowQualityFlag = "low-quality-flag",
  /** Multiple equally-correct answers. */
  Ambiguous = "ambiguous",
  /** Draft does not sit at the requested CEFR level. */
  LevelMismatch = "level-mismatch",
  /** Draft does not actually test the target grammar point. */
  GrammarPointMismatch = "grammar-point-mismatch",
  /**
   * Deterministic suspected malformed surface form → flagged. `detail` holds
   * the reconstructed surface form.
   */
  MalformedSurfaceForm = "malformed-surface-form",
  /** Free-form validator `flaggedReasons` note. `detail` holds the prose. */
  ValidatorNote = "validator-note",

  // -- Read-only ------------------------------------------------------------
  /**
   * Bucket for pre-migration `string[]` rows surfaced by
   * `normalizeFlaggedReasons` on read. NEVER emitted by any routing path —
   * new writes always use one of the coded members above. `detail` holds the
   * original legacy string verbatim.
   */
  LegacyUncoded = "legacy-uncoded",
}

/**
 * A single reason carried out of the routing / deterministic / synthetic layers.
 *
 * `code` is enum-constrained and is the analytics key; `detail` holds the
 * free-form prose or interpolated value when one exists, and is omitted (not
 * empty-string) for predicate-only codes such as {@link GenerationReasonCode.Ambiguous}.
 */
export type GenerationReason = {
  code: GenerationReasonCode;
  detail?: string;
};

/**
 * Friendly, human-readable label per code — rendered by dashboards, the manual
 * review UI, and CLI summaries so consumers never re-derive a display string
 * from the kebab-case code. Mirrors the prose of the pre-migration inline
 * strings so operators see familiar wording.
 */
export const REASON_LABELS: Record<GenerationReasonCode, string> = {
  [GenerationReasonCode.LowQualityReject]: "Low quality score (<0.5)",
  [GenerationReasonCode.ContextSpoilsAnswer]: "Context spoils answer",
  [GenerationReasonCode.CulturalIssue]: "Cultural issue",
  [GenerationReasonCode.VowelHarmonyAllomorph]: "Wrong vowel-harmony allomorph",
  [GenerationReasonCode.ParserFailure]: "Parser failure (retry exhausted)",
  [GenerationReasonCode.ValidatorParseFailure]:
    "Validator parse failure (malformed response)",
  [GenerationReasonCode.SeedTargetMismatch]: "Seed-target mismatch",
  [GenerationReasonCode.LowQualityFlag]: "Low quality score (<0.7)",
  [GenerationReasonCode.Ambiguous]: "Ambiguous",
  [GenerationReasonCode.LevelMismatch]: "Level mismatch",
  [GenerationReasonCode.GrammarPointMismatch]: "Grammar point mismatch",
  [GenerationReasonCode.MalformedSurfaceForm]: "Suspected malformed surface form",
  [GenerationReasonCode.ValidatorNote]: "Validator note",
  [GenerationReasonCode.LegacyUncoded]: "Legacy (uncoded)",
};

/**
 * The codes reachable when a draft terminates `rejected` — the ONLY codes that
 * can ever key `generation_jobs.rejection_reason_counts`. Backs the bounded-
 * cardinality test: every post-fix map key must be a member of this set.
 */
export const REJECTED_BRANCH_CODES: readonly GenerationReasonCode[] = [
  GenerationReasonCode.LowQualityReject,
  GenerationReasonCode.ContextSpoilsAnswer,
  GenerationReasonCode.CulturalIssue,
  GenerationReasonCode.VowelHarmonyAllomorph,
  GenerationReasonCode.ParserFailure,
  GenerationReasonCode.ValidatorParseFailure,
  GenerationReasonCode.SeedTargetMismatch,
];

/**
 * Render a reason for display: the code's friendly label, plus `": " + detail`
 * when a detail is present. Falls back to the raw code string when no label
 * exists (an unknown/future code read from a stored row), so the function is
 * total and never produces an empty string for a valid reason.
 */
export function formatReason(reason: GenerationReason): string {
  const label = REASON_LABELS[reason.code] ?? reason.code;
  return reason.detail ? `${label}: ${reason.detail}` : label;
}

/**
 * Coerce a raw `flagged_reasons` value (read from the DB) into
 * `GenerationReason[]`. Total and throw-free (a malformed stored row must never
 * crash a reader):
 *
 * - `GenerationReason[]` (new shape) → passed through (detail kept only when a
 *   string).
 * - legacy `string[]` → each element wrapped as
 *   `{ code: LegacyUncoded, detail: <string> }`, preserving the prose verbatim.
 * - `null` / `undefined` / non-array / unrecognized elements → `[]` / dropped.
 *
 * An object whose `code` is an unknown string is preserved as-is (cast); the
 * display layer (`formatReason`) degrades to showing the raw code.
 */
export function normalizeFlaggedReasons(raw: unknown): GenerationReason[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: GenerationReason[] = [];
  for (const element of raw) {
    if (typeof element === "string") {
      out.push({ code: GenerationReasonCode.LegacyUncoded, detail: element });
      continue;
    }
    if (
      element !== null &&
      typeof element === "object" &&
      typeof (element as { code?: unknown }).code === "string"
    ) {
      const { code, detail } = element as { code: string; detail?: unknown };
      out.push({
        code: code as GenerationReasonCode,
        ...(typeof detail === "string" ? { detail } : {}),
      });
    }
    // Anything else (numbers, null, objects without a string code) is dropped.
  }
  return out;
}
