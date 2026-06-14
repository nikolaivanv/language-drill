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
  // R6.2 / R1.4 — the `loadMostRecentSucceededJobPerCell` query goes through
  // `db.execute(sql\`...\`)`. The handler narrows `result.rows` to a typed
  // row shape, so the mock must return that shape (or [] by default).
  const mockExecute = vi.fn<
    () => Promise<{ rows: ReadonlyArray<unknown> }>
  >(() => Promise.resolve({ rows: [] }));
  return {
    mockSqsSend,
    mockGroupBy,
    mockWhere,
    mockFrom,
    mockSelect,
    mockExecute,
  };
});

const { mockSqsSend, mockGroupBy, mockExecute } = hoisted;

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
    createDb: vi.fn(
      () =>
        ({
          select: hoisted.mockSelect,
          execute: hoisted.mockExecute,
        }) as never,
    ),
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
  CURRICULUM_VERSION_BY_LANGUAGE,
  ROUND_1_CEFR_LEVELS,
  deterministicUuid,
  enumerateCurriculumCells,
  type Cell,
} from '@language-drill/db';
import type { LearningLanguage } from '@language-drill/shared';
import { handler } from './scheduler';
import { parseGenerationJobMessage } from './job-message';
import { resolveCellTarget } from './cell-targets';
import { TARGET_PER_CELL } from './scheduler-decision';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let consoleLogSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty result set → every cell gets count = 0 → all are under-target.
  // Tests override per scenario.
  mockGroupBy.mockResolvedValue([]);
  // Default: no recent succeeded jobs → no R6 suppression possible → every
  // cell schedulable subject only to the approvedInPool check.
  mockExecute.mockResolvedValue({ rows: [] });
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
 * Round-1 cells whose resolved per-cell target (R3) equals the global
 * `TARGET_PER_CELL` (B1/B2 cloze/translation, which fall through the
 * `CELL_TARGET_DEFAULTS` table to the global fallback). Tests that assert a
 * specific `need`/`count` value pick their subject from here so the arithmetic
 * stays `TARGET_PER_CELL - approved` — narrow A1/A2 and vocab cells resolve to
 * other targets.
 */
function cellsWithGlobalTarget(): Cell[] {
  return allRoundOneCells().filter(
    (c) => resolveCellTarget(c) === TARGET_PER_CELL,
  );
}

/**
 * Build a row set that puts every round-1 cell at its **resolved per-cell
 * target** (R3 — so each is `skip-target-reached`), EXCEPT the cells whose
 * `cellKey` is in `undertargetKeys`, which get `approved=currentForUndertarget`.
 * Filling to `resolveCellTarget(cell)` (not a flat 50) is required now that
 * targets vary by `(exerciseType, cefrLevel)` — a flat 50 would leave some
 * cells off their resolved target and spuriously enqueue them (or, for
 * vocab_recall at target 10, fill them past it).
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
      approved: undertargetKeys.has(cell.cellKey)
        ? currentForUndertarget
        : resolveCellTarget(cell),
    });
  }
  return rows;
}

/**
 * First Round-1 cloze cell whose grammar point has a `coverageSpec` with a
 * person axis that includes `2pl` (six-person paradigm). TR cells satisfy this;
 * ES coverageSpec cells only have five persons (no `2pl`). Picking a six-person
 * language lets the coverage assertions reference `2pl` directly.
 */
function firstCoverageSpecClozeCell(): Cell {
  const cell = allRoundOneCells().find(
    (c) =>
      c.exerciseType === 'cloze' &&
      c.grammarPoint.coverageSpec !== undefined &&
      c.grammarPoint.coverageSpec.axes.some(
        (ax) => ax.name === 'person' && '2pl' in ax.floors,
      ),
  );
  if (cell === undefined) {
    throw new Error('no six-person coverageSpec cloze cell in curriculum');
  }
  return cell;
}

