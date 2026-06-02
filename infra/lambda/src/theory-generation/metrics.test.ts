/**
 * Tests for the `CellFailed` EMF emitter (spec Component 4, Req 3.1–3.3).
 *
 * Asserts the emit/no-emit decision per outcome and the EMF envelope shape
 * (namespace, single `env` dimension, metric name/value) that CloudWatch Logs
 * auto-extraction depends on.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { emitCellOutcomeMetric } from './metrics';

let consoleLogSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
});

/** Parse the single EMF line the emitter wrote. Fails loudly if not exactly one. */
function soleEmittedRecord(): Record<string, unknown> {
  expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  const arg = consoleLogSpy.mock.calls[0]?.[0];
  expect(typeof arg).toBe('string');
  return JSON.parse(arg as string) as Record<string, unknown>;
}

describe('emitCellOutcomeMetric', () => {
  it("emits CellFailed=1 on a 'failed' outcome", () => {
    emitCellOutcomeMetric('failed', 'prod');
    expect(soleEmittedRecord()['CellFailed']).toBe(1);
  });

  it("emits CellFailed=0 on a 'succeeded' outcome", () => {
    emitCellOutcomeMetric('succeeded', 'prod');
    expect(soleEmittedRecord()['CellFailed']).toBe(0);
  });

  it("does NOT emit on 'skipped-cost-cap' (deliberate budget stop, not a failure)", () => {
    emitCellOutcomeMetric('skipped-cost-cap', 'prod');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('emits the EMF envelope with the LanguageDrill/TheoryGeneration namespace and env dimension', () => {
    emitCellOutcomeMetric('failed', 'dev');
    const record = soleEmittedRecord();

    // Top-level env dimension value carried alongside the metric value.
    expect(record['env']).toBe('dev');
    expect(record['CellFailed']).toBe(1);

    // EMF `_aws` envelope shape.
    const aws = record['_aws'] as Record<string, unknown>;
    expect(typeof aws['Timestamp']).toBe('number');

    const directives = aws['CloudWatchMetrics'] as Array<Record<string, unknown>>;
    expect(directives).toHaveLength(1);
    const directive = directives[0]!;
    expect(directive['Namespace']).toBe('LanguageDrill/TheoryGeneration');
    expect(directive['Dimensions']).toEqual([['env']]);
    expect(directive['Metrics']).toEqual([{ Name: 'CellFailed' }]);
  });
});
