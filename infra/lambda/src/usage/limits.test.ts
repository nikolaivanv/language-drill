import { describe, it, expect } from 'vitest';
import { limitFor, BASE_DAILY_LIMITS, BOOST_MULTIPLIER } from './limits';

describe('limitFor', () => {
  it('returns base limits for the free plan', () => {
    expect(limitFor('ai_evaluation', 'free')).toBe(50);
    expect(limitFor('read_annotation', 'free')).toBe(50);
    expect(limitFor('read_span_annotation', 'free')).toBe(150);
  });

  it('multiplies by 10 for the boosted plan', () => {
    expect(limitFor('ai_evaluation', 'boosted')).toBe(500);
    expect(limitFor('read_annotation', 'boosted')).toBe(500);
    expect(limitFor('read_span_annotation', 'boosted')).toBe(1500);
  });

  it('exposes the base table and multiplier', () => {
    expect(BASE_DAILY_LIMITS.ai_evaluation).toBe(50);
    expect(BOOST_MULTIPLIER).toBe(10);
  });
});
