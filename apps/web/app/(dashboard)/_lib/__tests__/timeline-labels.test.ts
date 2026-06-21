import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import { composeSubtitle, composeTitle, typeLabel } from '../timeline-labels';

describe('typeLabel', () => {
  it('labels sentence_construction', () => {
    expect(typeLabel(ExerciseType.SENTENCE_CONSTRUCTION)).toBe('sentence construction');
  });
});

describe('composeTitle', () => {
  it('index 1 of 8 → warm-up prefix', () => {
    expect(composeTitle(1, 8, ExerciseType.CLOZE)).toBe('warm-up · cloze');
  });

  it('index 8 of 8 → cool-down prefix', () => {
    expect(composeTitle(8, 8, ExerciseType.CLOZE)).toBe('cool-down · cloze');
  });

  it('middle index → core prefix', () => {
    expect(composeTitle(4, 8, ExerciseType.TRANSLATION)).toBe('core · translation');
  });

  it('index 1 of 1 → cool-down (total wins over warm-up when plan is length 1)', () => {
    // When total=1, index===total takes precedence since we check warm-up first then cool-down.
    // The rule is: 1 → warm-up; === total → cool-down; else core.
    // A single-item plan: index=1, total=1 → warm-up (index 1 wins).
    expect(composeTitle(1, 1, ExerciseType.CLOZE)).toBe('warm-up · cloze');
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
