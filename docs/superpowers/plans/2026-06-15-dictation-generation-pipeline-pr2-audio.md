# Dictation Generation Pipeline — PR 2 (Audio-Synth Lambda) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synthesize audio for approved dictation rows asynchronously. After the generation handler inserts an approved dictation row (with `audioS3Key = null`, from PR 1), enqueue an audio-synth job; a new SQS-fed Lambda calls Polly, uploads the MP3 to S3, and sets `audioS3Key` — at which point PR 1's serve gate lets the row reach learners.

**Architecture:** Mirror the existing generation SQS+Lambda+CDK pattern (`GenerationQueueConstruct` / `generation/handler.ts` / `GenerationLambdaConstruct`). Polly synthesis is extracted from the seed script into a shared `polly-synth.ts` lib used by both the new Lambda and the seed script (no duplicate Polly code). `validateAndInsertWithRetry`'s `DraftOutcome` gains the inserted exercise id so the generation handler can collect newly-approved dictation ids and batch them to the audio queue.

**Tech Stack:** AWS CDK (TypeScript), AWS Lambda (SQS event source), `@aws-sdk/client-polly`, `@aws-sdk/client-s3`, `@aws-sdk/client-sqs`, Drizzle, Vitest.

**Spec:** [`../specs/2026-06-15-dictation-generation-pipeline-design.md`](../specs/2026-06-15-dictation-generation-pipeline-design.md) §3.
**Depends on:** PR 1 (`2026-06-15-dictation-generation-pipeline-pr1-text.md`) merged — dictation generation produces the approved, audioless rows this PR fills.

**Pre-flight (read before Task 1):**
- `infra/lib/constructs/generation-queue.ts` — the SQS+DLQ+alarm construct to mirror.
- `infra/lib/constructs/generation-lambda.ts` — the consumer-Lambda construct (env, secrets, SQS event source, reserved concurrency) to mirror.
- `infra/lambda/src/generation/handler.ts` — the SQS handler shape (parse → guards → `runOneCell` → audit) and where to add the post-run enqueue.
- `infra/lib/stack.ts` — where the generation queue + lambda are instantiated and wired.
- `packages/db/scripts/seed-dictation.ts` — `synthesizeToS3` (the Polly code to extract), `audioKeyFor`.
- `infra/lambda/src/lib/audio-url.ts` — `CONTENT_BUCKET_NAME`, the S3 key convention `dictation/${id}.mp3`.
- `packages/db/src/generation/validate-and-insert.ts` — `DraftOutcome` (add the inserted id), the inserted branch (`inserted.length > 0`).
- `packages/db/src/generation/run-one-cell.ts` — the per-ordinal outcome loop (collect approved dictation ids) and `CellResult` (surface them).

**Conventions:** Tests in the existing `*.test.ts`; gate with `pnpm turbo run test --concurrency=1`. CDK construct tests follow the `*.test.ts` template snapshot pattern already in `infra/lib/constructs/`.

---

## Task 1: Extract Polly synthesis into a shared lib

**Files:**
- Create: `infra/lambda/src/lib/polly-synth.ts`
- Test: `infra/lambda/src/lib/polly-synth.test.ts`
- Modify: `packages/db/scripts/seed-dictation.ts` (call the shared helper)

- [ ] **Step 1: Write the failing test** (inject mock Polly + S3 clients)

