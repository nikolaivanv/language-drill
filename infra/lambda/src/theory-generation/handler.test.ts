/**
 * Tests for the SQS event-source handler. Pins every routing branch documented
 * in the design's Component 2 + Error Handling §1–§9 so the CDK construct can
 * wire this up with confidence (Req 8.3, 8.4).
 *
 * Mock layout:
 *   - `runOneTheoryCell` and `checkTheoryAuditRowState` are stubbed (the side-
 *     effect-bearing functions); everything else from `@language-drill/db`
 *     (curriculum, `buildTheoryCellKey`, `THEORY_ROUND_1_CEFR_LEVELS`, types)
 *     stays real via `importOriginal`.
 *   - `createDb` and `createClaudeClient` are stubbed because the handler
 *     constructs cold-start singletons at module load — they must be neutered
 *     before `import { handler } from './handler'`.
 *   - The real `parseTheoryGenerationJobMessage` is kept so parse-fail branches
 *     throw real shape errors.
 *
 * The kind-check branch (Req 2.7) uses the real ES B1 vocab umbrella
 * `es-b1-environment-vocab` from `packages/db/src/curriculum/es.ts` rather
 * than mocking `getGrammarPoint`. The soft-deadline tests (Req 2a.2, 2a.5)
 * use a fake `Context` whose `getRemainingTimeInMillis()` returns a per-test
 * value, plus `vi.spyOn(global, 'setTimeout')` / `clearTimeout` to assert
 * arming + clearing.
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
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type {
  CurriculumCefrLevel,
  TheoryCell,
  TheoryCellResult,
} from '@language-drill/db';

// ---------------------------------------------------------------------------
// Mocks. Vitest hoists vi.mock above imports automatically; the mock factory
// closures still have access to top-level `const` declarations because they're
// resolved lazily.
// ---------------------------------------------------------------------------

const mockRunOneTheoryCell = vi.fn();
const mockCheckTheoryAuditRowState = vi.fn();
// Observability spies — Req 2.7 asserts per-record flush + per-record trace
// scope (Req 2.1-2.6). Defaults are passthrough/no-op so existing tests
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
    runOneTheoryCell: (...args: unknown[]) => mockRunOneTheoryCell(...args),
  };
});

vi.mock('@language-drill/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@language-drill/ai')>();
  return {
    ...actual,
    createClaudeClient: vi.fn(() => ({}) as never),
    withLlmTrace: <T>(ctx: unknown, fn: () => T | Promise<T>) =>
      mockWithLlmTrace(ctx, fn),
    flushObservability: () => mockFlushObservability(),
  };
});

vi.mock('./job-message', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./job-message')>();
  return {
    ...actual,
    // Keep the real parseTheoryGenerationJobMessage so parse-fail branches
    // throw real shape errors. Only the I/O-bound audit check needs a stub.
    checkTheoryAuditRowState: (...args: unknown[]) =>
      mockCheckTheoryAuditRowState(...args),
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
    grammarPointKey: string;
    batchSeed: string;
  };
  maxCostUsd: number;
};

function validMessage(): ValidMessage {
  return {
    jobId: 'job-test-123',
    trigger: 'cli',
    // The grammar-point key below is asserted to exist in the ES curriculum
    // (packages/db/src/curriculum/es.ts). Don't change it without verifying
    // the new key is present in ALL_CURRICULA.
    spec: {
      language: Language.ES as LearningLanguage,
      cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
      grammarPointKey: 'es-b1-present-subjunctive',
      batchSeed: 'phase-4-test',
    },
    maxCostUsd: 0.25,
  };
}

function recordWith(body: string, messageId = 'msg-1'): SQSRecord {
  return { messageId, body } as unknown as SQSRecord;
}

function eventWith(records: SQSRecord[]): SQSEvent {
  return { Records: records } as SQSEvent;
}

function makeContext(remainingMs: number): Context {
  return {
    getRemainingTimeInMillis: () => remainingMs,
  } as unknown as Context;
}

function buildCell(): TheoryCell {
  return {
    language: Language.ES as LearningLanguage,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    grammarPoint: {
      key: 'es-b1-present-subjunctive',
    } as unknown as TheoryCell['grammarPoint'],
    cellKey: 'es:b1:es-b1-present-subjunctive',
  };
}

function cellResultBase(): TheoryCellResult {
  return {
    cell: buildCell(),
    jobId: 'job-test-123',
    status: 'succeeded',
    insertedCount: 0,
    skippedCount: 0,
    tokenUsage: ZERO_USAGE,
    costUsd: 0,
    durationMs: 0,
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

describe('SQS handler — guard chain', () => {
  it('parse-fail (jobId=1) → batchItemFailures push; truncated body logged', async () => {
    const event = eventWith([recordWith('{"jobId":1}', 'msg-bad-jobid')]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-bad-jobid' },
    ]);
    expect(mockCheckTheoryAuditRowState).not.toHaveBeenCalled();
    expect(mockRunOneTheoryCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'failed to parse SQS message',
    );
    expect(log['level']).toBe('error');
    expect(log['body']).toBe('{"jobId":1}');
  });

  it('body length > 500 chars + malformed JSON → captured log body length === 500', async () => {
    const longBody = '{' + 'A'.repeat(2000);
    const event = eventWith([recordWith(longBody, 'msg-long')]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-long' }]);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'failed to parse SQS message',
    );
    expect((log['body'] as string).length).toBe(500);
  });

  it("C1 narrowing → push, runOneTheoryCell never called", async () => {
    const msg = validMessage();
    msg.spec.cefrLevel = 'C1' as CurriculumCefrLevel;

    const event = eventWith([recordWith(JSON.stringify(msg), 'msg-c1')]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-c1' }]);
    expect(mockCheckTheoryAuditRowState).not.toHaveBeenCalled();
    expect(mockRunOneTheoryCell).not.toHaveBeenCalled();

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
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-prod-cli' },
    ]);
    expect(mockCheckTheoryAuditRowState).not.toHaveBeenCalled();
    expect(mockRunOneTheoryCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'rejecting cli-trigger in production',
    );
    expect(log['level']).toBe('warn');
  });

  it("audit row 'completed' → silent ack (no push), runOneTheoryCell not called", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({
      status: 'completed',
      jobStatus: 'succeeded',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-done'),
    ]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneTheoryCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'already succeeded; skipping',
    );
    expect(log['level']).toBe('info');
  });

  it("audit row 'in-progress' → push, runOneTheoryCell not called", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({
      status: 'in-progress',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-inprogress'),
    ]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-inprogress' },
    ]);
    expect(mockRunOneTheoryCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'already running; deferring',
    );
    expect(log['level']).toBe('warn');
  });

  it('curriculum miss → outer catch pushes; runOneTheoryCell never called', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });

    const msg = validMessage();
    msg.spec.grammarPointKey = 'es-b1-no-such-point';

    const event = eventWith([recordWith(JSON.stringify(msg), 'msg-miss')]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-miss' }]);
    expect(mockRunOneTheoryCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'unhandled error in per-record flow',
    );
    expect(log['level']).toBe('error');
    expect(String(log['error'])).toContain('es-b1-no-such-point');
  });

  it('kind=vocab (real es-b1-environment-vocab) → push, runOneTheoryCell never called', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });

    const msg = validMessage();
    msg.spec.grammarPointKey = 'es-b1-environment-vocab';

    const event = eventWith([recordWith(JSON.stringify(msg), 'msg-vocab')]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-vocab' }]);
    expect(mockRunOneTheoryCell).not.toHaveBeenCalled();

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'curriculum entry is not a grammar point',
    );
    expect(log['level']).toBe('warn');
    expect(log['kind']).toBe('vocab');
    expect(log['grammarPointKey']).toBe('es-b1-environment-vocab');
  });
});

describe('SQS handler — dispatch + result handling', () => {
  it('happy path → runOneTheoryCell called with signal; success log emitted', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 1,
      durationMs: 1234,
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-success'),
    ]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneTheoryCell).toHaveBeenCalledTimes(1);

    const callArgs = mockRunOneTheoryCell.mock.calls[0][0];
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    expect(callArgs.jobId).toBe('job-test-123');
    expect(callArgs.trigger).toBe('cli');
    expect(callArgs.args).toEqual({
      batchSeed: 'phase-4-test',
      maxCostUsd: 0.25,
    });

    const success = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'cell succeeded',
    );
    expect(success['level']).toBe('info');
    expect(success['inserted']).toBe(1);
    expect(success['skipped']).toBe(0);
    expect(success['durationMs']).toBe(1234);
  });

  it('runOneTheoryCell throws → push; error log captured', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockRejectedValueOnce(new Error('boom'));

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-throw'),
    ]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-throw' }]);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'runOneTheoryCell threw',
    );
    expect(log['level']).toBe('error');
    expect(log['error']).toBe('boom');
  });

  it("runOneTheoryCell returns 'failed' → silent ack; warn log", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'failed',
      errorMessage: 'validator rejected',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-failed'),
    ]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([]);
    expect(mockRunOneTheoryCell).toHaveBeenCalledTimes(1);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'cell terminal-failed',
    );
    expect(log['level']).toBe('warn');
    expect(log['status']).toBe('failed');
    expect(log['errorMessage']).toBe('validator rejected');
  });

  it("runOneTheoryCell returns 'skipped-cost-cap' → silent ack; warn log", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'skipped-cost-cap',
      errorMessage: 'cost cap reached at $0.25',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-cap'),
    ]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([]);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'cell terminal-failed',
    );
    expect(log['status']).toBe('skipped-cost-cap');
    expect(log['errorMessage']).toBe('cost cap reached at $0.25');
  });
});

// ---------------------------------------------------------------------------
// CellFailed EMF emission (Req 3.6) — the handler emits the application-level
// failure metric on every terminal *outcome* (failed → 1, succeeded → 0) and
// nothing on `skipped-cost-cap` (a deliberate budget stop, not a failure).
// ---------------------------------------------------------------------------

describe('SQS handler — CellFailed EMF emission', () => {
  /** True if any captured console.log line is an EMF record carrying CellFailed. */
  function emittedCellFailed(): boolean {
    return consoleLogSpy.mock.calls.some((call) => {
      const arg = call[0];
      if (typeof arg !== 'string') return false;
      try {
        return 'CellFailed' in (JSON.parse(arg) as Record<string, unknown>);
      } catch {
        return false;
      }
    });
  }

  it("emits CellFailed=1 on a 'failed' outcome", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'failed',
      errorMessage: 'validator rejected',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-emf-failed'),
    ]);
    await handler(event, makeContext(60_000));

    const emf = findLogLine(consoleLogSpy, (e) => 'CellFailed' in e);
    expect(emf['CellFailed']).toBe(1);
    // EMF envelope shape the CloudWatch alarm keys on.
    const aws = emf['_aws'] as Record<string, unknown>;
    const directive = (aws['CloudWatchMetrics'] as Array<Record<string, unknown>>)[0]!;
    expect(directive['Namespace']).toBe('LanguageDrill/TheoryGeneration');
    expect(emf['env']).toBe('dev');
  });

  it("emits CellFailed=0 on a 'succeeded' outcome", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 1,
      durationMs: 1234,
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-emf-success'),
    ]);
    await handler(event, makeContext(60_000));

    const emf = findLogLine(consoleLogSpy, (e) => 'CellFailed' in e);
    expect(emf['CellFailed']).toBe(0);
  });

  it("emits no CellFailed line on 'skipped-cost-cap'", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'skipped-cost-cap',
      errorMessage: 'cost cap reached at $0.25',
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-emf-cap'),
    ]);
    await handler(event, makeContext(60_000));

    expect(emittedCellFailed()).toBe(false);
  });
});

