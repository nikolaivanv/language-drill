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
  PERSON_ROTATION_TARGET_MULTIPLIER,
  resolveCellTarget,
} from './cell-targets';
import { TARGET_PER_CELL } from './scheduler-decision';

function makeCell(
  exerciseType: ExerciseType,
  cefrLevel: CurriculumCefrLevel,
  targetOverride?: number,
  personRotation?: boolean,
): Cell {
  const grammarPoint = {
    key: 'es-test',
    language: Language.ES,
    cefrLevel,
    title: 'test',
    summary: 'test',
    ...(targetOverride !== undefined ? { targetOverride } : {}),
    ...(personRotation !== undefined ? { personRotation } : {}),
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

  it('raises cloze/translation targets 1.5× for personRotation points (2026-06-12)', () => {
    // Audit-skewed cells were at/near target → skip-target-reached → the
    // rotation fix never reaches the pool without headroom.
    expect(PERSON_ROTATION_TARGET_MULTIPLIER).toBe(1.5);
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A1, undefined, true)),
    ).toBe(30); // 20 × 1.5
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A2, undefined, true)),
    ).toBe(45); // 30 × 1.5
    expect(
      resolveCellTarget(makeCell(ExerciseType.TRANSLATION, CefrLevel.A1, undefined, true)),
    ).toBe(30);
    // Fallback-resolved levels are raised too (50 → 75).
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.B1, undefined, true)),
    ).toBe(Math.ceil(TARGET_PER_CELL * PERSON_ROTATION_TARGET_MULTIPLIER));
  });

  it('does not raise sentence_construction or override-resolved targets', () => {
    // The raise exists to flush the audited 3sg skew out of cloze/translation
    // pools; SC already gained headroom when the pilot brake lifted (25 → 30
    // at A2, 50 at B1/B2), so a flagged point resolves SC at the plain table
    // value.
    expect(
      resolveCellTarget(
        makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.A2, undefined, true),
      ),
    ).toBe(30);
    // An explicit targetOverride marks a supply-limited point — respected as-is.
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A1, 12, true)),
    ).toBe(12);
    // Unflagged cells are untouched.
    expect(
      resolveCellTarget(makeCell(ExerciseType.CLOZE, CefrLevel.A1, undefined, false)),
    ).toBe(20);
  });
});