Create `infra/lambda/src/lib/polly-synth.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { synthesizeToS3 } from './polly-synth';

it('synthesizes MP3 via Polly and uploads to S3 with the given language code', async () => {
  const polly = { send: vi.fn().mockResolvedValue({
    AudioStream: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
  }) };
  const s3 = { send: vi.fn().mockResolvedValue({}) };
  await synthesizeToS3({
    polly: polly as never, s3: s3 as never, bucket: 'b', key: 'dictation/x.mp3',
    text: 'Hola mundo.', voiceId: 'Sergio', languageCode: 'es-ES',
  });
  const pollyInput = polly.send.mock.calls[0][0].input;
  expect(pollyInput).toMatchObject({ Engine: 'neural', OutputFormat: 'mp3', VoiceId: 'Sergio', LanguageCode: 'es-ES', Text: 'Hola mundo.' });
  const s3Input = s3.send.mock.calls[0][0].input;
  expect(s3Input).toMatchObject({ Bucket: 'b', Key: 'dictation/x.mp3', ContentType: 'audio/mpeg' });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module does not exist).

Run: `pnpm --filter @language-drill/lambda test -- polly-synth.test.ts`

- [ ] **Step 3: Create the lib** (lift verbatim from `seed-dictation.ts:197-217`, parameterize `languageCode`)

Create `infra/lambda/src/lib/polly-synth.ts`:

```ts
import {
  PollyClient,
  SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandInput,
} from '@aws-sdk/client-polly';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** S3 key convention for dictation clips — must match audio-url.ts's reader. */
export function dictationAudioKey(exerciseId: string): string {
  return `dictation/${exerciseId}.mp3`;
}

export type SynthesizeToS3Args = {
  polly: PollyClient;
  s3: S3Client;
  bucket: string;
  key: string;
  text: string;
  voiceId: string;
  /** BCP-47 Polly language code, e.g. 'es-ES'. Was hardcoded in the seed script. */
  languageCode: string;
};

/** Synthesize `text` with a Polly neural voice and upload the MP3 to S3. */
export async function synthesizeToS3(args: SynthesizeToS3Args): Promise<void> {
  const input: SynthesizeSpeechCommandInput = {
    Engine: 'neural',
    OutputFormat: 'mp3',
    Text: args.text,
    VoiceId: args.voiceId as SynthesizeSpeechCommandInput['VoiceId'],
    LanguageCode: args.languageCode as SynthesizeSpeechCommandInput['LanguageCode'],
  };
  const out = await args.polly.send(new SynthesizeSpeechCommand(input));
  const bytes = await out.AudioStream!.transformToByteArray();
  await args.s3.send(
    new PutObjectCommand({ Bucket: args.bucket, Key: args.key, Body: bytes, ContentType: 'audio/mpeg' }),
  );
}
```

(`@aws-sdk/client-polly` is already a dependency of `packages/db` for the seed script; add it to `infra/lambda`'s `package.json` if not present — verify with `grep client-polly infra/lambda/package.json`.)

- [ ] **Step 4: Point the seed script at the shared helper**

In `packages/db/scripts/seed-dictation.ts`, delete the local `synthesizeToS3` (lines ~197-217) and `audioKeyFor`, and import from the lib. Because `packages/db` cannot import from `infra/lambda`, choose ONE:
- **(preferred)** move `polly-synth.ts` to a location both can import — if `packages/db` already depends on `@aws-sdk/client-polly`, put the shared file in `packages/db/src/lib/polly-synth.ts` and have the Lambda import it via the `@language-drill/db` barrel (the Lambda already imports `@language-drill/db`). Update Task 1's create-path accordingly and re-run its test under `@language-drill/db`.
- If a db-package home is awkward, keep the helper in `packages/db/src/lib/` (db owns the seed script) and import it into the Lambda from `@language-drill/db`.

Resolve this placement in Step 4 and keep all later references consistent. Update the seed script's call site to pass `languageCode: 'es-ES'` explicitly and `dictationAudioKey(id)` for the key.

- [ ] **Step 5: Run the seed-script test + lib test — expect PASS.**

Run: `pnpm --filter @language-drill/db test -- seed-dictation.test.ts` and the polly-synth test in its package.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(audio): extract shared Polly synth helper; seed script reuses it"
```

---

## Task 2: `DraftOutcome` carries the inserted exercise id

**Files:**
- Modify: `packages/db/src/generation/validate-and-insert.ts`
- Test: `packages/db/src/generation/validate-and-insert.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/db/src/generation/validate-and-insert.test.ts`, extend an existing successful-insert case to assert the returned `DraftOutcome` includes `insertedExerciseId` equal to the draft id, and that a rejected/dedup-given-up outcome leaves it `undefined`.

