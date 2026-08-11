import { describe, it, expect } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import {
  buildClassifierSystemPrompt,
  buildClassifierUserPrompt,
  parseClassifierResult,
  VARIANT_SEED_CLASSIFIER_TOOL,
  type ClassifierRow,
} from './variant-seed-classifier.js';

const gp: GrammarPoint = {
  key: 'es-b1-que-vs-cual',
  kind: 'grammar',
  name: 'qué vs cuál',
  description: 'Interrogatives qué and cuál.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['¿Qué es la democracia?', '¿Cuál prefieres?'],
  examplesNegative: ['*¿Cuál libro lees?'],
  commonErrors: ['Using cuál before a noun.'],
  constructionVariants: [
    { id: 'que-definition-of-concept', directive: 'qué asking for a definition (¿Qué es la democracia?)' },
    { id: 'cual-selection-from-set', directive: 'cuál selecting from a known set (¿Cuál prefieres?)' },
    { id: 'que-before-noun', directive: 'qué directly before a noun (¿Qué libro lees?)' },
  ],
} as GrammarPoint;

const rows: ClassifierRow[] = [
  { rowId: 'r1', prompt: '¿___ es la democracia?', answer: 'Qué' },
  { rowId: 'r2', prompt: '¿___ libro estás leyendo?', answer: 'Qué' },
];

describe('buildClassifierSystemPrompt', () => {
  it('lists every declared variant id with its directive', () => {
    const p = buildClassifierSystemPrompt(gp);
    for (const v of gp.constructionVariants!) {
      expect(p).toContain(v.id);
      expect(p).toContain(v.directive);
    }
  });

  it('includes the point name and description for context', () => {
    const p = buildClassifierSystemPrompt(gp);
    expect(p).toContain('qué vs cuál');
    expect(p).toContain('Interrogatives qué and cuál.');
  });

  it('tells the model null is a valid answer and that guessing is worse', () => {
    const p = buildClassifierSystemPrompt(gp);
    expect(p.toLowerCase()).toContain('null');
    expect(p.toLowerCase()).toContain('guess');
  });
});

describe('buildClassifierUserPrompt', () => {
  it('includes each row id, prompt and answer', () => {
    const p = buildClassifierUserPrompt(rows);
    expect(p).toContain('r1');
    expect(p).toContain('¿___ es la democracia?');
    expect(p).toContain('Qué');
    expect(p).toContain('r2');
    expect(p).toContain('¿___ libro estás leyendo?');
  });
});

describe('parseClassifierResult', () => {
  const ok = {
    assignments: [
      { rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' },
      { rowId: 'r2', variantId: 'que-before-noun', confidence: 'medium' },
    ],
  };

  it('accepts a well-formed result covering every row', () => {
    const out = parseClassifierResult(ok, gp, rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' });
  });

  it('accepts a null variantId — an unclassifiable row is a valid outcome', () => {
    const out = parseClassifierResult(
      { assignments: [
        { rowId: 'r1', variantId: null, confidence: 'low' },
        { rowId: 'r2', variantId: null, confidence: 'low' },
      ] },
      gp,
      rows,
    );
    expect(out[0].variantId).toBeNull();
  });

  it('rejects a variantId not declared on this point', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: 'hearsay-dicen-que', confidence: 'high' },
          { rowId: 'r2', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/variantId/);
  });

  it('rejects a rowId that was not in the batch', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'low' },
          { rowId: 'INVENTED', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/rowId/);
  });

  it('rejects a batch with a row missing — a silent drop must not pass', () => {
    expect(() =>
      parseClassifierResult({ assignments: [{ rowId: 'r1', variantId: null, confidence: 'low' }] }, gp, rows),
    ).toThrow(/missing/);
  });

  it('rejects a duplicated rowId', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'low' },
          { rowId: 'r1', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'certain' },
          { rowId: 'r2', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/confidence/);
  });

  it('rejects a non-object or a missing assignments array', () => {
    expect(() => parseClassifierResult(null, gp, rows)).toThrow();
    expect(() => parseClassifierResult({}, gp, rows)).toThrow(/assignments/);
  });

  it('throws for a point with no constructionVariants', () => {
    const bare = { ...gp, constructionVariants: undefined } as GrammarPoint;
    expect(() => parseClassifierResult(ok, bare, rows)).toThrow(/constructionVariants/);
  });
});

describe('VARIANT_SEED_CLASSIFIER_TOOL', () => {
  it('requires the assignments array', () => {
    expect(VARIANT_SEED_CLASSIFIER_TOOL.input_schema.required).toEqual(['assignments']);
  });
});
