import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import { typeLabel } from '../timeline-labels';

describe('typeLabel', () => {
  it('labels sentence_construction', () => {
    expect(typeLabel(ExerciseType.SENTENCE_CONSTRUCTION)).toBe('sentence construction');
  });
});
