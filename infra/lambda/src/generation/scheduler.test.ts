/**
 * Tests for the EventBridge-invoked scheduler Lambda. Pins the curriculum
 * enumeration → in-memory diff → SendMessageBatch invariants documented in
 * design Component 4 / Req 4.7 without hitting Postgres or SQS.
 *
 * Mock layout (vitest hoists `vi.mock` above imports automatically):
 *   - `@aws-sdk/client-sqs` is fully stubbed: `SQSClient` returns an object whose
 *     `send` is the captured `mockSqsSend`, and `SendMessageBatchCommand` is a
 *     constructor that records its `input` so the test can decode it.
 *   - `@language-drill/db` is partially stubbed: only `createDb` and `requireEnv`
 *     are replaced (the cold-start singletons + per-invocation env reads).
 *     Everything else — `enumerateCurriculumCells`, `chunk`, `deterministicUuid`,
 *     `buildCellKey`, `buildCellKeyFromRow`, `ROUND_1_CEFR_LEVELS`, `ALL_CURRICULA`,
 *     `exercises` — is the real implementation via `importOriginal`.
 *   - The Drizzle chain `db.select(...).from(...).where(...).groupBy(...)` is
 *     terminated by `mockGroupBy`, which the per-test setup configures.
 *
 * Slow-query test: see Test 6 — uses a `Date.now` spy with an offset bump
 * inside the mocked `groupBy` to simulate elapsed-time without flaky timers.
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
  language: string | null;
  difficulty: string | null;
  type: string | null;
  grammarPointKey: string | null;
  approved: number;
};

const hoisted = vi.hoisted(() => {
  // Typed to accept the SendMessageBatchCommand stub (or any command instance);
  // tests cast `call[0]` to the captured-batch shape produced by the SQS mock.
  const mockSqsSend = vi.fn<(command: unknown) => Promise<unknown>>(() =>
    Promise.resolve({}),
  );
  const mockGroupBy = vi.fn<() => Promise<ApprovedRow[]>>();
  const mockWhere = vi.fn(() => ({ groupBy: mockGroupBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockSqsSend, mockGroupBy, mockWhere, mockFrom, mockSelect };
});

const { mockSqsSend, mockGroupBy } = hoisted;

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
      if (name === 'GENERATION_QUEUE_URL') {
        return 'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-dev-GenerationQueue';
      }
      if (name === 'AWS_REGION') return 'eu-central-1';
      if (name === 'DATABASE_URL') return 'postgres://fake';
      return `fake-${name}`;
    }),
  };
});

// Real exports we need for assertions. These come from the same `importOriginal`
// path as the in-mock spreads, so they are the actual implementations.
import {
  ALL_CURRICULA,
  ROUND_1_CEFR_LEVELS,
  deterministicUuid,
  enumerateCurriculumCells,
  type Cell,
} from '@language-drill/db';
import { handler } from './scheduler';
import { parseGenerationJobMessage } from './job-message';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let consoleLogSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty result set → every cell gets count = 0 → all are under-target.
  // Tests override per scenario.
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
  'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-dev-GenerationQueue';

/** Pull every JSON-decoded log line that matches `predicate`. */
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

/** Each captured `sqs.send` call's first arg is the SendMessageBatchCommand
 * stub our mock builds with shape `{ __type, input }`. Pull the `input`. */
function capturedBatches(): CapturedBatch[] {
  return mockSqsSend.mock.calls.map((call) => {
    const cmd = call[0] as { input: CapturedBatch };
    return cmd.input;
  });
}

function decodeBatch(batch: CapturedBatch): unknown[] {
  return batch.Entries.map((e) => JSON.parse(e.MessageBody) as unknown);
}

/** All round-1 cells from the live curriculum. The scheduler iterates this set
 *  and skips C1/C2 silently — but the curriculum is A1-B2 today, so this is
 *  identical to `enumerateCurriculumCells(ALL_CURRICULA)`. */
