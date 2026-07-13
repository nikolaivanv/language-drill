import { describe, it, expect, vi } from 'vitest';
import { resolveWordHints } from './word-hints';

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
