import { describe, it, expect } from 'vitest';
import {
  type ClozeContent,
  type ExerciseContent,
  ExerciseType,
  type GenerationReason,
  GenerationReasonCode,
  Language,
} from '@language-drill/shared';

import { checkTurkishCloze } from '@language-drill/ai';

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

const approved = (reasons: GenerationReason[] = []): RoutingDecision => ({
  reviewStatus: 'auto-approved',
  flaggedReasons: reasons,
});

// Canonical detail strings the checker produces for the fixtures below.
const HARMONY = {
  code: GenerationReasonCode.VowelHarmonyAllomorph,
  detail: 'expected lar, got ler',
} as const;
const MALFORMED = {
  code: GenerationReasonCode.MalformedSurfaceForm,
  detail: 'domeşler',
} as const;

// Fixtures keyed to known checkTurkishCloze verdicts:
const WRONG_HARMONY = cloze('Pazarda taze domat___ satıyorlar.', 'ler'); // expects lar
const NON_WORD = cloze('Bu domeş___ geldi.', 'ler'); // harmony ok, not a lexeme
const OK = cloze('Sokakta ev___ var.', 'ler'); // ev + ler, real word

describe('applyDeterministicChecks — wrong-harmony', () => {
  it('forces rejected from a high-score auto-approved decision', () => {
    const out = applyDeterministicChecks(approved(), WRONG_HARMONY, Language.TR);
    expect(out.reviewStatus).toBe('rejected');
    // Interpolated allomorph values live in `detail`; the code is bounded.
    expect(out.flaggedReasons[0]).toEqual(HARMONY);
  });

  it('prepends its reason ahead of pre-existing LLM reasons', () => {
    const out = applyDeterministicChecks(
      {
        reviewStatus: 'flagged',
        flaggedReasons: [{ code: GenerationReasonCode.Ambiguous }],
      },
      WRONG_HARMONY,
      Language.TR,
    );
    expect(out.reviewStatus).toBe('rejected');
    expect(out.flaggedReasons).toEqual([
      HARMONY,
      { code: GenerationReasonCode.Ambiguous },
    ]);
  });
});

describe('applyDeterministicChecks — non-word-stem', () => {
  it('downgrades auto-approved to flagged and appends its reason', () => {
    const out = applyDeterministicChecks(approved(), NON_WORD, Language.TR);
    expect(out.reviewStatus).toBe('flagged');
    expect(out.flaggedReasons).toEqual([MALFORMED]);
  });

  it('keeps an already-flagged status and appends after existing reasons', () => {
    const out = applyDeterministicChecks(
      {
        reviewStatus: 'flagged',
        flaggedReasons: [{ code: GenerationReasonCode.Ambiguous }],
      },
      NON_WORD,
      Language.TR,
    );
    expect(out.reviewStatus).toBe('flagged');
    expect(out.flaggedReasons).toEqual([
      { code: GenerationReasonCode.Ambiguous },
      MALFORMED,
    ]);
  });

  it('never upgrades an already-rejected decision', () => {
    const out = applyDeterministicChecks(
      {
        reviewStatus: 'rejected',
        flaggedReasons: [{ code: GenerationReasonCode.LowQualityReject }],
      },
      NON_WORD,
      Language.TR,
    );
    expect(out.reviewStatus).toBe('rejected');
    expect(out.flaggedReasons).toContainEqual(MALFORMED);
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

// ---------------------------------------------------------------------------
// R1.5 — whole-word blanks must not regress the deterministic harmony gate.
// Under the new universal whole-word convention the `___` is a standalone token
// (whitespace before it), so `extractSuffixalStem` finds no visible suffixal
// stem and the gate is inert: it can never emit a false wrong-harmony /
// non-word-stem on a full inflected surface — including stems that mutate at the
// boundary, the cases a partial-blank checker was most likely to misfire on.
// ---------------------------------------------------------------------------

describe('whole-word TR cloze — R1.5 no harmony-gate regression', () => {
  // Each fixture blanks the WHOLE inflected word (lemma in parens) over a stem
  // that mutates under the inflection — the format-change risk surface for R1.
  const wholeWordClozes: ReadonlyArray<{
    label: string;
    content: ClozeContent;
    answer: string;
  }> = [
    {
      label: 'accusative + buffer -y- (kahve → kahveyi)',
      content: cloze('Annem her sabah ___ içiyor. (kahve)', 'kahveyi'),
      answer: 'kahveyi',
    },
    {
      label: 'accusative + consonant softening p→b (kitap → kitabı)',
      content: cloze('Öğretmen ___ açtı. (kitap)', 'kitabı'),
      answer: 'kitabı',
    },
    {
      label: 'dative + consonant softening k→ğ (köpek → köpeğe)',
      content: cloze('Mamayı ___ verdim. (köpek)', 'köpeğe'),
      answer: 'köpeğe',
    },
  ];

  for (const { label, content, answer } of wholeWordClozes) {
    it(`emits no false wrong-harmony/non-word-stem verdict: ${label}`, () => {
      // The checker sees no suffixal stem (whitespace before `___`), so it must
      // NOT manufacture a harmony/word-formedness verdict on the whole word.
      const verdict = checkTurkishCloze(content);
      expect(verdict.kind).not.toBe('wrong-harmony');
      expect(verdict.kind).not.toBe('non-word-stem');

      // The routing decision therefore passes through untouched (no downgrade).
      const decision = approved();
      expect(
        applyDeterministicChecks(decision, content, Language.TR),
      ).toEqual(decision);

      // And the stored answer is the COMPLETE inflected word, not a bare suffix.
      expect(content.correctAnswer).toBe(answer);
    });
  }
});
