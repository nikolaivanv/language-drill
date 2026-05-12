import { describe, it, expect } from 'vitest';
import type { TheoryCellResult } from '@language-drill/db';

import { errMessage, summarizeTheoryResult } from './log';

// ---------------------------------------------------------------------------
// errMessage
// ---------------------------------------------------------------------------

describe('errMessage', () => {
  it("returns the message field of an Error('boom')", () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });

  it("returns the string as-is when a string was thrown ('string thrown')", () => {
    expect(errMessage('string thrown')).toBe('string thrown');
  });

  it("coerces an object via String(value) → '[object Object]'", () => {
    expect(errMessage({ code: 500 })).toBe('[object Object]');
  });

  it("coerces undefined via String(undefined) → 'undefined'", () => {
    expect(errMessage(undefined)).toBe('undefined');
  });

  it("coerces null via String(null) → 'null'", () => {
    expect(errMessage(null)).toBe('null');
  });

  it('preserves a subclass Error message', () => {
    class CustomError extends Error {}
    expect(errMessage(new CustomError('subclass-boom'))).toBe('subclass-boom');
  });
});

// ---------------------------------------------------------------------------
// summarizeTheoryResult
//
// `TheoryCellResult` exposes `insertedCount: 0 | 1` and `skippedCount: 0 | 1`
// (no flagged/rejected counts — those verdicts live on the audit row's
// boolean columns and are logged by the handler via `status`/`errorMessage`,
// not the summarizer). The four router branches produce these four shapes:
//
//   - auto-approved → insertedCount=1, skippedCount=0
//   - flagged       → insertedCount=1, skippedCount=0   (same shape as
//                                                        auto-approved at
//                                                        the result level)
//   - rejected      → insertedCount=0, skippedCount=0
//   - dedup-skip    → insertedCount=0, skippedCount=1   (partial unique
//                                                        index collision)
// ---------------------------------------------------------------------------

function buildResult(
  overrides: Partial<TheoryCellResult> = {},
): TheoryCellResult {
  return {
    cell: {
      language: 'ES',
      cefrLevel: 'B1',
      grammarPoint: {
        key: 'es-b1-present-subjunctive',
        kind: 'grammar',
        language: 'ES',
        cefrLevel: 'B1',
        slug: 'present-subjunctive',
        displayName: 'Present subjunctive',
      },
      cellKey: 'es-b1-grammar-present-subjunctive',
    } as unknown as TheoryCellResult['cell'],
    jobId: 'job-fixture-001',
    status: 'succeeded',
    insertedCount: 0,
    skippedCount: 0,
    tokenUsage: {
      inputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 50,
    },
    costUsd: 0.01,
    durationMs: 12_345,
    ...overrides,
  };
}

describe('summarizeTheoryResult', () => {
  it('projects an auto-approved cell (insertedCount=1, skippedCount=0)', () => {
    const result = buildResult({ insertedCount: 1, skippedCount: 0 });

    expect(summarizeTheoryResult(result)).toEqual({
      inserted: 1,
      skipped: 0,
      durationMs: 12_345,
    });
  });

  it('projects a flagged cell (insertedCount=1, skippedCount=0)', () => {
    // Flagged rows still INSERT into theory_topics, so insertedCount=1.
    // The audit row carries `flagged=true`; the summarizer does not.
    const result = buildResult({ insertedCount: 1, skippedCount: 0 });

    expect(summarizeTheoryResult(result)).toEqual({
      inserted: 1,
      skipped: 0,
      durationMs: 12_345,
    });
  });

  it('projects a rejected cell (insertedCount=0, skippedCount=0)', () => {
    // Rejected rows do not INSERT. The audit row carries `rejected=true`.
    const result = buildResult({ insertedCount: 0, skippedCount: 0 });

    expect(summarizeTheoryResult(result)).toEqual({
      inserted: 0,
      skipped: 0,
      durationMs: 12_345,
    });
  });

  it('projects a dedup-skip cell (insertedCount=0, skippedCount=1)', () => {
    const result = buildResult({ insertedCount: 0, skippedCount: 1 });

    expect(summarizeTheoryResult(result)).toEqual({
      inserted: 0,
      skipped: 1,
      durationMs: 12_345,
    });
  });

  it('passes through durationMs unchanged', () => {
    const result = buildResult({ durationMs: 987_654 });

    expect(summarizeTheoryResult(result).durationMs).toBe(987_654);
  });
});
