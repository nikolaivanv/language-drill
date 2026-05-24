import { describe, it, expect } from 'vitest';
import {
  CefrLevel,
  ExerciseType,
  Language,
} from '@language-drill/shared';
import type { ValidationResult } from '@language-drill/ai';

import {
  decideDemotion,
  parseRevalidateArgs,
  reconstructDraftAndSpec,
  type CandidateRow,
} from './revalidate-cloze-pool';
import type { ReviewStatus } from '../src/generation/routing';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// `tr-a1-vowel-harmony` is a real curriculum key (TR A1) — picking
// one that exists in `ALL_CURRICULA` lets `getGrammarPoint` resolve it.
const TR_A1_GRAMMAR_KEY = 'tr-a1-vowel-harmony';

const baseClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: 'Fill in the blank.',
  sentence: 'Sınıfta sekiz ___ var.',
  correctAnswer: 'öğrenci',
};

const baseRow: CandidateRow = {
  id: '00000000-0000-0000-0000-000000000001',
  type: 'cloze',
  language: Language.TR,
  difficulty: CefrLevel.A1,
  contentJson: baseClozeContent,
  grammarPointKey: TR_A1_GRAMMAR_KEY,
  topicDomain: null,
  modelId: 'claude-sonnet-4-5',
  reviewStatus: 'auto-approved',
};

const passingResult: ValidationResult = {
  qualityScore: 0.9,
  ambiguous: false,
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
};

function makeResult(overrides: Partial<ValidationResult>): ValidationResult {
  return { ...passingResult, ...overrides };
}

// ---------------------------------------------------------------------------
// parseRevalidateArgs
// ---------------------------------------------------------------------------

