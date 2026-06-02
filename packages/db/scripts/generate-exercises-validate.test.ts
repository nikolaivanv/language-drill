import { describe, it, expect } from "vitest";
import type { ValidationResult } from "@language-drill/ai";
import { GenerationReasonCode } from "@language-drill/shared";

import {
  routeValidationResult,
  VALIDATION_THRESHOLDS,
} from "./generate-exercises-validate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// VALIDATION_THRESHOLDS
// ---------------------------------------------------------------------------

describe("VALIDATION_THRESHOLDS", () => {
  it("locks the threshold values from plan §3.1", () => {
    expect(VALIDATION_THRESHOLDS.approveQualityFloor).toBe(0.7);
    expect(VALIDATION_THRESHOLDS.flagQualityFloor).toBe(0.5);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(VALIDATION_THRESHOLDS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// routeValidationResult — REJECTED branch
// ---------------------------------------------------------------------------

describe("routeValidationResult — rejected branch", () => {
  it("rejects when qualityScore < 0.5", () => {
    const decision = routeValidationResult(withResult({ qualityScore: 0.4 }));
    expect(decision.reviewStatus).toBe("rejected");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityReject },
    ]);
  });

  it("rejects on cultural issues alone, even when qualityScore is high (intentional hard veto)", () => {
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.9,
        culturalIssues: ["stereotyping middle-eastern characters"],
      }),
    );
    expect(decision.reviewStatus).toBe("rejected");
    // No 'low quality score' reason — score is fine; the cultural issue is the
    // sole reason. This proves the "regardless of qualityScore" intent.
    expect(decision.flaggedReasons).toEqual([
      {
        code: GenerationReasonCode.CulturalIssue,
        detail: "stereotyping middle-eastern characters",
      },
    ]);
  });

  it("combines low score + multiple cultural issues in deterministic order", () => {
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.3,
        culturalIssues: ["issue A", "issue B"],
      }),
    );
    expect(decision.reviewStatus).toBe("rejected");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityReject },
      { code: GenerationReasonCode.CulturalIssue, detail: "issue A" },
      { code: GenerationReasonCode.CulturalIssue, detail: "issue B" },
    ]);
  });

  it("rejects exactly at the qualityScore boundary", () => {
    // 0.5 is the floor — anything strictly below is rejected; 0.5 itself is not.
    const justBelow = routeValidationResult(withResult({ qualityScore: 0.499 }));
    expect(justBelow.reviewStatus).toBe("rejected");

    const exactly = routeValidationResult(withResult({ qualityScore: 0.5 }));
    expect(exactly.reviewStatus).not.toBe("rejected");
  });

  it("rejects on contextSpoilsAnswer alone, even when qualityScore is high (hard veto)", () => {
    // Regression: the "Vowel harmony: front vowel (e) requires -ler suffix"
    // case from the Turkish A1 pool. Score is fine, target is on-point, but
    // the context literally states the answer — the draft can never be
    // useful, so we reject (not flag).
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.9,
        contextSpoilsAnswer: true,
      }),
    );
    expect(decision.reviewStatus).toBe("rejected");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.ContextSpoilsAnswer },
    ]);
  });

  it("orders 'context spoils answer' before cultural issues when both fire", () => {
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.3,
        contextSpoilsAnswer: true,
        culturalIssues: ["sensitive content"],
      }),
    );
    expect(decision.reviewStatus).toBe("rejected");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityReject },
      { code: GenerationReasonCode.ContextSpoilsAnswer },
      { code: GenerationReasonCode.CulturalIssue, detail: "sensitive content" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// routeValidationResult — AUTO-APPROVED branch
// ---------------------------------------------------------------------------

describe("routeValidationResult — auto-approved branch", () => {
  it("auto-approves when every condition holds", () => {
    const decision = routeValidationResult(PASSING);
    expect(decision.reviewStatus).toBe("auto-approved");
    expect(decision.flaggedReasons).toEqual([]);
  });

  it("auto-approves at the qualityScore boundary (>= 0.7)", () => {
    const decision = routeValidationResult(withResult({ qualityScore: 0.7 }));
    expect(decision.reviewStatus).toBe("auto-approved");
  });
});

// ---------------------------------------------------------------------------
// routeValidationResult — FLAGGED branch (single failures)
// ---------------------------------------------------------------------------

describe("routeValidationResult — flagged branch (single failures)", () => {
  it("flags when 0.5 <= qualityScore < 0.7", () => {
    const decision = routeValidationResult(withResult({ qualityScore: 0.6 }));
    expect(decision.reviewStatus).toBe("flagged");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityFlag },
    ]);
  });

  it("flags when ambiguous = true (score still >= 0.7)", () => {
    const decision = routeValidationResult(withResult({ ambiguous: true }));
    expect(decision.reviewStatus).toBe("flagged");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.Ambiguous },
    ]);
  });

  it("flags when levelMatch = false", () => {
    const decision = routeValidationResult(withResult({ levelMatch: false }));
    expect(decision.reviewStatus).toBe("flagged");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LevelMismatch },
    ]);
  });

  it("flags when grammarPointMatch = false", () => {
    const decision = routeValidationResult(
      withResult({ grammarPointMatch: false }),
    );
    expect(decision.reviewStatus).toBe("flagged");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.GrammarPointMismatch },
    ]);
  });
});

