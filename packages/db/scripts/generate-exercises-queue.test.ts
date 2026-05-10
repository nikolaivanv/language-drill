/**
 * Tests for `postCellsToQueue` (Phase 4 / Task 30).
 *
 * `postCellsToQueue` accepts the SQSClient as a parameter, so unlike the
 * scheduler Lambda's tests there's no need to `vi.mock('@aws-sdk/client-sqs')`.
 * We construct a fake client whose `send` is a `vi.fn` and inspect the
 * captured `SendMessageBatchCommand` instances directly via `command.input`.
 *
 * The deep-relative import of `parseGenerationJobMessage` from
 * `infra/lambda/src/generation/job-message.ts` is intentional. Per the source
 * comment on `GenerationJobMessage`, `packages/db` cannot import from
 * `infra/lambda` (would create a reverse package edge), so the producer-side
 * type is duplicated. This round-trip test is the alignment guarantor: if the
 * two definitions ever drift, the parser will reject the producer's output
 * and these tests will fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import {
  ALL_CURRICULA,
  enumerateCurriculumCells,
  ROUND_1_CEFR_LEVELS,
  type Cell,
} from '../src';

// Cross-package deep import — see file header. Vitest resolves any path; the
// db package's `lint` script only scans `src/**/*.ts`, so this test file is
// outside its lint scope (verified by running `pnpm --filter @language-drill/db lint`).
import { parseGenerationJobMessage } from '../../../infra/lambda/src/generation/job-message';

import {
  MAX_CLI_CELLS_PER_INVOCATION,
  postCellsToQueue,
  type PostToQueueArgs,
} from './generate-exercises-queue';

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

/** Pull the `input` off the captured `SendMessageBatchCommand` at `callIndex`. */
function capturedBatch(callIndex: number): CapturedBatch {
  const command = mockSend.mock.calls[callIndex][0] as SendMessageBatchCommand;
  return (command as unknown as { input: CapturedBatch }).input;
}

const DEV_QUEUE_URL =
  'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-dev-GenerationQueue';
const PROD_QUEUE_URL =
  'https://sqs.eu-central-1.amazonaws.com/000000000000/LanguageDrillStack-GenerationQueue-XYZ';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Real cells from the live curriculum, narrowed to round-1 CEFR levels. */
function pickRoundOneCells(n: number): Cell[] {
  const all = enumerateCurriculumCells(ALL_CURRICULA).filter((c) =>
    (ROUND_1_CEFR_LEVELS as readonly string[]).includes(c.cefrLevel),
  );
  if (all.length < n) {
    throw new Error(
      `Curriculum has only ${all.length} round-1 cells; test wanted ${n}.`,
    );
  }
  return all.slice(0, n);
}

function defaultArgs(cells: readonly Cell[]): PostToQueueArgs {
  return {
    cells,
    batchSeed: 'cli-2026-05-08-test',
    topicDomain: null,
    count: 5,
    maxCostUsd: 0.5,
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

describe('postCellsToQueue — happy path (3 cells, dev queue, dryRun=false)', () => {
  it('posts one batch of 3 messages that round-trip through parseGenerationJobMessage', async () => {
    const cells = pickRoundOneCells(3);
    const args = defaultArgs(cells);

    const posted = await postCellsToQueue(fakeSqs, DEV_QUEUE_URL, args);

    // Exactly one SendMessageBatchCommand for the 3 messages.
    expect(mockSend).toHaveBeenCalledTimes(1);
    const batch = capturedBatch(0);
    expect(batch.QueueUrl).toBe(DEV_QUEUE_URL);
    expect(batch.Entries).toHaveLength(3);

    // Round-trip every produced message through the canonical Lambda parser.
    const messages = batch.Entries.map((e) =>
      parseGenerationJobMessage(JSON.parse(e.MessageBody)),
    );
    expect(messages).toHaveLength(3);

    for (const m of messages) {
      expect(m.trigger).toBe('cli');
      expect(m.spec.count).toBe(args.count);
      expect(m.maxCostUsd).toBe(args.maxCostUsd);
      expect(m.spec.batchSeed).toBe(args.batchSeed);
      expect(m.spec.topicDomain).toBe(args.topicDomain);
      expect(m.jobId).toMatch(UUID_REGEX);
    }

    // jobIds are unique (randomUUID per cell).
    const jobIds = new Set(messages.map((m) => m.jobId));
    expect(jobIds.size).toBe(3);

    // Returned PostedJob[] has 3 entries with synthesized messageIds.
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

describe('postCellsToQueue — dryRun=true', () => {
  it('does not call SQS and prints a [dry-run] line per cell', async () => {
    const cells = pickRoundOneCells(3);
    const args: PostToQueueArgs = { ...defaultArgs(cells), dryRun: true };

    const posted = await postCellsToQueue(fakeSqs, DEV_QUEUE_URL, args);

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockSend.mock.calls.length).toBe(0);

    // Three [dry-run] lines, one per cell.
    const dryRunLines = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('[dry-run] '));
    expect(dryRunLines).toHaveLength(3);
    for (const line of dryRunLines) {
      expect(line).toMatch(
        /^\[dry-run\] Would post job [0-9a-f-]{36} for [^ ]+ \(count=\d+, trigger=cli\)/,
      );
    }

    // Returned PostedJob[] has one item per cell with messageId=undefined.
    expect(posted).toHaveLength(3);
    for (const p of posted) {
      expect(p.jobId).toMatch(UUID_REGEX);
      expect(p.messageId).toBeUndefined();
    }
  });
});

describe('postCellsToQueue — input guards', () => {
  it('rejects more than MAX_CLI_CELLS_PER_INVOCATION cells without calling SQS', async () => {
    // Sanity: the constant matches the > 100 boundary called out in the spec.
    expect(MAX_CLI_CELLS_PER_INVOCATION).toBe(100);

    const cells = pickRoundOneCells(101);
    expect(cells).toHaveLength(101);
    const args = defaultArgs(cells);

    await expect(
      postCellsToQueue(fakeSqs, DEV_QUEUE_URL, args),
    ).rejects.toThrow(/MAX_CLI_CELLS_PER_INVOCATION/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects a non-dev queue URL when allowProd=false', async () => {
    const cells = pickRoundOneCells(3);
    const args = defaultArgs(cells); // allowProd: false

    await expect(
      postCellsToQueue(fakeSqs, PROD_QUEUE_URL, args),
    ).rejects.toThrow(/Refusing to post to prod queue/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('allows a non-dev queue URL when allowProd=true', async () => {
    const cells = pickRoundOneCells(3);
    const args: PostToQueueArgs = { ...defaultArgs(cells), allowProd: true };

    const posted = await postCellsToQueue(fakeSqs, PROD_QUEUE_URL, args);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const batch = capturedBatch(0);
    expect(batch.QueueUrl).toBe(PROD_QUEUE_URL);
    expect(batch.Entries).toHaveLength(3);
    expect(posted).toHaveLength(3);
  });
});

describe('postCellsToQueue — batching', () => {
  it('25 cells → 3 SendMessageBatchCommand calls sized 10/10/5, all round-tripping', async () => {
    const cells = pickRoundOneCells(25);
    const args = defaultArgs(cells);

    const posted = await postCellsToQueue(fakeSqs, DEV_QUEUE_URL, args);

    expect(mockSend.mock.calls).toHaveLength(3);
    const batches = [
      capturedBatch(0),
      capturedBatch(1),
      capturedBatch(2),
    ];
    expect(batches.map((b) => b.Entries.length)).toEqual([10, 10, 5]);
    for (const b of batches) {
      expect(b.QueueUrl).toBe(DEV_QUEUE_URL);
    }

    // All 25 messages round-trip cleanly.
    const allMessages = batches
      .flatMap((b) => b.Entries)
      .map((e) => parseGenerationJobMessage(JSON.parse(e.MessageBody)));
    expect(allMessages).toHaveLength(25);
    for (const m of allMessages) {
      expect(m.trigger).toBe('cli');
      expect(m.spec.count).toBe(args.count);
      expect(m.spec.batchSeed).toBe(args.batchSeed);
    }

    // Each `Entries[i].Id` is the 0-based index within its batch
    // (per the helper's `String(i)` Id assignment).
    for (const b of batches) {
      b.Entries.forEach((e, i) => {
        expect(e.Id).toBe(String(i));
      });
    }

    expect(posted).toHaveLength(25);
  });
});
