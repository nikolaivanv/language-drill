/**
 * Unit tests for `routeTheoryValidationResult` and `THEORY_VALIDATION_THRESHOLDS`.
 *
 * Pure-function coverage of every decision-table branch from
 * Phase 3 design Component 3 (Req 3.1–3.8). No DB, no Claude, no fixtures.
 * Mirrors the structural shape of
 * `packages/db/scripts/generate-exercises-validate.test.ts` (the exercise-side
 * routing tests) so the two test suites read as siblings.
 */

import { describe, expect, it } from 'vitest';
import type { TheoryValidationResult } from '@language-drill/ai';

import {
  routeTheoryValidationResult,
  THEORY_VALIDATION_THRESHOLDS,
} from './routing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASSING: TheoryValidationResult = {
  qualityScore: 0.85,
  factualErrors: [],
  levelMismatch: false,
  sectionsIncomplete: [],
  examplesUseGrammarPoint: true,
  culturalIssues: [],
  flaggedReasons: [],
};

function withResult(
  overrides: Partial<TheoryValidationResult>,
): TheoryValidationResult {
  return { ...PASSING, ...overrides };
}

// ---------------------------------------------------------------------------
// THEORY_VALIDATION_THRESHOLDS — invariants from Task 1
// ---------------------------------------------------------------------------

describe('THEORY_VALIDATION_THRESHOLDS', () => {
  it('locks the threshold values from design §Component 3', () => {
    expect(THEORY_VALIDATION_THRESHOLDS.approveQualityFloor).toBe(0.7);
    expect(THEORY_VALIDATION_THRESHOLDS.flagQualityFloor).toBe(0.5);
  });

  it('preserves the flagQualityFloor < approveQualityFloor invariant', () => {
    expect(
      THEORY_VALIDATION_THRESHOLDS.flagQualityFloor <
        THEORY_VALIDATION_THRESHOLDS.approveQualityFloor,
    ).toBe(true);
  });

  it('is frozen — attempts to mutate throw in strict mode (ESM is strict)', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (THEORY_VALIDATION_THRESHOLDS as any).flagQualityFloor = 0.9;
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// REJECTED branch (Req 3.2 / 3.3 / 3.4)
// ---------------------------------------------------------------------------

describe('routeTheoryValidationResult — rejected branch', () => {
  it('rejects on factualErrors non-empty regardless of qualityScore (Req 3.2)', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        qualityScore: 0.95,
        factualErrors: [
          'claims subjunctive is used after "creo que"; in modern usage it takes indicative',
        ],
      }),
    );
    expect(decision.reviewStatus).toBe('rejected');
    expect(decision.flaggedReasons).toEqual([
      'claims subjunctive is used after "creo que"; in modern usage it takes indicative',
    ]);
  });

  it('rejects on multiple factualErrors in original order (Req 3.2)', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        factualErrors: ['error A', 'error B'],
      }),
    );
    expect(decision.reviewStatus).toBe('rejected');
    expect(decision.flaggedReasons).toEqual(['error A', 'error B']);
  });

  it('rejects on culturalIssues non-empty even when qualityScore is high (Req 3.3)', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        qualityScore: 0.9,
        culturalIssues: ['stereotyping middle-eastern characters'],
      }),
    );
    expect(decision.reviewStatus).toBe('rejected');
    expect(decision.flaggedReasons).toEqual([
      'stereotyping middle-eastern characters',
    ]);
  });

  it('rejects on qualityScore < flagQualityFloor with synthetic header + flaggedReasons (Req 3.4)', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        qualityScore: 0.3,
        flaggedReasons: ['voice is too encouraging', 'pitfalls section thin'],
      }),
    );
    expect(decision.reviewStatus).toBe('rejected');
    expect(decision.flaggedReasons).toEqual([
      'low quality score (<0.5)',
      'voice is too encouraging',
      'pitfalls section thin',
    ]);
  });

  it('rejects at the qualityScore boundary — strictly below 0.5 only', () => {
    const justBelow = routeTheoryValidationResult(
      withResult({ qualityScore: 0.499 }),
    );
    expect(justBelow.reviewStatus).toBe('rejected');

    const exactly = routeTheoryValidationResult(
      withResult({ qualityScore: 0.5 }),
    );
    // 0.5 is the floor — not rejected. Falls through to the flagged branch
    // because qualityScore < approveQualityFloor (0.7).
    expect(exactly.reviewStatus).not.toBe('rejected');
  });

  it('factualErrors take precedence over culturalIssues when both are non-empty', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        factualErrors: ['wrong rule'],
        culturalIssues: ['stereotype'],
      }),
    );
    expect(decision.reviewStatus).toBe('rejected');
    // factualErrors win the first-match-wins ordering on the reject branches.
    expect(decision.flaggedReasons).toEqual(['wrong rule']);
  });

  it('culturalIssues take precedence over low qualityScore when both fail', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        qualityScore: 0.2,
        culturalIssues: ['stereotype'],
      }),
    );
    expect(decision.reviewStatus).toBe('rejected');
    // No synthetic 'low quality score' header — the culturalIssues branch
    // matches first and short-circuits.
    expect(decision.flaggedReasons).toEqual(['stereotype']);
  });
});

// ---------------------------------------------------------------------------
// AUTO-APPROVED branch (Req 3.5)
// ---------------------------------------------------------------------------

