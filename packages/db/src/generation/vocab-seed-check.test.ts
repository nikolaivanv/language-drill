import { GenerationReasonCode } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';
import { vocabSeedMismatch } from './vocab-seed-check';

const vocab = (expectedWord: string) => ({
  type: 'vocab_recall' as const,
  instructions: 'x',
  prompt: 'x',
  expectedWord,
  hints: [],
  exampleSentence: 'x',
});

describe('vocabSeedMismatch', () => {
  it('returns null when the expectedWord matches the seed', () => {
    expect(vocabSeedMismatch(vocab('manzana'), 'manzana')).toBeNull();
  });

  it('matches after normalization (article strip / case)', () => {
    expect(vocabSeedMismatch(vocab('Manzana'), 'la manzana')).toBeNull();
  });

  it('returns the reason when the model drifted off the seed', () => {
    expect(vocabSeedMismatch(vocab('pera'), 'manzana')).toEqual({
      code: GenerationReasonCode.SeedTargetMismatch,
      detail: 'expected "manzana", got "pera"',
    });
  });

  it('is a no-op when unseeded', () => {
    expect(vocabSeedMismatch(vocab('pera'), null)).toBeNull();
  });

  it('is a no-op for non-vocab content', () => {
    expect(vocabSeedMismatch({ type: 'cloze' }, 'manzana')).toBeNull();
  });
});
