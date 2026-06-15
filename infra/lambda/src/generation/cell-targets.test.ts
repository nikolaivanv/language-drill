/**
 * Table-driven unit tests for `resolveCellTarget` (R3). Pure: no DB, no env,
 * no AWS SDK — same shape as `scheduler-decision.test.ts`. Pins the
 * `override → table → fallback` precedence and the narrow-cell / vocab-surface
 * invariants the resolver exists to enforce.
 */

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';
import type { Cell, CurriculumCefrLevel } from '@language-drill/db';

import {
  CELL_TARGET_DEFAULTS,
  resolveCellTarget,
} from './cell-targets';
import { TARGET_PER_CELL } from './scheduler-decision';

function makeCell(
  exerciseType: ExerciseType,
  cefrLevel: CurriculumCefrLevel,
  targetOverride?: number,
): Cell {
  const grammarPoint = {
    key: 'es-test',
    language: Language.ES,
    cefrLevel,
    title: 'test',
    summary: 'test',
    ...(targetOverride !== undefined ? { targetOverride } : {}),
  } as unknown as Cell['grammarPoint'];
  return {
    language: Language.ES,
    cefrLevel,
    exerciseType,
    grammarPoint,
    cellKey: `es:${String(cefrLevel).toLowerCase()}:${exerciseType}:es-test`,
  } as Cell;
}

describe('resolveCellTarget', () => {
  it('prefers grammarPoint.targetOverride over everything (R3.1, R3.2)', () => {
    const cell = makeCell(ExerciseType.CLOZE, CefrLevel.A1, 12);
    expect(resolveCellTarget(cell)).toBe(12);
  });

  it('lets the override win even when a table entry exists', () => {
    // CLOZE A1 has a table default; the override must still take precedence.
    expect(CELL_TARGET_DEFAULTS[ExerciseType.CLOZE][CefrLevel.A1]).toBe(20);
    const cell = makeCell(ExerciseType.CLOZE, CefrLevel.A1, 15);
    expect(resolveCellTarget(cell)).toBe(15);
  });

  it('uses the (exerciseType, cefrLevel) table default when no override (R3.3)', () => {
    expect(resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A1))).toBe(20);
    expect(resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A2))).toBe(30);
    expect(resolveCellTarget(makeCell(ExerciseType.TRANSLATION, CefrLevel.A1))).toBe(20);
    expect(resolveCellTarget(makeCell(ExerciseType.VOCAB_RECALL, CefrLevel.A1))).toBe(10);
  });

  it('falls back to TARGET_PER_CELL when the table leaves a (type, level) unset', () => {
    // B1/B2 cloze/translation are intentionally unset → global fallback.
    expect(resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.B1))).toBe(
      TARGET_PER_CELL,
    );
    expect(
      resolveCellTarget(makeCell(ExerciseType.TRANSLATION, CefrLevel.B2)),
    ).toBe(TARGET_PER_CELL);
  });

  it('resolves a narrow A1/A2 cell below the global 50 (R3.2)', () => {
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A1)),
    ).toBeLessThan(TARGET_PER_CELL);
    expect(
      resolveCellTarget(makeCell(ExerciseType.TRANSLATION, CefrLevel.A2)),
    ).toBeLessThan(TARGET_PER_CELL);
    // …and a genuinely narrow point via the override knob.
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A1, 15)),
    ).toBeLessThan(TARGET_PER_CELL);
  });

  it('caps vocab_recall low (10) at every level — token-efficiency over a single-umbrella surface ceiling', () => {
    expect(resolveCellTarget(makeCell(ExerciseType.VOCAB_RECALL, CefrLevel.A1))).toBe(10);
    expect(resolveCellTarget(makeCell(ExerciseType.VOCAB_RECALL, CefrLevel.A2))).toBe(10);
    expect(resolveCellTarget(makeCell(ExerciseType.VOCAB_RECALL, CefrLevel.B1))).toBe(10);
    expect(resolveCellTarget(makeCell(ExerciseType.VOCAB_RECALL, CefrLevel.B2))).toBe(10);
  });

  it('uses the constrained A1/A2 defaults for sentence_construction', () => {
    // Pilot brake lifted 2026-06-08 (the constrained-prompt fix is validated for
    // single-construction points). SC resolves like cloze/translation again:
    // 20/30 at A1/A2, fall through to TARGET_PER_CELL at B1/B2.
    expect(resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.A2))).toBe(30);
    expect(resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.B1))).toBe(TARGET_PER_CELL);
  });

  it('resolves dictation B1/B2 targets to 15 (small rotating audio pool)', () => {
    // Dictation umbrellas carry no coverageSpec, so the floor-raise never
    // applies — the table value is returned verbatim.
    expect(resolveCellTarget(makeCell(ExerciseType.DICTATION, CefrLevel.B1))).toBe(15);
    expect(resolveCellTarget(makeCell(ExerciseType.DICTATION, CefrLevel.B2))).toBe(15);
  });

  it('sentence_construction resolves at the plain table value (no raise)', () => {
    // SC already gained headroom when the pilot brake lifted (25 → 30
    // at A2, 50 at B1/B2); it resolves at the table value regardless of
    // any coverage spec.
    expect(
      resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.A2)),
    ).toBe(30);
    // An explicit targetOverride marks a supply-limited point — respected as-is.
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A1, 12)),
    ).toBe(12);
  });
});

function cell(over: Partial<Cell> & { grammarPoint?: Partial<Cell['grammarPoint']> }): Cell {
  return {
    cellKey: 'k',
    language: 'ES' as Cell['language'],
    cefrLevel: 'B1',
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: { key: 'es-b1-x', kind: 'grammar', ...(over.grammarPoint ?? {}) },
    ...over,
  } as Cell;
}

describe('resolveCellTarget (floor-driven)', () => {
  it('no spec → base table value (B1 cloze = 50)', () => {
    expect(resolveCellTarget(cell({}))).toBe(50);
  });
  it('person spec raises target to the floor sum (5×15 = 75 > base 50)', () => {
    const c = cell({
      grammarPoint: { key: 'es-b1-x', kind: 'grammar',
        coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } }] } } as unknown as Cell['grammarPoint'],
    });
    expect(resolveCellTarget(c)).toBe(75);
  });
  it('takes the max over axes, not the sum of axes', () => {
    const c = cell({
      grammarPoint: { key: 'tr-a1-x', kind: 'grammar',
        coverageSpec: { axes: [
          { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
          { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
        ] } } as unknown as Cell['grammarPoint'],
      cefrLevel: CefrLevel.A1,
    });
    expect(resolveCellTarget(c)).toBe(30); // max(20 base, max(30, 30))
  });
  it('targetOverride wins over base and floor sum', () => {
    const c = cell({ grammarPoint: { key: 'es-b1-x', kind: 'grammar', targetOverride: 12 } as unknown as Cell['grammarPoint'] });
    expect(resolveCellTarget(c)).toBe(12);
  });
  it('floor sum below base → base wins (vocab base 10)', () => {
    const c = cell({
      exerciseType: ExerciseType.VOCAB_RECALL,
      cefrLevel: CefrLevel.A1,
      grammarPoint: { key: 'tr-a1-vocab-x', kind: 'vocab',
        coverageSpec: { axes: [{ name: 'wordClass', floors: { noun: 6, verb: 2, adjective: 2 } }] } } as unknown as Cell['grammarPoint'],
    });
    expect(resolveCellTarget(c)).toBe(10);
  });
});
