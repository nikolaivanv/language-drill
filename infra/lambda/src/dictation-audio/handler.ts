/**
 * SQS event-source handler for the dictation audio-synth Lambda. AWS invokes
 * this with a batch of SQS records; each record body is `{ exerciseId: string }`
 * (enqueued by the generation handler once a dictation row is inserted as
 * approved/flagged with `audio_s3_key = null`). For each record the handler:
 *   1. loads the `exercises` row,
 *   2. skips rows that are missing, non-dictation, or already have audio
 *      (idempotent — safe under SQS at-least-once redelivery),
 *   3. synthesizes the `referenceText` with the row's Polly `voiceId` and the
 *      language's Polly `LanguageCode`, uploads the MP3 to S3 under
 *      `dictation/<id>.mp3`, and
 *   4. sets `audio_s3_key` — at which point PR 1's serve gate lets the row
 *      reach learners.
 *
 * Per-record isolation: each record runs in its own try/catch, so a single
 * malformed or throwing record never poisons the rest of the batch. The
 * function returns `{ batchItemFailures }` per the AWS partial-batch-failure
 * contract — only records the handler couldn't resolve are reported, so SQS
 * redelivers them after the visibility timeout and they DLQ after
 * `maxReceiveCount`. Missing / non-dictation rows are treated as success
 * (nothing to do; never re-queued).
 *
 * The per-record work is factored behind the exported `processRecord` (with
 * injected deps) so tests exercise every branch without touching the real AWS
 * SDK or Neon. `handler` constructs the module-scoped clients once at
 * cold-start and reuses them across warm invocations — same pattern as the
 * generation + API Lambdas.
 */

import { PollyClient } from '@aws-sdk/client-polly';
import { S3Client } from '@aws-sdk/client-s3';
import {
  createDb,
  dictationAudioKey,
  exercises,
  requireEnv,
  synthesizeToS3,
  type Db,
  type SynthesizeToS3Args,
} from '@language-drill/db';
import { ExerciseType, type DictationContent } from '@language-drill/shared';
import { eq } from 'drizzle-orm';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Cold-start singletons — reused across warm invocations.
// ---------------------------------------------------------------------------

const db = createDb(requireEnv('DATABASE_URL'));
const polly = new PollyClient({});
const s3 = new S3Client({});

// ---------------------------------------------------------------------------
// Language → Polly BCP-47 language code.
//
// ES is the only language exercised this milestone; DE/TR are included so the
// next languages are a one-line add (the dictation curriculum + voices are the
// only other prerequisite). A language absent from this map throws, which DLQs
// the record — a louder signal than silently dropping it.
// ---------------------------------------------------------------------------

const LANGUAGE_CODE_BY_LANGUAGE: Record<string, string> = {
  ES: 'es-ES',
  DE: 'de-DE',
  TR: 'tr-TR',
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Message contract
// ---------------------------------------------------------------------------

type AudioJobMessage = { exerciseId: string };

function parseAudioJobMessage(body: string): AudioJobMessage {
  const parsed: unknown = JSON.parse(body);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { exerciseId?: unknown }).exerciseId !== 'string' ||
    (parsed as { exerciseId: string }).exerciseId.length === 0
  ) {
    throw new Error('message body is not { exerciseId: string }');
  }
  return { exerciseId: (parsed as { exerciseId: string }).exerciseId };
}

// ---------------------------------------------------------------------------
// Per-record processor (DI seam)
// ---------------------------------------------------------------------------

export type ProcessDeps = {
  db: Db;
  polly: PollyClient;
  s3: S3Client;
  bucket: string;
  /** Injected so tests don't reach the real Polly/S3 SDK. */
  synth: (args: SynthesizeToS3Args) => Promise<void>;
};

/**
 * Process one SQS record. Returns `true` if the record should be reported as a
 * batch failure (→ SQS retry → DLQ), `false` on success or intentional no-op.
 * Never throws — all failure modes are mapped to the boolean return so the
 * batch loop stays simple.
 */
export async function processRecord(
  record: SQSRecord,
  deps: ProcessDeps,
): Promise<boolean> {
  let exerciseId: string;
  try {
    exerciseId = parseAudioJobMessage(record.body).exerciseId;
  } catch (err) {
    log({
      level: 'error',
      messageId: record.messageId,
      // Truncate untrusted payload to bound log size / prevent log injection.
      body: record.body.slice(0, 500),
      error: errMessage(err),
      message: 'failed to parse audio-synth message',
    });
    return true; // malformed → retry → DLQ
  }

  try {
    const rows = await deps.db
      .select()
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1);
    const row = rows[0];

    // Missing or non-dictation → nothing to do; never re-queue.
    if (!row || row.type !== ExerciseType.DICTATION) {
      log({
        level: 'info',
        exerciseId,
        message: row ? 'row is not a dictation; skipping' : 'row not found; skipping',
      });
      return false;
    }

    // Idempotency: audio already synthesized on a prior (redelivered) attempt.
    if (row.audioS3Key) {
      log({
        level: 'info',
        exerciseId,
        message: 'audioS3Key already set; skipping synthesis',
      });
      return false;
    }

    const content = row.contentJson as DictationContent | null;
    const referenceText = content?.referenceText;
    const voiceId = content?.voiceId;
    if (!referenceText || !voiceId) {
      // Malformed content for an audioless dictation row is unexpected and
      // unrecoverable by retry, but DLQ-ing surfaces it for a human rather
      // than silently dropping. (No synthesis without text + voice.)
      throw new Error(
        `dictation row ${exerciseId} missing referenceText or voiceId in contentJson`,
      );
    }

    const languageCode = LANGUAGE_CODE_BY_LANGUAGE[row.language ?? ''];
    if (!languageCode) {
      throw new Error(
        `no Polly language code for language '${row.language}' (exercise ${exerciseId})`,
      );
    }

    const key = dictationAudioKey(exerciseId);
    await deps.synth({
      polly: deps.polly,
      s3: deps.s3,
      bucket: deps.bucket,
      key,
      text: referenceText,
      voiceId,
      languageCode,
    });

    await deps.db
      .update(exercises)
      .set({ audioS3Key: key })
      .where(eq(exercises.id, exerciseId));

    log({
      level: 'info',
      exerciseId,
      key,
      message: 'synthesized dictation audio and set audioS3Key',
    });
    return false;
  } catch (err) {
    log({
      level: 'error',
      messageId: record.messageId,
      exerciseId,
      error: errMessage(err),
      message: 'audio synthesis failed',
    });
    return true; // Polly/S3/DB error → retry → DLQ after maxReceiveCount
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const bucket = requireEnv('CONTENT_BUCKET_NAME');
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    const failed = await processRecord(record, {
      db,
      polly,
      s3,
      bucket,
      synth: synthesizeToS3,
    });
    if (failed) {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
