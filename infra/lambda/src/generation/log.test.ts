import { describe, it, expect } from 'vitest';
import { ZERO_USAGE } from '@language-drill/ai';
import {
  CefrLevel,
  ExerciseType,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import {
  ALL_CURRICULA,
  type Cell,
  type CellResult,
  type CurriculumCefrLevel,
} from '@language-drill/db';

import { errMessage, summarizeResult } from './log';

// ---------------------------------------------------------------------------
// errMessage
// ---------------------------------------------------------------------------

describe('errMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });

  it('returns the message of an Error subclass (instanceof matches)', () => {
    class CustomError extends Error {}
    expect(errMessage(new CustomError('subclass-boom'))).toBe('subclass-boom');
  });

  it("returns 'null' for null", () => {
    expect(errMessage(null)).toBe('null');
  });

  it("returns 'undefined' for undefined", () => {
    expect(errMessage(undefined)).toBe('undefined');
  });

  it('returns the string itself for a plain string', () => {
    expect(errMessage('plain string')).toBe('plain string');
  });

  it("returns '123' for a number", () => {
    expect(errMessage(123)).toBe('123');
  });

  it("returns '[object Object]' for a plain object", () => {
    expect(errMessage({ foo: 'bar' })).toBe('[object Object]');
  });
});

// ---------------------------------------------------------------------------
// summarizeResult
// ---------------------------------------------------------------------------

const TEST_GRAMMAR_POINT_KEY = 'es-b1-present-subjunctive';
const TEST_CELL_KEY = `es:b1:cloze:${TEST_GRAMMAR_POINT_KEY}`;

function buildCell(): Cell {
  const grammarPoint = ALL_CURRICULA.find(
    (g) => g.key === TEST_GRAMMAR_POINT_KEY,
  );
  if (!grammarPoint) {
    throw new Error(
      `Test fixture missing: grammar point '${TEST_GRAMMAR_POINT_KEY}' not in ALL_CURRICULA`,
    );
  }
  return {
    language: Language.ES as LearningLanguage,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    exerciseType: ExerciseType.CLOZE,
    grammarPoint,
    cellKey: TEST_CELL_KEY,
  };
}

function cellResultBase(): CellResult {
  return {
    cell: buildCell(),
    jobId: 'job-test',
    status: 'succeeded',
    insertedCount: 0,
    skippedCount: 0,
    tokenUsage: ZERO_USAGE,
    costUsd: 0,
    durationMs: 0,
    inBatchDuplicateCount: 0,
    validatedCount: 0,
    flaggedCount: 0,
    rejectedCount: 0,
    dedupGivenUpCount: 0,
    malformedDraftCount: 0,
  };
}

describe('summarizeResult', () => {
  it('returns all-zero output for an all-zero CellResult', () => {
    expect(summarizeResult(cellResultBase())).toEqual({
      inserted: 0,
      approved: 0,
      flagged: 0,
      rejected: 0,
      dedupGivenUp: 0,
      malformedDrafts: 0,
      durationMs: 0,
    });
  });

  it('derives approved = inserted - flagged (10 inserted, 3 flagged → 7 approved)', () => {
    const r: CellResult = {
      ...cellResultBase(),
      insertedCount: 10,
      flaggedCount: 3,
    };
    expect(summarizeResult(r)).toEqual({
      inserted: 10,
      approved: 7,
      flagged: 3,
      rejected: 0,
      dedupGivenUp: 0,
      malformedDrafts: 0,
      durationMs: 0,
    });
  });

  it('handles inserted == flagged → approved = 0 (every row was flagged)', () => {
    const r: CellResult = {
      ...cellResultBase(),
      insertedCount: 5,
      flaggedCount: 5,
    };
    expect(summarizeResult(r)).toEqual({
      inserted: 5,
      approved: 0,
      flagged: 5,
      rejected: 0,
      dedupGivenUp: 0,
      malformedDrafts: 0,
      durationMs: 0,
    });
  });

  it("handles zero inserted + zero flagged on a 'failed' cell → approved = 0", () => {
    const r: CellResult = {
      ...cellResultBase(),
      status: 'failed',
      errorMessage: 'generator failed',
      insertedCount: 0,
      flaggedCount: 0,
    };
    expect(summarizeResult(r)).toEqual({
      inserted: 0,
      approved: 0,
      flagged: 0,
      rejected: 0,
      dedupGivenUp: 0,
      malformedDrafts: 0,
      durationMs: 0,
    });
  });

  it('passes durationMs through unchanged (no rounding, no unit conversion)', () => {
    const r: CellResult = {
      ...cellResultBase(),
      durationMs: 180_000,
    };
    expect(summarizeResult(r)).toEqual({
      inserted: 0,
      approved: 0,
      flagged: 0,
      rejected: 0,
      dedupGivenUp: 0,
      malformedDrafts: 0,
      durationMs: 180_000,
    });
  });

  it("projects all count fields on a 'failed' status — projection is not gated on status", () => {
    const r: CellResult = {
      ...cellResultBase(),
      status: 'failed',
      errorMessage: 'something exploded',
      insertedCount: 4,
      flaggedCount: 1,
      rejectedCount: 2,
      dedupGivenUpCount: 1,
      durationMs: 1234,
    };
    expect(summarizeResult(r)).toEqual({
      inserted: 4,
      approved: 3,
      flagged: 1,
      rejected: 2,
      dedupGivenUp: 1,
      malformedDrafts: 0,
      durationMs: 1234,
    });
  });

  it('surfaces malformedDraftCount on the projection (production-incident signal)', () => {
    const r: CellResult = {
      ...cellResultBase(),
      insertedCount: 49,
      flaggedCount: 0,
      rejectedCount: 0,
      malformedDraftCount: 1,
      durationMs: 360_000,
    };
    expect(summarizeResult(r)).toEqual({
      inserted: 49,
      approved: 49,
      flagged: 0,
      rejected: 0,
      dedupGivenUp: 0,
      malformedDrafts: 1,
      durationMs: 360_000,
    });
  });
});
