import { describe, it, expect } from 'vitest';
import { accuracyTier, TIER_TITLE, type AccuracyTier } from '../accuracy-tier';

describe('accuracyTier', () => {
  type Case = {
    name: string;
    correct: number;
    attempted: number;
    tier: AccuracyTier;
  };

  // Boundary table — covers the explicit task examples plus the just-above /
  // just-below cases on each tier boundary (0.5 and 0.8).
  const cases: Case[] = [
    // attemptedCount === 0 → low (all-skipped fallback)
    { name: '0 of 0 → low (no attempts)', correct: 0, attempted: 0, tier: 'low' },
    { name: '5 of 0 → low (degenerate, no attempts)', correct: 5, attempted: 0, tier: 'low' },

    // attemptedCount < 0 → low (defensive — must not throw)
    { name: '0 of -1 → low (negative attempted, defensive)', correct: 0, attempted: -1, tier: 'low' },
    { name: '5 of -3 → low (negative attempted, defensive)', correct: 5, attempted: -3, tier: 'low' },

    // High tier (≥ 0.8)
    { name: '8 of 10 → high (lower boundary)', correct: 8, attempted: 10, tier: 'high' },
    { name: '10 of 10 → high (perfect)', correct: 10, attempted: 10, tier: 'high' },
    { name: '9 of 10 → high', correct: 9, attempted: 10, tier: 'high' },
    { name: '4 of 5 → high (0.8 exact via different denominator)', correct: 4, attempted: 5, tier: 'high' },

    // Just below 0.8 → mid
    { name: '79 of 100 → mid (just below 0.8)', correct: 79, attempted: 100, tier: 'mid' },
    { name: '7 of 10 → mid', correct: 7, attempted: 10, tier: 'mid' },

    // Mid tier (≥ 0.5, < 0.8)
    { name: '5 of 10 → mid (0.5 lower boundary)', correct: 5, attempted: 10, tier: 'mid' },
    { name: '6 of 10 → mid', correct: 6, attempted: 10, tier: 'mid' },
    { name: '50 of 100 → mid (0.5 exact)', correct: 50, attempted: 100, tier: 'mid' },

    // Just below 0.5 → low
    { name: '49 of 100 → low (just below 0.5)', correct: 49, attempted: 100, tier: 'low' },
    { name: '4 of 10 → low', correct: 4, attempted: 10, tier: 'low' },

    // Low tier (< 0.5)
    { name: '0 of 5 → low', correct: 0, attempted: 5, tier: 'low' },
    { name: '1 of 5 → low (0.2)', correct: 1, attempted: 5, tier: 'low' },
    { name: '2 of 10 → low', correct: 2, attempted: 10, tier: 'low' },

    // Negative correct (defensive — ratio goes negative, must fall into low without throwing)
    { name: '-1 of 5 → low (negative correct, defensive)', correct: -1, attempted: 5, tier: 'low' },
  ];

  it.each(cases)('$name', ({ correct, attempted, tier }) => {
    expect(accuracyTier(correct, attempted)).toBe(tier);
  });

  it('does not throw on attemptedCount === 0', () => {
    expect(() => accuracyTier(0, 0)).not.toThrow();
    expect(() => accuracyTier(5, 0)).not.toThrow();
  });

  it('does not throw on negative attemptedCount', () => {
    expect(() => accuracyTier(0, -1)).not.toThrow();
    expect(() => accuracyTier(5, -10)).not.toThrow();
  });
});

describe('TIER_TITLE', () => {
  it('maps each tier to the exact lowercase title from the design system', () => {
    expect(TIER_TITLE.high).toBe('nice work.');
    expect(TIER_TITLE.mid).toBe('good attempt.');
    expect(TIER_TITLE.low).toBe('back next time?');
  });

  it('uses lowercase for every title (Req 3.7)', () => {
    for (const title of Object.values(TIER_TITLE)) {
      expect(title).toBe(title.toLowerCase());
    }
  });
});
