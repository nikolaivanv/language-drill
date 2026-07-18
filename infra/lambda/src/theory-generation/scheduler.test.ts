/**
 * Tests for the EventBridge-invoked theory scheduler Lambda. Pins the
 * curriculum enumeration → set-based diff → SendMessageBatch invariants
 * documented in design Component 3 + Req 3.x without hitting Postgres or
 * SQS.
 *
 * Mock layout (vitest hoists `vi.mock` above imports automatically):
 *   - `@aws-sdk/client-sqs` is fully stubbed: `SQSClient` returns an object
 *     whose `send` is the captured `mockSqsSend`, and `SendMessageBatchCommand`
 *     is a constructor that records its `input` so the test can decode it.
 *   - `@language-drill/db` is partially stubbed: only `createDb` and
 *     `requireEnv` are replaced. Everything else — `enumerateTheoryCells`,
 *     `chunk`, `deterministicUuid`, `THEORY_ROUND_1_CEFR_LEVELS`,
 *     `ALL_CURRICULA`, `theoryTopics` — is the real implementation via
 *     `importOriginal`.
 *   - The Drizzle chain `db.select(...).from(...).where(...)` is terminated by
 *     `mockWhere` (theory's query has no `GROUP BY` — cells are 0-or-1).
 *
 * Slow-query test: uses a `Date.now` spy with an offset bump inside the
 * mocked `where` to simulate elapsed-time without flaky timers.
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

// ---------------------------------------------------------------------------
// Hoisted mocks. The scheduler module instantiates `new SQSClient(...)` and
// calls `createDb(...)` at top-level (cold-start singletons). vitest hoists
// `vi.mock` factories above all imports, but ordinary `const` declarations in
// this test file run *after* the imported module. `vi.hoisted` lets us share
// state between the mock factories and the test code.
// ---------------------------------------------------------------------------

type ApprovedRow = {
  language: string;
  grammarPointKey: string;
};

type BackoffCountRow = {
  cellKey: string;
  /** COUNT(*) over `rejected = true OR status = 'failed'` in the window. */
  unproductive: number;
  /** FILTERed rejection-only sub-count (Req 4.4 telemetry). */
  rejections: number;
};

const hoisted = vi.hoisted(() => {
  const mockSqsSend = vi.fn<(command: unknown) => Promise<unknown>>(() =>
    Promise.resolve({}),
  );
  // The scheduler now issues two aggregate queries:
  //   - approved-set: `db.select(...).from(...).where(...)` (awaited directly)
  //   - backoff-count: `db.select(...).from(...).where(...).groupBy(...)`
  // The chain returned by `.where(...)` is a thenable that ALSO carries a
  // `.groupBy(...)` method. Awaiting it delegates to `mockWhere(...)`
  // (preserves the existing approved-set behavior); calling `.groupBy(...)`
  // delegates to `mockGroupBy(...)`. Each test configures the two mocks
  // independently via `mockResolvedValueOnce`.
  const mockWhere =
    vi.fn<(...args: unknown[]) => Promise<ApprovedRow[]>>();
  const mockGroupBy =
    vi.fn<(...args: unknown[]) => Promise<BackoffCountRow[]>>();
  const mockFrom = vi.fn(() => ({
    where: (...args: unknown[]) => {
      const wherePromise = mockWhere(...args);
      return {
        then: <TResult1 = ApprovedRow[], TResult2 = never>(
          onFulfilled?:
            | ((value: ApprovedRow[]) => TResult1 | PromiseLike<TResult1>)
            | null,
          onRejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ): PromiseLike<TResult1 | TResult2> =>
          wherePromise.then(onFulfilled, onRejected),
        groupBy: (...gArgs: unknown[]) => mockGroupBy(...gArgs),
      };
    },
  }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockSqsSend, mockWhere, mockGroupBy, mockFrom, mockSelect };
});

const { mockSqsSend, mockWhere, mockGroupBy, mockSelect } = hoisted;

// `SQSClient` and `SendMessageBatchCommand` are invoked with `new`, so they
// must be real constructor functions.
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: function MockSQSClient(this: { send: typeof hoisted.mockSqsSend }) {
    this.send = hoisted.mockSqsSend;
  },
  SendMessageBatchCommand: function MockSendMessageBatchCommand(
    this: { __type: string; input: unknown },
    input: unknown,
  ) {
    this.__type = 'SendMessageBatch';
    this.input = input;
  },
}));