```ts
expect(outcome.terminalStatus).toBe('inserted-approved');
expect(outcome.insertedExerciseId).toBe(draft.id);
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/db test -- validate-and-insert.test.ts`

- [ ] **Step 3: Add the field**

In `packages/db/src/generation/validate-and-insert.ts`:

1. Add to the `DraftOutcome` type (near `realizedCoverage`):

```ts
  /**
   * The `exercises.id` of the row inserted on an inserted-* /
   * first-attempt-dedup-then-success outcome. Used by the generation handler to
   * enqueue an audio-synth job for newly-approved dictation rows (PR 2).
   * `undefined` on rejected / dedup-given-up outcomes.
   */
  insertedExerciseId?: string;
```

2. In the `inserted.length > 0` branch's returned object, add:

```ts
        insertedExerciseId: currentDraft.id,
```

(The id is `currentDraft.id` — equal to `opts.draft.id` on attempt 0, or the retry id after a dedup retry. It is exactly the `exercises.id` just inserted.)

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/db test -- validate-and-insert.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/validate-and-insert.ts packages/db/src/generation/validate-and-insert.test.ts
git commit -m "feat(db): DraftOutcome carries inserted exercise id for audio enqueue"
```

---

## Task 3: `runOneCell` surfaces newly-approved dictation ids

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts`
- Test: `packages/db/src/generation/run-one-cell.test.ts`

- [ ] **Step 1: Write the failing test**

In `run-one-cell.test.ts`, for a dictation cell where N drafts auto-approve, assert `CellResult.approvedDictationIds` is the list of those inserted ids (length N), and that for a non-dictation (cloze) cell it is `[]`.

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/db test -- run-one-cell.test.ts`

- [ ] **Step 3: Collect the ids in the outcome loop + surface on `CellResult`**

In `packages/db/src/generation/run-one-cell.ts`:

1. Add to `CellResult`:

```ts
  /**
   * `exercises.id`s of dictation rows this cell inserted as approved/flagged
   * (audio not yet synthesized). Empty for non-dictation cells. The generation
   * handler batches these to the dictation audio-synth queue (PR 2).
   */
  approvedDictationIds: string[];
```

2. Before the outcome loop, declare `const approvedDictationIds: string[] = [];`.

3. Inside the loop, on the `inserted-approved`, `inserted-flagged`, and `first-attempt-dedup-then-success` cases, when `cell.exerciseType === ExerciseType.DICTATION` and `outcome.insertedExerciseId`, push it:

```ts
          if (cell.exerciseType === ExerciseType.DICTATION && outcome.insertedExerciseId) {
            approvedDictationIds.push(outcome.insertedExerciseId);
          }
```

(Flagged dictation rows also need audio so a reviewer can listen before approving — include both. The serve gate from PR 1 still hides flagged rows from learners via `approvedStatusFilter`.)

4. Add `approvedDictationIds` to the success-path `return {...}` object, and `approvedDictationIds: []` to `failClosed`'s returned `CellResult`.

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/db test -- run-one-cell.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(db): runOneCell surfaces approved dictation ids"
```

---

## Task 4: Audio-synth SQS queue construct (CDK)

**Files:**
- Create: `infra/lib/constructs/dictation-audio-queue.ts`
- Test: `infra/lib/constructs/dictation-audio-queue.test.ts`

- [ ] **Step 1: Write the failing test** (mirror `generation-queue.test.ts`)