describe('routeTheoryValidationResult — auto-approved branch', () => {
  it('auto-approves when every conjunct holds (Req 3.5)', () => {
    const decision = routeTheoryValidationResult(PASSING);
    expect(decision.reviewStatus).toBe('auto-approved');
    expect(decision.flaggedReasons).toEqual([]);
  });

  it('auto-approves at the qualityScore boundary (>= 0.7)', () => {
    const decision = routeTheoryValidationResult(
      withResult({ qualityScore: 0.7 }),
    );
    expect(decision.reviewStatus).toBe('auto-approved');
  });

  it('auto-approves at qualityScore = 1.0', () => {
    const decision = routeTheoryValidationResult(
      withResult({ qualityScore: 1.0 }),
    );
    expect(decision.reviewStatus).toBe('auto-approved');
  });

  it('ignores flaggedReasons on auto-approve (empty output regardless)', () => {
    const decision = routeTheoryValidationResult(
      withResult({ flaggedReasons: ['informational note from the validator'] }),
    );
    expect(decision.reviewStatus).toBe('auto-approved');
    expect(decision.flaggedReasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FLAGGED branch — single failures
// ---------------------------------------------------------------------------

describe('routeTheoryValidationResult — flagged branch (single failures)', () => {
  it('flags when 0.5 <= qualityScore < 0.7 and no other failures', () => {
    const decision = routeTheoryValidationResult(
      withResult({ qualityScore: 0.6 }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual(['low quality score (<0.7)']);
  });

  it('flags at qualityScore = 0.5 (the rejected/flagged boundary)', () => {
    const decision = routeTheoryValidationResult(
      withResult({ qualityScore: 0.5 }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual(['low quality score (<0.7)']);
  });

  it('flags on levelMismatch alone (score still >= 0.7)', () => {
    const decision = routeTheoryValidationResult(
      withResult({ levelMismatch: true }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual(['level mismatch']);
  });

  it('flags on sectionsIncomplete: ["formation"] alone', () => {
    const decision = routeTheoryValidationResult(
      withResult({ sectionsIncomplete: ['formation'] }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual(['incomplete section: formation']);
  });

  it('flags one entry per sectionsIncomplete element in original order', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        sectionsIncomplete: ['formation', 'common pitfalls'],
      }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual([
      'incomplete section: formation',
      'incomplete section: common pitfalls',
    ]);
  });

  it('flags on examplesUseGrammarPoint = false alone', () => {
    const decision = routeTheoryValidationResult(
      withResult({ examplesUseGrammarPoint: false }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual(['examples off-target']);
  });
});

// ---------------------------------------------------------------------------
// FLAGGED branch — combinations + passthrough (Req 3.6)
// ---------------------------------------------------------------------------

describe('routeTheoryValidationResult — flagged branch (combinations)', () => {
  it('combines all failure conditions in the documented fixed order (Req 3.6)', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        qualityScore: 0.6,
        levelMismatch: true,
        sectionsIncomplete: ['formation', 'common pitfalls'],
        examplesUseGrammarPoint: false,
        flaggedReasons: ['voice is too encouraging'],
      }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual([
      'low quality score (<0.7)',
      'level mismatch',
      'incomplete section: formation',
      'incomplete section: common pitfalls',
      'examples off-target',
      'voice is too encouraging',
    ]);
  });

  it('appends result.flaggedReasons after canonical reasons in original order', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        qualityScore: 0.6,
        flaggedReasons: ['x', 'y', 'z'],
      }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual([
      'low quality score (<0.7)',
      'x',
      'y',
      'z',
    ]);
  });

  it("does NOT add 'low quality score (<0.7)' when score is exactly 0.7 but another condition fails", () => {
    const decision = routeTheoryValidationResult(
      withResult({ qualityScore: 0.7, levelMismatch: true }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual(['level mismatch']);
  });

  it('flags on levelMismatch + sectionsIncomplete + examplesUseGrammarPoint=false (score >= 0.7)', () => {
    const decision = routeTheoryValidationResult(
      withResult({
        levelMismatch: true,
        sectionsIncomplete: ['examples in context'],
        examplesUseGrammarPoint: false,
      }),
    );
    expect(decision.reviewStatus).toBe('flagged');
    expect(decision.flaggedReasons).toEqual([
      'level mismatch',
      'incomplete section: examples in context',
      'examples off-target',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Never returns 'manual-approved' (Req 3.8)
//
// Exhaustive enumeration of the relevant input axes — finite and
// reproducible, unlike a `Math.random()` property test that would flake in
// CI. The cartesian product is 6 × 2 × 2 × 2 × 2 × 2 × 2 = 384 cases.
// ---------------------------------------------------------------------------

describe("routeTheoryValidationResult — never produces 'manual-approved' (Req 3.8)", () => {
  it('does not return "manual-approved" on any combination of inputs', () => {
    const qualityScores = [0.0, 0.49, 0.5, 0.69, 0.7, 1.0];
    const booleans = [true, false];
    const stringArrays = [[], ['x']];
    const sectionArrays = [[], ['formation']];

    let count = 0;
    for (const qualityScore of qualityScores) {
      for (const levelMismatch of booleans) {
        for (const examplesUseGrammarPoint of booleans) {
          for (const sectionsIncomplete of sectionArrays) {
            for (const factualErrors of stringArrays) {
              for (const culturalIssues of stringArrays) {
                for (const flaggedReasons of stringArrays) {
                  const { reviewStatus } = routeTheoryValidationResult({
                    qualityScore,
                    factualErrors,
                    levelMismatch,
                    sectionsIncomplete,
                    examplesUseGrammarPoint,
                    culturalIssues,
                    flaggedReasons,
                  });
                  expect(reviewStatus).not.toBe('manual-approved');
                  count++;
                }
              }
            }
          }
        }
      }
    }
    expect(count).toBe(384);
  });
});
