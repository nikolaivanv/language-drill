/**
 * SQS event-source handler for the generation Lambda. AWS invokes this with a
 * batch of SQS records; each record body is a `GenerationJobMessage` (one
 * cell-job). The handler is a thin shell over `runOneCell` from
 * `@language-drill/db`: it parses + validates the message, applies the
 * round-1 / production-trigger / idempotency guards (Reqs 2.5–2.9), looks up
 * the curriculum entry, builds a `Cell`, and dispatches.
 *
 * Per-record isolation: each record runs in its own try/catch, so a single
 * malformed or unexpectedly-throwing record never poisons the rest of the
 * batch. The function returns `{ batchItemFailures }` per the AWS partial-
 * batch-failure contract: only entries the handler couldn't terminally
 * resolve are reported back, so SQS redelivers them after the visibility
 * timeout. Successful runs and terminal failures (the `runOneCell` audit row
 * is the source of truth) are silently acknowledged.
 *
 * Module-level db + Anthropic client are constructed at cold-start and reused
 * across invocations — same pattern as the API Lambda.
 */

import {
  buildCellKey,
  createDb,
  getGrammarPoint,
  requireEnv,
  ROUND_1_CEFR_LEVELS,
  runOneCell,
  type Cell,
  type CellResult,
} from '@language-drill/db';
import {
  createObservedClaudeClient,
  flushObservability,
  GENERATION_PROMPT_VERSION,
  withLlmTrace,
} from '@language-drill/ai';
import type { Context, SQSBatchResponse, SQSEvent } from 'aws-lambda';

import {
  checkAuditRowState,
  parseGenerationJobMessage,
} from './job-message';
import { errMessage, summarizeResult } from './log';

// ---------------------------------------------------------------------------
// Cold-start singletons
// ---------------------------------------------------------------------------

const db = createDb(requireEnv('DATABASE_URL'));
// Observed Anthropic client — vanilla `new Anthropic({apiKey})` when
// Langfuse env vars are unset (Req 1 AC 2), Proxy-wrapped otherwise.
// One module-singleton shared across SQS records; the Anthropic Proxy
// reads ALS per call so trace metadata stays per-record correct even
// though the client itself is reused (design.md §2c).
const client = createObservedClaudeClient(requireEnv('ANTHROPIC_API_KEY'));

// ---------------------------------------------------------------------------
// Soft-deadline buffer
//
// AWS hard-kills the Lambda at the configured 900 s timeout with no JS-level
// finally/catch opportunity, leaving audit rows stuck in `running`. We fire
// an AbortController this many ms before the hard timeout so `runOneCell`'s
// outer try/catch routes through `failClosed` and writes `status='failed'`
// before AWS pulls the plug. 30 s leaves headroom for in-flight Claude HTTP
// teardown + Neon WS round-trip + p99 cold-connection retry.
// ---------------------------------------------------------------------------