/** First Round-1 cloze cell whose grammar point has NO `coverageSpec`. */
function firstNoCoverageSpecClozeCell(): Cell {
  const cell = allRoundOneCells().find(
    (c) => c.exerciseType === 'cloze' && c.grammarPoint.coverageSpec === undefined,
  );
  if (cell === undefined) {
    throw new Error('no no-coverageSpec cloze cell in curriculum');
  }
  return cell;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler handler', () => {
  it('two under-target cells → one batch with two messages, all parsing cleanly', async () => {
    // Subjects resolve to TARGET_PER_CELL so `count === 40` (= 50 − 10) holds.
    const undertargetCells = cellsWithGlobalTarget().slice(0, 2);
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
    // Every round-1 cell at TARGET_PER_CELL=50; nothing is under target.
    // (Phase 4: MIN_PER_CELL hysteresis was removed — see scheduler-decision.ts.)
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

  // -------------------------------------------------------------------------
  // R6 — top-up-to-target + suppression scenarios
  //
  // Scenarios A, B, C from tasks.md task 21. Each picks ONE specific Round-1
  // cell to manipulate; every other cell is at TARGET so it lands as
  // skip-target-reached and contributes only to the suppressed counter.
  // -------------------------------------------------------------------------

  it('R6 scenario A: 30 approved + saturated-dedup job + curriculum match → 0 enqueued, suppressed.saturatedDedup === 1', async () => {
    // Pick the first Round-1 cell as the test subject. The rest are at TARGET.
    const subject = cellsWithGlobalTarget()[0];
    const subjectKeys = new Set([subject.cellKey]);
    mockGroupBy.mockResolvedValueOnce(rowsToFillAllCellsExcept(subjectKeys, 30));

    // R6.1 saturation thresholds at requestedCount=50:
    //   ceil(0.5 * 50) = 25 (dedup-given-up threshold, inclusive)
    //   ceil(0.3 * 50) = 15 (approved threshold, strict upper bound)
    // So `dedupGivenUpCount=25 AND approvedCount=14` saturates. Curriculum
    // version matches the on-disk constant for the subject's language → R6.4
    // mismatch does NOT clear suppression.
    const currentVersion =
      CURRICULUM_VERSION_BY_LANGUAGE[subject.language as LearningLanguage];
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          cell_key: subject.cellKey,
          approved_count: 14,
          requested_count: 50,
          dedup_given_up_count: 25,
          curriculum_version: currentVersion,
          finished_at: new Date('2026-05-22T00:00:00Z'),
        },
      ],
    });

    await handler();

    // No SQS calls — saturated-dedup suppresses the only under-target cell.
    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(capturedBatches()).toEqual([]);

    // Per-skip log line for the subject cell (grep target).
    const skipLog = findLogLine(
      (e) =>
        e['cellKey'] === subject.cellKey &&
        e['reason'] === 'saturated-dedup',
    );
    expect(skipLog).toBeDefined();

    // Completion log includes the suppressed summary with saturatedDedup === 1.
    const completionLog = findLogLine(
      (e) =>
        typeof e['message'] === 'string' &&
        ((e['message'] as string).includes('Pool at target') ||
          (e['message'] as string).includes('scheduler complete')),
    );
    expect(completionLog).toBeDefined();
    const suppressed = completionLog!['suppressed'] as Record<string, number>;
    expect(suppressed['saturatedDedup']).toBe(1);
  });

  it('R6 scenario B: same setup with bumped curriculum version → 1 message with need = 20', async () => {
    // Same approved + saturated-dedup as scenario A, but the recent job's
    // recorded curriculumVersion is STALE (older than the on-disk constant),
    // so R6.4 fires and suppression clears → the cell is enqueued.
    const subject = cellsWithGlobalTarget()[0];
    const subjectKeys = new Set([subject.cellKey]);
    mockGroupBy.mockResolvedValueOnce(rowsToFillAllCellsExcept(subjectKeys, 30));

    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          cell_key: subject.cellKey,
          approved_count: 14,
          requested_count: 50,
          dedup_given_up_count: 25,
          // Any value different from `CURRICULUM_VERSION_BY_LANGUAGE[...]`
          // triggers the R6.4 suppression-cleared branch in decideEnqueue.
          curriculum_version: '2026-04-01',
          finished_at: new Date('2026-05-22T00:00:00Z'),
        },
      ],
    });

    await handler();

    const batches = capturedBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0].Entries).toHaveLength(1);

    const [msg] = decodeBatch(batches[0]).map((m) =>
      parseGenerationJobMessage(m),
    );
    expect(msg.spec.grammarPointKey).toBe(subject.grammarPoint.key);
    expect(msg.spec.cefrLevel).toBe(subject.cefrLevel);
    expect(msg.spec.language).toBe(subject.language);
    // TARGET_PER_CELL=50 minus approvedInPool=30 = 20.
    expect(msg.spec.count).toBe(20);

    // Completion log shows zero suppressions (suppression cleared).
    const completionLog = findLogLine(
      (e) =>
        typeof e['message'] === 'string' &&
        (e['message'] as string).includes('scheduler complete'),
    );
    expect(completionLog).toBeDefined();
    const suppressed = completionLog!['suppressed'] as Record<string, number>;
    expect(suppressed['saturatedDedup']).toBe(0);
    expect(suppressed['lowYield']).toBe(0);
  });

  it('R6 scenario C: 48 approved + no recent job → 1 message with need = 2 (top-up-to-target, previously skipped under MIN_PER_CELL hysteresis)', async () => {
    // Under the old MIN_PER_CELL=25 hysteresis, a cell at 48 approved
    // wouldn't qualify (48 >= 25 → skipped). Under the new TARGET-only
    // policy, anything < 50 is topped up. This test pins the new behavior.
    const subject = cellsWithGlobalTarget()[0];
    const subjectKeys = new Set([subject.cellKey]);
    mockGroupBy.mockResolvedValueOnce(rowsToFillAllCellsExcept(subjectKeys, 48));

    // No recent job for the subject → no suppression possible → enqueue.
    // The default `mockExecute.mockResolvedValue({ rows: [] })` from
    // beforeEach already provides this; the explicit assertion below
    // documents the dependency for future readers.
    expect(mockExecute).toBeDefined();

    await handler();

    const batches = capturedBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0].Entries).toHaveLength(1);

    const [msg] = decodeBatch(batches[0]).map((m) =>
      parseGenerationJobMessage(m),
    );
    expect(msg.spec.grammarPointKey).toBe(subject.grammarPoint.key);
    // TARGET_PER_CELL=50 minus approvedInPool=48 = 2.
    expect(msg.spec.count).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Phase 2 — coverage controller (any axis via coverageSpec)
  // -------------------------------------------------------------------------

  it('Phase 2: coverageSpec cell under target gets weighted coverageTargets favoring starved persons', async () => {
    const subject = firstCoverageSpecClozeCell();
    const subjectKeys = new Set([subject.cellKey]);
    // Subject under target; everything else at its resolved target.
    mockGroupBy.mockResolvedValueOnce(
      rowsToFillAllCellsExcept(subjectKeys, 0),
    );

    // 1st execute = recent succeeded jobs (none → no coverage_outcome, no
    // suppression). 2nd execute = approved-pool coverage distribution (unnested
    // axis rows): the pool is heavily skewed toward 3sg, with 2pl starved (absent).
    mockExecute.mockResolvedValueOnce({ rows: [] });
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          language: subject.language,
          difficulty: subject.cefrLevel,
          type: subject.exerciseType,
          grammar_point_key: subject.grammarPoint.key,
          axis: 'person',
          value: '3sg',
          n: 40,
        },
        {
          language: subject.language,
          difficulty: subject.cefrLevel,
          type: subject.exerciseType,
          grammar_point_key: subject.grammarPoint.key,
          axis: 'person',
          value: '1sg',
          n: 5,
        },
      ],
    });

    await handler();

    const messages = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseGenerationJobMessage(m));
    const subjectMsg = messages.find(
      (m) =>
        m.spec.grammarPointKey === subject.grammarPoint.key &&
        m.spec.cefrLevel === subject.cefrLevel &&
        m.spec.language === subject.language &&
        m.spec.exerciseType === subject.exerciseType,
    );
    expect(subjectMsg).toBeDefined();

    // coverageTargets present and length-matched to count (validated by parse too).
    expect(subjectMsg!.spec.coverageTargets).toBeDefined();
    expect(subjectMsg!.spec.coverageTargets).toHaveLength(subjectMsg!.spec.count);

    // The starved 2pl bucket (absent from the pool) is targeted; the heavily
    // over-represented 3sg bucket is not, given the strong skew.
    const personValues = subjectMsg!.spec.coverageTargets!.map((t) => t.person);
    expect(personValues).toContain('2pl');
    expect(personValues).not.toContain('3sg');
  });

  it('Phase 2: no-coverageSpec cell gets no coverageTargets', async () => {
    const subject = firstNoCoverageSpecClozeCell();
    const subjectKeys = new Set([subject.cellKey]);
    mockGroupBy.mockResolvedValueOnce(
      rowsToFillAllCellsExcept(subjectKeys, 0),
    );
    // Recent jobs + coverage distribution both empty (the beforeEach default
    // `mockResolvedValue({ rows: [] })` covers both execute calls) — irrelevant
    // for a no-coverageSpec cell, which never reaches the controller.

    await handler();

    const messages = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseGenerationJobMessage(m));
    const subjectMsg = messages.find(
      (m) =>
        m.spec.grammarPointKey === subject.grammarPoint.key &&
        m.spec.cefrLevel === subject.cefrLevel &&
        m.spec.language === subject.language &&
        m.spec.exerciseType === subject.exerciseType,
    );
    expect(subjectMsg).toBeDefined();
    expect(subjectMsg!.spec.coverageTargets).toBeUndefined();
  });

  it('Phase 2: version-matched give-up suppresses a zero-yield person bucket', async () => {
    // A person bucket that the most-recent succeeded job targeted with
    // requested >= GIVE_UP_MIN_ATTEMPTS and approved === 0 is given up — but
    // ONLY while that job's curriculum_version still matches the on-disk
    // CURRICULUM_VERSION_<LANG> constant.
    const subject = firstCoverageSpecClozeCell();
    const subjectKeys = new Set([subject.cellKey]);
    // Subject under target (approved=0 → need === resolveCellTarget(cell));
    // everything else at its resolved target so only the subject enqueues.
    mockGroupBy.mockResolvedValueOnce(rowsToFillAllCellsExcept(subjectKeys, 0));

    // The recent-jobs row's curriculum_version EQUALS the on-disk constant for
    // the subject's language → the give-up gate holds and the coverage_outcome
    // is fed to decideCoverageTargets.
    const onDiskVersion =
      CURRICULUM_VERSION_BY_LANGUAGE[subject.language as LearningLanguage];
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          cell_key: subject.cellKey,
          // approved_count >= LOW_YIELD_THRESHOLD and dedup_given_up_count low
          // so decideEnqueue clears the *cell*-level suppression and the cell
          // enqueues — isolating the *person*-level give-up under test.
          approved_count: 20,
          requested_count: 30,
          dedup_given_up_count: 0,
          curriculum_version: onDiskVersion,
          // 2pl asked 5× (>= GIVE_UP_MIN_ATTEMPTS=2), 0 approved → give-up.
          coverage_outcome: { person: { '2pl': { requested: 5, approved: 0 } } },
          finished_at: new Date('2026-06-12T00:00:00Z'),
        },
      ],
    });
    // 2nd execute = approved-pool coverage distribution (unnested axis rows).
    // 2pl is the most-starved (absent ⇒ 0), so absent suppression water-fill
    // WOULD pick it; the others sit above it. This makes suppression the *only*
    // reason 2pl is missing.
    mockExecute.mockResolvedValueOnce({
      rows: ['1sg', '2sg', '3sg', '1pl', '3pl'].map((value) => ({
        language: subject.language,
        difficulty: subject.cefrLevel,
        type: subject.exerciseType,
        grammar_point_key: subject.grammarPoint.key,
        axis: 'person',
        value,
        n: 10,
      })),
    });

    await handler();

    const messages = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseGenerationJobMessage(m));
    const subjectMsg = messages.find(
      (m) =>
        m.spec.grammarPointKey === subject.grammarPoint.key &&
        m.spec.cefrLevel === subject.cefrLevel &&
        m.spec.language === subject.language &&
        m.spec.exerciseType === subject.exerciseType,
    );
    expect(subjectMsg).toBeDefined();

    // coverageTargets present, length-matched to count, and 2pl is GIVEN UP.
    expect(subjectMsg!.spec.coverageTargets).toBeDefined();
    expect(subjectMsg!.spec.coverageTargets).toHaveLength(subjectMsg!.spec.count);
    const personValues = subjectMsg!.spec.coverageTargets!.map((t) => t.person);
    expect(personValues).not.toContain('2pl');

    // The give-up is surfaced in the structured log line with axis-keyed suppressed map.
    const giveUpLog = findLogLine(
      (e) =>
        e['cellKey'] === subject.cellKey &&
        typeof e['message'] === 'string' &&
        (e['message'] as string).includes('buckets given up'),
    );
    expect(giveUpLog).toBeDefined();
    expect(giveUpLog!['suppressed']).toEqual({ person: ['2pl'] });
  });

  it('Phase 2: a curriculum-version mismatch clears the person-bucket give-up', async () => {
    // Identical to the version-matched case EXCEPT the recent job's
    // curriculum_version is stale. The handler zeroes `recentOutcome`, so the
    // previously-given-up 2pl bucket is eligible again and the still-starved
    // 2pl is water-filled back in.
    const subject = firstCoverageSpecClozeCell();
    const subjectKeys = new Set([subject.cellKey]);
    mockGroupBy.mockResolvedValueOnce(rowsToFillAllCellsExcept(subjectKeys, 0));

    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          cell_key: subject.cellKey,
          approved_count: 0,
          requested_count: 30,
          dedup_given_up_count: 0,
          // STALE: any value other than the on-disk constant clears the give-up.
          curriculum_version: '1999-01-01',
          coverage_outcome: { person: { '2pl': { requested: 5, approved: 0 } } },
          finished_at: new Date('2026-06-12T00:00:00Z'),
        },
      ],
    });
    // Same skewed distribution (unnested axis rows): 2pl absent (most starved)
    // so once eligible it is clearly among the water-fill picks.
    mockExecute.mockResolvedValueOnce({
      rows: ['1sg', '2sg', '3sg', '1pl', '3pl'].map((value) => ({
        language: subject.language,
        difficulty: subject.cefrLevel,
        type: subject.exerciseType,
        grammar_point_key: subject.grammarPoint.key,
        axis: 'person',
        value,
        n: 10,
      })),
    });

    await handler();

    const messages = capturedBatches()
      .flatMap(decodeBatch)
      .map((m) => parseGenerationJobMessage(m));
    const subjectMsg = messages.find(
      (m) =>
        m.spec.grammarPointKey === subject.grammarPoint.key &&
        m.spec.cefrLevel === subject.cefrLevel &&
        m.spec.language === subject.language &&
        m.spec.exerciseType === subject.exerciseType,
    );
    expect(subjectMsg).toBeDefined();

    // Suppression cleared → 2pl targeted again.
    expect(subjectMsg!.spec.coverageTargets).toBeDefined();
    expect(subjectMsg!.spec.coverageTargets).toHaveLength(subjectMsg!.spec.count);
    const personValues = subjectMsg!.spec.coverageTargets!.map((t) => t.person);
    expect(personValues).toContain('2pl');
  });
});
