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

// ---------------------------------------------------------------------------
// variantsForType — per-variant exercise-type scoping (`appliesTo`)
// ---------------------------------------------------------------------------

import { variantsForType } from './construction-variant-seed';

/**
 * The prod defect this scoping exists for (measured 2026-08-25): a variant
 * whose target form has a free, equally-correct alternant in the same slot is
 * unrealizable as a CLOZE — nothing in a blank can force it, so the validator
 * flags every draft `ambiguous`. `es-b2-complex-conditionals` ran 2/29 approved
 * in cloze while the same variant approved 27/27 in translation.
 */
const SCOPED_VARIANTS = [
  { id: 'past-counterfactual-standard', directive: 'standard' },
  {
    id: 'past-counterfactual-hubiera-result',
    directive: 'hubiera result',
    appliesTo: [ExerciseType.TRANSLATION],
  },
];

const SCOPED_POINT = {
  ...POINT,
  constructionVariants: SCOPED_VARIANTS,
} as unknown as GrammarPoint;

describe('variantsForType', () => {
  it('drops a variant whose appliesTo excludes the exercise type', () => {
    expect(variantsForType(SCOPED_POINT, ExerciseType.CLOZE).map((v) => v.id)).toEqual([
      'past-counterfactual-standard',
    ]);
  });

  it('keeps a variant whose appliesTo includes the exercise type', () => {
    expect(variantsForType(SCOPED_POINT, ExerciseType.TRANSLATION).map((v) => v.id)).toEqual([
      'past-counterfactual-standard',
      'past-counterfactual-hubiera-result',
    ]);
  });

  it('keeps an unscoped variant on every variant-seeded type', () => {
    for (const type of [
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
      ExerciseType.SENTENCE_CONSTRUCTION,
    ]) {
      expect(variantsForType(POINT, type).map((v) => v.id)).toEqual(
        VARIANTS.map((v) => v.id),
      );
    }
  });

  it('returns an empty list for a point that declares no variants', () => {
    expect(variantsForType(POINT_NO_VARIANTS, ExerciseType.CLOZE)).toEqual([]);
  });
});

describe('resolveConstructionVariant with appliesTo', () => {
  // Without this the validator would be handed a "requested sub-construction"
  // directive for a variant the generator was never allowed to be asked for.
  it('does not resolve a variant scoped out of the exercise type', () => {
    expect(
      resolveConstructionVariant(
        SCOPED_POINT,
        ExerciseType.CLOZE,
        'past-counterfactual-hubiera-result',
      ),
    ).toBeUndefined();
  });

  it('still resolves that variant on the type it is scoped to', () => {
    expect(
      resolveConstructionVariant(
        SCOPED_POINT,
        ExerciseType.TRANSLATION,
        'past-counterfactual-hubiera-result',
      )?.id,
    ).toBe('past-counterfactual-hubiera-result');
  });
});

// ---------------------------------------------------------------------------
// Per-variant give-up (2026-08-26)
// ---------------------------------------------------------------------------

import { VARIANT_GIVE_UP_MIN_ATTEMPTS, variantsGivenUp } from './construction-variant-seed';

describe('pickVariantSeeds — give-up', () => {
  // The adverse-selection property this exists to break: deficit ranking always
  // targets the LEAST-covered variant, and a variant is least-covered precisely
  // BECAUSE the validator keeps rejecting it. Measured on prod 2026-08-26,
  // de-b2-conditional-connectors/falls-open-condition took 0/7 the night after
  // the variant ahead of it was scoped out, and 0/13 across two nights.
  it('never seeds a given-up variant, however starved it looks', () => {
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([['hearsay', 40], ['adversity', 30], ['doorbell', 30]]),
      count: 8,
      givenUp: new Set(['uno-generic']),
    });
    expect(out).toHaveLength(8);
    expect(out).not.toContain('uno-generic');
  });

  it('still deficit-ranks among the variants that remain', () => {
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([['hearsay', 40], ['doorbell', 2]]),
      count: 6,
      givenUp: new Set(['uno-generic']),
    });
    expect(out).not.toContain('uno-generic');
    expect(out).not.toContain('hearsay');
  });

  // The non-null guarantee outranks give-up: an unseeded slot falls back to
  // free generation, which is the frame collapse the picker exists to remove.
  it('ignores give-up entirely when it would empty the pool', () => {
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map(),
      count: 4,
      givenUp: new Set(VARIANTS.map((v) => v.id)),
    });
    expect(out).toHaveLength(4);
    expect(out.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('is a no-op when no variant is given up', () => {
    const opts = { variants: VARIANTS, coverage: new Map([['hearsay', 5]]), count: 5 };
    expect(pickVariantSeeds({ ...opts, givenUp: new Set() })).toEqual(
      pickVariantSeeds(opts),
    );
  });
});