// ---------------------------------------------------------------------------
// routeValidationResult — FLAGGED branch (combinations + passthrough)
// ---------------------------------------------------------------------------

describe("routeValidationResult — flagged branch (combinations)", () => {
  it("combines multiple failures in the documented deterministic order", () => {
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.6,
        ambiguous: true,
        levelMatch: false,
        grammarPointMatch: false,
        flaggedReasons: ["extra reason"],
      }),
    );
    expect(decision.reviewStatus).toBe("flagged");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityFlag },
      { code: GenerationReasonCode.Ambiguous },
      { code: GenerationReasonCode.LevelMismatch },
      { code: GenerationReasonCode.GrammarPointMismatch },
      { code: GenerationReasonCode.ValidatorNote, detail: "extra reason" },
    ]);
  });

  it("appends result.flaggedReasons after the canonical reasons in original order", () => {
    const decision = routeValidationResult(
      withResult({
        qualityScore: 0.6,
        flaggedReasons: ["x", "y"],
      }),
    );
    expect(decision.reviewStatus).toBe("flagged");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.LowQualityFlag },
      { code: GenerationReasonCode.ValidatorNote, detail: "x" },
      { code: GenerationReasonCode.ValidatorNote, detail: "y" },
    ]);
  });

  it("does NOT add 'low quality score (<0.7)' when score is at 0.7 but another condition fails", () => {
    const decision = routeValidationResult(
      withResult({ qualityScore: 0.7, ambiguous: true }),
    );
    expect(decision.reviewStatus).toBe("flagged");
    expect(decision.flaggedReasons).toEqual([
      { code: GenerationReasonCode.Ambiguous },
    ]);
  });
});

// ---------------------------------------------------------------------------
// routeValidationResult — never returns 'manual-approved'
// ---------------------------------------------------------------------------

describe("routeValidationResult — never produces manual-approved", () => {
  it("does not return 'manual-approved' on any input — that value is set only by the review CLI", () => {
    const inputs: ValidationResult[] = [
      PASSING,
      withResult({ qualityScore: 0.4 }),
      withResult({ qualityScore: 0.6 }),
      withResult({ ambiguous: true }),
      withResult({ culturalIssues: ["issue"] }),
      withResult({ qualityScore: 0.0 }),
      withResult({ qualityScore: 1.0 }),
    ];
    for (const input of inputs) {
      const { reviewStatus } = routeValidationResult(input);
      expect(reviewStatus).not.toBe("manual-approved");
    }
  });
});
