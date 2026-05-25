import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import { cefrRankWindow, frequencyBand, loadFrequency } from '@language-drill/ai';

import { pickSeeds } from './seed-picker';

// Real bundled-dictionary band the tests drive `exclude`/exhaustion against.
const ES_B1 = cefrRankWindow(CefrLevel.B1);
const esB1Band = frequencyBand(Language.ES, ES_B1.rankMin, ES_B1.rankMax);

describe('pickSeeds', () => {
  const base = {
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    batchSeed: 'cell-abc|2026-05-25',
    count: 10,
    exclude: new Set<string>(),
  } as const;

  it('returns exactly `count` slots', () => {
    expect(pickSeeds(base)).toHaveLength(10);
    expect(pickSeeds({ ...base, count: 3 })).toHaveLength(3);
  });

  it('is deterministic for identical options (R5.1)', () => {
    expect(pickSeeds(base)).toEqual(pickSeeds(base));
  });

  it('varies with batchSeed — a different cell/batch yields different seeds', () => {
    const a = pickSeeds(base);
    const b = pickSeeds({ ...base, batchSeed: 'a-different-seed' });
    expect(a).not.toEqual(b);
  });

  it('assigns distinct, in-band, non-stopword seeds (R5.1, R5.2)', () => {
    const { isStopword } = loadFrequency(Language.ES);
    const seeds = pickSeeds(base).filter((s): s is string => s !== null);

    // Distinct — no ordinal repeats another ordinal's anchor.
    expect(new Set(seeds).size).toBe(seeds.length);

    // Every seed is a real band lemma and never a closed-class stopword.
    const bandSet = new Set(esB1Band);
    for (const s of seeds) {
      expect(bandSet.has(s)).toBe(true);
      expect(isStopword(s)).toBe(false);
    }
  });

  it('never proposes an excluded (live-pool) lemma (R5.3)', () => {
    const excluded = esB1Band.slice(0, 5);
    const seeds = pickSeeds({ ...base, exclude: new Set(excluded) });
    for (const ex of excluded) {
      expect(seeds).not.toContain(ex);
    }
  });

  it('honours exclude case-insensitively', () => {
    const first = esB1Band[0];
    const seeds = pickSeeds({
      ...base,
      exclude: new Set([first.toUpperCase()]),
    });
    expect(seeds).not.toContain(first);
  });

  it('returns null for ordinals once the candidate pool is exhausted (R5.6)', () => {
    // Exclude all but the first two band lemmas, then request five seeds:
    // exactly two ordinals can be satisfied, the rest fall back to null.
    const exclude = new Set(esB1Band.slice(2));
    const seeds = pickSeeds({ ...base, count: 5, exclude });

    const nonNull = seeds.filter((s): s is string => s !== null);
    expect(nonNull).toHaveLength(2);
    expect(new Set(nonNull)).toEqual(new Set(esB1Band.slice(0, 2)));
    expect(seeds).toContain(null);
  });

  it('falls back to all-null when the band is empty for the window (R5.6)', () => {
    // TR has no words ranked >= 10000, so the C1 window (10000–20000) is empty.
    const window = cefrRankWindow(CefrLevel.C1);
    const emptyBand = frequencyBand(Language.TR, window.rankMin, window.rankMax);
    expect(emptyBand).toHaveLength(0); // precondition for this test's validity

    const seeds = pickSeeds({
      language: Language.TR,
      cefrLevel: CefrLevel.C1,
      batchSeed: 'x',
      count: 4,
      exclude: new Set<string>(),
    });
    expect(seeds).toEqual([null, null, null, null]);
  });
});
