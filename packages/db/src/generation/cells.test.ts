import { ExerciseType } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import { ALL_CURRICULA, type GrammarPoint } from '../curriculum';
import { assertValidCellKey } from '../lib/cell-key';

import { ROUND_1_CEFR_LEVELS, enumerateCurriculumCells } from './cells';

/**
 * Build a synthetic curriculum entry for enumeration tests. `key` and `kind`
 * are required; everything else gets a valid default (the cell-key regex needs
 * a lowercase `tr` / `a2` discriminator and a `[a-z0-9-]+` grammar-point key).
 */
function makeGrammarPoint(
  overrides: Partial<GrammarPoint> & Pick<GrammarPoint, 'key' | 'kind'>,
): GrammarPoint {
  return {
    name: 'Synthetic point',
    description: 'A synthetic curriculum entry for cell-enumeration tests.',
    cefrLevel: 'A2',
    language: 'tr',
    examplesPositive: ['örnek bir', 'örnek iki'],
    examplesNegative: ['*yanlış örnek'],
    commonErrors: ['ortak hata'],
    ...overrides,
  };
}

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

  it('produces 2 cells per grammar entry (cloze + translation) and 1 per vocab entry (vocab_recall), minus one per clozeUnsuitable point', () => {
    const grammarCount = ALL_CURRICULA.filter((g) => g.kind === 'grammar').length;
    const vocabCount = ALL_CURRICULA.filter((g) => g.kind === 'vocab').length;
    // A clozeUnsuitable grammar point yields 1 cell (translation) instead of 2,
    // so each flagged point drops the total by exactly one.
    const flaggedCount = ALL_CURRICULA.filter((g) => g.clozeUnsuitable === true).length;
    expect(cells).toHaveLength(grammarCount * 2 + vocabCount - flaggedCount);
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

describe('enumerateCurriculumCells — clozeUnsuitable flag', () => {
  it('emits only a translation cell (no cloze) for a clozeUnsuitable grammar point', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-flagged',
      kind: 'grammar',
      clozeUnsuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([ExerciseType.TRANSLATION]);
    expect(cells.some((c) => c.exerciseType === ExerciseType.CLOZE)).toBe(false);
  });

  it('still emits cloze + translation for an unflagged grammar point', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-unflagged',
      kind: 'grammar',
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
    ]);
  });

  it('leaves vocab umbrellas unchanged (vocab_recall only)', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-vocab',
      kind: 'vocab',
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([ExerciseType.VOCAB_RECALL]);
  });

  it('drops exactly one cell per flagged point versus the same point unflagged', () => {
    const unflagged = makeGrammarPoint({ key: 'tr-a2-synthetic-a', kind: 'grammar' });
    const flagged = makeGrammarPoint({
      key: 'tr-a2-synthetic-a',
      kind: 'grammar',
      clozeUnsuitable: true,
    });
    expect(enumerateCurriculumCells([unflagged])).toHaveLength(2);
    expect(enumerateCurriculumCells([flagged])).toHaveLength(1);
  });
});