const SOFT_DEADLINE_BUFFER_MS = 30_000;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: SQSEvent,
  context: Context,
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      // 1. Parse the body. Inner try-catch so the parse-fail branch is the
      //    *only* place that can push for this record before `parsed` is in
      //    scope; the outer catch handles unanticipated throws once we have
      //    a parsed message.
      let parsed;
      try {
        parsed = parseGenerationJobMessage(JSON.parse(record.body));
      } catch (err) {
        log({
          level: 'error',
          messageId: record.messageId,
          // Req 2.5: truncate untrusted payload to bound CloudWatch log size
          // and prevent log injection from arbitrarily large bodies.
          body: record.body.slice(0, 500),
          error: errMessage(err),
          message: 'failed to parse SQS message',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // 2. Round-1 CEFR guard (Req 2.7). The parser accepts C1/C2 at runtime
      //    for forward-compat, but Phase 4 only services A1–B2.
      if (
        !(ROUND_1_CEFR_LEVELS as readonly string[]).includes(
          parsed.spec.cefrLevel,
        )
      ) {
        log({
          level: 'warn',
          jobId: parsed.jobId,
          messageId: record.messageId,
          cefrLevel: parsed.spec.cefrLevel,
          message: 'out-of-scope CEFR level',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // 3. Production-trigger guard (Req 2.6). Defense-in-depth on top of
      //    the CLI's prod-queue substring guard.
      if (
        process.env['ENV_NAME'] === 'production' &&
        parsed.trigger === 'cli'
      ) {
        log({
          level: 'warn',
          jobId: parsed.jobId,
          messageId: record.messageId,
          message: 'rejecting cli-trigger in production',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // 4. Audit-row idempotency (Req 2.9). SQS at-least-once → inspect prior
      //    state before re-running.
      const audit = await checkAuditRowState(db, parsed.jobId);
      if (audit.status === 'completed') {
        // Implicit acknowledgment: no batchItemFailures push.
        log({
          level: 'info',
          jobId: parsed.jobId,
          message: `already ${audit.jobStatus}; skipping`,
        });
        continue;
      }
      if (audit.status === 'in-progress') {
        log({
          level: 'warn',
          jobId: parsed.jobId,
          messageId: record.messageId,
          message: 'already running; deferring',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // 5. Curriculum lookup. Throwing on miss surfaces it via the outer
      //    catch — there's no inline batchItemFailures push here.
      const grammarPoint = getGrammarPoint(parsed.spec.grammarPointKey);
      if (!grammarPoint) {
        throw new Error(
          `grammarPointKey not in curriculum: ${parsed.spec.grammarPointKey}`,
        );
      }

      // 6. Cell construction.
      const cell: Cell = {
        language: parsed.spec.language,
        cefrLevel: parsed.spec.cefrLevel,
        exerciseType: parsed.spec.exerciseType,
        grammarPoint,
        cellKey: buildCellKey({
          language: parsed.spec.language,
          cefrLevel: parsed.spec.cefrLevel,
          exerciseType: parsed.spec.exerciseType,
          grammarPointKey: parsed.spec.grammarPointKey,
        }),
      };

      // 7. Dispatch to runOneCell. A throw here is caller-visible (network,
      //    bug) and warrants redelivery; the audit row is `runOneCell`'s
      //    responsibility for terminal-failure persistence.
      //
      //    Wrapped in `withLlmTrace` so the Anthropic Proxy can tag every
      //    `generate`-AND-`validate` call inside this cell with the shared
      //    job + cell metadata (Req 2 AC 3 / 4). The Proxy disambiguates
      //    feature='generate' vs 'validate' from the outgoing tool name
      //    via `TOOL_NAME_TO_FEATURE` (design.md §2c); ALS carries the
      //    shared fields, the Proxy picks the per-call feature tag.
      // Soft-deadline: abort `runOneCell` ~30 s before AWS hard-kills the
      // Lambda. `runOneCell`'s outer try/catch routes the abort through
      // `failClosed`, finalizing the audit row as `status='failed'`. Without
      // this, the row stays in `'running'` and the idempotency guard at step
      // 4 above defers every redelivery until DLQ.
      const remainingMs = context.getRemainingTimeInMillis();
      const deadlineMs = Math.max(
        remainingMs - SOFT_DEADLINE_BUFFER_MS,
        1_000,
      );
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(
          new Error(
            'Approaching Lambda timeout; finalized before forced termination',
          ),
        );
      }, deadlineMs);

      let result: CellResult;
      try {
        result = await withLlmTrace(
          {
            feature: 'generate',
            env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
            promptVersion: GENERATION_PROMPT_VERSION,
            requestId: record.messageId,
            jobId: parsed.jobId,
            cellKey: cell.cellKey,
            language: parsed.spec.language,
            cefrLevel: parsed.spec.cefrLevel,
            exerciseType: parsed.spec.exerciseType,
          },
          () =>
            runOneCell({
              db,
              client,
              cell,
              args: {
                count: parsed.spec.count,
                batchSeed: parsed.spec.batchSeed,
                topicDomain: parsed.spec.topicDomain,
                maxCostUsd: parsed.maxCostUsd,
                personTargets: parsed.spec.personTargets,
              },
              jobId: parsed.jobId,
              trigger: parsed.trigger,
              signal: controller.signal,
            }),
        );
      } catch (err) {
        log({
          level: 'error',
          jobId: parsed.jobId,
          messageId: record.messageId,
          error: errMessage(err),
          message: 'runOneCell threw',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      } finally {
        clearTimeout(timer);
      }

      // Result dispatch. Req 2.4 amendment: terminal failures (audit row
      // already has the verdict) are NOT pushed to batchItemFailures —
      // redelivery would just trip the idempotency guard at step 4.
      if (result.status === 'succeeded') {
        log({
          level: 'info',
          jobId: parsed.jobId,
          ...summarizeResult(result),
          message: 'cell succeeded',
        });
        continue;
      }
      // 'failed' or 'skipped-cost-cap'.
      log({
        level: 'warn',
        jobId: parsed.jobId,
        status: result.status,
        errorMessage: result.errorMessage,
        message: 'cell terminal-failed',
      });
    } catch (err) {
      // Outer safety net for unanticipated throws (curriculum miss, audit
      // check throw, anything else not handled inline). Inner branches that
      // already pushed used `continue`, so they never fall through here —
      // each record produces at most one batchItemFailures entry.
      log({
        level: 'error',
        messageId: record.messageId,
        error: errMessage(err),
        message: 'unhandled error in per-record flow',
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    } finally {
      // Drain buffered traces per record so each cell's generate +
      // validate traces land in Langfuse before the Lambda freezes
      // between SQS batches (Req 6 AC 3). No-op when Langfuse is
      // disabled — `continue` in any pre-trace gate also lands here.
      await flushObservability();
    }
  }

  return { batchItemFailures };
}
