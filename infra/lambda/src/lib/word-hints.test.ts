import { describe, it, expect, vi } from 'vitest';
import { resolveWordHints, evidenceWeightFromHints } from './word-hints';

const UNITS = [{ text: 'water', hintable: true, lemma: 'su' }];

describe('resolveWordHints', () => {
  it('returns cached units without generating, metering, or gating', async () => {
    const generate = vi.fn();
    const meter = vi.fn();
    const writeCache = vi.fn();
    const checkLimit = vi.fn();
    const res = await resolveWordHints({
      readCache: async () => UNITS,
      checkLimit, generate, writeCache, meter,
    });
    expect(res).toEqual({ units: UNITS, cached: true });
    expect(generate).not.toHaveBeenCalled();
    expect(meter).not.toHaveBeenCalled();
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it('on miss: gates, generates, caches, meters', async () => {
    const order: string[] = [];
    const res = await resolveWordHints({
      readCache: async () => null,
      checkLimit: async () => { order.push('gate'); },
      generate: async () => { order.push('gen'); return UNITS; },
      writeCache: async () => { order.push('cache'); },
      meter: async () => { order.push('meter'); },
    });
    expect(res).toEqual({ units: UNITS, cached: false });
    expect(order).toEqual(['gate', 'gen', 'cache', 'meter']);
  });

  it('on empty generation: does NOT cache or meter (allows retry)', async () => {
    const writeCache = vi.fn();
    const meter = vi.fn();
    const res = await resolveWordHints({
      readCache: async () => null,
      checkLimit: async () => {},
      generate: async () => [],
      writeCache, meter,
    });
    expect(res).toEqual({ units: [], cached: false });
    expect(writeCache).not.toHaveBeenCalled();
    expect(meter).not.toHaveBeenCalled();
  });
});

describe('evidenceWeightFromHints', () => {
  it('no hints → 1.0', () => {
    expect(evidenceWeightFromHints(undefined)).toBe(1);
    expect(evidenceWeightFromHints({ wordsRevealed: 0, fullAnswerRevealed: false })).toBe(1);
  });
  it('per word −0.15, floored at 0.4', () => {
    expect(evidenceWeightFromHints({ wordsRevealed: 2, fullAnswerRevealed: false })).toBeCloseTo(0.7);
    expect(evidenceWeightFromHints({ wordsRevealed: 10, fullAnswerRevealed: false })).toBe(0.4);
  });
  it('full-answer reveal overrides to 0.1', () => {
    expect(evidenceWeightFromHints({ wordsRevealed: 1, fullAnswerRevealed: true })).toBe(0.1);
  });
});
