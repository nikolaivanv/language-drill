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
});

describe('deriveTier', () => {
  it('bands by rank with null → extended', () => {
    expect(deriveTier(500)).toBe('core');
    expect(deriveTier(1000)).toBe('core');
    expect(deriveTier(2000)).toBe('common');
    expect(deriveTier(9000)).toBe('extended');
    expect(deriveTier(null)).toBe('extended');
  });
});
