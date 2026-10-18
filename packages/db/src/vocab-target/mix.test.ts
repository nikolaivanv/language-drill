import { describe, expect, it } from 'vitest';
import { countPos, emptyPosCounts, fitToMix, mixShortfall, planFillMixRequest } from './mix';

const w = (pos: 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase', i: number) => ({ pos, lemma: `${pos}${i}` });

describe('countPos', () => {
  it('counts by class and skips nulls', () => {
    const c = countPos([{ pos: 'noun' }, { pos: 'verb' }, { pos: null }, { pos: 'noun' }]);
    expect(c.noun).toBe(2);
    expect(c.verb).toBe(1);
    expect(c.adjective).toBe(0);
  });
});

describe('mixShortfall', () => {
  it('reports missing verbs and adjectives/adverbs against the total', () => {
    const c = { ...emptyPosCounts(), noun: 26, verb: 2, adjective: 2 };
    // total 30 → need ceil(6)=6 verbs, ceil(4.5)=5 adj/adv
    expect(mixShortfall(c, 30)).toEqual({ verb: 4, adjectiveOrAdverb: 3 });
  });

  it('does not over-ask on exact shares (0.2 × 30 is 6, not 7)', () => {
    const c = { ...emptyPosCounts(), noun: 24, verb: 6 };
    expect(mixShortfall(c, 30).verb).toBe(0);
  });

  it('is zero when the mix is met', () => {
    const c = { ...emptyPosCounts(), noun: 15, verb: 8, adjective: 4, adverb: 3 };
    expect(mixShortfall(c, 30)).toEqual({ verb: 0, adjectiveOrAdverb: 0 });
  });
});

describe('fitToMix', () => {
  it('drops surplus nouns from the end so nouns stay at or under 60%', () => {
    const batch = [
      ...Array.from({ length: 20 }, (_, i) => w('noun', i)),
      ...Array.from({ length: 6 }, (_, i) => w('verb', i)),
      ...Array.from({ length: 4 }, (_, i) => w('adjective', i)),
    ];
    const kept = fitToMix(emptyPosCounts(), batch);
    const nouns = kept.filter((k) => k.pos === 'noun');
    // non-nouns 10 → nouns ≤ floor(1.5 × 10) = 15; the first 15 are kept (priority order)
    expect(nouns).toHaveLength(15);
    expect(nouns.at(-1)?.lemma).toBe('noun14');
    expect(kept.filter((k) => k.pos !== 'noun')).toHaveLength(10);
  });

  it('counts existing rows toward the quota', () => {
    const existing = { ...emptyPosCounts(), noun: 25, verb: 2 };
    const kept = fitToMix(existing, [w('noun', 0), w('verb', 0), w('verb', 1)]);
    // non-nouns 4 → nouns ≤ 6 overall; 25 already → no new noun fits
    expect(kept.map((k) => k.pos)).toEqual(['verb', 'verb']);
  });

  it('keeps phrases at or under 10% after nouns are trimmed', () => {
    const batch = [
      ...Array.from({ length: 20 }, (_, i) => w('noun', i)),
      ...Array.from({ length: 5 }, (_, i) => w('verb', i)),
      ...Array.from({ length: 5 }, (_, i) => w('phrase', i)),
    ];
    const kept = fitToMix(emptyPosCounts(), batch);
    const n = (p: string) => kept.filter((k) => k.pos === p).length;
    expect(n('phrase')).toBeLessThanOrEqual(Math.floor(0.1 * kept.length));
    expect(n('noun')).toBeLessThanOrEqual(Math.floor(0.6 * kept.length));
    expect(n('verb')).toBe(5);
  });

  it('caps phrases at 10% of the resulting total', () => {
    const batch = [
      ...Array.from({ length: 10 }, (_, i) => w('verb', i)),
      ...Array.from({ length: 5 }, (_, i) => w('phrase', i)),
    ];
    const kept = fitToMix(emptyPosCounts(), batch);
    expect(kept.filter((k) => k.pos === 'phrase')).toHaveLength(1); // floor(0.1 × 15)
  });
});

describe('planFillMixRequest', () => {
  it('covers the shortfall and splits the remaining growth 60/40 verbs/adj-adv', () => {
    const existing = { ...emptyPosCounts(), noun: 26, verb: 2, adjective: 2 };
    // target total 42 → need ceil(8.4)=9 verbs (7 short), ceil(6.3)=7 adj/adv (5 short)
    expect(planFillMixRequest(existing, 12)).toEqual({ verb: 7, adjectiveOrAdverb: 5 });
  });

  it('re-measures against the grown total so the verb quota holds', () => {
    const existing = { ...emptyPosCounts(), noun: 30 };
    const req = planFillMixRequest(existing, 12);
    const finalTotal = 30 + req.verb + req.adjectiveOrAdverb;
    expect(req.verb).toBeGreaterThanOrEqual(Math.ceil(0.2 * finalTotal - 1e-9));
    expect(req.adjectiveOrAdverb).toBeGreaterThanOrEqual(Math.ceil(0.15 * finalTotal - 1e-9));
    expect(req).toEqual({ verb: 10, adjectiveOrAdverb: 8 });
  });

  it('never asks for less than the growth', () => {
    const existing = { ...emptyPosCounts(), noun: 10, verb: 10, adjective: 10 };
    const req = planFillMixRequest(existing, 12);
    expect(req.verb + req.adjectiveOrAdverb).toBe(12);
    expect(req.verb).toBe(7); // round(12 × 0.6)
  });
});
