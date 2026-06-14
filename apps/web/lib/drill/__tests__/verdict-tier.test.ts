import { describe, it, expect } from 'vitest';
import type { EvaluationError } from '@language-drill/shared';
import {
  clozeVerdict,
  dictationVerdict,
  translationVerdict,
  vocabVerdict,
  type VerdictTier,
} from '../verdict-tier';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarError: EvaluationError = {
  type: 'grammar',
  severity: 'minor',
  text: 'x',
  correction: 'y',
  explanation: 'z',
};

const spellingError: EvaluationError = {
  type: 'spelling',
  severity: 'minor',
  text: 'x',
  correction: 'y',
  explanation: 'z',
};

const vocabularyError: EvaluationError = {
  type: 'vocabulary',
  severity: 'minor',
  text: 'x',
  correction: 'y',
  explanation: 'z',
};

// ---------------------------------------------------------------------------
// clozeVerdict
// ---------------------------------------------------------------------------

describe('clozeVerdict', () => {
  type Case = { score: number; tier: VerdictTier; label: string };

  const cases: Case[] = [
    { score: 0.0, tier: 'terracotta', label: 'wrong' },
    { score: 0.4, tier: 'yellow', label: 'off — see why' },
    { score: 0.6, tier: 'yellow', label: 'off — see why' },
    { score: 0.7, tier: 'yellow', label: 'close' },
    { score: 0.95, tier: 'sage', label: 'spot on' },
    { score: 1.0, tier: 'sage', label: 'spot on' },
  ];

  it.each(cases)('score $score → tier $tier', ({ score, tier }) => {
    expect(clozeVerdict(score).tier).toBe(tier);
  });

  it.each(cases)('score $score → label "$label"', ({ score, label }) => {
    expect(clozeVerdict(score).label).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// translationVerdict
// ---------------------------------------------------------------------------

describe('translationVerdict', () => {
  type Case = { score: number; tier: VerdictTier; label: string };

  const cases: Case[] = [
    { score: 0.0, tier: 'terracotta', label: 'not quite' },
    { score: 0.4, tier: 'yellow', label: 'gist is there · grammar drifted' },
    { score: 0.6, tier: 'yellow', label: 'gist is there · grammar drifted' },
    { score: 0.7, tier: 'yellow', label: 'meaning is right · small issues' },
    { score: 0.95, tier: 'sage', label: 'spot on' },
    { score: 1.0, tier: 'sage', label: 'spot on' },
  ];

  it.each(cases)('score $score → tier $tier', ({ score, tier }) => {
    expect(translationVerdict(score).tier).toBe(tier);
  });

  it.each(cases)('score $score → label "$label"', ({ score, label }) => {
    expect(translationVerdict(score).label).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// dictationVerdict — score-only bands (sage / yellow×2 / terracotta)
// ---------------------------------------------------------------------------

describe('dictationVerdict', () => {
  type Case = { score: number; tier: VerdictTier; label: string };

  const cases: Case[] = [
    { score: 0.0, tier: 'terracotta', label: "hard clip · let's slow down" },
    { score: 0.3, tier: 'terracotta', label: "hard clip · let's slow down" },
    { score: 0.4, tier: 'yellow', label: 'the gist · boundaries slipped' },
    { score: 0.6, tier: 'yellow', label: 'the gist · boundaries slipped' },
    { score: 0.7, tier: 'yellow', label: 'close · a few you missed' },
    { score: 0.8, tier: 'yellow', label: 'close · a few you missed' },
    { score: 0.95, tier: 'sage', label: 'oído fino' },
    { score: 1.0, tier: 'sage', label: 'oído fino' },
  ];

  it.each(cases)('score $score → tier $tier', ({ score, tier }) => {
    expect(dictationVerdict(score).tier).toBe(tier);
  });

  it.each(cases)('score $score → label "$label"', ({ score, label }) => {
    expect(dictationVerdict(score).label).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// vocabVerdict — table over edge values × all 5 precedence rules
// ---------------------------------------------------------------------------

describe('vocabVerdict', () => {
  type Case = {
    name: string;
    score: number;
    errors: EvaluationError[];
    tier: VerdictTier;
    label: string;
  };

  // Edge values across the score axis (no errors) — covers rules 1, 4, 5.
  const edgeValueCases: Case[] = [
    {
      name: '0.0 with no errors → wrong (rule 5)',
      score: 0.0,
      errors: [],
      tier: 'terracotta',
      label: 'wrong',
    },
    {
      name: '0.4 with no errors → wrong (rule 5, below 0.6 band)',
      score: 0.4,
      errors: [],
      tier: 'terracotta',
      label: 'wrong',
    },
    {
      name: '0.6 with no errors → close (rule 4, lower boundary of yellow band)',
      score: 0.6,
      errors: [],
      tier: 'yellow',
      label: 'close',
    },
    {
      name: '0.7 with no errors → close (rule 4, fallback inside yellow band)',
      score: 0.7,
      errors: [],
      tier: 'yellow',
      label: 'close',
    },
    {
      name: '0.95 with no errors → close (rule 4, just below 1.0)',
      score: 0.95,
      errors: [],
      tier: 'yellow',
      label: 'close',
    },
    {
      name: '1.0 with no errors → exact (rule 1)',
      score: 1.0,
      errors: [],
      tier: 'sage',
      label: 'exact',
    },
  ];

  // Rule 2: grammar error in [0.7, 1.0)
  const grammarCases: Case[] = [
    {
      name: '0.7 with grammar error → right word · wrong inflection (rule 2, lower boundary)',
      score: 0.7,
      errors: [grammarError],
      tier: 'yellow',
      label: 'right word · wrong inflection',
    },
    {
      name: '0.95 with grammar error → right word · wrong inflection (rule 2)',
      score: 0.95,
      errors: [grammarError],
      tier: 'yellow',
      label: 'right word · wrong inflection',
    },
  ];

  // Rule 3: spelling error (no grammar) in [0.6, 1.0)
  const spellingCases: Case[] = [
    {
      name: '0.6 with only spelling error → spelling slipped (rule 3, lower boundary)',
      score: 0.6,
      errors: [spellingError],
      tier: 'yellow',
      label: 'spelling slipped',
    },
    {
      name: '0.95 with only spelling error → spelling slipped (rule 3)',
      score: 0.95,
      errors: [spellingError],
      tier: 'yellow',
      label: 'spelling slipped',
    },
  ];

  // Rule precedence: grammar wins over spelling when both present
  const grammarBeatsSpellingCases: Case[] = [
    {
      name: '0.85 with grammar + spelling → right word · wrong inflection (rule 2 beats rule 3)',
      score: 0.85,
      errors: [grammarError, spellingError],
      tier: 'yellow',
      label: 'right word · wrong inflection',
    },
    {
      name: '0.7 with grammar + spelling → right word · wrong inflection (rule 2 beats rule 3 at boundary)',
      score: 0.7,
      errors: [grammarError, spellingError],
      tier: 'yellow',
      label: 'right word · wrong inflection',
    },
  ];

  // Rule 1 wins over everything: 1.0 with errors → still "exact"
  const exactWinsCases: Case[] = [
    {
      name: '1.0 with grammar + spelling → exact (rule 1 wins)',
      score: 1.0,
      errors: [grammarError, spellingError],
      tier: 'sage',
      label: 'exact',
    },
    {
      name: '1.0 with only grammar error → exact (rule 1 wins over rule 2)',
      score: 1.0,
      errors: [grammarError],
      tier: 'sage',
      label: 'exact',
    },
    {
      name: '1.0 with only spelling error → exact (rule 1 wins over rule 3)',
      score: 1.0,
      errors: [spellingError],
      tier: 'sage',
      label: 'exact',
    },
  ];

  // Edge: spelling-only error below 0.6 → wrong (rule 5 still wins)
  const belowBandCases: Case[] = [
    {
      name: '0.4 with grammar error → wrong (below band, rule 5)',
      score: 0.4,
      errors: [grammarError],
      tier: 'terracotta',
      label: 'wrong',
    },
    {
      name: '0.4 with spelling error → wrong (below band, rule 5)',
      score: 0.4,
      errors: [spellingError],
      tier: 'terracotta',
      label: 'wrong',
    },
  ];

  // Edge: 0.6 with grammar (below rule-2 band of 0.7) → close (rule 4)
  const grammarBelowRuleTwoCases: Case[] = [
    {
      name: '0.6 with grammar error → close (below 0.7 grammar band, falls to rule 4)',
      score: 0.6,
      errors: [grammarError],
      tier: 'yellow',
      label: 'close',
    },
  ];

  // Vocabulary-only errors should not trigger rules 2 or 3
  const otherErrorTypeCases: Case[] = [
    {
      name: '0.85 with only vocabulary error → close (no grammar, no spelling, rule 4)',
      score: 0.85,
      errors: [vocabularyError],
      tier: 'yellow',
      label: 'close',
    },
  ];

  const allCases: Case[] = [
    ...edgeValueCases,
    ...grammarCases,
    ...spellingCases,
    ...grammarBeatsSpellingCases,
    ...exactWinsCases,
    ...belowBandCases,
    ...grammarBelowRuleTwoCases,
    ...otherErrorTypeCases,
  ];

  it.each(allCases)('$name (tier)', ({ score, errors, tier }) => {
    expect(vocabVerdict(score, errors).tier).toBe(tier);
  });

  it.each(allCases)('$name (label)', ({ score, errors, label }) => {
    expect(vocabVerdict(score, errors).label).toBe(label);
  });
});
