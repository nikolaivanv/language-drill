import { describe, expect, it } from 'vitest';

import {
  ALL_CURRICULA,
  assertCurriculumInvariants,
  deCurriculum,
  esCurriculum,
  getGrammarPoint,
  trCurriculum,
} from './index';
import type { GrammarPoint } from './types';

/**
 * Returns a shallow clone of ALL_CURRICULA where the entry at `index` has been
 * shallow-merged with `overrides`. Used by the mutation tests so the frozen
 * production array stays untouched.
 */
function mutateAt(index: number, overrides: Partial<GrammarPoint>): GrammarPoint[] {
  const clone = ALL_CURRICULA.map((entry) => ({ ...entry }));
  clone[index] = { ...clone[index], ...overrides };
  return clone;
}

const FIRST_ES_INDEX = 0;
const FIRST_GRAMMAR_KEY = ALL_CURRICULA[FIRST_ES_INDEX].key;

describe('assertCurriculumInvariants', () => {
  it('passes for the shipped curriculum', () => {
    expect(() => assertCurriculumInvariants()).not.toThrow();
  });

  it('throws on a malformed key', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { key: 'es-Z9-bad-key' });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/malformed key 'es-Z9-bad-key'/);
  });

  it('throws on a duplicate key', () => {
    const broken = mutateAt(1, { key: FIRST_GRAMMAR_KEY });
    expect(() => assertCurriculumInvariants(broken)).toThrow(
      new RegExp(`duplicate key '${FIRST_GRAMMAR_KEY}'`),
    );
  });

  it('throws when language does not match the key prefix', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { language: 'DE' as GrammarPoint['language'] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/does not match key prefix/);
  });

  it('throws when cefrLevel does not match the key infix', () => {
    const broken = mutateAt(FIRST_ES_INDEX, {
      cefrLevel: 'B2' as GrammarPoint['cefrLevel'],
    });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/does not match key infix/);
  });

  it('throws on fewer than two positive examples', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { examplesPositive: ['only one'] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/fewer than 2 positive examples/);
  });

  it('throws on missing negative examples', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { examplesNegative: [] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/no negative examples/);
  });

  it('throws on a negative example missing the leading "*"', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { examplesNegative: ['no asterisk here'] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/missing the leading '\*'/);
  });

  it('throws on missing commonErrors', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { commonErrors: [] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/no commonErrors/);
  });

  it('throws on an over-long description', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { description: 'x'.repeat(201) });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/exceeds 200 characters/);
  });

  it('throws on a dangling prerequisite key', () => {
    const broken = mutateAt(FIRST_ES_INDEX, {
      prerequisiteKeys: ['es-a1-this-does-not-exist'],
    });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/dangling prerequisite/);
  });

  it('throws on a cross-language prerequisite', () => {
    const esIndex = ALL_CURRICULA.findIndex((e) => e.language === 'ES');
    const deKey = ALL_CURRICULA.find((e) => e.language === 'DE')!.key;
    const broken = mutateAt(esIndex, { prerequisiteKeys: [deKey] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/cross-language prerequisite/);
  });

  it('throws when a per-language grammar count drops below the minimum', () => {
    const trimmed = ALL_CURRICULA
      .filter((e) => !(e.language === 'ES' && e.cefrLevel === 'A1'))
      .map((e) => ({ ...e, prerequisiteKeys: undefined }));
    expect(() => assertCurriculumInvariants(trimmed)).toThrow(
      /ES A1 grammar count 0 below minimum 4/,
    );
  });
});

describe('getGrammarPoint', () => {
  it('returns the matching entry for a known key', () => {
    const entry = getGrammarPoint('es-b1-present-subjunctive');
    expect(entry).toBeDefined();
    expect(entry?.key).toBe('es-b1-present-subjunctive');
    expect(entry?.language).toBe('ES');
    expect(entry?.cefrLevel).toBe('B1');
  });

  it('returns undefined for an unknown key', () => {
    expect(getGrammarPoint('xx-z9-no-such-thing')).toBeUndefined();
  });
});

describe('per-language counts', () => {
  function countsFor(curriculum: readonly GrammarPoint[]) {
    const grammar = { A1: 0, A2: 0, B1: 0, B2: 0 } as Record<string, number>;
    let vocab = 0;
    for (const entry of curriculum) {
      if (entry.kind === 'grammar') {
        grammar[entry.cefrLevel]++;
      } else {
        vocab++;
      }
    }
    return { grammar, vocab };
  }

  it('Spanish meets minimums (≥4 A1, ≥5 A2, ≥6 B1, ≥5 B2 grammar) and has 3 vocab umbrellas', () => {
    const { grammar, vocab } = countsFor(esCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(4);
    expect(grammar.A2).toBeGreaterThanOrEqual(5);
    expect(grammar.B1).toBeGreaterThanOrEqual(6);
    expect(grammar.B2).toBeGreaterThanOrEqual(5);
    expect(vocab).toBe(3);
    expect(grammar.A1 + grammar.A2 + grammar.B1 + grammar.B2).toBeGreaterThanOrEqual(20);
  });

  it('German meets minimums and has 3 vocab umbrellas', () => {
    const { grammar, vocab } = countsFor(deCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(4);
    expect(grammar.A2).toBeGreaterThanOrEqual(5);
    expect(grammar.B1).toBeGreaterThanOrEqual(6);
    expect(grammar.B2).toBeGreaterThanOrEqual(5);
    expect(vocab).toBe(3);
    expect(grammar.A1 + grammar.A2 + grammar.B1 + grammar.B2).toBeGreaterThanOrEqual(20);
  });

  it('Turkish meets minimums and has 3 vocab umbrellas', () => {
    const { grammar, vocab } = countsFor(trCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(4);
    expect(grammar.A2).toBeGreaterThanOrEqual(5);
    expect(grammar.B1).toBeGreaterThanOrEqual(6);
    expect(grammar.B2).toBeGreaterThanOrEqual(5);
    expect(vocab).toBe(3);
    expect(grammar.A1 + grammar.A2 + grammar.B1 + grammar.B2).toBeGreaterThanOrEqual(20);
  });
});