describe('SQS handler — soft-deadline AbortController (Req 2a)', () => {
  it('arms setTimeout with (remainingMs - 10_000) when remainingMs = 30_000', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 1,
    });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-armed'),
    ]);
    await handler(event, makeContext(30_000));

    // Find the handler's setTimeout call; ignore any internal Node timers.
    const handlerCall = setTimeoutSpy.mock.calls.find(
      (call) => call[1] === 20_000,
    );
    expect(handlerCall).toBeDefined();

    setTimeoutSpy.mockRestore();
  });

  it('clears the timer on normal completion', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 1,
    });

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-clear-ok'),
    ]);
    await handler(event, makeContext(60_000));

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('clears the timer when runOneTheoryCell throws (Req 2a.5 — no timer leak)', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockRejectedValueOnce(new Error('boom'));

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-clear-throw'),
    ]);
    await handler(event, makeContext(60_000));

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('soft-deadline fires → controller.signal aborts mid-call; mock returns failed; silent ack', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });

    // remainingMs=100 → softDeadlineMs = max(100-10_000, 1) = 1 → fires almost
    // immediately. The mock awaits the abort signal then returns failed,
    // mirroring the Phase 3 `failClosed` 'Aborted by user (SIGINT)' branch.
    let observedAborted = false;
    mockRunOneTheoryCell.mockImplementation(async (input: {
      signal: AbortSignal;
    }) => {
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) {
          resolve();
          return;
        }
        input.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      observedAborted = input.signal.aborted;
      return {
        ...cellResultBase(),
        status: 'failed' as const,
        errorMessage: 'Aborted by user (SIGINT)',
      };
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-deadline'),
    ]);
    const result = await handler(event, makeContext(100));

    expect(observedAborted).toBe(true);
    // Silent ack — terminal failure (audit row carries the verdict).
    expect(result.batchItemFailures).toEqual([]);

    const log = findLogLine(
      consoleLogSpy,
      (e) => e['message'] === 'cell terminal-failed',
    );
    expect(log['level']).toBe('warn');
    expect(log['errorMessage']).toBe('Aborted by user (SIGINT)');
  });

  it("safety floor: remainingMs=5_000 → setTimeout called with 1 (Math.max(..., 1) floor, not -5_000)", async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockImplementation(async (input: {
      signal: AbortSignal;
    }) => {
      // Same hang-until-abort pattern so the 1ms timer can actually fire.
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) {
          resolve();
          return;
        }
        input.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        ...cellResultBase(),
        status: 'failed' as const,
        errorMessage: 'Aborted by user (SIGINT)',
      };
    });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-floor'),
    ]);
    await handler(event, makeContext(5_000));

    // 5_000 - 10_000 = -5_000 → Math.max(-5_000, 1) = 1.
    const handlerCall = setTimeoutSpy.mock.calls.find((call) => call[1] === 1);
    expect(handlerCall).toBeDefined();

    setTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// theory-gen-observability-resilience Req 2 — observability flush + trace
