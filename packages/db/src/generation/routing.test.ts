/**
 * Regression net for the three boolean vetoes that the validator-prompt
 * cluster A edits (tasks 8 + 9 + 10) made actually fire in production:
 * `ambiguous`, `contextSpoilsAnswer`, and `grammarPointMatch`. The routing
 * logic itself is unchanged — these tests just pin that the now-firing
 * booleans map to the documented `(reviewStatus, flaggedReasons)` pairs.
 *
 * Reasons are now `{ code, detail? }` (`GenerationReason`) rather than bare
 * strings — these tests pin the canonical code per branch, the documented
 * ordering, and that free-form prose (culturalIssues / validator flaggedReasons)
 * lands in `detail` under the `cultural-issue` / `validator-note` codes.
 *
 * The exhaustive coverage of `routeValidationResult` lives at
 * `packages/db/scripts/generate-exercises-validate.test.ts` (Phase 3
 * back-compat home). This file is the canonical home alongside the
 * canonical `routing.ts` — pinning the three vetoes that the prompt
 * change now exercises in production.
 */
import { describe, it, expect } from "vitest";
import type { ValidationResult } from "@language-drill/ai";
import { GenerationReasonCode } from "@language-drill/shared";

import { routeValidationResult } from "./routing";

const PASSING: ValidationResult = {
  qualityScore: 0.85,
  ambiguous: false,
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
};

function withResult(overrides: Partial<ValidationResult>): ValidationResult {
  return { ...PASSING, ...overrides };
}

function codes(decision: { flaggedReasons: { code: GenerationReasonCode }[] }) {
  return decision.flaggedReasons.map((r) => r.code);
}

describe("routeValidationResult — cluster-A boolean vetoes", () => {
  it("flags `ambiguous = true` with the rest of the result passing", () => {
    // R3.B — the validator now actually fires `ambiguous` on the
    // "Sınıfta sekiz" / "Evde yeni" / "mutlu" patterns. The draft is
    // flagged (not rejected) because acceptableAnswers can rescue it
    // and a reviewer's eyes are the cheapest disambiguator.
    const decision = routeValidationResult(withResult({ ambiguous: true }));
    expect(decision.reviewStatus).toBe("flagged");
    expect(codes(decision)).toContain(GenerationReasonCode.Ambiguous);
  });

  it("rejects `contextSpoilsAnswer = true` with the rest of the result passing", () => {
    // R3.A — the validator now actually fires `contextSpoilsAnswer` on
    // the "vowel harmony: front vowel stems take -ler" / locative
    // exhaustive-enumeration patterns. The draft is rejected (not
    // flagged) because the spoiler text is baked into the exercise body
    // and a reviewer cannot remove it without rewriting the draft.
    const decision = routeValidationResult(
      withResult({ contextSpoilsAnswer: true }),
    );
    expect(decision.reviewStatus).toBe("rejected");
    // `context-spoils-answer` must be the FIRST reason in the rejected
    // branch (no low-score reason precedes it when qualityScore is high).
    expect(decision.flaggedReasons[0]).toEqual({
      code: GenerationReasonCode.ContextSpoilsAnswer,
    });
  });

  it("flags `grammarPointMatch = false` with the rest of the result passing", () => {
    // R2.6 — the validator now sets `grammarPointMatch = false` when the
    // construction the blank tests is a different grammar-point key from
    // the cell's declared point, even when grammatically related. The
    // `correctAnswer: "da"` outlier in `tr-a1-vowel-harmony` (tests
    // locative `-DA`) is the worked example.
    const decision = routeValidationResult(
      withResult({ grammarPointMatch: false }),
    );
    expect(decision.reviewStatus).toBe("flagged");
    expect(codes(decision)).toContain(
      GenerationReasonCode.GrammarPointMismatch,
    );
  });
});

describe("routeValidationResult — reason codes, detail, and ordering", () => {
  it("rejects low quality and carries culturalIssues prose in detail under cultural-issue", () => {
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.3,
        contextSpoilsAnswer: true,
        culturalIssues: ["'Ulan' is a coarse interjection", "stereotype"],
      }),
    );
    expect(decision.reviewStatus).toBe("rejected");
    // Documented reject-branch order: low-quality, context-spoils, then each
    // cultural issue in original order with prose in `detail`.
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityReject },
      { code: GenerationReasonCode.ContextSpoilsAnswer },
      {
        code: GenerationReasonCode.CulturalIssue,
        detail: "'Ulan' is a coarse interjection",
      },
      { code: GenerationReasonCode.CulturalIssue, detail: "stereotype" },
    ]);
  });

  it("flags low quality and carries validator flaggedReasons prose in detail under validator-note", () => {
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.6,
        ambiguous: true,
        levelMatch: false,
        grammarPointMatch: false,
        flaggedReasons: ["buffer-consonant ambiguous blank"],
      }),
    );
    expect(decision.reviewStatus).toBe("flagged");
    // Documented flag-branch order: low-quality(<0.7), ambiguous, level,
    // grammar-point, then validator notes in original order.
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityFlag },
      { code: GenerationReasonCode.Ambiguous },
      { code: GenerationReasonCode.LevelMismatch },
      { code: GenerationReasonCode.GrammarPointMismatch },
      {
        code: GenerationReasonCode.ValidatorNote,
        detail: "buffer-consonant ambiguous blank",
      },
    ]);
  });

  it("auto-approves a fully passing result with no reasons", () => {
    const decision = routeValidationResult(PASSING);
    expect(decision.reviewStatus).toBe("auto-approved");
    expect(decision.flaggedReasons).toEqual([]);
  });
});
