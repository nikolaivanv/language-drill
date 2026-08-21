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

describe("coverageSpec appliesTo scoping", () => {
  // tr-a1-ablative-dative's shape: a `case` axis its CONJUGATION cell needs to
  // seed from, on a point whose cloze/translation diversity is owned by
  // constructionVariants. Without scoping the axis would also raise the
  // cloze/translation target it no longer governs.
  const scoped = {
    key: "tr-a1-ablative-dative",
    kind: "grammar",
    cefrLevel: "A1",
    language: "TR",
    name: "x",
    description: "x",
    coverageSpec: {
      axes: [{ name: "case", floors: { ablative: 6, dative: 6 } }],
      appliesTo: [ExerciseType.CONJUGATION],
    },
  } as unknown as GrammarPoint;

  it("raises the target for a type the spec applies to", () => {
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.CONJUGATION,
        cefrLevel: "A1" as never,
        grammarPoint: scoped,
      }),
    ).toBeGreaterThanOrEqual(12);
  });

  it("does NOT raise the target for a type the spec excludes", () => {
    const unscoped = {
      ...scoped,
      coverageSpec: { axes: [{ name: "case", floors: { ablative: 30, dative: 30 } }] },
    } as unknown as GrammarPoint;
    const withScope = resolveCellTargetFor({
      exerciseType: ExerciseType.CLOZE,
      cefrLevel: "A1" as never,
      grammarPoint: {
        ...scoped,
        coverageSpec: {
          axes: [{ name: "case", floors: { ablative: 30, dative: 30 } }],
          appliesTo: [ExerciseType.CONJUGATION],
        },
      } as unknown as GrammarPoint,
    });
    const withoutScope = resolveCellTargetFor({
      exerciseType: ExerciseType.CLOZE,
      cefrLevel: "A1" as never,
      grammarPoint: unscoped,
    });
    expect(withoutScope).toBe(60);
    expect(withScope).toBe(20);
  });

  it("an omitted appliesTo still governs every type (unchanged default)", () => {
    const plain = {
      ...scoped,
      coverageSpec: { axes: [{ name: "case", floors: { ablative: 30, dative: 30 } }] },
    } as unknown as GrammarPoint;
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.TRANSLATION,
        cefrLevel: "A1" as never,
        grammarPoint: plain,
      }),
    ).toBe(60);
  });
});
