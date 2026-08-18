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

  it('keeps ranking by share when every variant has equal absolute coverage', () => {
    // Equal absolute coverage (500 each) is not equal *relative* coverage: at
    // 3/1/1/1 shares, hearsay's fair share of the post-batch pool (1002) still
    // sits far above 500, while the three unweighted variants (334 each) are
    // already past theirs. Every slot goes to the variant furthest below its
    // share — hearsay, all four times — not a round-robin cycle.
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
    expect(out).toEqual(['hearsay', 'hearsay', 'hearsay', 'hearsay']);
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

// ---------------------------------------------------------------------------
// resolveConstructionVariant
// ---------------------------------------------------------------------------

import { ExerciseType } from './index';
import { resolveConstructionVariant } from './construction-variant-seed';
import type { GrammarPoint } from './curriculum-types';

const POINT = {
  key: 'es-b1-impersonal-plural',
  kind: 'grammar',
  name: 'Impersonal plural',
  description: 'd',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['a', 'b'],
  examplesNegative: ['*c'],
  commonErrors: ['e'],
  constructionVariants: VARIANTS,
} as unknown as GrammarPoint;

const POINT_NO_VARIANTS = { ...POINT, constructionVariants: undefined } as GrammarPoint;

describe('resolveConstructionVariant', () => {
  it('resolves a seedWord that is a declared variant id', () => {
    const v = resolveConstructionVariant(POINT, ExerciseType.CLOZE, 'adversity');
    expect(v?.id).toBe('adversity');
    expect(v?.directive).toBe('adversity');
  });

  it('resolves for every exercise type that seeds from the variant pool', () => {
    for (const type of [
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
      ExerciseType.SENTENCE_CONSTRUCTION,
    ]) {
      expect(resolveConstructionVariant(POINT, type, 'hearsay')?.id).toBe('hearsay');
    }
  });

  // The whole safety property: a seed that is an ordinary frequency lemma (or a
  // conjugation verb, or an elicitation value) must resolve to nothing, so the
  // caller renders nothing and the prompt stays byte-identical to today.
  it('returns undefined for a frequency-word seed', () => {
    expect(resolveConstructionVariant(POINT, ExerciseType.CLOZE, 'restaurante')).toBeUndefined();
  });

  it('returns undefined for exercise types that do not seed from the variant pool', () => {
    for (const type of [
      ExerciseType.CONJUGATION,
      ExerciseType.VOCAB_RECALL,
      ExerciseType.DICTATION,
      ExerciseType.FREE_WRITING,
      ExerciseType.CONTEXTUAL_PARAPHRASE,
    ]) {
      expect(resolveConstructionVariant(POINT, type, 'hearsay')).toBeUndefined();
    }
  });

  it('returns undefined when the point declares no variants', () => {
    expect(
      resolveConstructionVariant(POINT_NO_VARIANTS, ExerciseType.CLOZE, 'hearsay'),
    ).toBeUndefined();
  });

  it('returns undefined for null, undefined and empty seedWords', () => {
    expect(resolveConstructionVariant(POINT, ExerciseType.CLOZE, null)).toBeUndefined();
    expect(resolveConstructionVariant(POINT, ExerciseType.CLOZE, undefined)).toBeUndefined();
    expect(resolveConstructionVariant(POINT, ExerciseType.CLOZE, '')).toBeUndefined();
  });

  it('does not match on a prefix or case variation of a variant id', () => {
    expect(resolveConstructionVariant(POINT, ExerciseType.CLOZE, 'hears')).toBeUndefined();
    expect(resolveConstructionVariant(POINT, ExerciseType.CLOZE, 'Hearsay')).toBeUndefined();
  });
});