describe('variantsGivenUp', () => {
  it('gives up a variant with enough attempts and zero approvals', () => {
    const given = variantsGivenUp({
      'falls-open-condition': { requested: VARIANT_GIVE_UP_MIN_ATTEMPTS, approved: 0 },
    });
    expect([...given]).toEqual(['falls-open-condition']);
  });

  it('does not give up on too few attempts — one bad batch must not kill a variant', () => {
    const given = variantsGivenUp({
      a: { requested: VARIANT_GIVE_UP_MIN_ATTEMPTS - 1, approved: 0 },
    });
    expect([...given]).toEqual([]);
  });

  // Until 2026-08-26 ANY nonzero approval protected a variant outright, on the
  // reasoning that a variant which can produce still teaches its construction.
  // That left the merely-poor ones running forever, so a rated rule now applies
  // ABOVE a higher attempt bar. What survives from the old guarantee is the
  // part that mattered: a variant is never retired on a small sample, however
  // bad the sample looks.
  it('does not give up on a nonzero rate until there is enough evidence', () => {
    const given = variantsGivenUp({
      a: { requested: VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS - 1, approved: 1 },
    });
    expect([...given]).toEqual([]);
  });

  it('gives up on a sustained poor rate once the evidence is there', () => {
    expect([...variantsGivenUp({ a: { requested: 30, approved: 1 } })]).toEqual(['a']);
  });

  it('returns an empty set for a null outcome', () => {
    expect([...variantsGivenUp(null)]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Accumulated evidence + ratio give-up
// ---------------------------------------------------------------------------

import {
  mergeVariantOutcomes,
  VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS,
  VARIANT_GIVE_UP_MIN_RATE,
} from './construction-variant-seed';

describe('mergeVariantOutcomes', () => {
  it('sums requested and approved per variant', () => {
    const merged = mergeVariantOutcomes(
      { a: { requested: 3, approved: 1 }, b: { requested: 2, approved: 0 } },
      { a: { requested: 4, approved: 2 }, c: { requested: 1, approved: 1 } },
    );
    expect(merged).toEqual({
      a: { requested: 7, approved: 3 },
      b: { requested: 2, approved: 0 },
      c: { requested: 1, approved: 1 },
    });
  });

  it('treats a null carry-forward as an empty base', () => {
    expect(mergeVariantOutcomes(null, { a: { requested: 1, approved: 1 } })).toEqual({
      a: { requested: 1, approved: 1 },
    });
  });

  it('returns null when there is nothing at all to record', () => {
    expect(mergeVariantOutcomes(null, null)).toBeNull();
  });

  it('does not mutate either input', () => {
    const prev = { a: { requested: 1, approved: 1 } };
    const next = { a: { requested: 1, approved: 0 } };
    mergeVariantOutcomes(prev, next);
    expect(prev).toEqual({ a: { requested: 1, approved: 1 } });
    expect(next).toEqual({ a: { requested: 1, approved: 0 } });
  });
});

describe('variantsGivenUp — poor-yield rule', () => {
  // Why accumulation is load-bearing: measured on the 2026-08-26 prod run, a
  // ratio rule over a SINGLE batch caught 1 variant out of 386, because a
  // variant seldom draws 10+ ordinals in one night once a pool starts filling.
  // Over two nights of accumulated evidence the same rule catches the real
  // cases — perception-verb-infinitive at 1/17, digindan-dolayi-formal at 1/12.
  it('gives up on a variant with enough attempts and a rate below the floor', () => {
    const given = variantsGivenUp({
      'perception-verb-infinitive': {
        requested: VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS,
        approved: 1,
      },
    });
    expect([...given]).toEqual(['perception-verb-infinitive']);
  });

  it('keeps a variant whose rate clears the floor', () => {
    const requested = VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS;
    const approved = Math.ceil(requested * VARIANT_GIVE_UP_MIN_RATE) + 1;
    expect([...variantsGivenUp({ a: { requested, approved } })]).toEqual([]);
  });

  // The rated rule needs MORE evidence than the zero rule, because a nonzero
  // rate is a noisier signal than a flat zero.
  it('needs more attempts than the zero rule before judging a rate', () => {
    expect(VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS).toBeGreaterThan(VARIANT_GIVE_UP_MIN_ATTEMPTS);
    expect([
      ...variantsGivenUp({
        a: { requested: VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS - 1, approved: 1 },
      }),
    ]).toEqual([]);
  });

  it('still applies the zero rule at the lower attempt count', () => {
    expect([
      ...variantsGivenUp({ a: { requested: VARIANT_GIVE_UP_MIN_ATTEMPTS, approved: 0 } }),
    ]).toEqual(['a']);
  });
});
