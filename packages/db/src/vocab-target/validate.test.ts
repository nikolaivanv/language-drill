import { describe, expect, it } from 'vitest';
import { deriveTier, validateProposedWord } from './validate';

describe('validateProposedWord', () => {
  it('accepts a well-formed word', () => {
    expect(
      validateProposedWord({
        displayForm: 'la manzana',
        lemma: 'manzana',
        gloss: 'apple',
        exampleSentence: 'Como una manzana roja.',
      }),
    ).toEqual({
      displayForm: 'la manzana',
      lemma: 'manzana',
      gloss: 'apple',
      exampleSentence: 'Como una manzana roja.',
    });
  });

  it('rejects a multi-token lemma', () => {
    expect(
      validateProposedWord({
        displayForm: 'buenos días',
        lemma: 'buenos días',
        gloss: 'good morning',
        exampleSentence: 'Buenos días a todos.',
      }),
    ).toBeNull();
  });

  it('rejects when the example omits the word', () => {
    expect(
      validateProposedWord({
        displayForm: 'la manzana',
        lemma: 'manzana',
        gloss: 'apple',
        exampleSentence: 'Como una pera.',
      }),
    ).toBeNull();
  });

  it('rejects missing/empty fields and non-objects', () => {
    expect(validateProposedWord({ lemma: 'x' })).toBeNull();
    expect(validateProposedWord(null)).toBeNull();
    expect(
      validateProposedWord({
        displayForm: '  ',
        lemma: 'x',
        gloss: 'y',
        exampleSentence: 'x here',
      }),
    ).toBeNull();
  });

  it('accepts via the displayForm-token fallback when the lemma itself is not a substring of the example (irregular plural)', () => {
    // "pez" -> "peces" (z→c before e); "pez" is not a substring of "peces",
    // so this only passes because the OR-fallback checks displayForm's
    // trailing token ("peces"), not just the lemma token ("pez").
    expect(
      validateProposedWord({
        displayForm: 'los peces',
        lemma: 'pez',
        gloss: 'fish',
        exampleSentence: 'Hay muchos peces en el río.',
      }),
    ).toEqual({
      displayForm: 'los peces',
      lemma: 'pez',
      gloss: 'fish',
      exampleSentence: 'Hay muchos peces en el río.',
    });
  });
});

describe('deriveTier', () => {
  it('bands by rank with null → extended', () => {
    expect(deriveTier(500)).toBe('core');
    expect(deriveTier(1000)).toBe('core');
    expect(deriveTier(2000)).toBe('common');
    expect(deriveTier(9000)).toBe('extended');
    expect(deriveTier(null)).toBe('extended');
  });

  it('bands the exact 2500 boundary (<=2500 common, >2500 extended)', () => {
    expect(deriveTier(2500)).toBe('common');
    expect(deriveTier(2501)).toBe('extended');
  });
});
