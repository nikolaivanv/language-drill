/**
 * Tests for the dictation audio-synth SQS handler. Mirrors the DI seam of
 * `generation/handler.test.ts`: the per-record work is factored behind an
 * exported `processRecord` taking injected deps (`db`, `polly`, `s3`, `bucket`,
 * `synth`), so these tests never touch the real AWS SDK or Neon. The
 * cold-start singletons in the handler module are neutered via `vi.mock` so
 * `import { handler, processRecord } from './handler'` is side-effect-free.
 *
 * Coverage (plan Task 5, Step 1):
 *   (a) synthesizes + sets audioS3Key for an audioless dictation row,
 *   (b) idempotent skip when audioS3Key already set (synth NOT called),
 *   (c) synth throws → record id in batchItemFailures.
 * Plus: missing / non-dictation row is a no-op success (doesn't poison queue).
 *
 * The exported `runRecords` seam (the handler's batch loop) is exercised
 * directly against a MIXED batch with distinct messageIds, asserting the
 * aggregation + `{ itemIdentifier: record.messageId }` mapping reports exactly
 * the failing record and not the succeeding one.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { SQSRecord } from 'aws-lambda';

vi.mock('@language-drill/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@language-drill/db')>();
  return {
    ...actual,
    // Cold-start singleton — never used by tests directly.
    createDb: vi.fn(() => ({}) as never),
    requireEnv: vi.fn((name: string) => `fake-${name}`),
    // Keep the real `dictationAudioKey`; only `synthesizeToS3` is injected.
  };
});

import { processRecord, runRecords, type ProcessDeps } from './handler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXERCISE_ID = '11111111-1111-1111-1111-111111111111';

type DictationRow = {
  id: string;
  type: string | null;
  language: string | null;
  contentJson: unknown;
  audioS3Key: string | null;
};

function dictationRow(overrides: Partial<DictationRow> = {}): DictationRow {
  return {
    id: EXERCISE_ID,
    type: ExerciseType.DICTATION,
    language: 'ES',
    contentJson: { referenceText: 'Hola mundo.', voiceId: 'Sergio' },
    audioS3Key: null,
    ...overrides,
  };
}

/**
 * A fake Drizzle `db` recording the loaded row and any UPDATE. `select()...`
 * resolves to `selectRows`; `update()...` captures the SET payload.
 */
function fakeDb(selectRows: DictationRow[]) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectRows,
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  return { db: db as unknown as ProcessDeps['db'], updateCalls };
}

function recordWith(exerciseId: string, messageId = 'msg-1'): SQSRecord {
  return {
    messageId,
    body: JSON.stringify({ exerciseId }),
  } as unknown as SQSRecord;
}

let synth: Mock;

function deps(db: ProcessDeps['db']): ProcessDeps {
  return {
    db,
    polly: {} as never,
    s3: {} as never,
    bucket: 'content-bucket',
    synth,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  synth = vi.fn().mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processRecord', () => {
  it('synthesizes and sets audioS3Key for an audioless dictation row', async () => {
    const { db, updateCalls } = fakeDb([dictationRow()]);

    const failed = await processRecord(recordWith(EXERCISE_ID), deps(db));

    expect(failed).toBe(false);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(synth).toHaveBeenCalledWith({
      polly: expect.anything(),
      s3: expect.anything(),
      bucket: 'content-bucket',
      key: `dictation/${EXERCISE_ID}.mp3`,
      text: 'Hola mundo.',
      voiceId: 'Sergio',
      languageCode: 'es-ES',
    });
    expect(updateCalls).toEqual([
      { audioS3Key: `dictation/${EXERCISE_ID}.mp3` },
    ]);
  });

  it('skips synthesis when audioS3Key is already set (idempotent redelivery)', async () => {
    const { db, updateCalls } = fakeDb([
      dictationRow({ audioS3Key: `dictation/${EXERCISE_ID}.mp3` }),
    ]);

    const failed = await processRecord(recordWith(EXERCISE_ID), deps(db));

    expect(failed).toBe(false);
    expect(synth).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it('reports a batch failure when synth throws (→ DLQ after retries)', async () => {
    const { db, updateCalls } = fakeDb([dictationRow()]);
    synth.mockRejectedValueOnce(new Error('Polly is down'));

    const failed = await processRecord(recordWith(EXERCISE_ID), deps(db));

    expect(failed).toBe(true);
    expect(synth).toHaveBeenCalledTimes(1);
    // The UPDATE never ran because synth threw first.
    expect(updateCalls).toEqual([]);
  });

  it('malformed body → batch failure, synth never called', async () => {
    const { db } = fakeDb([]);
    const record = { messageId: 'msg-bad', body: 'not-json' } as SQSRecord;

    const failed = await processRecord(record, deps(db));

    expect(failed).toBe(true);
    expect(synth).not.toHaveBeenCalled();
  });

  it('missing row → no-op success (does not poison the queue)', async () => {
    const { db, updateCalls } = fakeDb([]); // no row found

    const failed = await processRecord(recordWith(EXERCISE_ID), deps(db));

    expect(failed).toBe(false);
    expect(synth).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it('non-dictation row → no-op success (does not poison the queue)', async () => {
    const { db, updateCalls } = fakeDb([
      dictationRow({ type: ExerciseType.CLOZE }),
    ]);

    const failed = await processRecord(recordWith(EXERCISE_ID), deps(db));

    expect(failed).toBe(false);
    expect(synth).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it('unknown language (no Polly code) → batch failure (retry → DLQ)', async () => {
    const { db, updateCalls } = fakeDb([dictationRow({ language: 'XX' })]);

    const failed = await processRecord(recordWith(EXERCISE_ID), deps(db));

    expect(failed).toBe(true);
    expect(synth).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });
});

describe('runRecords (batch aggregation)', () => {
  it('reports EXACTLY the failing record id in batchItemFailures, not the succeeding one', async () => {
    // Mixed batch: a well-formed dictation record (synthesizes → success) and a
    // malformed-body record (fails at parse, before any DB read). The single
    // `fakeDb` row backs the good record; the malformed record never queries it.
    // Distinct messageIds make the { itemIdentifier: record.messageId } mapping
    // genuinely verifiable — the loop must skip the success and surface only the
    // failure.
    const { db, updateCalls } = fakeDb([dictationRow()]);

    const okRecord = recordWith(EXERCISE_ID, 'msg-ok');
    const badRecord = {
      messageId: 'msg-bad',
      body: 'not-json',
    } as unknown as SQSRecord;

    const response = await runRecords([okRecord, badRecord], deps(db));

    // Only the malformed record is reported; the success is absent.
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'msg-bad' }]);
    // The successful record still did its work.
    expect(synth).toHaveBeenCalledTimes(1);
    expect(updateCalls).toEqual([
      { audioS3Key: `dictation/${EXERCISE_ID}.mp3` },
    ]);
  });

  it('returns an empty batchItemFailures when every record succeeds', async () => {
    const { db } = fakeDb([dictationRow()]);

    const response = await runRecords(
      [recordWith(EXERCISE_ID, 'msg-a'), recordWith(EXERCISE_ID, 'msg-b')],
      deps(db),
    );

    expect(response).toEqual({ batchItemFailures: [] });
  });
});
