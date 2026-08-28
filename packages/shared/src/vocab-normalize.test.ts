import { describe, expect, it } from 'vitest';
import { normalizeWord } from './vocab-normalize';

describe('normalizeWord', () => {
  it('lowercases and trims', () => {
    expect(normalizeWord('  Manzana  ')).toBe('manzana');
  });

  it('strips a leading article on multi-token strings', () => {
    expect(normalizeWord('la manzana')).toBe('manzana');
    expect(normalizeWord('los libros')).toBe('libros');
    expect(normalizeWord('un coche')).toBe('coche');
  });

  it('does NOT strip a single bare token that happens to be an article', () => {
    expect(normalizeWord('la')).toBe('la');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeWord('la   casa')).toBe('casa');
  });

  // Regression: the ARTICLES set was Spanish-only, so a German expectedWord
  // carrying its definite article ("die Schule") normalized to "die schule"
  // and never matched the curated seed lemma "Schule". `vocabSeedMismatch`
  // then rejected an otherwise-clean draft as seed-target-mismatch — 13 times
  // in prod, all German, zero in ES/TR (which is exactly what a Spanish-only
  // article list predicts). See de:a1:vocab_recall:de-a1-vocab-city-transport,
  // stuck 1 target short from 2026-08-17 to 2026-08-28.
  it('strips a leading German article', () => {
    expect(normalizeWord('die Schule')).toBe('schule');
    expect(normalizeWord('der Bahnhof')).toBe('bahnhof');
    expect(normalizeWord('das Auto')).toBe('auto');
    expect(normalizeWord('eine Straße')).toBe('straße');
    expect(normalizeWord('ein Hotel')).toBe('hotel');
  });

  it('matches a German article-form display form against its bare lemma', () => {
    expect(normalizeWord('die Schule')).toBe(normalizeWord('Schule'));
  });

  it('does NOT strip a single bare token that happens to be a German article', () => {
    expect(normalizeWord('die')).toBe('die');
    expect(normalizeWord('das')).toBe('das');
  });
});
