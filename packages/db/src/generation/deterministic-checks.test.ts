import { describe, it, expect } from 'vitest';
import {
  type ClozeContent,
  type ExerciseContent,
  ExerciseType,
  Language,
} from '@language-drill/shared';

import { applyDeterministicChecks } from './deterministic-checks';
import type { RoutingDecision } from './routing';

// ---------------------------------------------------------------------------
// Deterministic routing combiner (tr-harmony-eval-grounding spec R3). Uses the
// real tr.json lexicon (via checkTurkishCloze) so verdict→routing mapping is
// pinned end-to-end.
// ---------------------------------------------------------------------------

function cloze(sentence: string, correctAnswer: string): ClozeContent {
  return {
    type: ExerciseType.CLOZE,
    instructions: 'Fill in the blank.',
    sentence,
    correctAnswer,
  };
}

const approved = (reasons: string[] = []): RoutingDecision => ({
  reviewStatus: 'auto-approved',
  flaggedReasons: reasons,
});

// Fixtures keyed to known checkTurkishCloze verdicts:
const WRONG_HARMONY = cloze('Pazarda taze domat___ satıyorlar.', 'ler'); // expects lar
const NON_WORD = cloze('Bu domeş___ geldi.', 'ler'); // harmony ok, not a lexeme
const OK = cloze('Sokakta ev___ var.', 'ler'); // ev + ler, real word

describe('applyDeterministicChecks — wrong-harmony', () => {
  it('forces rejected from a high-score auto-approved decision', () => {
    const out = applyDeterministicChecks(approved(), WRONG_HARMONY, Language.TR);
    expect(out.reviewStatus).toBe('rejected');
    expect(out.flaggedReasons[0]).toBe(
      'wrong vowel-harmony allomorph (deterministic): expected lar, got ler',
    );
  });

  it('prepends its reason ahead of pre-existing LLM reasons', () => {
    const out = applyDeterministicChecks(
      { reviewStatus: 'flagged', flaggedReasons: ['ambiguous'] },
      WRONG_HARMONY,
      Language.TR,
    );
    expect(out.reviewStatus).toBe('rejected');
    expect(out.flaggedReasons).toEqual([
      'wrong vowel-harmony allomorph (deterministic): expected lar, got ler',
      'ambiguous',
    ]);
  });
});

describe('applyDeterministicChecks — non-word-stem', () => {
  it('downgrades auto-approved to flagged and appends its reason', () => {
    const out = applyDeterministicChecks(approved(), NON_WORD, Language.TR);
    expect(out.reviewStatus).toBe('flagged');
    expect(out.flaggedReasons).toEqual([
      'suspected malformed surface form (deterministic): domeşler',
    ]);
  });

  it('keeps an already-flagged status and appends after existing reasons', () => {
    const out = applyDeterministicChecks(
      { reviewStatus: 'flagged', flaggedReasons: ['ambiguous'] },
      NON_WORD,
      Language.TR,
    );
    expect(out.reviewStatus).toBe('flagged');
    expect(out.flaggedReasons).toEqual([
      'ambiguous',
      'suspected malformed surface form (deterministic): domeşler',
    ]);
  });

  it('never upgrades an already-rejected decision', () => {
    const out = applyDeterministicChecks(
      { reviewStatus: 'rejected', flaggedReasons: ['low quality score (<0.5)'] },
      NON_WORD,
      Language.TR,
    );
    expect(out.reviewStatus).toBe('rejected');
    expect(out.flaggedReasons).toContain(
      'suspected malformed surface form (deterministic): domeşler',
    );
  });
});

describe('applyDeterministicChecks — pass-through', () => {
  it('leaves an ok verdict unchanged', () => {
    const decision = approved();
    expect(applyDeterministicChecks(decision, OK, Language.TR)).toEqual(decision);
  });

  it('leaves a lexical (whole-word) blank unchanged', () => {
    const decision = approved();
    const lexical = cloze('Sınıfta sekiz ___ var.', 'öğrenci');
    expect(applyDeterministicChecks(decision, lexical, Language.TR)).toEqual(decision);
  });

  it('does not touch non-Turkish drafts, even a would-be wrong-harmony one', () => {
    const decision = approved();
    // Same content shape, but language ES → checker must not run.
    expect(applyDeterministicChecks(decision, WRONG_HARMONY, Language.ES)).toEqual(
      decision,
    );
  });

  it('does not touch non-cloze content', () => {
    const decision = approved();
    const translation: ExerciseContent = {
      type: ExerciseType.TRANSLATION,
      instructions: 'Translate.',
      sourceText: 'The tomatoes are fresh.',
      sourceLanguage: Language.EN,
      targetLanguage: Language.TR,
      referenceTranslation: 'Domatesler taze.',
    };
    expect(applyDeterministicChecks(decision, translation, Language.TR)).toEqual(
      decision,
    );
  });
});
