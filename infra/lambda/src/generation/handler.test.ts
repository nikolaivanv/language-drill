/**
 * Tests for the SQS event-source handler. Pins every routing branch documented
 * in the design's Error Handling section so the CDK construct can wire this up
 * with confidence (Req 8.5).
 *
 * Mock layout:
 *   - `runOneCell` and `checkAuditRowState` are stubbed (the side-effect-bearing
 *     functions); everything else from `@language-drill/db` (curriculum,
 *     `buildCellKey`, `ROUND_1_CEFR_LEVELS`, types) stays real via
 *     `importOriginal`.
 *   - `createDb` and `createClaudeClient` are stubbed because the handler
 *     constructs cold-start singletons at module load — they must be neutered
 *     before `import { handler } from './handler'`.
 *   - The real `parseGenerationJobMessage` is kept so parse-fail branches throw
 *     real shape errors (Task 10's coverage).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import { ZERO_USAGE } from '@language-drill/ai';
import {
  CefrLevel,
  ExerciseType,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type {
  Cell,
  CellResult,
  CurriculumCefrLevel,
} from '@language-drill/db';

// ---------------------------------------------------------------------------
// Mocks. Vitest hoists vi.mock above imports automatically; the mock factory
// closures still have access to top-level `const` declarations because they're
// resolved lazily.
// ---------------------------------------------------------------------------

const mockRunOneCell = vi.fn();
const mockCheckAuditRowState = vi.fn();
// Observability spies — Task 16 asserts per-record flush + per-record trace
// scope (Req 6.3 / 7.4). Defaults are passthrough/no-op so existing tests
// keep their behaviour; new observability tests inspect `.mock.calls`.
const mockFlushObservability = vi.fn<() => Promise<void>>(
  () => Promise.resolve(),
);
const mockWithLlmTrace = vi.fn(
  <T>(_ctx: unknown, fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(fn()),
);

vi.mock('@language-drill/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@language-drill/db')>();
  return {
    ...actual,
    // Cold-start singleton — never used by tests directly. `as never` is the
    // most permissive cast that compiles for the `Db` return type.
    createDb: vi.fn(() => ({}) as never),
    requireEnv: vi.fn((name: string) => `fake-${name}`),
    runOneCell: (...args: unknown[]) => mockRunOneCell(...args),
  };
});

vi.mock('@language-drill/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@language-drill/ai')>();
  return {
    ...actual,
    createClaudeClient: vi.fn(() => ({}) as never),
    // Drop-in replacement post-Task 15 — the handler's cold-start client is
    // now `createObservedClaudeClient`. `{}` is fine because `runOneCell` is
    // mocked and never inspects the client shape.
    createObservedClaudeClient: vi.fn(() => ({}) as never),
    withLlmTrace: <T>(ctx: unknown, fn: () => T | Promise<T>) =>
      mockWithLlmTrace(ctx, fn),
    flushObservability: () => mockFlushObservability(),
  };
});

vi.mock('./job-message', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./job-message')>();
  return {
    ...actual,
    // Keep the real parseGenerationJobMessage so parse-fail branches throw
    // real shape errors. Only the I/O-bound audit check needs a stub.
    checkAuditRowState: (...args: unknown[]) => mockCheckAuditRowState(...args),
  };
});

import { handler } from './handler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ValidMessage = {
  jobId: string;
  trigger: 'cli' | 'scheduled' | 'admin';
  spec: {
    language: LearningLanguage;
    cefrLevel: CurriculumCefrLevel;
    exerciseType: ExerciseType;
    grammarPointKey: string;
    topicDomain: string | null;
    count: number;
    batchSeed: string;
  };
  maxCostUsd: number;
};

function validMessage(): ValidMessage {
  return {
    jobId: 'job-test-123',
    trigger: 'cli',
    // The grammar-point key below is asserted to exist in the ES curriculum
    // (see packages/db/src/curriculum/es.ts:161). Don't change it without
    // verifying the new key is present in ALL_CURRICULA.
    spec: {
      language: Language.ES as LearningLanguage,
      cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
      exerciseType: ExerciseType.CLOZE,
      grammarPointKey: 'es-b1-present-subjunctive',
      topicDomain: null,
      count: 5,
      batchSeed: 'phase-4-test',
    },
    maxCostUsd: 0.5,
  };
}

function recordWith(body: string, messageId = 'msg-1'): SQSRecord {
  return { messageId, body } as unknown as SQSRecord;
}

function eventWith(records: SQSRecord[]): SQSEvent {
  return { Records: records } as SQSEvent;
}

function buildCell(): Cell {
  return {
    language: Language.ES as LearningLanguage,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    exerciseType: ExerciseType.CLOZE,
    // grammarPoint shape is opaque to these tests; runOneCell is mocked, so
    // its real curriculum entry is never inspected. The handler resolves the
    // real one from the curriculum before invoking runOneCell.
    grammarPoint: {
      key: 'es-b1-present-subjunctive',
    } as unknown as Cell['grammarPoint'],
    cellKey: 'es:b1:cloze:es-b1-present-subjunctive',
  };
}

function cellResultBase(): CellResult {
  return {
    cell: buildCell(),
    jobId: 'job-test-123',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan captured `console.log` calls (each `[0]` is the JSON string the handler
 * emitted) and return the first parsed entry matching `predicate`. Throws if
 * none match — assertion failures point at the missing log line directly.
 */
