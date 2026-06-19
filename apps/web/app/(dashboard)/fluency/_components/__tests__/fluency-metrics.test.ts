import { describe, it, expect } from 'vitest';
import { ExerciseType, type ExerciseContent } from '@language-drill/shared';
import {
  median,
  summarizeFluency,
  formatSeconds,
  promptLabelFor,
  type FluencyItemResult,
} from '../fluency-metrics';

function result(over: Partial<FluencyItemResult>): FluencyItemResult {
  return {
    index: 0,
    type: 'cloze',
    promptLabel: 'x',
    userAnswer: 'a',
    correct: true,
    correctAnswer: 'a',
    latencyMs: 1000,
    ...over,
  };
}

describe('median', () => {
  it('returns 0 for an empty list', () => {
    expect(median([])).toBe(0);
  });
  it('returns the middle value for odd counts', () => {
    expect(median([3000, 1000, 2000])).toBe(2000);
  });
  it('averages the two middle values for even counts', () => {
    expect(median([1000, 2000, 3000, 4000])).toBe(2500);
  });
});

describe('summarizeFluency', () => {
  it('returns zeros for no results', () => {
    expect(summarizeFluency([])).toEqual({
      count: 0,
      correctCount: 0,
      accuracy: 0,
      medianLatencyMs: 0,
      fastestMs: 0,
      slowestMs: 0,
    });
  });
  it('computes count, accuracy, median, fastest and slowest', () => {
    const s = summarizeFluency([
      result({ index: 0, correct: true, latencyMs: 1000 }),
      result({ index: 1, correct: false, latencyMs: 3000 }),
      result({ index: 2, correct: true, latencyMs: 2000 }),
    ]);
    expect(s.count).toBe(3);
    expect(s.correctCount).toBe(2);
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.medianLatencyMs).toBe(2000);
    expect(s.fastestMs).toBe(1000);
    expect(s.slowestMs).toBe(3000);
  });
});

describe('formatSeconds', () => {
  it('formats ms as one-decimal seconds', () => {
    expect(formatSeconds(4800)).toBe('4.8s');
  });
});

describe('promptLabelFor', () => {
  it('uses the sentence for cloze', () => {
    const c = { type: ExerciseType.CLOZE, sentence: 'El gato ___' } as ExerciseContent;
    expect(promptLabelFor(c)).toBe('El gato ___');
  });
  it('uses the prompt for vocab', () => {
    const c = { type: ExerciseType.VOCAB_RECALL, prompt: 'opposite of big' } as ExerciseContent;
    expect(promptLabelFor(c)).toBe('opposite of big');
  });
  it('uses lemma + feature bundle for conjugation', () => {
    const c = {
      type: ExerciseType.CONJUGATION,
      lemma: 'ir',
      featureBundle: 'condicional · 1ª pl',
    } as ExerciseContent;
    expect(promptLabelFor(c)).toBe('ir · condicional · 1ª pl');
  });
});
