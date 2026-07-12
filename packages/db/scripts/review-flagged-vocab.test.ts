import { describe, expect, it } from 'vitest';
import { Language } from '@language-drill/shared';
import { formatFlaggedRow, parseLanguage } from './review-flagged-vocab';

describe('review-flagged-vocab parseLanguage', () => {
  it('defaults to ES', () => {
    expect(parseLanguage([])).toBe(Language.ES);
  });
  it('parses a valid learning language', () => {
    expect(parseLanguage(['--language', 'tr'])).toBe(Language.TR);
  });
  it('rejects EN', () => {
    expect(() => parseLanguage(['--language', 'en'])).toThrow();
  });
});

describe('formatFlaggedRow', () => {
  it('renders a compact review line', () => {
    const line = formatFlaggedRow({
      umbrellaKey: 'es-a1-vocab-food-drink',
      displayForm: 'la manzana',
      lemma: 'manzana',
      gloss: 'apple',
      tier: 'core',
      freqRank: 800,
      exampleSentence: 'Como una manzana.',
    });
    expect(line).toContain('es-a1-vocab-food-drink');
    expect(line).toContain('la manzana');
    expect(line).toContain('manzana');
    expect(line).toContain('apple');
    expect(line).toContain('core');
    expect(line).toContain('800');
    expect(line).toContain('Como una manzana.');
  });

  it('shows rank as n/a when null', () => {
    const line = formatFlaggedRow({
      umbrellaKey: 'es-a1-vocab-food-drink',
      displayForm: 'el zumo',
      lemma: 'zumo',
      gloss: 'juice',
      tier: 'extended',
      freqRank: null,
      exampleSentence: 'Bebo zumo.',
    });
    expect(line).toContain('n/a');
  });
});
