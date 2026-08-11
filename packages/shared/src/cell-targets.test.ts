import { describe, it, expect } from 'vitest';
import { ExerciseType } from './index';
import { CELL_TARGET_DEFAULTS, TARGET_PER_CELL, resolveCellTargetFor } from './cell-targets';
import type { GrammarPoint } from './curriculum-types';

const gp = (extra: Partial<GrammarPoint> = {}): GrammarPoint =>
  ({
    key: 'es-b1-test',
    kind: 'grammar',
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['d'],
    ...extra,
  }) as GrammarPoint;

describe('resolveCellTargetFor', () => {
  it('targetOverride wins outright, even below the variant floor', () => {
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'A1',
        grammarPoint: gp({ targetOverride: 12 }),
      }),
    ).toBe(12);
  });

  it('falls back to the (type, level) table', () => {
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'A1',
        grammarPoint: gp(),
      }),
    ).toBe(20);
  });

  it('falls through to TARGET_PER_CELL for an unset level', () => {
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'B1',
        grammarPoint: gp(),
      }),
    ).toBe(TARGET_PER_CELL);
  });

  it('raises to the largest single-axis floor sum, never the product', () => {
    const point = gp({
      coverageSpec: {
        axes: [
          { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
          { name: 'polarity', floors: { affirmative: 10, negative: 8 } },
        ],
      },
    });
    // max(base 20, person sum 25, polarity sum 18) === 25
    expect(
      resolveCellTargetFor({ exerciseType: ExerciseType.CLOZE, cefrLevel: 'A1', grammarPoint: point }),
    ).toBe(25);
  });

  it('raises to variants.length * MIN_PER_VARIANT', () => {
    const point = gp({
      constructionVariants: [
        { id: 'a', directive: 'A' },
        { id: 'b', directive: 'B' },
        { id: 'c', directive: 'C' },
        { id: 'd', directive: 'D' },
        { id: 'e', directive: 'E' },
        { id: 'f', directive: 'F' },
      ],
    });
    // max(base 20, variant floor 6*4=24) === 24
    expect(
      resolveCellTargetFor({ exerciseType: ExerciseType.CLOZE, cefrLevel: 'A1', grammarPoint: point }),
    ).toBe(24);
  });

  it('keeps the vocab_recall low cap at every level', () => {
    expect(CELL_TARGET_DEFAULTS[ExerciseType.VOCAB_RECALL].B2).toBe(10);
  });
});
