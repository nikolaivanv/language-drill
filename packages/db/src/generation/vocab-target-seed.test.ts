import { describe, expect, it } from 'vitest';
import { computeUncoveredTargetBand, pickTargetSeeds } from './vocab-target-seed';

describe('computeUncoveredTargetBand', () => {
  const targets = [
    { lemma: 'manzana', displayForm: 'la manzana' },
    { lemma: 'pan', displayForm: 'el pan' },
    { lemma: 'agua', displayForm: 'el agua' },
  ];

  it('drops targets whose lemma is covered', () => {
    const covered = new Set(['manzana']); // already normalized surfaces
    expect(computeUncoveredTargetBand(targets, covered)).toEqual(['pan', 'agua']);
  });

  it('drops targets whose displayForm (article-stripped) is covered', () => {
    // "el pan" normalizes to "pan"; a covered "pan" must exclude it.
    const covered = new Set(['pan']);
    expect(computeUncoveredTargetBand(targets, covered)).toEqual(['manzana', 'agua']);
  });

  it('preserves input (priority) order', () => {
    expect(computeUncoveredTargetBand(targets, new Set())).toEqual(['manzana', 'pan', 'agua']);
  });
});

describe('pickTargetSeeds', () => {
  const band = ['manzana', 'pan', 'agua', 'leche'];

  it('assigns band entries to ordinals in order', () => {
    expect(pickTargetSeeds({ band, count: 3, exclude: new Set() })).toEqual([
      'manzana',
      'pan',
      'agua',
    ]);
  });

  it('returns exactly `count` slots, padding with null when the band is short', () => {
    expect(pickTargetSeeds({ band: ['manzana'], count: 3, exclude: new Set() })).toEqual([
      'manzana',
      null,
      null,
    ]);
  });

  it('skips excluded seeds case-insensitively', () => {
    expect(pickTargetSeeds({ band, count: 2, exclude: new Set(['MANZANA']) })).toEqual([
      'pan',
      'agua',
    ]);
  });

  it('is deterministic', () => {
    const a = pickTargetSeeds({ band, count: 4, exclude: new Set() });
    const b = pickTargetSeeds({ band, count: 4, exclude: new Set() });
    expect(a).toEqual(b);
  });
});