function allRoundOneCells(): Cell[] {
  return enumerateCurriculumCells(ALL_CURRICULA).filter((c) =>
    (ROUND_1_CEFR_LEVELS as readonly string[]).includes(c.cefrLevel),
  );
}

/**
 * Build a row set that puts every round-1 cell at `approved=50` (TARGET_PER_CELL),
 * EXCEPT the cells whose `cellKey` is in `undertargetKeys`, which get
 * `approved=currentForUndertarget`.
 *
 * Row shape MUST match `buildCellKeyFromRow` byte-for-byte: that helper feeds
 * `language` / `difficulty` / `type` / `grammarPointKey` straight through
 * `buildCellKey`, which lowercases them. The `Cell` we read from the curriculum
 * has the *uppercase* enum values for `language` (e.g. `"ES"`) and `cefrLevel`
 * (e.g. `"B1"`), and the lowercase exerciseType (e.g. `"cloze"`). So setting
 * `difficulty: cell.cefrLevel` works — `buildCellKey` lowercases `"B1"` → `"b1"`,
 * which matches what `enumerateCurriculumCells` produced for the same cell.
 */
function rowsToFillAllCellsExcept(
  undertargetKeys: Set<string>,
  currentForUndertarget = 0,
): ApprovedRow[] {
  const rows: ApprovedRow[] = [];
  for (const cell of allRoundOneCells()) {
    rows.push({
      language: cell.language,
      difficulty: cell.cefrLevel,
      type: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
      approved: undertargetKeys.has(cell.cellKey) ? currentForUndertarget : 50,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler handler', () => {
  it('two under-target cells → one batch with two messages, all parsing cleanly', async () => {
    const undertargetCells = allRoundOneCells().slice(0, 2);
    const undertargetKeys = new Set(undertargetCells.map((c) => c.cellKey));
    mockGroupBy.mockResolvedValueOnce(
      rowsToFillAllCellsExcept(undertargetKeys, 10),
    );

    await handler();

    const batches = capturedBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0].QueueUrl).toBe(QUEUE_URL);
    expect(batches[0].Entries).toHaveLength(2);

    const messages = decodeBatch(batches[0]).map((m) =>
      parseGenerationJobMessage(m),
    );
    const today = new Date().toISOString().slice(0, 10);
    const expectedSeed = `scheduled-${today}`;

    for (const m of messages) {
      expect(m.trigger).toBe('scheduled');
      expect(m.spec.count).toBe(40); // TARGET_PER_CELL(50) - currentForUndertarget(10)
      expect(m.spec.batchSeed).toBe(expectedSeed);
      expect(m.maxCostUsd).toBe(0.5);
    }

    // jobId === deterministicUuid([cellKey, batchSeed].join('|'))
    for (const m of messages) {
      const cell = undertargetCells.find(
        (c) =>
          c.grammarPoint.key === m.spec.grammarPointKey &&
          c.exerciseType === m.spec.exerciseType &&
          c.cefrLevel === m.spec.cefrLevel &&
          c.language === m.spec.language,
      );
      expect(cell).toBeDefined();
      expect(m.jobId).toBe(
        deterministicUuid([cell!.cellKey, expectedSeed].join('|')),
      );
    }

    // Aggregated jobIds log line per Req 4.3.5.
    const batchSentLog = findLogLine(
      (e) => e['message'] === 'SendMessageBatch sent',
    );
    expect(batchSentLog).toBeDefined();
    expect(batchSentLog!['batchSize']).toBe(2);
    expect(Array.isArray(batchSentLog!['jobIds'])).toBe(true);
  });

  it('empty under-target list → no SQS calls, "Pool at target" log emitted', async () => {
    // Every round-1 cell at TARGET_PER_CELL=50; nothing under MIN_PER_CELL=25.
    mockGroupBy.mockResolvedValueOnce(rowsToFillAllCellsExcept(new Set()));

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

  it('25 under-target cells → three batches sized 10/10/5', async () => {
    const undertargetCells = allRoundOneCells().slice(0, 25);
    expect(undertargetCells).toHaveLength(25);
    const undertargetKeys = new Set(undertargetCells.map((c) => c.cellKey));
    mockGroupBy.mockResolvedValueOnce(
      rowsToFillAllCellsExcept(undertargetKeys, 10),
    );

    await handler();

    const batches = capturedBatches();
    expect(batches).toHaveLength(3);
    expect(batches[0].Entries).toHaveLength(10);
    expect(batches[1].Entries).toHaveLength(10);
    expect(batches[2].Entries).toHaveLength(5);

    // Every batch addressed to the same queue.
    for (const batch of batches) {
      expect(batch.QueueUrl).toBe(QUEUE_URL);
    }

    // Total messages: exactly 25, each parsing cleanly.
    const allMessages = batches.flatMap(decodeBatch).map((m) =>
      parseGenerationJobMessage(m),
    );
    expect(allMessages).toHaveLength(25);
    for (const m of allMessages) {
      expect(m.trigger).toBe('scheduled');
    }
  });

  it('same-day idempotency: two invocations produce identical jobIds', async () => {
    const undertargetCells = allRoundOneCells().slice(0, 2);
    const undertargetKeys = new Set(undertargetCells.map((c) => c.cellKey));
    // Both invocations see the same DB state (same row set both times).
    mockGroupBy.mockResolvedValueOnce(
      rowsToFillAllCellsExcept(undertargetKeys, 10),
    );
    mockGroupBy.mockResolvedValueOnce(
      rowsToFillAllCellsExcept(undertargetKeys, 10),
    );

    await handler();
    const messagesRun1 = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseGenerationJobMessage(m));

    // Reset SQS captures between invocations so the second handler() doesn't
    // see the first run's batches in `capturedBatches()`.
    mockSqsSend.mockClear();

    await handler();
    const messagesRun2 = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseGenerationJobMessage(m));

    expect(messagesRun1).toHaveLength(2);
    expect(messagesRun2).toHaveLength(2);

    // Req 4.4: same UTC day → same `batchSeed` → identical deterministic jobIds.
    expect(messagesRun1.map((m) => m.jobId).sort()).toEqual(
      messagesRun2.map((m) => m.jobId).sort(),
    );
    // The full message bodies should also be byte-identical (same seed, same
    // cells, same need values).
    expect(messagesRun1.map((m) => m.spec.batchSeed)).toEqual(
      messagesRun2.map((m) => m.spec.batchSeed),
    );
  });

  it('out-of-scope CEFR levels (C1/C2) are silently skipped from produced messages', async () => {
    // Every cell has count 0 → every round-1 cell becomes under-target. If the
    // curriculum ever introduces C1/C2 entries (Phase 6), this guard pins that
    // the scheduler MUST skip them — the consumer's per-message guard is
    // defense-in-depth on top.
    //
    // Today the curriculum is A1-B2 only (verified in
    // packages/db/src/curriculum/{es,de,tr}.ts), so this test is a forward-
    // compat invariant rather than an active guard. Still pinned because the
    // scheduler's filter is the load-bearing one for round-1 narrowing.
    mockGroupBy.mockResolvedValueOnce([]);

    await handler();

    const allMessages = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseGenerationJobMessage(m));
    expect(allMessages.length).toBeGreaterThan(0);
    for (const m of allMessages) {
      expect(['A1', 'A2', 'B1', 'B2']).toContain(m.spec.cefrLevel);
    }
  });

  it('logs a slow-query warning when the enumeration query exceeds 30s', async () => {
    // Approach: spy on `Date.now` and bump an offset *inside* the mocked
    // groupBy implementation. The scheduler reads `Date.now()` before and
    // after the awaited query — bumping the offset between those two reads
    // makes the second read appear 31s after the first without depending on
    // fake-timer / microtask ordering, which has been flaky historically.
    const realDateNow = Date.now;
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + offset);

    mockGroupBy.mockImplementationOnce(async () => {
      offset = 31_000;
      return [];
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
});
