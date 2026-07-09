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

describe('text_generation bucket', () => {
  it('has a free base limit of 20', () => {
    expect(BASE_DAILY_LIMITS.text_generation).toBe(20);
  });

  it('boosts to 10x for boosted plans', () => {
    expect(limitFor('text_generation', 'free')).toBe(20);
    expect(limitFor('text_generation', 'boosted')).toBe(200);
  });
});

describe('writing_helper bucket', () => {
  it('has a free base limit of 50', () => {
    expect(BASE_DAILY_LIMITS.writing_helper).toBe(50);
  });

  it('boosts to 10x for boosted plans', () => {
    expect(limitFor('writing_helper', 'free')).toBe(50);
    expect(limitFor('writing_helper', 'boosted')).toBe(500);
  });
});

describe('read_tts limits', () => {
  it('meters read_tts at 50 free / 500 boosted', () => {
    expect(BASE_DAILY_LIMITS.read_tts).toBe(50);
    expect(limitFor('read_tts', 'free')).toBe(50);
    expect(limitFor('read_tts', 'boosted')).toBe(500);
  });
});