vi.mock('@language-drill/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@language-drill/db')>();
  return {
    ...actual,
    createDb: vi.fn(() => ({ select: hoisted.mockSelect }) as never),
    requireEnv: vi.fn((name: string) => {
      if (name === 'THEORY_GENERATION_QUEUE_URL') {
        return 'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-dev-TheoryGenerationQueue';
      }
      if (name === 'AWS_REGION') return 'eu-central-1';
      if (name === 'DATABASE_URL') return 'postgres://fake';
      return `fake-${name}`;
    }),
  };
});

// Real exports we need for assertions. These come from the same
// `importOriginal` path as the in-mock spreads, so they are the actual
// implementations.
import {
  ALL_CURRICULA,
  THEORY_ROUND_1_CEFR_LEVELS,
  deterministicUuid,
  enumerateTheoryCells,
  type TheoryCell,
} from '@language-drill/db';
import { handler } from './scheduler';
import { parseTheoryGenerationJobMessage } from './job-message';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let consoleLogSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty result set → every grammar+round-1 cell becomes under-
  // target. Tests override per scenario.
  mockWhere.mockResolvedValue([]);
  // Default: no recent rejections → no cell is suppressed by the backoff
  // filter. Tests override per scenario via `mockResolvedValueOnce`.
  mockGroupBy.mockResolvedValue([]);
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUEUE_URL =
  'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-dev-TheoryGenerationQueue';

