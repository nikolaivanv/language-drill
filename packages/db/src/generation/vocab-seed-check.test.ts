import { describe, expect, it } from 'vitest';
import { SEED_TARGET_MISMATCH_REASON, vocabSeedMismatchReason } from './vocab-seed-check';

const vocab = (expectedWord: string) => ({
  type: 'vocab_recall' as const,
  instructions: 'x',
  prompt: 'x',
  expectedWord,
  hints: [],
  exampleSentence: 'x',
});

describe('vocabSeedMismatchReason', () => {
  it('returns null when the expectedWord matches the seed', () => {
    expect(vocabSeedMismatchReason(vocab('manzana'), 'manzana')).toBeNull();
  });

  it('matches after normalization (article strip / case)', () => {
    expect(vocabSeedMismatchReason(vocab('Manzana'), 'la manzana')).toBeNull();
  });

  it('returns the reason when the model drifted off the seed', () => {
    expect(vocabSeedMismatchReason(vocab('pera'), 'manzana')).toBe(SEED_TARGET_MISMATCH_REASON);
  });

  it('is a no-op when unseeded', () => {
    expect(vocabSeedMismatchReason(vocab('pera'), null)).toBeNull();
  });

  it('is a no-op for non-vocab content', () => {
    expect(vocabSeedMismatchReason({ type: 'cloze' }, 'manzana')).toBeNull();
  });
});