function findLogLine(
  spy: MockInstance<typeof console.log>,
  predicate: (entry: Record<string, unknown>) => boolean,
): Record<string, unknown> {
  for (const call of spy.mock.calls) {
    const arg = call[0];
    if (typeof arg !== 'string') continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(arg) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (predicate(entry)) return entry;
  }
  const dump = spy.mock.calls.map((c) => c[0]).join('\n');
  throw new Error(`no log line matched predicate. captured:\n${dump}`);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let consoleLogSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  vi.clearAllMocks();
  // `vi.clearAllMocks()` clears call records but preserves implementations.
  // Re-pin the trace + flush spies defensively so each test starts with the
  // documented passthrough/no-op behaviour even if a prior test patched them.
  mockWithLlmTrace.mockImplementation(
    <T>(_ctx: unknown, fn: () => T | Promise<T>): Promise<T> =>
      Promise.resolve(fn()),
  );
  mockFlushObservability.mockImplementation(() => Promise.resolve());
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  delete process.env['ENV_NAME'];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SQS handler', () => {
  it('valid record + runOneCell succeeds → no batchItemFailures, success log emitted', async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 5,
      flaggedCount: 1,
      durationMs: 1234,
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-success'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneCell).toHaveBeenCalledTimes(1);
    const success = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'cell succeeded',
    );
    expect(success['level']).toBe('info');
    expect(success['inserted']).toBe(5);
    expect(success['approved']).toBe(4);
    expect(success['flagged']).toBe(1);
  });

  it('malformed record body (not JSON) → messageId in failures, never calls audit check', async () => {
    const event = eventWith([recordWith('not-json', 'msg-malformed')]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-malformed' },
    ]);
    expect(mockCheckAuditRowState).not.toHaveBeenCalled();
    expect(mockRunOneCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'failed to parse SQS message',
    );
    expect(log['level']).toBe('error');
    expect(log['body']).toBe('not-json');
  });

  it('body length > 1000 chars + malformed JSON → captured log body has length === 500', async () => {
    // ~2001 chars; leading `{` makes JSON.parse choke partway through, so the
    // parse-fail branch fires.
    const longBody = '{' + 'A'.repeat(2000);
    expect(longBody.length).toBeGreaterThan(1000);

    const event = eventWith([recordWith(longBody, 'msg-long')]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-long' },
    ]);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'failed to parse SQS message',
    );
    expect(typeof log['body']).toBe('string');
    expect((log['body'] as string).length).toBe(500);
  });

  it('curriculum miss → outer catch pushes; runOneCell never called', async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });

    const msg = validMessage();
    msg.spec.grammarPointKey = 'es-b1-fake-grammar-point';

    const event = eventWith([recordWith(JSON.stringify(msg), 'msg-miss')]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-miss' },
    ]);
    expect(mockRunOneCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'unhandled error in per-record flow',
    );
    expect(log['level']).toBe('error');
    expect(String(log['error'])).toContain('es-b1-fake-grammar-point');
  });

  it("audit row 'in-progress' → messageId in failures, runOneCell not called", async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'in-progress' });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-inprogress'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-inprogress' },
    ]);
    expect(mockRunOneCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'already running; deferring',
    );
    expect(log['level']).toBe('warn');
  });

  it("audit row 'completed', jobStatus 'succeeded' → silent skip, runOneCell not called", async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({
      status: 'completed',
      jobStatus: 'succeeded',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-done-ok'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'already succeeded; skipping',
    );
    expect(log['level']).toBe('info');
  });

  it("audit row 'completed', jobStatus 'failed' → silent skip, log carries 'already failed; skipping'", async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({
      status: 'completed',
      jobStatus: 'failed',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-done-failed'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'already failed; skipping',
    );
    expect(log['level']).toBe('info');
  });

  it("out-of-scope CEFR level 'C1' → messageId in failures, audit not consulted", async () => {
    const msg = validMessage();
    // The parser permits C1/C2 for forward-compat; the handler narrows.
    msg.spec.cefrLevel = 'C1' as CurriculumCefrLevel;

    const event = eventWith([recordWith(JSON.stringify(msg), 'msg-c1')]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-c1' },
    ]);
    expect(mockCheckAuditRowState).not.toHaveBeenCalled();
    expect(mockRunOneCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'out-of-scope CEFR level',
    );
    expect(log['level']).toBe('warn');
    expect(log['cefrLevel']).toBe('C1');
  });

  it("ENV_NAME='production' + trigger='cli' → rejected before audit / run", async () => {
    process.env['ENV_NAME'] = 'production';

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-prod-cli'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-prod-cli' },
    ]);
    expect(mockCheckAuditRowState).not.toHaveBeenCalled();
    expect(mockRunOneCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'rejecting cli-trigger in production',
    );
    expect(log['level']).toBe('warn');
  });

  it("ENV_NAME='production' + trigger='scheduled' → allowed through", async () => {
    process.env['ENV_NAME'] = 'production';
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 3,
    });

    const msg = validMessage();
    msg.trigger = 'scheduled';

    const event = eventWith([
      recordWith(JSON.stringify(msg), 'msg-prod-scheduled'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneCell).toHaveBeenCalledTimes(1);
  });

  it('runOneCell throws → messageId in failures, error log captured', async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell.mockRejectedValueOnce(new Error('boom'));

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-throw'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-throw' },
    ]);
    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'runOneCell threw',
    );
    expect(log['level']).toBe('error');
    expect(log['error']).toBe('boom');
  });

  it("runOneCell returns 'failed' → NO batchItemFailures (Req 2.4 amendment), terminal log emitted", async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'failed',
      errorMessage: 'cap exceeded',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-failed'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneCell).toHaveBeenCalledTimes(1);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'cell terminal-failed',
    );
    expect(log['level']).toBe('warn');
    expect(log['status']).toBe('failed');
    expect(log['errorMessage']).toBe('cap exceeded');
  });

  it("runOneCell returns 'skipped-cost-cap' → NO batchItemFailures, terminal log emitted", async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'skipped-cost-cap',
      errorMessage: 'cost cap reached at $0.50',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-cap'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneCell).toHaveBeenCalledTimes(1);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'cell terminal-failed',
    );
    expect(log['status']).toBe('skipped-cost-cap');
    expect(log['errorMessage']).toBe('cost cap reached at $0.50');
  });
});

