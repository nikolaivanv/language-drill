import { describe, expect, it } from 'vitest';

import { pickVariantSeeds } from './construction-variant-seed';

const VARIANTS = [
  { id: 'hearsay', directive: 'hearsay', share: 3 },
  { id: 'adversity', directive: 'adversity' },
  { id: 'doorbell', directive: 'doorbell' },
  { id: 'uno-generic', directive: 'uno' },
];

describe('pickVariantSeeds', () => {
  it('returns exactly `count` slots and never null', () => {
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map(),
      count: 6,
    });
    expect(out).toHaveLength(6);
    expect(out.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('starves the over-covered variant and fills the empty ones first', () => {
    // The live pool is the observed prod collapse: 43 hearsay, nothing else.
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([['hearsay', 43]]),
      count: 6,
    });
    expect(out).not.toContain('hearsay');
    expect(new Set(out)).toEqual(new Set(['adversity', 'doorbell', 'uno-generic']));
  });

  it('honours share when nothing is covered yet', () => {
    // shares 3/1/1/1 over 12 slots → hearsay 6, others 2 each.
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map(),
      count: 12,
    });
    const counts = out.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts['hearsay']).toBe(6);
    expect(counts['adversity']).toBe(2);
    expect(counts['doorbell']).toBe(2);
    expect(counts['uno-generic']).toBe(2);
  });

  it('keeps cycling in share order when every variant is over quota', () => {
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([
        ['hearsay', 500],
        ['adversity', 500],
        ['doorbell', 500],
        ['uno-generic', 500],
      ]),
      count: 4,
    });
    expect(out).toHaveLength(4);
    expect(out.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('ignores coverage keys that are not declared variants (legacy seedWords)', () => {
    // Legacy rows carry a frequency word in seedWord, never a variant id.
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([['restaurante', 40], ['iglesia', 12]]),
      count: 4,
    });
    expect(new Set(out).size).toBeGreaterThan(1);
  });

  it('is deterministic for identical inputs', () => {
    const opts = { variants: VARIANTS, coverage: new Map([['hearsay', 5]]), count: 7 };
    expect(pickVariantSeeds(opts)).toEqual(pickVariantSeeds(opts));
  });

  it('returns an empty array for count 0', () => {
    expect(pickVariantSeeds({ variants: VARIANTS, coverage: new Map(), count: 0 })).toEqual([]);
  });
});