describe('parseRevalidateArgs', () => {
  it('defaults to dry-run with no filters', () => {
    const args = parseRevalidateArgs([]);
    expect(args.apply).toBe(false);
    expect(args.language).toBeNull();
    expect(args.cefrLevel).toBeNull();
    expect(args.limit).toBeNull();
    expect(args.concurrency).toBeGreaterThan(0);
    expect(args.maxCostUsd).toBeGreaterThan(0);
  });

  it('parses --apply, --language, --cefr, --limit, --concurrency, --max-cost-usd', () => {
    const args = parseRevalidateArgs([
      '--apply',
      '--language',
      'tr',
      '--cefr',
      'a1',
      '--limit',
      '50',
      '--concurrency',
      '8',
      '--max-cost-usd',
      '12.5',
    ]);
    expect(args.apply).toBe(true);
    expect(args.language).toBe(Language.TR);
    expect(args.cefrLevel).toBe(CefrLevel.A1);
    expect(args.limit).toBe(50);
    expect(args.concurrency).toBe(8);
    expect(args.maxCostUsd).toBe(12.5);
  });

  it('accepts --lang and --level as aliases', () => {
    const args = parseRevalidateArgs(['--lang', 'ES', '--level', 'B1']);
    expect(args.language).toBe(Language.ES);
    expect(args.cefrLevel).toBe(CefrLevel.B1);
  });

  it('rejects unknown languages', () => {
    expect(() => parseRevalidateArgs(['--language', 'FR'])).toThrow();
  });

  it('rejects unknown CEFR levels', () => {
    expect(() => parseRevalidateArgs(['--cefr', 'D3'])).toThrow();
  });

  it('rejects unrecognized flags', () => {
    expect(() => parseRevalidateArgs(['--bogus'])).toThrow(
      /Unrecognized argument/,
    );
  });

  it('rejects --limit values that are not positive integers', () => {
    expect(() => parseRevalidateArgs(['--limit', '0'])).toThrow();
    expect(() => parseRevalidateArgs(['--limit', '-5'])).toThrow();
    expect(() => parseRevalidateArgs(['--limit', 'abc'])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// reconstructDraftAndSpec
// ---------------------------------------------------------------------------

describe('reconstructDraftAndSpec', () => {
  it('builds (draft, spec) for a well-formed cloze row', () => {
    const recon = reconstructDraftAndSpec(baseRow);
    expect(recon.ok).toBe(true);
    if (!recon.ok) return;

    expect(recon.draft.id).toBe(baseRow.id);
    expect(recon.draft.contentJson).toEqual(baseClozeContent);
    expect(recon.draft.metadata.grammarPointKey).toBe(TR_A1_GRAMMAR_KEY);
    expect(recon.draft.metadata.inputTokens).toBe(0);
    expect(recon.draft.metadata.inBatchDuplicate).toBe(false);

    expect(recon.spec.exerciseType).toBe(ExerciseType.CLOZE);
    expect(recon.spec.language).toBe(Language.TR);
    expect(recon.spec.cefrLevel).toBe(CefrLevel.A1);
    expect(recon.spec.grammarPoint.key).toBe(TR_A1_GRAMMAR_KEY);
  });

  it('skips rows with no grammar_point_key (seed rows)', () => {
    const recon = reconstructDraftAndSpec({
      ...baseRow,
      grammarPointKey: null,
    });
    expect(recon.ok).toBe(false);
    if (recon.ok) return;
    expect(recon.reason).toBe('missing-grammar-point-key');
  });

  it('skips rows whose grammar_point_key does not resolve in the curriculum', () => {
    const recon = reconstructDraftAndSpec({
      ...baseRow,
      grammarPointKey: 'tr-a1-does-not-exist-anywhere',
    });
    expect(recon.ok).toBe(false);
    if (recon.ok) return;
    expect(recon.reason).toBe('unknown-grammar-point');
  });

  it('skips rows whose content_json is not a cloze body', () => {
    const recon = reconstructDraftAndSpec({
      ...baseRow,
      contentJson: { type: ExerciseType.TRANSLATION },
    });
    expect(recon.ok).toBe(false);
    if (recon.ok) return;
    expect(recon.reason).toBe('malformed-content-json');
  });

  it('skips rows with invalid language', () => {
    const recon = reconstructDraftAndSpec({ ...baseRow, language: 'XX' });
    expect(recon.ok).toBe(false);
    if (recon.ok) return;
    expect(recon.reason).toBe('mismatched-language');
  });

  it('skips rows with invalid CEFR', () => {
    const recon = reconstructDraftAndSpec({ ...baseRow, difficulty: 'Z9' });
    expect(recon.ok).toBe(false);
    if (recon.ok) return;
    expect(recon.reason).toBe('mismatched-cefr');
  });

  it('skips rows whose language is EN (cloze exercises target learner languages)', () => {
    const recon = reconstructDraftAndSpec({ ...baseRow, language: Language.EN });
    expect(recon.ok).toBe(false);
    if (recon.ok) return;
    expect(recon.reason).toBe('mismatched-language');
  });
});

// ---------------------------------------------------------------------------
// decideDemotion
// ---------------------------------------------------------------------------

describe('decideDemotion', () => {
  it('no-op when current=auto-approved and new validator passes', () => {
    const action = decideDemotion('auto-approved', passingResult);
    expect(action.kind).toBe('no-change');
  });

  it('demotes auto-approved → rejected when new validator says contextSpoilsAnswer', () => {
    // Regression: Turkish A1 "Vowel harmony: front vowel (e) requires -ler".
    const action = decideDemotion(
      'auto-approved',
      makeResult({ contextSpoilsAnswer: true }),
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('rejected');
    expect(action.reasons).toContain('context spoils answer');
  });

  it('demotes auto-approved → flagged when new validator marks ambiguous', () => {
    // Regression: Turkish A1 "Sınıfta sekiz ___ var" — score still fine,
    // grammar point still on-point; only `ambiguous` flips.
    const action = decideDemotion(
      'auto-approved',
      makeResult({ ambiguous: true }),
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('flagged');
    expect(action.reasons).toContain('ambiguous');
  });

  it('demotes flagged → rejected when new validator says contextSpoilsAnswer', () => {
    const action = decideDemotion(
      'flagged',
      makeResult({ contextSpoilsAnswer: true }),
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('rejected');
  });

  it('does NOT promote flagged → auto-approved even when new validator passes (avoid drift)', () => {
    const action = decideDemotion('flagged', passingResult);
    expect(action.kind).toBe('no-change');
  });

  it('does NOT demote flagged → flagged (no churn on still-flagged rows)', () => {
    const action = decideDemotion(
      'flagged',
      makeResult({ ambiguous: true }),
    );
    expect(action.kind).toBe('no-change');
  });

  it('skips manual-approved regardless of validator result (human-trusted)', () => {
    const action = decideDemotion(
      'manual-approved',
      makeResult({ contextSpoilsAnswer: true, ambiguous: true, qualityScore: 0.1 }),
    );
    expect(action.kind).toBe('skip');
    if (action.kind !== 'skip') return;
    expect(action.reason).toBe('manual-approved');
  });

  it('skips rejected (already out)', () => {
    const action = decideDemotion('rejected' as ReviewStatus, passingResult);
    expect(action.kind).toBe('skip');
  });

  // -------------------------------------------------------------------------
  // R3.C.8 regression cases — these pin the demotion behavior on existing
  // approved offenders once the updated R3.A / R3.B / R7 validator prompt
  // ships and `pnpm revalidate:cloze --apply` runs through them. Each test
  // models one production failure pattern with the specific `ValidationResult`
  // shape the new prompt would return.
  // -------------------------------------------------------------------------

  it('R3.A regression: spoiled-context demote with qualityScore=0.5 routes auto-approved → rejected', () => {
    // Production pattern: TR A1 vowel-harmony cloze whose context spelled the
    // rule out above the blank ("(u = back, unrounded → -lar)" / blank "lar").
    // The new validator returns `contextSpoilsAnswer: true` and a qualityScore
    // at the 0.5 floor. The floor check uses strict `<`, so 'low quality score
    // (<0.5)' is NOT pushed; the contextSpoilsAnswer veto alone is sufficient
    // to land the row in 'rejected' with 'context spoils answer' as the
    // leading reason.
    const action = decideDemotion(
      'auto-approved',
      makeResult({ qualityScore: 0.5, contextSpoilsAnswer: true }),
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('rejected');
    expect(action.reasons).toContain('context spoils answer');
  });

  it('R3.B regression: ambiguous-fill demote with qualityScore=0.65 routes auto-approved → flagged', () => {
    // Production pattern: TR A1 cloze "Evde yeni ___ var. Onlar çok güzel." /
    // "perdeler" — multiple lexemes (kitaplar, çiçekler, lambalar) fit the
    // sentence equally well. The new validator returns `ambiguous: true` and a
    // qualityScore in the 0.5..0.7 borderline band. Both signals collapse the
    // row to 'flagged' rather than 'rejected', because the exercise is
    // salvageable with an `acceptableAnswers` edit.
    const action = decideDemotion(
      'auto-approved',
      makeResult({ qualityScore: 0.65, ambiguous: true }),
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('flagged');
    expect(action.reasons).toContain('ambiguous');
    expect(action.reasons).toContain('low quality score (<0.7)');
  });

  it('R7.2/R7.3 regression: buffer-consonant ambiguous blank demotes auto-approved → flagged with reason carried through', () => {
    // Production pattern: TR A1 cloze "Ben çok mutlu___" / "um" — the blank
    // position absorbs the buffer consonant `-y-` without `acceptableAnswers`,
    // so both "um" (linguistic suffix) and "yum" (visible completion) are
    // gradeable. R7.2 instructs the validator to set `ambiguous: true` AND
    // surface the specific 'buffer-consonant ambiguous blank' string in
    // `flaggedReasons` so the review CLI can distinguish lexeme-ambiguity
    // (R3.B) from buffer-consonant-ambiguity (R7) at triage time.
    const action = decideDemotion(
      'auto-approved',
      makeResult({
        qualityScore: 0.65,
        ambiguous: true,
        flaggedReasons: ['buffer-consonant ambiguous blank'],
      }),
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('flagged');
    expect(action.reasons).toContain('ambiguous');
    expect(action.reasons).toContain('buffer-consonant ambiguous blank');
  });

  // -------------------------------------------------------------------------
  // tr-harmony-eval-grounding R3.5 — the deterministic gate runs inside
  // decideDemotion when content + language are supplied. These pin demotion of
  // existing approved offenders that the LLM validator would still pass.
  // -------------------------------------------------------------------------

  function clz(sentence: string, correctAnswer: string) {
    return {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in the blank.',
      sentence,
      correctAnswer,
    };
  }

  it('deterministic: demotes auto-approved → rejected for a wrong-harmony cloze (domatler)', () => {
    const action = decideDemotion(
      'auto-approved',
      passingResult, // LLM still approves
      clz('Pazarda taze domat___ satıyorlar.', 'ler'),
      Language.TR,
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('rejected');
    expect(action.reasons[0]).toBe(
      'wrong vowel-harmony allomorph (deterministic): expected lar, got ler',
    );
  });

  it('deterministic: demotes auto-approved → flagged for a non-word stem', () => {
    const action = decideDemotion(
      'auto-approved',
      passingResult,
      clz('Bu domeş___ geldi.', 'ler'),
      Language.TR,
    );
    expect(action.kind).toBe('demote');
    if (action.kind !== 'demote') return;
    expect(action.to).toBe('flagged');
    expect(action.reasons).toContain(
      'suspected malformed surface form (deterministic): domeşler',
    );
  });

  it('deterministic: no-change for a clean Turkish cloze (ev + ler)', () => {
    const action = decideDemotion(
      'auto-approved',
      passingResult,
      clz('Sokakta ev___ var.', 'ler'),
      Language.TR,
    );
    expect(action.kind).toBe('no-change');
  });

  it('deterministic: omitting content/language skips the gate (backward-compat)', () => {
    // Same wrong-harmony content, but bare 2-arg call → pure LLM routing only.
    const action = decideDemotion('auto-approved', passingResult);
    expect(action.kind).toBe('no-change');
  });
});
