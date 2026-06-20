import { describe, it, expect } from 'vitest';

import { pickConjugationSeeds, pickSeeds } from './seed-picker';

// A fake rank-ordered band; the picker is pure over whatever array it's given.
const BAND = ['hablar', 'comer', 'vivir', 'beber', 'correr', 'saltar', 'mirar'];

describe('pickSeeds', () => {
  const base = { band: BAND, batchSeed: 'cell-abc|2026-05-25', count: 10, exclude: new Set<string>() } as const;

  it('returns exactly `count` slots', () => {
    expect(pickSeeds(base)).toHaveLength(10);
    expect(pickSeeds({ ...base, count: 3 })).toHaveLength(3);
  });

  it('is deterministic for identical options', () => {
    expect(pickSeeds(base)).toEqual(pickSeeds(base));
  });

  it('varies with batchSeed', () => {
    expect(pickSeeds(base)).not.toEqual(pickSeeds({ ...base, batchSeed: 'different' }));
  });

  it('assigns distinct, in-band seeds', () => {
    const seeds = pickSeeds({ ...base, count: 5 }).filter((s): s is string => s !== null);
    expect(new Set(seeds).size).toBe(seeds.length);
    const bandSet = new Set(BAND);
    for (const s of seeds) expect(bandSet.has(s)).toBe(true);
  });

  it('never proposes an excluded lemma', () => {
    const excluded = BAND.slice(0, 3);
    const seeds = pickSeeds({ ...base, exclude: new Set(excluded) });
    for (const ex of excluded) expect(seeds).not.toContain(ex);
  });

  it('honours exclude case-insensitively', () => {
    const seeds = pickSeeds({ ...base, exclude: new Set([BAND[0].toUpperCase()]) });
    expect(seeds).not.toContain(BAND[0]);
  });

  it('returns null once the candidate pool is exhausted', () => {
    const exclude = new Set(BAND.slice(2)); // leave only 2 candidates
    const seeds = pickSeeds({ ...base, count: 5, exclude });
    const nonNull = seeds.filter((s): s is string => s !== null);
    expect(nonNull).toHaveLength(2);
    expect(new Set(nonNull)).toEqual(new Set(BAND.slice(0, 2)));
    expect(seeds).toContain(null);
  });

  it('falls back to all-null when the band is empty', () => {
    expect(pickSeeds({ ...base, band: [], count: 4 })).toEqual([null, null, null, null]);
  });
});

describe('pickConjugationSeeds', () => {
  const base = { band: BAND, batchSeed: 'seed-abc', exclude: new Set<string>() };

  it('assigns a distinct (lemma, person) pair per ordinal and is deterministic', () => {
    const persons = ['1sg', '2sg', '3sg', '1pl', '3pl'];
    const a = pickConjugationSeeds({ ...base, count: 5, persons });
    expect(pickConjugationSeeds({ ...base, count: 5, persons })).toEqual(a);
    const pairs = a.map((lemma, i) => `${lemma}|${persons[i]}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(a.every((l) => typeof l === 'string')).toBe(true);
  });

  it('may reuse the same verb across persons but not within one person', () => {
    const same = pickConjugationSeeds({ ...base, count: 2, persons: ['1sg', '1sg'] });
    expect(same[0]).not.toBe(same[1]);
  });

  it('respects the exclude set of prior (lemma, person) keys', () => {
    const persons = ['1sg'];
    const first = pickConjugationSeeds({ ...base, count: 1, persons })[0]!;
    const next = pickConjugationSeeds({ ...base, count: 1, persons, exclude: new Set([`${first}|1sg`]) })[0];
    expect(next).not.toBe(first);
  });

  it('returns null for ordinals with no person target', () => {
    const out = pickConjugationSeeds({ ...base, count: 2, persons: [null, '3sg'] });
    expect(out[0]).toBeNull();
    expect(typeof out[1]).toBe('string');
  });

  it('falls back to all-null when the band is empty', () => {
    expect(pickConjugationSeeds({ ...base, band: [], count: 2, persons: ['1sg', '2sg'] })).toEqual([null, null]);
  });
});
