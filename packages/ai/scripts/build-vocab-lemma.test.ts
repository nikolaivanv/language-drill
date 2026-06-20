import { describe, it, expect } from 'vitest';

import { POS_MAP, joinLemmaPos, type CorpusRow, type WiktRow } from './build-vocab-lemma';

describe('POS_MAP', () => {
  it('maps wiktextract pos to UD upos', () => {
    expect(POS_MAP['verb']).toBe('VERB');
    expect(POS_MAP['noun']).toBe('NOUN');
    expect(POS_MAP['adj']).toBe('ADJ');
    expect(POS_MAP['adv']).toBe('ADV');
  });
});

describe('joinLemmaPos', () => {
  const corpus: CorpusRow[] = [
    { lemma: 'hablar', rank: 50 },
    { lemma: 'hablar', rank: 120 }, // another surface of the same lemma
    { lemma: 'casa', rank: 80 },
    { lemma: 'rareword', rank: 9000 },
  ];
  const wikt: WiktRow[] = [
    { word: 'hablar', pos: 'verb' },
    { word: 'casa', pos: 'noun' },
    { word: 'casa', pos: 'verb' }, // homograph: casa is also a verb form lemma
  ];

  it('dedupes by lemma keeping the lowest rank', () => {
    const rows = joinLemmaPos(corpus, wikt);
    const hablar = rows.find((r) => r.lemma === 'hablar');
    expect(hablar?.rank).toBe(50);
  });

  it('collects all attested PoS into posAll (sorted, deduped)', () => {
    const rows = joinLemmaPos(corpus, wikt);
    const casa = rows.find((r) => r.lemma === 'casa');
    expect(casa?.posAll).toEqual(['NOUN', 'VERB']);
    expect(casa?.source).toBe('wiktextract');
  });

  it('marks unmatched lemmas with empty posAll and source=unmatched', () => {
    const rows = joinLemmaPos(corpus, wikt);
    const rare = rows.find((r) => r.lemma === 'rareword');
    expect(rare?.posAll).toEqual([]);
    expect(rare?.source).toBe('unmatched');
  });

  it('orders output by rank ascending then lemma', () => {
    const rows = joinLemmaPos(corpus, wikt);
    expect(rows.map((r) => r.lemma)).toEqual(['hablar', 'casa', 'rareword']);
  });
});
