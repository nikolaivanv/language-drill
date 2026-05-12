import { describe, expect, it } from 'vitest';

import type { GrammarPoint } from '../curriculum';
import { ALL_CURRICULA } from '../curriculum';
import { assertValidTheoryCellKey } from '../lib/theory-cell-key';

import {
  THEORY_ROUND_1_CEFR_LEVELS,
  enumerateTheoryCells,
  type TheoryCell,
} from './cells';

describe('THEORY_ROUND_1_CEFR_LEVELS', () => {
  it('pins the round-1 scope to A1, A2, B1, B2 in order', () => {
    expect(THEORY_ROUND_1_CEFR_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2']);
  });
});

describe('enumerateTheoryCells', () => {
  it('produces exactly one cell per grammar entry in the live curriculum', () => {
    const grammarCount = ALL_CURRICULA.filter((e) => e.kind === 'grammar').length;
    expect(enumerateTheoryCells(ALL_CURRICULA).length).toBe(grammarCount);
  });

  it('never returns a cell whose grammarPoint.kind is "vocab"', () => {
    const cells = enumerateTheoryCells(ALL_CURRICULA);
    for (const cell of cells) {
      expect(cell.grammarPoint.kind).not.toBe('vocab');
    }
  });

  it('emits a cellKey that passes assertValidTheoryCellKey for every returned cell', () => {
    const cells: readonly TheoryCell[] = enumerateTheoryCells(ALL_CURRICULA);
    for (const cell of cells) {
      expect(() => assertValidTheoryCellKey(cell.cellKey)).not.toThrow();
    }
  });

  it('filters out vocab umbrellas from a synthetic mixed-kind input', () => {
    const buildPoint = (key: string, kind: 'grammar' | 'vocab'): GrammarPoint => ({
      key,
      kind,
      name: 'synthetic',
      description: 'synthetic test entry',
      cefrLevel: 'B1',
      language: 'ES',
      examplesPositive: ['foo', 'bar'],
      examplesNegative: ['*baz'],
      commonErrors: ['err'],
    });

    const synthetic: readonly GrammarPoint[] = [
      buildPoint('es-b1-synth-grammar-1', 'grammar'),
      buildPoint('es-b1-synth-grammar-2', 'grammar'),
      buildPoint('es-b1-synth-vocab-1', 'vocab'),
      buildPoint('es-b1-synth-vocab-2', 'vocab'),
    ];

    expect(enumerateTheoryCells(synthetic).length).toBe(2);
  });
});
