import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';

import { buildCellKey } from '../lib/cell-key';
import type { Cell } from './cells';
import { resolveCellMechanisms } from './diversity-mechanisms';

const basePoint: GrammarPoint = {
  key: 'es-b1-test',
  kind: 'grammar',
  name: 'Test point',
  description: 'A test point.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['a', 'b'],
  examplesNegative: ['*c'],
  commonErrors: ['d'],
};

function cellOf(gp: GrammarPoint, exerciseType: ExerciseType): Cell {
  return {
    language: gp.language,
    cefrLevel: gp.cefrLevel,
    exerciseType,
    grammarPoint: gp,
    cellKey: buildCellKey({
      language: gp.language,
      cefrLevel: gp.cefrLevel,
      exerciseType,
      grammarPointKey: gp.key,
    }),
  };
}

describe('resolveCellMechanisms — seed source', () => {
  it('reports the frequency band for a plain grammar cloze cell', () => {
    const m = resolveCellMechanisms(cellOf(basePoint, ExerciseType.CLOZE));
    expect(m.seed.kind).toBe('frequency-band');
    if (m.seed.kind !== 'frequency-band') throw new Error('narrowing');
    expect(m.seed.band).toBe('content-word');
    expect(m.seed.rankMax).toBeGreaterThan(0);
  });

  it('reports the variant pool when the point declares constructionVariants', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      constructionVariants: [
        { id: 'hearsay', directive: 'Use the hearsay reading.', share: 3 },
        { id: 'adversity', directive: 'Use the adversity reading.' },
      ],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.seed.kind).toBe('construction-variants');
    if (m.seed.kind !== 'construction-variants') throw new Error('narrowing');
    expect(m.seed.variants).toEqual([
      { id: 'hearsay', directive: 'Use the hearsay reading.', share: 3 },
      { id: 'adversity', directive: 'Use the adversity reading.', share: 1 },
    ]);
  });

  it('defaults an omitted variant share to 1', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      constructionVariants: [
        { id: 'a', directive: 'A.' },
        { id: 'b', directive: 'B.' },
      ],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    if (m.seed.kind !== 'construction-variants') throw new Error('narrowing');
    expect(m.seed.variants.map((v) => v.share)).toEqual([1, 1]);
  });

  it('routes a sentence_construction cell through the variant pool too (2026-08-14)', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      sentenceConstructionSuitable: true,
      constructionVariants: [
        { id: 'a', directive: 'A.' },
        { id: 'b', directive: 'B.' },
      ],
    };
    const m = resolveCellMechanisms(
      cellOf(gp, ExerciseType.SENTENCE_CONSTRUCTION),
    );
    expect(m.seed.kind).toBe('construction-variants');
  });

  // #652 gave variant-less sentence_construction cells a frequency seed (they
  // previously had NO diversity mechanism at all). Because this resolver
  // delegates to `seedKindFor` rather than restating its precedence, that change
  // reaches the panel for free — this test pins that it actually does, and that
  // the variant branch above still wins when both could apply.
  it('reports the frequency band for a sentence_construction cell with no variants', () => {
    const gp: GrammarPoint = { ...basePoint, sentenceConstructionSuitable: true };
    const m = resolveCellMechanisms(
      cellOf(gp, ExerciseType.SENTENCE_CONSTRUCTION),
    );
    expect(m.seed.kind).toBe('frequency-band');
    if (m.seed.kind !== 'frequency-band') throw new Error('narrowing');
    expect(m.seed.band).toBe('content-word');
  });

  it('reports the curated predicate pool for a predicate-nominal conjugation cell', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      key: 'tr-a1-copula',
      language: 'TR',
      cefrLevel: 'A1',
      conjugationSuitable: true,
      conjugationSeedKind: 'predicate-nominal',
      conjugationSeedWords: ['doktor', 'öğretmen', 'yorgun'],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CONJUGATION));
    expect(m.seed).toEqual({
      kind: 'curated',
      source: 'conjugationSeedWords',
      values: ['doktor', 'öğretmen', 'yorgun'],
    });
  });

  it('reports the curated elicitation pool for a self-revealing point', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      selfRevealingElicitation: 'digit-form',
      elicitationSeedValues: ['tercero', 'doscientas'],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.seed).toEqual({
      kind: 'curated',
      source: 'elicitationSeedValues',
      values: ['tercero', 'doscientas'],
    });
  });

  it('reports the paraphrase scenario pool for a contextual_paraphrase cell', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      key: 'es-b2-paraphrase',
      kind: 'paraphrase',
      paraphrase: { seeds: ['at the airport', 'at the doctor'] },
    };
    const m = resolveCellMechanisms(
      cellOf(gp, ExerciseType.CONTEXTUAL_PARAPHRASE),
    );
    expect(m.seed).toEqual({
      kind: 'curated',
      source: 'paraphrase.seeds',
      values: ['at the airport', 'at the doctor'],
    });
  });

  it('reports the noun band for a nominal-inflection conjugation cell', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      key: 'tr-a2-possessive',
      language: 'TR',
      cefrLevel: 'A2',
      conjugationSuitable: true,
      conjugationSeedKind: 'noun',
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CONJUGATION));
    expect(m.seed.kind).toBe('frequency-band');
    if (m.seed.kind !== 'frequency-band') throw new Error('narrowing');
    expect(m.seed.band).toBe('noun');
  });

  it('reports no seeding when conjugationSeedKind is none', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      conjugationSuitable: true,
      conjugationSeedKind: 'none',
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CONJUGATION));
    expect(m.seed).toEqual({ kind: 'none' });
  });
});

describe('resolveCellMechanisms — axes', () => {
  it('marks spec axes controlled and monitoring axes monitored', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      coverageSpec: {
        axes: [{ name: 'person', floors: { '1sg': 4, '3sg': 6 } }],
      },
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    const byName = Object.fromEntries(m.axes.map((a) => [a.name, a]));
    expect(byName.person).toEqual({
      name: 'person',
      role: 'controlled',
      floors: { '1sg': 4, '3sg': 6 },
    });
    // cloze monitors polarity + sentenceType regardless of the spec
    expect(byName.polarity.role).toBe('monitored');
    expect(byName.polarity.floors).toBeUndefined();
    expect(byName.sentenceType.role).toBe('monitored');
  });

  it('returns axes in the canonical order coverageAxesFor produces', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 2 } }] },
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.axes.map((a) => a.name)).toEqual([
      'person',
      'polarity',
      'sentenceType',
    ]);
  });
});

describe('resolveCellMechanisms — target', () => {
  it('surfaces an explicit targetOverride alongside the resolved target', () => {
    const gp: GrammarPoint = { ...basePoint, targetOverride: 12 };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.target).toBe(12);
    expect(m.targetOverride).toBe(12);
  });

  it('reports a null override when the target comes from the defaults table', () => {
    const m = resolveCellMechanisms(cellOf(basePoint, ExerciseType.CLOZE));
    expect(m.targetOverride).toBeNull();
    expect(m.target).toBeGreaterThan(0);
  });
});
