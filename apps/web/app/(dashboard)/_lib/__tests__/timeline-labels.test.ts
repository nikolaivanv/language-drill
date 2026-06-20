import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import { composeSubtitle, typeLabel } from '../timeline-labels';

describe('typeLabel', () => {
  it('labels sentence_construction', () => {
    expect(typeLabel(ExerciseType.SENTENCE_CONSTRUCTION)).toBe('sentence construction');
  });
});

describe('composeSubtitle', () => {
  it('leads with the grammar-point name when present (over the topic, decision D5)', () => {
    expect(
      composeSubtitle('Locative case -DA', 'everyday life / transport', ExerciseType.TRANSLATION, 1),
    ).toBe('Locative case -DA · 1 items');
  });

  it('falls back to the topic when there is no grammar point', () => {
    expect(
      composeSubtitle(null, 'everyday life / transport', ExerciseType.TRANSLATION, 1),
    ).toBe('everyday life / transport · 1 items');
  });

  it('falls back to the type label when neither grammar point nor topic is present', () => {
    expect(composeSubtitle(null, null, ExerciseType.CLOZE, 4)).toBe('cloze · 4 items');
  });
});