// scope. The handler wraps each cell's `runOneTheoryCell` dispatch in
// `withLlmTrace` so the Anthropic Proxy can tag every generate-theory +
// validate-theory call with the shared cell + job metadata, and drains
// buffered traces via `flushObservability` in the inner `finally` (alongside
// the existing `clearTimeout(timer)`).
// ---------------------------------------------------------------------------

describe('SQS handler — observability flush + trace scope (Req 2)', () => {
  it('wraps runOneTheoryCell in withLlmTrace with the expected context shape (Req 2.1, 2.3, 2.7)', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });

    // Capture the order of (a) withLlmTrace entry and (b) runOneTheoryCell
    // entry so we can prove the trace ALS scope is open when the orchestrator
    // runs — the Proxy reads ALS per `messages.create` call.
    const callOrder: string[] = [];
    mockWithLlmTrace.mockImplementationOnce(
      <T>(ctx: unknown, fn: () => T | Promise<T>): Promise<T> => {
        callOrder.push(
          `withLlmTrace:enter(${(ctx as { feature: string }).feature})`,
        );
        return Promise.resolve(fn()).then((v) => {
          callOrder.push('withLlmTrace:exit');
          return v;
        });
      },
    );
    mockRunOneTheoryCell.mockImplementationOnce(async () => {
      callOrder.push('runOneTheoryCell');
      return {
        ...cellResultBase(),
        status: 'succeeded',
        insertedCount: 1,
      };
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-trace-ctx'),
    ]);
    await handler(event, makeContext(60_000));

    // Sequence proof: trace opens → runOneTheoryCell runs → trace closes.
    expect(callOrder).toEqual([
      'withLlmTrace:enter(generate-theory)',
      'runOneTheoryCell',
      'withLlmTrace:exit',
    ]);

    // Context contents — the Proxy reads these from ALS to tag every
    // `messages.create` issued by `runOneTheoryCell`. `feature='generate-theory'`
    // is the shared default; the Proxy overrides it to `'validate-theory'`
    // for the validator tool call via TOOL_NAME_TO_FEATURE.
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
    expect(ctx.feature).toBe('generate-theory');
    expect(ctx.exerciseType).toBe('theory');
    expect(ctx.requestId).toBe('msg-trace-ctx');
    expect(ctx.jobId).toBe('job-test-123');
    expect(ctx.cellKey).toBe('es:b1:es-b1-present-subjunctive');
    expect(ctx.language).toBe('ES');
    expect(ctx.cefrLevel).toBe('B1');
    // env defaults to 'dev' when LANGFUSE_ENV is unset (vitest default).
    expect(ctx.env).toBe('dev');
    // The version string is the literal from
    // packages/ai/src/theory-prompts.ts. Match the date-stamped format
    // `theory-generate@YYYY-MM-DD` without locking the date.
    expect(ctx.promptVersion).toMatch(/^theory-generate@\d{4}-\d{2}-\d{2}$/);
  });

  it('success path → flushObservability called exactly once per record (Req 2.2)', async () => {
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockResolvedValueOnce({
      ...cellResultBase(),
      status: 'succeeded',
      insertedCount: 1,
    });

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-flush-ok'),
    ]);
    await handler(event, makeContext(60_000));

    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it('runOneTheoryCell throws → flushObservability still called exactly once per record (Req 2.2)', async () => {
    // The inner `finally` MUST drain Langfuse traces even when the
    // orchestrator throws, otherwise a Lambda freeze drops the
    // partially-buffered generate-theory trace.
    mockCheckTheoryAuditRowState.mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell.mockRejectedValueOnce(new Error('upstream timeout'));

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-flush-throw'),
    ]);
    const result = await handler(event, makeContext(60_000));

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-flush-throw' },
    ]);
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it('two-record batch → flushObservability called exactly twice (once per record)', async () => {
    mockCheckTheoryAuditRowState
      .mockResolvedValueOnce({ status: 'absent' })
      .mockResolvedValueOnce({ status: 'absent' });
    mockRunOneTheoryCell
      .mockResolvedValueOnce({
        ...cellResultBase(),
        status: 'succeeded',
        insertedCount: 1,
      })
      .mockRejectedValueOnce(new Error('boom'));

    const event = eventWith([
      recordWith(JSON.stringify(validMessage()), 'msg-batch-1'),
      recordWith(JSON.stringify(validMessage()), 'msg-batch-2'),
    ]);
    const result = await handler(event, makeContext(60_000));

    // Only the failing record reports a batchItemFailure.
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-batch-2' },
    ]);
    // One flush per record that reaches the inner try, regardless of
    // per-record outcome.
    expect(mockFlushObservability).toHaveBeenCalledTimes(2);
  });
});
