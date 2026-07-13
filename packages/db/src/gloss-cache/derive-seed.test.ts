import { describe, it, expect } from 'vitest';
import type { DeepCard } from '@language-drill/shared';
import { deriveSeedRows, type SeedVocabRow } from './derive-seed';

const row = (o: Partial<SeedVocabRow>): SeedVocabRow => ({
  language: 'es', lemma: 'banco', gloss: 'bench', pos: 'noun',
  cefrBand: 'B1', frequencyRank: 4200, card: null, addedAt: new Date(0), ...o,
});

/** Minimal valid word card fixture; only `baseGloss` varies across tests. */
const wordCard = (baseGloss?: string): DeepCard => ({
  type: 'word',
  surface: 'banco',
  lemma: 'banco',
  pos: 'noun',
  contextualSense: 'financial institution',
  definition: 'a place that holds money',
  definitionLabel: 'noun',
  cefr: 'B1',
  freq: 4200,
  ...(baseGloss !== undefined ? { baseGloss } : {}),
});

describe('deriveSeedRows', () => {
  it('uses gloss for skim rows (card null)', () => {
    expect(deriveSeedRows([row({})])).toEqual([
      { language: 'es', lemma: 'banco', baseGloss: 'bench', pos: 'noun', cefr: 'B1', freqRank: 4200, source: 'seed', promptVersion: null },
    ]);
  });

  it('prefers card.baseGloss over gloss for deep rows', () => {
    const deep = row({ gloss: 'financial institution', card: wordCard('bench; bank') });
    expect(deriveSeedRows([deep])[0].baseGloss).toBe('bench; bank');
  });

  it('skips phrase rows, empty base gloss, and null cefr', () => {
    expect(deriveSeedRows([row({ pos: 'phrase' })])).toEqual([]);
    expect(deriveSeedRows([row({ gloss: '   ', card: null })])).toEqual([]);
    expect(deriveSeedRows([row({ cefrBand: null })])).toEqual([]);
    // deep row whose card predates baseGloss falls back to gloss only when card is null;
    // here card is present but baseGloss missing → contextual gloss must NOT leak in:
    expect(deriveSeedRows([row({ gloss: 'contextual', card: wordCard() })])).toEqual([]);
  });

  it('dedupes per (language, lemma): deep-source and most-recent win', () => {
    const skimOld = row({ gloss: 'bench', card: null, addedAt: new Date(1) });
    const deepNew = row({ gloss: 'ctx', card: wordCard('bench; bank'), addedAt: new Date(2) });
    const out = deriveSeedRows([skimOld, deepNew]);
    expect(out).toHaveLength(1);
    expect(out[0].baseGloss).toBe('bench; bank');
  });
});