// ---------------------------------------------------------------------------
// Task 16: per-record flush + per-record trace scope (Req 6.3, 7.4)
// ---------------------------------------------------------------------------
//
// The SQS handler wraps each record in `try/catch/finally` where the `finally`
// drains Langfuse traces via `flushObservability`. The `runOneCell` call is
// itself wrapped in `withLlmTrace` so the Anthropic Proxy can tag every
// generate + validate call inside one cell-job with the shared metadata
// (jobId, cellKey, language, cefr, type). These tests prove:
//   - flush runs once per record on success AND every failure branch,
//   - the trace scope is opened around `runOneCell` with the right metadata,
//   - with Langfuse env vars absent (vitest default), batchItemFailures is
//     byte-identical to the pre-spec contract.

describe('SQS handler — observability flush + trace scope', () => {
  it('success path → flushObservability called exactly once per record', async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 5,
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-flush-ok'),
    ]);
    await handler(event);

    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it('runOneCell throws → flushObservability still called exactly once per record', async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell.mockRejectedValueOnce(new Error('upstream timeout'));

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-flush-throw'),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-flush-throw' },
    ]);
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it('pre-trace gate (parse fail) → flushObservability still called exactly once', async () => {
    // Parse fail short-circuits *before* `withLlmTrace` is ever entered.
    // The per-record `finally` MUST still flush — that's the contract for
    // every code path through the loop, not just the ones that opened a
    // trace.
    const event = eventWith([recordWith('not-json', 'msg-flush-parse')]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-flush-parse' },
    ]);
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
    // No trace ever opened — parse fail short-circuits before runOneCell.
    expect(mockWithLlmTrace).not.toHaveBeenCalled();
  });

  it('two-record batch → flushObservability called exactly twice (once per record)', async () => {
    mockCheckAuditRowState
      .mockResolvedValueOnce({ status: 'absent' })
      .mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell
      .mockResolvedValueOnce({
        ...cellResultBase(),
        status: 'succeeded',
        insertedCount: 5,
      })
      .mockRejectedValueOnce(new Error('boom'));

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-batch-1'),
      recordWith(JSON.stringify(validMessage()), 'msg-batch-2'),
    ]);
    const result = await handler(event);

    // Only the failing record reports a batchItemFailure.
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-batch-2' },
    ]);
    // One flush per record, regardless of per-record outcome.
    expect(mockFlushObservability).toHaveBeenCalledTimes(2);
  });

  it('trace scope is entered around runOneCell with the cell + job metadata', async () => {
    mockCheckAuditRowState.mockResolvedValueOnce({ status: 'absent' });

    // Capture the order of (a) withLlmTrace entry and (b) runOneCell entry
    // so we can prove the trace ALS scope is open when runOneCell runs.
    const callOrder: string[] = [];
    mockWithLlmTrace.mockImplementationOnce(
      <T>(ctx: unknown, fn: () => T | Promise<T>): Promise<T> => {
        callOrder.push(`withLlmTrace:enter(${(ctx as { feature: string }).feature})`);
        return Promise.resolve(fn()).then((v) => {
          callOrder.push('withLlmTrace:exit');
          return v;
        });
      },
    );
    mockRunOneCell.mockImplementationOnce(async () => {
      callOrder.push('runOneCell');
      return {
        ...cellResultBase(),
        status: 'succeeded',
        insertedCount: 5,
      };
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-trace-ctx'),
    ]);
    await handler(event);

    // Sequence proof: trace opens → runOneCell runs → trace closes.
    expect(callOrder).toEqual([
      'withLlmTrace:enter(generate)',
      'runOneCell',
      'withLlmTrace:exit',
    ]);

    // Context contents — the Proxy reads these from ALS to tag every
    // `messages.create` issued by runOneCell. `feature='generate'` is the
    // shared default; the Proxy overrides it to 'validate' for
    // validation tool calls via TOOL_NAME_TO_FEATURE.
    expect(mockWithLlmTrace).toHaveBeenCalledTimes(1);
    const ctx = mockWithLlmTrace.mock.calls[0]![0] as {
      feature: string;
      env: string;
      promptVersion: string;
      requestId: string;
      jobId: string;
      cellKey: string;
      language: string;
      cefrLevel: string;
      exerciseType: string;
    };
    expect(ctx.feature).toBe('generate');
    expect(ctx.requestId).toBe('msg-trace-ctx');
    expect(ctx.jobId).toBe('job-test-123');
    expect(ctx.cellKey).toBe('es:b1:cloze:es-b1-present-subjunctive');
    expect(ctx.language).toBe('ES');
    expect(ctx.cefrLevel).toBe('B1');
    expect(ctx.exerciseType).toBe('cloze');
    // The version string is the literal from packages/ai/src/generation-prompts.ts.
    // Match the date-stamped format `generate@YYYY-MM-DD` without locking the date.
    expect(ctx.promptVersion).toMatch(/^generate@\d{4}-\d{2}-\d{2}$/);
  });

  it('LANGFUSE_PUBLIC_KEY unset (default) → batchItemFailures shape is byte-identical to pre-spec', async () => {
    // Defensive: vitest leaves Langfuse env vars unset by default, but
    // a prior test could have leaked them. This test pins the no-op
    // contract end-to-end (Req 7 AC 4): the handler's return value is
    // determined entirely by record-parse, gate, and runOneCell outcomes —
    // never by the observability layer.
    expect(process.env['LANGFUSE_PUBLIC_KEY']).toBeUndefined();

    mockCheckAuditRowState
      .mockResolvedValueOnce({ status: 'absent' })
      .mockResolvedValueOnce({ status: 'absent' });
    mockRunOneCell
      .mockResolvedValueOnce({
        ...cellResultBase(),
        status: 'succeeded',
        insertedCount: 5,
      })
      .mockRejectedValueOnce(new Error('boom'));

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-noop-1'),
      recordWith(JSON.stringify(validMessage()), 'msg-noop-2'),
      recordWith('not-json', 'msg-noop-3'),
    ]);
    const result = await handler(event);

    // Same shape pre-spec would emit: only the runOneCell-throw and the
    // parse-fail records report as batchItemFailures.
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-noop-2' },
      { itemIdentifier: 'msg-noop-3' },
    ]);
  });
});
