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
  SENTENCE_CONSTRUCTION_PILOT_TARGET,
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

  it('caps every active sentence_construction level at the pilot brake (2026-06-07)', () => {
    // TEMPORARY: the SC prompt fix is unconfirmed, so A2/B1/B2 are throttled to
    // SENTENCE_CONSTRUCTION_PILOT_TARGET instead of 30 (A2) / 50 (B1/B2 fallback).
    // When the fix is validated via eval:gen and the brake is lifted, this test
    // reverts to A2=30 and B1=TARGET_PER_CELL.
    expect(SENTENCE_CONSTRUCTION_PILOT_TARGET).toBeLessThan(TARGET_PER_CELL);
    expect(
      resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.A2)),
    ).toBe(SENTENCE_CONSTRUCTION_PILOT_TARGET);
    expect(
      resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.B1)),
    ).toBe(SENTENCE_CONSTRUCTION_PILOT_TARGET);
    expect(
      resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.B2)),
    ).toBe(SENTENCE_CONSTRUCTION_PILOT_TARGET);
    // A1 SC (no active cells today) keeps its narrow default.
    expect(
      resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.A1)),
    ).toBe(20);
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

  it('does not raise sentence_construction (pilot brake) or override-resolved targets', () => {
    // SC keeps the 2026-06-07 pilot brake even on a flagged point.
    expect(
      resolveCellTarget(
        makeCell(ExerciseType.SENTENCE_CONSTRUCTION, CefrLevel.A2, undefined, true),
      ),
    ).toBe(SENTENCE_CONSTRUCTION_PILOT_TARGET);
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
