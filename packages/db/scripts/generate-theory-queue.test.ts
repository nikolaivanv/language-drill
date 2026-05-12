/**
 * Tests for `postTheoryCellsToQueue` (Phase 4 / Task 17).
 *
 * `postTheoryCellsToQueue` accepts the SQSClient as a parameter, so unlike
 * the scheduler Lambda's tests there's no need to `vi.mock('@aws-sdk/client-
 * sqs')`. We construct a fake client whose `send` is a `vi.fn` and inspect
 * the captured `SendMessageBatchCommand` instances directly via
 * `command.input`.
 *
 * The deep-relative import of `parseTheoryGenerationJobMessage` from
 * `infra/lambda/src/theory-generation/job-message.ts` is intentional. Per
 * the source comment on `TheoryGenerationJobMessage`, `packages/db` cannot
 * import from `infra/lambda` (would create a reverse package edge), so the
 * producer-side type is duplicated. This round-trip test is the alignment
 * guarantor: if the two definitions ever drift, the parser will reject the
 * producer's output and these tests will fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import {
  ALL_CURRICULA,
  enumerateTheoryCells,
  THEORY_ROUND_1_CEFR_LEVELS,
  type TheoryCell,
} from '../src';

// Cross-package deep import — see file header. Vitest resolves any path; the
// db package's `lint` script only scans `src/**/*.ts`, so this test file is
// outside its lint scope.
import { parseTheoryGenerationJobMessage } from '../../../infra/lambda/src/theory-generation/job-message';

import {
  MAX_CLI_CELLS_PER_INVOCATION,
  postTheoryCellsToQueue,
  type PostTheoryCellsToQueueArgs,
} from './generate-theory-queue';

// ---------------------------------------------------------------------------
// Fake SQS client + helpers
// ---------------------------------------------------------------------------

type Entry = { Id: string; MessageBody: string };
type CapturedBatch = { QueueUrl: string; Entries: Entry[] };

const mockSend = vi.fn(async (command: unknown) => {
  // Default: synthesize a Successful response covering every entry.
  const cmd = command as { input?: { Entries?: Entry[] } };
  const entries = cmd.input?.Entries ?? [];
  return {
    Successful: entries.map((e) => ({
      Id: e.Id,
      MessageId: `msg-${e.Id}-${Math.random().toString(36).slice(2, 8)}`,
      MD5OfMessageBody: 'x',
    })),
    Failed: [],
  };
});

const fakeSqs = { send: mockSend } as unknown as SQSClient;

function capturedBatch(callIndex: number): CapturedBatch {
  const command = mockSend.mock.calls[callIndex][0] as SendMessageBatchCommand;
  return (command as unknown as { input: CapturedBatch }).input;
}

const DEV_QUEUE_URL =
  'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-dev-TheoryGenerationQueue';
const PROD_QUEUE_URL =
  'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-TheoryGenerationQueue-XYZ';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Real cells from the live curriculum, narrowed to round-1 grammar cells.
 * When `n` exceeds the available cell count the helper cycles through the
 * pool so count-only assertions (e.g. MAX_CLI_CELLS_PER_INVOCATION) keep
 * working while the curriculum is temporarily reduced. The cycled
 * duplicates are harmless because `postTheoryCellsToQueue` does not dedupe.
 */
function pickRoundOneGrammarCells(n: number): TheoryCell[] {
  const all = enumerateTheoryCells(ALL_CURRICULA).filter((c) =>
    (THEORY_ROUND_1_CEFR_LEVELS as readonly string[]).includes(c.cefrLevel),
  );
  if (all.length === 0) {
    throw new Error('Curriculum has no round-1 theory cells; cannot pick any.');
  }
  const out: TheoryCell[] = [];
  for (let i = 0; i < n; i++) {
    out.push(all[i % all.length]);
  }
  return out;
}

function defaultArgs(
  cells: readonly TheoryCell[],
): PostTheoryCellsToQueueArgs {
  return {
    cells,
    batchSeed: 'cli-2026-05-12-test',
    maxCostUsd: 0.25,
    allowProd: false,
    dryRun: false,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((_chunk: any) => true) as any);
});

afterEach(() => {
  stdoutSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('postTheoryCellsToQueue — happy path (3 cells, dev queue, dryRun=false)', () => {
  it('posts one batch of 3 messages that round-trip through parseTheoryGenerationJobMessage', async () => {
    const cells = pickRoundOneGrammarCells(3);
    const args = defaultArgs(cells);

    const posted = await postTheoryCellsToQueue(fakeSqs, DEV_QUEUE_URL, args);

    // Exactly one SendMessageBatchCommand for the 3 messages.
    expect(mockSend).toHaveBeenCalledTimes(1);
    const batch = capturedBatch(0);
    expect(batch.QueueUrl).toBe(DEV_QUEUE_URL);
    expect(batch.Entries).toHaveLength(3);

    // Round-trip every produced message through the canonical Lambda parser.
    const messages = batch.Entries.map((e) =>
      parseTheoryGenerationJobMessage(JSON.parse(e.MessageBody)),
    );
    expect(messages).toHaveLength(3);

    for (const m of messages) {
      expect(m.trigger).toBe('cli');
      expect(m.maxCostUsd).toBe(args.maxCostUsd);
      expect(m.spec.batchSeed).toBe(args.batchSeed);
      expect(m.jobId).toMatch(UUID_REGEX);
    }

    // jobIds are unique (randomUUID per cell).
    const jobIds = new Set(messages.map((m) => m.jobId));
    expect(jobIds.size).toBe(3);

    // Returned PostedTheoryJob[] has 3 entries with synthesized messageIds.
    expect(posted).toHaveLength(3);
    for (const p of posted) {
      expect(p.cellKey).not.toBe('?');
      expect(p.jobId).toMatch(UUID_REGEX);
      expect(typeof p.messageId).toBe('string');
      expect(p.messageId).not.toBe('');
    }

    // The set of cellKeys returned matches the input cells' cellKeys.
    expect(new Set(posted.map((p) => p.cellKey))).toEqual(
      new Set(cells.map((c) => c.cellKey)),
    );
  });
});

describe('postTheoryCellsToQueue — dryRun=true', () => {
  it('does not call SQS and prints a [dry-run] line per cell', async () => {
    const cells = pickRoundOneGrammarCells(3);
    const args: PostTheoryCellsToQueueArgs = {
      ...defaultArgs(cells),
      dryRun: true,
    };

    const posted = await postTheoryCellsToQueue(fakeSqs, DEV_QUEUE_URL, args);

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockSend.mock.calls.length).toBe(0);

    // Three [dry-run] lines, one per cell.
    const dryRunLines = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('[dry-run] '));
    expect(dryRunLines).toHaveLength(3);
    for (const line of dryRunLines) {
      expect(line).toMatch(
        /^\[dry-run\] Would post job [0-9a-f-]{36} for [^ ]+ \(trigger=cli\)/,
      );
    }

    // Returned PostedTheoryJob[] has one item per cell with messageId=undefined.
    expect(posted).toHaveLength(3);
    for (const p of posted) {
      expect(p.jobId).toMatch(UUID_REGEX);
      expect(p.messageId).toBeUndefined();
    }
  });
});

describe('postTheoryCellsToQueue — input guards', () => {
  it('rejects more than MAX_CLI_CELLS_PER_INVOCATION cells without calling SQS', async () => {
    // Sanity: the constant matches the > 100 boundary called out in the spec.
    expect(MAX_CLI_CELLS_PER_INVOCATION).toBe(100);

    const cells = pickRoundOneGrammarCells(101);
    expect(cells).toHaveLength(101);
    const args = defaultArgs(cells);

    await expect(
      postTheoryCellsToQueue(fakeSqs, DEV_QUEUE_URL, args),
    ).rejects.toThrow(/MAX_CLI_CELLS_PER_INVOCATION/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects a non-dev queue URL when allowProd=false', async () => {
    const cells = pickRoundOneGrammarCells(3);
    const args = defaultArgs(cells); // allowProd: false

    await expect(
      postTheoryCellsToQueue(fakeSqs, PROD_QUEUE_URL, args),
    ).rejects.toThrow(/Refusing to post to prod queue/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('allows a non-dev queue URL when allowProd=true', async () => {
    const cells = pickRoundOneGrammarCells(3);
    const args: PostTheoryCellsToQueueArgs = {
      ...defaultArgs(cells),
      allowProd: true,
    };

    const posted = await postTheoryCellsToQueue(fakeSqs, PROD_QUEUE_URL, args);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const batch = capturedBatch(0);
    expect(batch.QueueUrl).toBe(PROD_QUEUE_URL);
    expect(batch.Entries).toHaveLength(3);
    expect(posted).toHaveLength(3);
  });
});

describe('postTheoryCellsToQueue — batching', () => {
  it('15 cells → 2 SendMessageBatchCommand calls sized 10/5, all round-tripping', async () => {
    const cells = pickRoundOneGrammarCells(15);
    const args = defaultArgs(cells);

    const posted = await postTheoryCellsToQueue(fakeSqs, DEV_QUEUE_URL, args);

    expect(mockSend.mock.calls).toHaveLength(2);
    const batches = [capturedBatch(0), capturedBatch(1)];
    expect(batches.map((b) => b.Entries.length)).toEqual([10, 5]);
    for (const b of batches) {
      expect(b.QueueUrl).toBe(DEV_QUEUE_URL);
    }

    // All 15 messages round-trip cleanly through the canonical Lambda parser.
    const allMessages = batches
      .flatMap((b) => b.Entries)
      .map((e) => parseTheoryGenerationJobMessage(JSON.parse(e.MessageBody)));
    expect(allMessages).toHaveLength(15);
    for (const m of allMessages) {
      expect(m.trigger).toBe('cli');
      expect(m.spec.batchSeed).toBe(args.batchSeed);
      expect(m.maxCostUsd).toBe(0.25);
    }

    // Each `Entries[i].Id` is the 0-based index within its batch
    // (per the helper's `String(i)` Id assignment).
    for (const b of batches) {
      b.Entries.forEach((e, i) => {
        expect(e.Id).toBe(String(i));
      });
    }

    expect(posted).toHaveLength(15);
  });
});

describe('postTheoryCellsToQueue — round-trip alignment with consumer parser', () => {
  it('produced messages deep-equal the consumer-parsed result (no field drift)', async () => {
    // Pick a single cell so we can construct the expected producer-side
    // message and compare it byte-for-byte to the parsed consumer-side one.
    const cells = pickRoundOneGrammarCells(1);
    const args = defaultArgs(cells);

    await postTheoryCellsToQueue(fakeSqs, DEV_QUEUE_URL, args);

    const batch = capturedBatch(0);
    expect(batch.Entries).toHaveLength(1);

    const producerMessage = JSON.parse(batch.Entries[0].MessageBody);
    const parsed = parseTheoryGenerationJobMessage(producerMessage);

    // Round-trip alignment: the consumer-parsed value must deep-equal the
    // producer-emitted JSON. If a field is added to one side but not the
    // other, this assertion fails.
    expect(parsed).toEqual(producerMessage);
  });
});
