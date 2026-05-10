/**
 * Phase 4 — pure SQS-posting helper for `pnpm generate:exercises --queue`.
 *
 * Takes a resolved `Cell[]` plus the parsed CLI args and emits one
 * `GenerationJobMessage` per cell to the generation `SQSClient`. The CLI's
 * `mainQueue` wraps this; tests exercise it in isolation with a mocked
 * SQSClient (Task 30).
 *
 * The CLI uses `randomUUID()` for `jobId` rather than `deterministicUuid` —
 * this is the "I want fresh jobs every time" path. The scheduler (Component 4)
 * is the deterministic-on-purpose case.
 *
 * The `GenerationJobMessage` type below MUST stay in lockstep with the
 * source-of-truth in `infra/lambda/src/generation/job-message.ts`. Both are
 * the same plain-JSON shape; the duplication avoids a reverse package edge
 * (`packages/db` cannot import from `infra/lambda`, which already imports
 * `@language-drill/db`). The Task 30 round-trip test imports the parser
 * directly to assert the two definitions stay aligned.
 */

import { randomUUID } from 'node:crypto';

import {
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  type ExerciseType,
  type LearningLanguage,
} from '@language-drill/shared';

import { type Cell, chunk } from '../src';
import { type CurriculumCefrLevel } from '../src/curriculum';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mirror of `infra/lambda/src/generation/job-message.ts:GenerationJobMessage`.
 * Producer-side declaration to keep `packages/db` free of any inbound edge
 * from `infra/lambda`. The Task 30 test imports the canonical parser and
 * round-trips messages produced here through it, so any drift between the
 * two surfaces fails CI.
 */
export type GenerationJobMessage = {
  jobId: string;
  trigger: 'cli' | 'scheduled' | 'admin';
  spec: {
    language: LearningLanguage;
    cefrLevel: CurriculumCefrLevel;
    exerciseType: ExerciseType;
    grammarPointKey: string;
    topicDomain: string | null;
    count: number;
    batchSeed: string;
  };
  maxCostUsd: number;
};

export type PostToQueueArgs = {
  cells: readonly Cell[];
  batchSeed: string;
  topicDomain: string | null;
  count: number;
  maxCostUsd: number;
  allowProd: boolean;
  dryRun: boolean;
};

export type PostedJob = {
  cellKey: string;
  jobId: string;
  messageId?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Req 6.6 — refuse to post more than this many cells in one CLI invocation. */
export const MAX_CLI_CELLS_PER_INVOCATION = 100;

/** SQS `SendMessageBatchCommand` hard limit. */
const MAX_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// postCellsToQueue
// ---------------------------------------------------------------------------

export async function postCellsToQueue(
  sqs: SQSClient,
  queueUrl: string,
  args: PostToQueueArgs,
): Promise<PostedJob[]> {
  // Req 6.6 — refuse oversized invocations before any SQS call.
  if (args.cells.length > MAX_CLI_CELLS_PER_INVOCATION) {
    throw new Error(
      `MAX_CLI_CELLS_PER_INVOCATION exceeded: ${args.cells.length} cells > ${MAX_CLI_CELLS_PER_INVOCATION}. The scheduler is the right tool for language-wide fills.`,
    );
  }

  // Req 6.5 — defense-in-depth substring guard. The Lambda's
  // `ENV_NAME=production && trigger='cli'` reject (Req 2.6) is the primary
  // contract; this check just shrinks the "I forgot which terminal I was in"
  // blast radius.
  if (!args.allowProd && !queueUrl.includes('-dev-')) {
    throw new Error(
      'Refusing to post to prod queue without --allow-prod (queue URL does not contain "-dev-")',
    );
  }

  const messages: GenerationJobMessage[] = args.cells.map((cell) => ({
    jobId: randomUUID(),
    trigger: 'cli',
    spec: {
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
      topicDomain: args.topicDomain,
      count: args.count,
      batchSeed: args.batchSeed,
    },
    maxCostUsd: args.maxCostUsd,
  }));

  if (args.dryRun) {
    for (const m of messages) {
      process.stdout.write(
        `[dry-run] Would post job ${m.jobId} for ${cellKeyOf(args.cells, m)} (count=${m.spec.count}, trigger=cli)\n`,
      );
    }
    return messages.map((m) => ({
      cellKey: cellKeyOf(args.cells, m),
      jobId: m.jobId,
    }));
  }

  const posted: PostedJob[] = [];
  for (const batch of chunk(messages, MAX_BATCH_SIZE)) {
    const command = new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: batch.map((msg, i) => ({
        Id: String(i),
        MessageBody: JSON.stringify(msg),
      })),
    });
    const response = await sqs.send(command);
    const successful = response.Successful ?? [];
    batch.forEach((msg, i) => {
      const entry = successful.find((e) => e.Id === String(i));
      const cellKey = cellKeyOf(args.cells, msg);
      posted.push({
        cellKey,
        jobId: msg.jobId,
        messageId: entry?.MessageId,
      });
      process.stdout.write(
        `Posted job ${msg.jobId} for ${cellKey} (count=${msg.spec.count}, trigger=cli)\n`,
      );
    });
  }
  return posted;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the originating `cell.cellKey` for a produced message. Cells and
 * messages are produced in lockstep order so we could index by position; the
 * lookup-by-grammarPointKey-and-type form is a tiny safeguard against future
 * code that reorders the messages array.
 */
function cellKeyOf(
  cells: readonly Cell[],
  msg: GenerationJobMessage,
): string {
  const cell = cells.find(
    (c) =>
      c.grammarPoint.key === msg.spec.grammarPointKey &&
      c.exerciseType === msg.spec.exerciseType &&
      c.cefrLevel === msg.spec.cefrLevel &&
      c.language === msg.spec.language,
  );
  return cell?.cellKey ?? '?';
}
