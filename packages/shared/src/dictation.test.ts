import { describe, it, expect } from 'vitest';
import {
  ExerciseType,
  isDictationContent,
  isDictationResult,
  type DictationContent,
  type DictationResult,
  type ExerciseContent,
} from './index';

const content: DictationContent = {
  type: ExerciseType.DICTATION,
  title: 'El tiempo lo cura todo',
  referenceText: 'Cuando era niño, mi abuela me decía que el tiempo lo cura todo.',
  sentences: ['Cuando era niño, mi abuela me decía que el tiempo lo cura todo.'],
  accent: 'español peninsular',
  voiceId: 'Sergio',
  tested: ['Límites de palabra (sinalefa)'],
  durationSec: 6,
  waveform: [0.2, 0.5, 0.8, 0.4],
};

describe('dictation type guards', () => {
  it('DICTATION enum value is "dictation"', () => {
    expect(ExerciseType.DICTATION).toBe('dictation');
  });

  it('isDictationContent narrows on type', () => {
    expect(isDictationContent(content)).toBe(true);
    const cloze = { type: ExerciseType.CLOZE } as unknown as ExerciseContent;
    expect(isDictationContent(cloze)).toBe(false);
  });

  it('isDictationResult discriminates on kind', () => {
    const r = { kind: 'dictation', score: 0.9 } as unknown as DictationResult;
    expect(isDictationResult(r)).toBe(true);
    expect(isDictationResult({ score: 0.9 } as never)).toBe(false);
  });
});
