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

const hoisted = vi.hoisted(() => {
  const mockSqsSend = vi.fn<(command: unknown) => Promise<unknown>>(() =>
    Promise.resolve({}),
  );
  const mockWhere = vi.fn<() => Promise<ApprovedRow[]>>();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockSqsSend, mockWhere, mockFrom, mockSelect };
});

const { mockSqsSend, mockWhere } = hoisted;

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
    // 0.25 maxCostUsd from SCHEDULER_PER_CELL_COST_CAP_USD.
    const parsed = allMessages.map((m) => parseTheoryGenerationJobMessage(m));
    for (const m of parsed) {
      expect(m.trigger).toBe('scheduled');
      expect(m.maxCostUsd).toBe(0.25);
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
});
