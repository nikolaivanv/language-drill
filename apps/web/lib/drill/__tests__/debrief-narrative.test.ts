import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import type { AccuracyTier } from '../accuracy-tier';
import { debriefNarrative, type NarrativeInput } from '../debrief-narrative';

// Default input — overridden per test.
function makeInput(overrides: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    tier: 'mid',
    language: Language.ES,
    exerciseCount: 5,
    correctCount: 3,
    attemptedCount: 5,
    skippedCount: 0,
    ...overrides,
  };
}

describe('debriefNarrative — what\'s-next routing (Req 4.4)', () => {
  it('high tier links to /progress', () => {
    const result = debriefNarrative(makeInput({ tier: 'high', correctCount: 5 }));
    expect(result.whatsNextHref).toBe('/progress');
    expect(result.whatsNextLabel).toBe('see what moved →');
  });

  it('mid tier links to /drill', () => {
    const result = debriefNarrative(makeInput({ tier: 'mid' }));
    expect(result.whatsNextHref).toBe('/drill?start=quick');
    expect(result.whatsNextLabel).toBe('another short session →');
  });

  it('low tier links to /drill', () => {
    const result = debriefNarrative(makeInput({ tier: 'low', correctCount: 1 }));
    expect(result.whatsNextHref).toBe('/drill?start=quick');
    expect(result.whatsNextLabel).toBe('another short session →');
  });
});

describe('debriefNarrative — language name in paragraphs (Req 4.3)', () => {
  type Case = { language: Language; expected: string };

  const cases: Case[] = [
    { language: Language.ES, expected: 'spanish' },
    { language: Language.DE, expected: 'german' },
    { language: Language.TR, expected: 'turkish' },
    { language: Language.EN, expected: 'english' },
  ];

  it.each(cases)(
    '$language → paragraphs reference "$expected"',
    ({ language, expected }) => {
      const result = debriefNarrative(makeInput({ language }));
      const joined = result.paragraphs.join(' ');
      expect(joined.toLowerCase()).toContain(expected);
    },
  );
});

describe('debriefNarrative — count of items practiced (Req 4.3)', () => {
  it('high tier paragraphs include "X of Y stuck"', () => {
    const result = debriefNarrative(
      makeInput({ tier: 'high', correctCount: 8, attemptedCount: 10 }),
    );
    expect(result.paragraphs.join(' ')).toContain('8 of 10 stuck');
  });

  it('mid tier paragraphs include "X of Y stuck"', () => {
    const result = debriefNarrative(
      makeInput({ tier: 'mid', correctCount: 6, attemptedCount: 10 }),
    );
    expect(result.paragraphs.join(' ')).toContain('6 of 10 stuck');
  });

  it('low tier paragraphs include "X of Y stuck"', () => {
    const result = debriefNarrative(
      makeInput({ tier: 'low', correctCount: 1, attemptedCount: 5 }),
    );
    expect(result.paragraphs.join(' ')).toContain('1 of 5 stuck');
  });
});

describe('debriefNarrative — all-skipped fallback', () => {
  it('attemptedCount === 0 returns low-tier-shaped narrative (no "X of Y stuck")', () => {
    const result = debriefNarrative(
      makeInput({
        tier: 'low',
        correctCount: 0,
        attemptedCount: 0,
        skippedCount: 5,
        exerciseCount: 5,
      }),
    );
    // Should NOT contain the "0 of 0 stuck" awkward phrasing
    expect(result.paragraphs.join(' ')).not.toContain('0 of 0 stuck');
    // Should mention the language and the session size
    expect(result.paragraphs.join(' ')).toContain('spanish');
    expect(result.paragraphs.join(' ')).toContain('5');
  });

  it('attemptedCount === 0 still routes to /drill', () => {
    const result = debriefNarrative(
      makeInput({
        tier: 'low',
        correctCount: 0,
        attemptedCount: 0,
        skippedCount: 5,
      }),
    );
    expect(result.whatsNextHref).toBe('/drill?start=quick');
  });

  it('attemptedCount === 0 returns 1–2 paragraphs', () => {
    const result = debriefNarrative(
      makeInput({
        tier: 'low',
        correctCount: 0,
        attemptedCount: 0,
        skippedCount: 5,
      }),
    );
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(result.paragraphs.length).toBeLessThanOrEqual(2);
  });
});

describe('debriefNarrative — paragraph shape', () => {
  const tiers: AccuracyTier[] = ['high', 'mid', 'low'];

  it.each(tiers)('%s tier returns 1–2 paragraphs', (tier) => {
    const result = debriefNarrative(
      makeInput({
        tier,
        correctCount: tier === 'high' ? 5 : tier === 'mid' ? 3 : 1,
      }),
    );
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(result.paragraphs.length).toBeLessThanOrEqual(2);
  });

  it.each(tiers)('%s tier paragraphs are non-empty strings', (tier) => {
    const result = debriefNarrative(makeInput({ tier }));
    for (const p of result.paragraphs) {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });
});

describe('debriefNarrative — copy is lowercase (Req 3.7 / 4.2)', () => {
  // The narrative copy lives in the DebriefTab speech bubble where mixed-case
  // would be acceptable per the prototype, but our copy choice is all-lowercase
  // for consistency with the rest of Phase F. We also allow digits, punctuation,
  // and arrows. Letters must be lowercase.
  type Case = { tier: AccuracyTier; correct: number; attempted: number };

  const cases: Case[] = [
    { tier: 'high', correct: 5, attempted: 5 },
    { tier: 'mid', correct: 3, attempted: 5 },
    { tier: 'low', correct: 1, attempted: 5 },
    { tier: 'low', correct: 0, attempted: 0 }, // all-skipped fallback
  ];

  it.each(cases)(
    'tier=$tier correct=$correct attempted=$attempted → letters all lowercase',
    ({ tier, correct, attempted }) => {
      const result = debriefNarrative(
        makeInput({
          tier,
          correctCount: correct,
          attemptedCount: attempted,
          skippedCount: Math.max(0, 5 - attempted),
        }),
      );
      const joined = result.paragraphs.join(' ');
      // All letter characters must be lowercase
      const letters = joined.match(/[a-z]/gi) ?? [];
      for (const ch of letters) {
        expect(ch).toBe(ch.toLowerCase());
      }
    },
  );

  it('what\'s-next label is lowercase', () => {
    for (const tier of ['high', 'mid', 'low'] as const) {
      const result = debriefNarrative(makeInput({ tier }));
      const letters = result.whatsNextLabel.match(/[a-z]/gi) ?? [];
      for (const ch of letters) {
        expect(ch).toBe(ch.toLowerCase());
      }
    }
  });
});