Create `infra/lib/constructs/dictation-audio-queue.test.ts` from the generation-queue test: assert the synthesized template has a queue with the right visibility timeout, a DLQ with `maxReceiveCount: 3` and 14-day retention, and a DLQ-depth alarm.

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/infra test -- dictation-audio-queue.test.ts`

- [ ] **Step 3: Create the construct** (copy `generation-queue.ts`, rename, shorter timeout)

Create `infra/lib/constructs/dictation-audio-queue.ts`:

```ts
import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * SQS queue + DLQ for the dictation audio-synth pipeline (Phase 2). One message
 * per approved dictation row; the consumer Lambda calls Polly, uploads the MP3
 * to S3, and sets `audio_s3_key`. A single Polly synth + S3 put is fast (a few
 * seconds), so the visibility timeout is far below the generation queue's 900 s.
 * `maxReceiveCount = 3` gives a transient Polly/S3 error two retries before the
 * message lands in the DLQ.
 */
export class DictationAudioQueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly dlqDepthAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'DictationAudioDeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'DictationAudioQueue', {
      // Must be >= the consumer Lambda's timeout. Polly synth + S3 put is quick;
      // 120 s leaves generous headroom for cold starts + a long clip.
      visibilityTimeout: Duration.seconds(120),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });

    this.dlqDepthAlarm = new cloudwatch.Alarm(this, 'DictationAudioDlqDepthAlarm', {
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'A dictation audio-synth message survived every redelivery and landed in the DLQ.',
    });
  }
}
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/infra test -- dictation-audio-queue.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/lib/constructs/dictation-audio-queue.ts infra/lib/constructs/dictation-audio-queue.test.ts
git commit -m "feat(infra): dictation audio-synth SQS queue + DLQ alarm construct"
```

---

## Task 5: Audio-synth Lambda handler

**Files:**
- Create: `infra/lambda/src/dictation-audio/handler.ts`
- Create: `infra/lambda/src/dictation-audio/handler.test.ts`

- [ ] **Step 1: Define the message contract + write the failing test**

The message body is `{ exerciseId: string }`. Create `infra/lambda/src/dictation-audio/handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
// import { handler } from './handler';  // with injected deps per the handler's testable seam

it('synthesizes and sets audioS3Key for an audioless dictation row', async () => {
  // Arrange: a fake db returning one dictation row { id, contentJson: { referenceText, voiceId }, audioS3Key: null }
  // and a spy synth fn. Act: invoke the record processor. Assert: synth called with
  // referenceText + voiceId + 'es-ES' + key 'dictation/<id>.mp3', and db.update set audio_s3_key to that key.
});

it('skips synthesis when audioS3Key is already set (idempotent redelivery)', async () => {
  // Arrange: row already has audioS3Key. Assert: synth NOT called; record succeeds.
});

it('returns the record as a batch failure when synth throws (→ DLQ after retries)', async () => {
  // Assert the SQSBatchResponse.batchItemFailures contains the messageId.
});
```

Follow the dependency-injection seam used by `generation/handler.test.ts` (it factors the per-record work behind a testable function rather than mocking the AWS SDK at module scope) — mirror that exactly.

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/lambda test -- dictation-audio/handler.test.ts`

- [ ] **Step 3: Implement the handler**

