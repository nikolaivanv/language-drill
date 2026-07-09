/**
 * Tests for the generation `CellFailed` EMF emitter — mirrors the theory
 * pipeline's metrics test. Asserts the emit/no-emit decision per outcome and
 * the EMF envelope shape CloudWatch Logs auto-extraction depends on.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { emitCellCostMetric, emitCellOutcomeMetric } from './metrics';

let consoleLogSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
});

function soleEmittedRecord(): Record<string, unknown> {
  expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  const arg = consoleLogSpy.mock.calls[0]?.[0];
  expect(typeof arg).toBe('string');
  return JSON.parse(arg as string) as Record<string, unknown>;
}

describe('emitCellOutcomeMetric (generation)', () => {
  it("emits CellFailed=1 on a 'failed' outcome", () => {
    emitCellOutcomeMetric('failed', 'prod');
    expect(soleEmittedRecord()['CellFailed']).toBe(1);
  });

  it("emits CellFailed=0 on a 'succeeded' outcome", () => {
    emitCellOutcomeMetric('succeeded', 'prod');
    expect(soleEmittedRecord()['CellFailed']).toBe(0);
  });

  it("does NOT emit on 'skipped-cost-cap'", () => {
    emitCellOutcomeMetric('skipped-cost-cap', 'prod');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('emits the EMF envelope with the LanguageDrill/Generation namespace and env dimension', () => {
    emitCellOutcomeMetric('failed', 'dev');
    const record = soleEmittedRecord();
    expect(record['env']).toBe('dev');
    expect(record['CellFailed']).toBe(1);
    const aws = record['_aws'] as Record<string, unknown>;
    expect(typeof aws['Timestamp']).toBe('number');
    const directives = aws['CloudWatchMetrics'] as Array<Record<string, unknown>>;
    expect(directives).toHaveLength(1);
    const directive = directives[0]!;
    expect(directive['Namespace']).toBe('LanguageDrill/Generation');
    expect(directive['Dimensions']).toEqual([['env']]);
    expect(directive['Metrics']).toEqual([{ Name: 'CellFailed' }]);
  });
});

describe('emitCellCostMetric (generation)', () => {
  it('emits the cost as the CellCostUsd value', () => {
    emitCellCostMetric(0.6321, 'prod');
    expect(soleEmittedRecord()['CellCostUsd']).toBe(0.6321);
  });

  it('emits a zero-cost point (e.g. skipped-cost-cap / precheck-fail)', () => {
    emitCellCostMetric(0, 'prod');
    const record = soleEmittedRecord();
    expect(record['CellCostUsd']).toBe(0);
  });

  it('emits the EMF envelope with the LanguageDrill/Generation namespace and env dimension', () => {
    emitCellCostMetric(1.49, 'dev');
    const record = soleEmittedRecord();
    expect(record['env']).toBe('dev');
    expect(record['CellCostUsd']).toBe(1.49);
    const aws = record['_aws'] as Record<string, unknown>;
    expect(typeof aws['Timestamp']).toBe('number');
    const directives = aws['CloudWatchMetrics'] as Array<Record<string, unknown>>;
    expect(directives).toHaveLength(1);
    const directive = directives[0]!;
    expect(directive['Namespace']).toBe('LanguageDrill/Generation');
    expect(directive['Dimensions']).toEqual([['env']]);
    expect(directive['Metrics']).toEqual([{ Name: 'CellCostUsd', Unit: 'None' }]);
  });
});