function findLogLine(
  predicate: (entry: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  for (const call of consoleLogSpy.mock.calls) {
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
  return undefined;
}

function collectLogLines(
  predicate: (entry: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  for (const call of consoleLogSpy.mock.calls) {
    const arg = call[0];
    if (typeof arg !== 'string') continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(arg) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (predicate(entry)) matches.push(entry);
  }
  return matches;
}

type CapturedBatch = {
  QueueUrl: string;
  Entries: Array<{ Id: string; MessageBody: string }>;
};

function capturedBatches(): CapturedBatch[] {
  return mockSqsSend.mock.calls.map((call) => {
    const cmd = call[0] as { input: CapturedBatch };
    return cmd.input;
  });
}

function decodeBatch(batch: CapturedBatch): unknown[] {
  return batch.Entries.map((e) => JSON.parse(e.MessageBody) as unknown);
}

/** All round-1 grammar theory cells from the live curriculum. */
function allRoundOneGrammarCells(): TheoryCell[] {
  return enumerateTheoryCells(ALL_CURRICULA).filter((c) =>
    (THEORY_ROUND_1_CEFR_LEVELS as readonly string[]).includes(c.cefrLevel),
  );
}

/**
 * Build an approved-row set that "fills" every round-1 grammar cell EXCEPT
 * those whose `cellKey` is in `undertargetKeys`. Empty `undertargetKeys`
 * means: every cell is filled → Pool at target.
 *
 * Row shape matches the diff key: `${row.language}|${row.grammarPointKey}`
 * compared against `${cell.language}|${cell.grammarPoint.key}`. Both sides
 * carry the uppercase enum value (e.g. `"ES"`), so no case-normalisation
 * is needed.
 */
function rowsFillingAllExcept(undertargetKeys: Set<string>): ApprovedRow[] {
  const rows: ApprovedRow[] = [];
  for (const cell of allRoundOneGrammarCells()) {
    if (undertargetKeys.has(cell.cellKey)) continue;
    rows.push({
      language: cell.language,
      grammarPointKey: cell.grammarPoint.key,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('theory scheduler handler', () => {
  it('empty curriculum slice (every cell already approved) → no SQS calls, "Pool at target" log', async () => {
    mockWhere.mockResolvedValueOnce(rowsFillingAllExcept(new Set()));

    await handler();

    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(capturedBatches()).toEqual([]);

    const log = findLogLine(
      (e) =>
        typeof e['message'] === 'string' &&
        (e['message'] as string).includes('Pool at target'),
    );
    expect(log).toBeDefined();
    expect(log!['level']).toBe('info');
  });

  it('all cells undersized (empty approved rows) → every cell enqueued, batched ≤ 10 per call', async () => {
    mockWhere.mockResolvedValueOnce([]);
    const expectedCellCount = allRoundOneGrammarCells().length;

    await handler();

    const batches = capturedBatches();
    const allMessages = batches.flatMap(decodeBatch);
    expect(allMessages).toHaveLength(expectedCellCount);

    expect(batches).toHaveLength(Math.ceil(expectedCellCount / 10));
    for (const batch of batches) {
      expect(batch.Entries.length).toBeLessThanOrEqual(10);
      expect(batch.QueueUrl).toBe(QUEUE_URL);
    }

    // Every message parses cleanly and carries the scheduled trigger + the
    // 0.6 maxCostUsd from SCHEDULER_PER_CELL_COST_CAP_USD (Opus generator
    // + headroom for the one validator-feedback retry).
    const parsed = allMessages.map((m) => parseTheoryGenerationJobMessage(m));
    for (const m of parsed) {
      expect(m.trigger).toBe('scheduled');
      expect(m.maxCostUsd).toBe(0.6);
    }
  });

  it('partial diff: half cells approved → only the unmatched half enqueued', async () => {
    const allCells = allRoundOneGrammarCells();
    const half = Math.floor(allCells.length / 2);
    const approvedCells = allCells.slice(0, half);
    const undertargetCells = allCells.slice(half);

    // Pass only the approved half through the mocked where().
    const approvedRows: ApprovedRow[] = approvedCells.map((c) => ({
      language: c.language,
      grammarPointKey: c.grammarPoint.key,
    }));
    mockWhere.mockResolvedValueOnce(approvedRows);

    await handler();

    const messages = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseTheoryGenerationJobMessage(m));
    expect(messages).toHaveLength(undertargetCells.length);

    // Every produced message corresponds to an undertarget cell, and none
    // corresponds to an approved cell.
    const producedKeys = new Set(
      messages.map((m) => `${m.spec.language}|${m.spec.grammarPointKey}`),
    );
    for (const c of undertargetCells) {
      expect(
        producedKeys.has(`${c.language}|${c.grammarPoint.key}`),
      ).toBe(true);
    }
    for (const c of approvedCells) {
      expect(
        producedKeys.has(`${c.language}|${c.grammarPoint.key}`),
      ).toBe(false);
    }
  });

  it('every produced message has cefrLevel ∈ {A1,A2,B1,B2} (C1/C2 forward-compat skip)', async () => {
    // The curriculum is A1-B2 today, so this test is a forward-compat
    // invariant: if Phase 6 introduces C1/C2 entries, this assertion pins
    // the scheduler's round-1 filter as the load-bearing one.
    mockWhere.mockResolvedValueOnce([]);

    await handler();

    const messages = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseTheoryGenerationJobMessage(m));
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(['A1', 'A2', 'B1', 'B2']).toContain(m.spec.cefrLevel);
    }
  });

  it('same-day idempotency: two invocations produce identical jobIds', async () => {
    const allCells = allRoundOneGrammarCells();
    const undertarget = allCells.slice(0, 3);
    const undertargetKeys = new Set(undertarget.map((c) => c.cellKey));

    mockWhere.mockResolvedValueOnce(rowsFillingAllExcept(undertargetKeys));
    await handler();
    const run1 = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseTheoryGenerationJobMessage(m));

    // Reset capture between invocations so run2 doesn't see run1's batches.
    mockSqsSend.mockClear();

    mockWhere.mockResolvedValueOnce(rowsFillingAllExcept(undertargetKeys));
    await handler();
    const run2 = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseTheoryGenerationJobMessage(m));

    expect(run1).toHaveLength(3);
    expect(run2).toHaveLength(3);

    // Req 3.5: same UTC day → same `batchSeed` → identical deterministic
    // jobIds.
    expect(run1.map((m) => m.jobId).sort()).toEqual(
      run2.map((m) => m.jobId).sort(),
    );
    expect(run1.map((m) => m.spec.batchSeed)).toEqual(
      run2.map((m) => m.spec.batchSeed),
    );

    // The jobId formula is deterministicUuid([cellKey, batchSeed].join('|')).
    const today = new Date().toISOString().slice(0, 10);
    const expectedSeed = `theory-scheduled-${today}`;
    for (const m of run1) {
      const cell = undertarget.find(
        (c) =>
          c.language === m.spec.language &&
          c.cefrLevel === m.spec.cefrLevel &&
          c.grammarPoint.key === m.spec.grammarPointKey,
      );
      expect(cell).toBeDefined();
      expect(m.jobId).toBe(
        deterministicUuid([cell!.cellKey, expectedSeed].join('|')),
      );
      expect(m.spec.batchSeed).toBe(expectedSeed);
    }
  });

  it('logs a slow-query warning when the enumeration query exceeds 30s', async () => {
    // Spy on `Date.now`; bump the offset inside the mocked where() so the
    // before/after deltas appear ≥ 31s without flaky fake timers.
    const realDateNow = Date.now;
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + offset);

    mockWhere.mockImplementationOnce(async () => {
      offset = 31_000;
      // Return rows for every cell so we don't accidentally also test the
      // "all cells undersized" SQS branch in the same case.
      return rowsFillingAllExcept(new Set());
    });

    await handler();

    const log = findLogLine((e) => {
      const msg = e['message'];
      return typeof msg === 'string' && /exceeded/.test(msg);
    });
    expect(log).toBeDefined();
    expect(log!['level']).toBe('warn');
    expect(log!['durationMs']).toBeGreaterThanOrEqual(31_000);
  });

  it('SendMessageBatch log carries batchSize + jobIds array', async () => {
    const allCells = allRoundOneGrammarCells();
    const undertarget = allCells.slice(0, 2);
    const undertargetKeys = new Set(undertarget.map((c) => c.cellKey));
    mockWhere.mockResolvedValueOnce(rowsFillingAllExcept(undertargetKeys));

    await handler();

    const log = findLogLine((e) => e['message'] === 'SendMessageBatch sent');
    expect(log).toBeDefined();
    expect(log!['batchSize']).toBe(2);
    expect(Array.isArray(log!['jobIds'])).toBe(true);
    expect((log!['jobIds'] as unknown[]).length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // theory-gen-malformed-sections-and-observability Req 4 — combined backoff:
  // `rejected = true` OR `status = 'failed'` both count as unproductive.
  // ---------------------------------------------------------------------------

  describe('per-cell unproductive-attempt backoff (Req 4)', () => {
    /**
     * Build the approved-set so exactly `undertargetCells` are missing
     * from approved. Returns the cells and the rows the mock should
     * resolve as the approved-set query result.
     */
    function setupUndertarget(undertargetCells: TheoryCell[]): {
      undertargetCells: TheoryCell[];
      approvedRows: ApprovedRow[];
    } {
      const undertargetKeys = new Set(undertargetCells.map((c) => c.cellKey));
      return {
        undertargetCells,
        approvedRows: rowsFillingAllExcept(undertargetKeys),
      };
    }

    const SUPPRESS_MSG = 'theory cell suppressed by unproductive-attempt backoff';

    /**
     * Shape the combined-backoff aggregate returns per cell: `unproductive` is
     * COUNT(*) over `rejected = true OR status = 'failed'`; `rejections` is the
     * FILTERed rejection-only sub-count.
     */
    function backoffRow(cellKey: string, unproductive: number, rejections: number) {
      return { cellKey, unproductive, rejections };
    }

    it('(a) 2 failures + 0 rejections (unproductive=2) passes the filter', async () => {
      const [target] = allRoundOneGrammarCells();
      const { approvedRows } = setupUndertarget([target!]);
      mockWhere.mockResolvedValueOnce(approvedRows);
      mockGroupBy.mockResolvedValueOnce([backoffRow(target!.cellKey, 2, 0)]);

      await handler();

      const messages = capturedBatches()
        .flatMap(decodeBatch)
        .map((m) => parseTheoryGenerationJobMessage(m));
      expect(messages).toHaveLength(1);
      expect(messages[0].spec.grammarPointKey).toBe(target!.grammarPoint.key);
      expect(
        findLogLine((e) => e['message'] === SUPPRESS_MSG),
      ).toBeUndefined();
    });

    it('(b) 3 failures + 0 rejections (unproductive=3) is suppressed AND logs both counts once', async () => {
      const [target] = allRoundOneGrammarCells();
      const { approvedRows } = setupUndertarget([target!]);
      mockWhere.mockResolvedValueOnce(approvedRows);
      mockGroupBy.mockResolvedValueOnce([backoffRow(target!.cellKey, 3, 0)]);

      await handler();

      // Not enqueued — a deterministically-failing cell is bounded like a
      // rejected one even with zero rejections (Req 4.1).
      expect(capturedBatches().flatMap(decodeBatch)).toHaveLength(0);
      expect(mockSqsSend).not.toHaveBeenCalled();

      const suppressionLogs = collectLogLines(
        (e) => e['message'] === SUPPRESS_MSG,
      );
      expect(suppressionLogs).toHaveLength(1);
      expect(suppressionLogs[0]['level']).toBe('warn');
      expect(suppressionLogs[0]['cellKey']).toBe(target!.cellKey);
      expect(suppressionLogs[0]['recentUnproductiveAttempts']).toBe(3);
      expect(suppressionLogs[0]['recentRejections']).toBe(0);
      expect(suppressionLogs[0]['backoffWindowDays']).toBe(14);
    });

    it('(c) 2 failures + 1 rejection (combined unproductive=3) is suppressed', async () => {
      const [target] = allRoundOneGrammarCells();
      const { approvedRows } = setupUndertarget([target!]);
      mockWhere.mockResolvedValueOnce(approvedRows);
      mockGroupBy.mockResolvedValueOnce([backoffRow(target!.cellKey, 3, 1)]);

      await handler();

      // Combined count crosses the threshold even though neither failures (2)
      // nor rejections (1) would alone (Req 4.2).
      expect(capturedBatches().flatMap(decodeBatch)).toHaveLength(0);

      const suppressionLogs = collectLogLines(
        (e) => e['message'] === SUPPRESS_MSG,
      );
      expect(suppressionLogs).toHaveLength(1);
      expect(suppressionLogs[0]['recentUnproductiveAttempts']).toBe(3);
      expect(suppressionLogs[0]['recentRejections']).toBe(1);
    });

    it('(d) unproductive attempts older than the window do not count (query returns 2 in-window)', async () => {
      // The DB-side `WHERE started_at >= now() - interval 14 days` ages the
      // oldest attempt out before COUNT(*), so the query returns the in-window
      // count. The scheduler trusts that post-window count rather than applying
      // its own window logic on top.
      const [target] = allRoundOneGrammarCells();
      const { approvedRows } = setupUndertarget([target!]);
      mockWhere.mockResolvedValueOnce(approvedRows);
      mockGroupBy.mockResolvedValueOnce([backoffRow(target!.cellKey, 2, 0)]);

      await handler();

      const messages = capturedBatches()
        .flatMap(decodeBatch)
        .map((m) => parseTheoryGenerationJobMessage(m));
      expect(messages).toHaveLength(1);
      expect(messages[0].spec.grammarPointKey).toBe(target!.grammarPoint.key);
    });

    it('two excluded cells each log their own combined + rejection sub-counts (no shared/stale value)', async () => {
      const all = allRoundOneGrammarCells();
      const cellA = all[0]!;
      const cellB = all[1]!;
      const { approvedRows } = setupUndertarget([cellA, cellB]);
      mockWhere.mockResolvedValueOnce(approvedRows);
      mockGroupBy.mockResolvedValueOnce([
        backoffRow(cellA.cellKey, 4, 1),
        backoffRow(cellB.cellKey, 7, 7),
      ]);

      await handler();

      expect(capturedBatches().flatMap(decodeBatch)).toHaveLength(0);

      const suppressionLogs = collectLogLines(
        (e) => e['message'] === SUPPRESS_MSG,
      );
      expect(suppressionLogs).toHaveLength(2);

      const logA = suppressionLogs.find((l) => l['cellKey'] === cellA.cellKey);
      const logB = suppressionLogs.find((l) => l['cellKey'] === cellB.cellKey);
      expect(logA!['recentUnproductiveAttempts']).toBe(4);
      expect(logA!['recentRejections']).toBe(1);
      expect(logB!['recentUnproductiveAttempts']).toBe(7);
      expect(logB!['recentRejections']).toBe(7);
    });

    it('the combined-backoff count query is invoked exactly once per sweep (Req 4.3)', async () => {
      mockWhere.mockResolvedValueOnce([]);
      mockGroupBy.mockResolvedValueOnce([]);

      await handler();

      // Two `db.select(...)` calls per sweep: one for approved-set, one for
      // the combined unproductive-attempt count. No per-cell N+1.
      expect(mockSelect).toHaveBeenCalledTimes(2);
      // And exactly one `.groupBy(...)` terminator — the backoff count query.
      expect(mockGroupBy).toHaveBeenCalledTimes(1);
    });
  });
});