Create `infra/lambda/src/dictation-audio/handler.ts`. It must:
- Parse each SQS record body to `{ exerciseId }`; malformed body → record-level failure (DLQ).
- Load the `exercises` row by id (via the shared `db` client used elsewhere in the Lambda package). If the row is missing or not `type='dictation'` → log + treat as success (nothing to do; don't poison the queue).
- **Idempotency:** if `audioS3Key` is already set, return success without synthesizing (safe SQS redelivery).
- Read `referenceText` and `voiceId` from `contentJson`; resolve the Polly `LanguageCode` from the row's `language` (ES → `'es-ES'`; add a small `LANGUAGE_CODE_BY_LANGUAGE` map so DE/TR are a one-line add later).
- `key = dictationAudioKey(exerciseId)`; call `synthesizeToS3({ polly, s3, bucket: requireEnv('CONTENT_BUCKET_NAME'), key, text: referenceText, voiceId, languageCode })`.
- `UPDATE exercises SET audio_s3_key = key WHERE id = exerciseId`.
- Any thrown error (Polly/S3/DB) → add the record's `messageId` to `batchItemFailures` so SQS retries, then DLQs after `maxReceiveCount`.
- Return `SQSBatchResponse` (partial-batch-failure), exactly like `generation/handler.ts`.

Keep AWS clients module-scoped (reused across warm invocations), and expose the per-record processor as an exported function taking injected deps so the tests in Step 1 don't touch the real SDK.

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/lambda test -- dictation-audio/handler.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/dictation-audio/
git commit -m "feat(lambda): dictation audio-synth SQS handler (idempotent synth → S3 → set key)"
```

---

## Task 6: Enqueue approved dictation ids from the generation handler

**Files:**
- Modify: `infra/lambda/src/generation/handler.ts`
- Test: `infra/lambda/src/generation/handler.test.ts`

- [ ] **Step 1: Write the failing test**

In `generation/handler.test.ts`, for a run where `runOneCell` (stub/spy) returns `approvedDictationIds: ['id1','id2']`, assert the handler sends a `SendMessageBatchCommand` to the dictation audio queue (URL from `DICTATION_AUDIO_QUEUE_URL` env) with two entries `{ exerciseId: 'id1' }`, `{ exerciseId: 'id2' }`. For a cloze cell (`approvedDictationIds: []`), assert no audio-queue send happens.

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/lambda test -- generation/handler.test.ts`

- [ ] **Step 3: Add the enqueue after `runOneCell`**

In `infra/lambda/src/generation/handler.ts`, after `runOneCell` returns a `CellResult` for a record, if `result.approvedDictationIds.length > 0`:
- Send them to the dictation audio queue via `SendMessageBatchCommand` in batches of ≤ 10 (reuse the scheduler's batching shape from `scheduler.ts:379`), with `QueueUrl = requireEnv('DICTATION_AUDIO_QUEUE_URL')` and each entry's body `JSON.stringify({ exerciseId })` and a unique `Id` (e.g. the exercise id, which is unique within a batch).
- Wrap the send in try/catch and **log-but-don't-fail** the generation record on an enqueue error: the dictation rows are inserted-and-approved already; the serve gate keeps them hidden until audio lands, and a reconcile/backfill can re-enqueue. (Do NOT mark the generation SQS record failed — that would re-run the whole cell and waste Claude budget.) Emit a structured warn so a metric filter can alarm on dropped enqueues.

Reuse the module-scoped `SQSClient` already imported in this file (or add one mirroring `scheduler.ts`).

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/lambda test -- generation/handler.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/handler.ts infra/lambda/src/generation/handler.test.ts
git commit -m "feat(lambda): generation handler enqueues approved dictation ids for audio synth"
```

---

## Task 7: Wire the queue + Lambda into the CDK stack

**Files:**
- Modify: `infra/lib/stack.ts`
- Create: `infra/lib/constructs/dictation-audio-lambda.ts` (consumer-Lambda construct, mirroring `generation-lambda.ts`)
- Test: `infra/lib/stack.test.ts` (or the relevant stack snapshot test), `infra/lib/constructs/dictation-audio-lambda.test.ts`

- [ ] **Step 1: Write the failing construct test** (mirror `generation-lambda.test.ts`)

Assert the synthesized template has: a Lambda with the `dictation-audio/handler` entry, an SQS event source on the `DictationAudioQueue`, `CONTENT_BUCKET_NAME` + `DICTATION_AUDIO_QUEUE_URL` + `DATABASE_URL` env, Polly + S3 (`s3:PutObject` on the content bucket) + DB-secret IAM grants, and a sensible `reservedConcurrency`.

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/infra test -- dictation-audio-lambda.test.ts`

- [ ] **Step 3: Create the Lambda construct** by adapting `generation-lambda.ts`: same NodejsFunction bundling, attach the `DictationAudioQueueConstruct.queue` as an `SqsEventSource`, grant `polly:SynthesizeSpeech` (no resource ARN — Polly is account-scoped), grant `s3:PutObject` on the content bucket, grant read on the DB secret, set env (`CONTENT_BUCKET_NAME`, `DATABASE_URL` wiring per the existing generation Lambda, `AWS_REGION`). Timeout 60–90 s (≤ the queue's 120 s visibility). `reservedConcurrency` modest (e.g. 2–3) to stay within Polly TPS.

- [ ] **Step 4: Instantiate + wire in `stack.ts`**

In `infra/lib/stack.ts`, alongside the generation queue/lambda wiring:
- `const dictationAudioQueue = new DictationAudioQueueConstruct(this, 'DictationAudioQueue');`
- `new DictationAudioLambdaConstruct(this, 'DictationAudioLambda', { queue: dictationAudioQueue.queue, contentBucket, dbSecret, ... });`
- Pass the queue URL to the **generation Lambda's** environment as `DICTATION_AUDIO_QUEUE_URL` (the generation handler enqueues to it — Task 6) and grant the generation Lambda `sqs:SendMessage` on `dictationAudioQueue.queue`.

- [ ] **Step 5: Run the stack + construct tests — expect PASS.**

Run: `pnpm --filter @language-drill/infra test`

- [ ] **Step 6: Commit**

```bash
git add infra/lib/stack.ts infra/lib/constructs/dictation-audio-lambda.ts infra/lib/constructs/dictation-audio-lambda.test.ts
git commit -m "feat(infra): provision dictation audio-synth Lambda + wire enqueue grant"
```

---

## Task 8: Full-suite gate + deploy/rollout note

- [ ] **Step 1: Lint + typecheck + tests across all packages**

```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```

Expected: zero failures. Run infra serially (the known parallel-load flake).

- [ ] **Step 2: CDK synth sanity check (no deploy)**

```bash
pnpm --filter @language-drill/infra exec cdk synth LanguageDrillStack-dev >/dev/null
```

Expected: synth succeeds (validates the new constructs + IAM wiring).

- [ ] **Step 3: Document rollout in the PR description**

After merge, `deploy.yml` runs CDK deploy → provisions the audio queue + Lambda and sets `DICTATION_AUDIO_QUEUE_URL` on the generation Lambda. From the next ~04:00 UTC scheduler tick, dictation cells generate approved rows, the generation handler enqueues their ids, and the audio Lambda fills `audioS3Key` — at which point PR 1's serve gate releases them to learners. Watch: the `DictationAudioDlqDepthAlarm`, the generation handler's "dropped enqueue" warn metric, and `exercises` rows with `type='dictation' AND audio_s3_key IS NULL` older than ~10 min (a stuck-synth signal). Backfill any pre-existing audioless rows with a one-off enqueue if needed.

- [ ] **Step 4: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "chore(audio): fixups from full-suite + synth gate"
```

---

## Self-review checklist

- [ ] **Spec coverage (§3):** shared synth lib → Task 1; trigger after approval → Tasks 2, 3, 6; SQS queue + DLQ → Task 4; audio Lambda (idempotent synth → S3 → set key) → Task 5; CDK wiring → Task 7.
- [ ] **No DB migration:** `audioS3Key` already exists (nullable); this PR only writes it. `DraftOutcome.insertedExerciseId` and `CellResult.approvedDictationIds` are in-memory.
- [ ] **Idempotency:** the audio handler skips when `audioS3Key` is set; enqueue uses the exercise id as a stable batch entry id; an enqueue failure never fails the generation record.
- [ ] **Type consistency:** `synthesizeToS3({...})` args object identical in Task 1 and Task 5; `dictationAudioKey(id)` used in Tasks 1 + 5; message body `{ exerciseId }` identical in Tasks 5 + 6; `approvedDictationIds` name matches across Tasks 3 + 6; env var `DICTATION_AUDIO_QUEUE_URL` identical in Tasks 6 + 7.
- [ ] **Serve gate** (PR 1, Task 9b) is the safety net that keeps audioless rows hidden during the synth window — confirm PR 1 is merged before PR 2 deploys.
