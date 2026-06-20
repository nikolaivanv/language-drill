import { describe, it, expect } from 'vitest';

import { POS_MAP, joinLemmaPos, applyGapFill, chunk, type CorpusRow, type WiktRow, type VocabLemmaSeedRow } from './build-vocab-lemma';

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

describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('applyGapFill', () => {
  const base: VocabLemmaSeedRow[] = [
    { lemma: 'hablar', rank: 50, posAll: ['VERB'], source: 'wiktextract' },
    { lemma: 'gizlemek', rank: 900, posAll: [], source: 'unmatched' },
    { lemma: 'zzz', rank: 9999, posAll: [], source: 'unmatched' },
  ];

  it('promotes resolved unmatched rows to source=llm with posAll', () => {
    const resolved = new Map<string, string[]>([['gizlemek', ['VERB']]]);
    const out = applyGapFill(base, resolved);
    const g = out.find((r) => r.lemma === 'gizlemek');
    expect(g?.posAll).toEqual(['VERB']);
    expect(g?.source).toBe('llm');
  });

  it('leaves still-unresolved rows untouched', () => {
    const out = applyGapFill(base, new Map());
    expect(out.find((r) => r.lemma === 'zzz')?.source).toBe('unmatched');
  });

  it('never downgrades a wiktextract row', () => {
    const resolved = new Map<string, string[]>([['hablar', ['NOUN']]]);
    const out = applyGapFill(base, resolved);
    const h = out.find((r) => r.lemma === 'hablar');
    expect(h?.source).toBe('wiktextract');
    expect(h?.posAll).toEqual(['VERB']);
  });
});
