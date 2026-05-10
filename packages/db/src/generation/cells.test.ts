import { ExerciseType } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import { ALL_CURRICULA } from '../curriculum';
import { assertValidCellKey } from '../lib/cell-key';

import { ROUND_1_CEFR_LEVELS, enumerateCurriculumCells } from './cells';

describe('ROUND_1_CEFR_LEVELS', () => {
  it('contains exactly A1, A2, B1, B2 in order', () => {
    expect(ROUND_1_CEFR_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2']);
  });
});

describe('enumerateCurriculumCells', () => {
  const cells = enumerateCurriculumCells(ALL_CURRICULA);

  it('produces a non-empty cell list against the real curriculum', () => {
    expect(cells.length).toBeGreaterThan(0);
  });

  it('produces 2 cells per grammar entry (cloze + translation) and 1 per vocab entry (vocab_recall)', () => {
    const grammarCount = ALL_CURRICULA.filter((g) => g.kind === 'grammar').length;
    const vocabCount = ALL_CURRICULA.filter((g) => g.kind === 'vocab').length;
    expect(cells).toHaveLength(grammarCount * 2 + vocabCount);
  });

  it('pairs vocab umbrellas only with vocab_recall', () => {
    for (const cell of cells) {
      if (cell.grammarPoint.kind === 'vocab') {
        expect(cell.exerciseType).toBe(ExerciseType.VOCAB_RECALL);
      }
    }
  });

  it('pairs grammar points only with cloze or translation (never vocab_recall)', () => {
    for (const cell of cells) {
      if (cell.grammarPoint.kind === 'grammar') {
        expect([ExerciseType.CLOZE, ExerciseType.TRANSLATION]).toContain(
          cell.exerciseType,
        );
      }
    }
  });

  it('every cell carries a cellKey that passes assertValidCellKey', () => {
    for (const cell of cells) {
      expect(() => assertValidCellKey(cell.cellKey)).not.toThrow();
    }
  });

  it("every cell's discriminator triple matches its grammar-point entry", () => {
    for (const cell of cells) {
      expect(cell.language).toBe(cell.grammarPoint.language);
      expect(cell.cefrLevel).toBe(cell.grammarPoint.cefrLevel);
    }
  });

  it('produces a fresh array on every call (no aliasing of internal state)', () => {
    const first = enumerateCurriculumCells(ALL_CURRICULA);
    const second = enumerateCurriculumCells(ALL_CURRICULA);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('returns an empty array for an empty curriculum', () => {
    expect(enumerateCurriculumCells([])).toEqual([]);
  });
});
