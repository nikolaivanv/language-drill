import { ExerciseType } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import { ALL_CURRICULA, esCurriculum, trCurriculum, type GrammarPoint } from '../curriculum';
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

  it('produces 2 cells per grammar entry (cloze + translation), 1 per vocab entry (vocab_recall), and 1 per dictation umbrella (dictation), minus one per clozeUnsuitable point, plus one per sentenceConstructionSuitable point', () => {
    const grammarCount = ALL_CURRICULA.filter((g) => g.kind === 'grammar').length;
    const vocabCount = ALL_CURRICULA.filter((g) => g.kind === 'vocab').length;
    // A dictation umbrella yields exactly one cell (dictation only).
    const dictationCount = ALL_CURRICULA.filter((g) => g.kind === 'dictation').length;
    // A free-writing umbrella yields exactly one cell (free_writing only).
    const fwCount = ALL_CURRICULA.filter((g) => g.kind === 'free-writing').length;
    // A clozeUnsuitable grammar point yields 1 cell (translation) instead of 2,
    // so each flagged point drops the total by exactly one.
    const flaggedCount = ALL_CURRICULA.filter((g) => g.clozeUnsuitable === true).length;
    const scCount = ALL_CURRICULA.filter((g) => g.sentenceConstructionSuitable === true).length;
    expect(cells).toHaveLength(
      grammarCount * 2 + vocabCount + dictationCount + fwCount - flaggedCount + scCount,
    );
  });

  it('pairs vocab umbrellas only with vocab_recall', () => {
    for (const cell of cells) {
      if (cell.grammarPoint.kind === 'vocab') {
        expect(cell.exerciseType).toBe(ExerciseType.VOCAB_RECALL);
      }
    }
  });

  it('pairs grammar points only with cloze, translation, or sentence_construction (never vocab_recall)', () => {
    for (const cell of cells) {
      if (cell.grammarPoint.kind === 'grammar') {
        expect([ExerciseType.CLOZE, ExerciseType.TRANSLATION, ExerciseType.SENTENCE_CONSTRUCTION]).toContain(
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

describe('enumerateCurriculumCells — kind:dictation umbrellas', () => {
  it('pairs a kind:dictation umbrella with DICTATION only', () => {
    const dictationCells = enumerateCurriculumCells(esCurriculum).filter(
      (c) => c.grammarPoint.kind === 'dictation',
    );
    expect(dictationCells.length).toBeGreaterThanOrEqual(2);
    for (const cell of dictationCells) {
      expect(cell.exerciseType).toBe(ExerciseType.DICTATION);
    }
    // es-b1-dictation produces exactly one cell (no cloze/translation pairing)
    const b1 = dictationCells.filter((c) => c.grammarPoint.key === 'es-b1-dictation');
    expect(b1).toHaveLength(1);
  });

  it('pairs the TR dictation umbrellas with DICTATION only', () => {
    const cells = enumerateCurriculumCells(trCurriculum).filter(
      (c) => c.grammarPoint.kind === 'dictation',
    );
    const keys = cells.map((c) => c.grammarPoint.key).sort();
    expect(keys).toEqual(['tr-a1-dictation', 'tr-a2-dictation']);
    for (const cell of cells) {
      expect(cell.exerciseType).toBe(ExerciseType.DICTATION);
    }
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

describe('enumerateCurriculumCells — kind:free-writing umbrellas', () => {
  it("pairs a free-writing umbrella with exactly the free_writing cell", () => {
    const entry = {
      key: "es-b2-fw-remote-work",
      kind: "free-writing" as const,
      name: "x",
      description: "y",
      cefrLevel: "B2" as const,
      language: "ES" as const,
      examplesPositive: ["a", "b"],
      examplesNegative: ["*c"],
      commonErrors: ["d"],
      freeWriting: { register: "formal" as const },
    };
    const cells = enumerateCurriculumCells([entry]);
    expect(cells.map((c) => c.exerciseType)).toEqual([ExerciseType.FREE_WRITING]);
    expect(cells[0].cellKey).toBe("es:b2:free_writing:es-b2-fw-remote-work");
  });
});

describe('enumerateCurriculumCells — conjugationSuitable flag', () => {
  it('adds a conjugation cell for a flagged grammar point (also keeps cloze + translation)', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-conj',
      kind: 'grammar',
      conjugationSuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    const types = cells.map((c) => c.exerciseType);
    expect(types).toContain(ExerciseType.CONJUGATION);
    expect(types).toEqual(
      expect.arrayContaining([ExerciseType.CLOZE, ExerciseType.TRANSLATION]),
    );
  });

  it('omits the conjugation cell when the flag is absent', () => {
    const point = makeGrammarPoint({ key: 'tr-a2-synthetic-noconj', kind: 'grammar' });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.some((c) => c.exerciseType === ExerciseType.CONJUGATION)).toBe(false);
  });

  it('combines with clozeUnsuitable: translation + conjugation only', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-cloze-conj',
      kind: 'grammar',
      clozeUnsuitable: true,
      conjugationSuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([
      ExerciseType.TRANSLATION,
      ExerciseType.CONJUGATION,
    ]);
  });

  it('combines with sentenceConstructionSuitable: cloze + translation + sentence_construction + conjugation', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-sc-conj',
      kind: 'grammar',
      sentenceConstructionSuitable: true,
      conjugationSuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
      ExerciseType.SENTENCE_CONSTRUCTION,
      ExerciseType.CONJUGATION,
    ]);
  });
});

describe('enumerateCurriculumCells — sentenceConstructionSuitable flag', () => {
  it('adds a sentence_construction cell for a flagged grammar point', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-sc',
      kind: 'grammar',
      sentenceConstructionSuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
      ExerciseType.SENTENCE_CONSTRUCTION,
    ]);
  });

  it('omits the sentence_construction cell when not flagged', () => {
    const point = makeGrammarPoint({ key: 'tr-a2-synthetic-nosc', kind: 'grammar' });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.some((c) => c.exerciseType === ExerciseType.SENTENCE_CONSTRUCTION)).toBe(false);
  });

  it('combines with clozeUnsuitable: translation + sentence_construction only', () => {
    const point = makeGrammarPoint({
      key: 'tr-a2-synthetic-both',
      kind: 'grammar',
      clozeUnsuitable: true,
      sentenceConstructionSuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([
      ExerciseType.TRANSLATION,
      ExerciseType.SENTENCE_CONSTRUCTION,
    ]);
  });
});
