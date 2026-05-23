/**
 * SQS event-source handler for the theory generation Lambda. AWS invokes this
 * with a batch of SQS records; each record body is a
 * `TheoryGenerationJobMessage` (one cell-job). The handler is a thin shell
 * over `runOneTheoryCell` from `@language-drill/db`: it parses + validates
 * the message, applies the round-1 / production-trigger / idempotency /
 * curriculum / kind guards (Reqs 2.1–2.7), looks up the curriculum entry,
 * builds a `TheoryCell`, arms a soft-deadline `AbortController` (Req 2a.2 —
 * the PR #79 zombie-prevention fix theory ships ahead of the exercise side),
 * and dispatches.
 *
 * Per-record isolation: each record runs in its own try/catch, so a single
 * malformed or unexpectedly-throwing record never poisons the rest of the
 * batch. The function returns `{ batchItemFailures }` per the AWS partial-
 * batch-failure contract: only entries the handler couldn't terminally
 * resolve are reported back, so SQS redelivers them after the visibility
 * timeout. Successful runs and terminal failures (the `runOneTheoryCell`
 * audit row is the source of truth) are silently acknowledged.
 *
 * Module-level db + Anthropic client are constructed at cold-start and reused
 * across invocations — same pattern as the exercise generation Lambda.
 */

import {
  buildTheoryCellKey,
  createDb,
  getGrammarPoint,
  requireEnv,
  runOneTheoryCell,
  THEORY_ROUND_1_CEFR_LEVELS,
  type TheoryCell,
  type TheoryCellResult,
} from '@language-drill/db';
import {
  createClaudeClient,
  flushObservability,
  THEORY_GENERATION_PROMPT_VERSION,
  withLlmTrace,
} from '@language-drill/ai';
import type { Context, SQSBatchResponse, SQSEvent } from 'aws-lambda';

import {
  checkTheoryAuditRowState,
  parseTheoryGenerationJobMessage,
} from './job-message';
import { errMessage, summarizeTheoryResult } from './log';

// ---------------------------------------------------------------------------
// Cold-start singletons
// ---------------------------------------------------------------------------

const db = createDb(requireEnv('DATABASE_URL'));
const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Safety margin (ms) between `runOneTheoryCell`'s soft-deadline abort and
 * AWS's hard-kill of the runtime at the Lambda's `timeout` (PR #79 fix —
 * Req 2a.2). 10 s leaves room for `failClosed` to UPDATE the audit row to
 * `status='failed'` before AWS terminates.
 */
const SOFT_DEADLINE_SAFETY_MARGIN_MS = 10_000;

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
        parsed = parseTheoryGenerationJobMessage(JSON.parse(record.body));
      } catch (err) {
        log({
          level: 'error',
          messageId: record.messageId,
          // Req 2.1: truncate untrusted payload to bound CloudWatch log size
          // and prevent log injection from arbitrarily large bodies.
          body: record.body.slice(0, 500),
          error: errMessage(err),
          message: 'failed to parse SQS message',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // 2. Round-1 CEFR guard (Req 2.2). The parser accepts C1/C2 at runtime
      //    for forward-compat, but Phase 4 only services A1–B2.
      if (
        !(THEORY_ROUND_1_CEFR_LEVELS as readonly string[]).includes(
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

      // 3. Production-trigger guard (Req 2.3). Defense-in-depth on top of
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

      // 4. Audit-row idempotency (Reqs 2.4, 2.5). SQS at-least-once → inspect
      //    prior state before re-running.
      const audit = await checkTheoryAuditRowState(db, parsed.jobId);
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

      // 5. Curriculum lookup (Req 2.6). Throwing on miss surfaces it via the
      //    outer catch — there's no inline batchItemFailures push here.
      const grammarPoint = getGrammarPoint(parsed.spec.grammarPointKey);
      if (!grammarPoint) {
        throw new Error(
          `grammarPointKey not in curriculum: ${parsed.spec.grammarPointKey}`,
        );
      }

      // 6. Kind check (Req 2.7). Vocab umbrellas are not theory subjects.
      if (grammarPoint.kind !== 'grammar') {
        log({
          level: 'warn',
          jobId: parsed.jobId,
          messageId: record.messageId,
          grammarPointKey: parsed.spec.grammarPointKey,
          kind: grammarPoint.kind,
          message: 'curriculum entry is not a grammar point',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // 7. Cell construction.
      const cell: TheoryCell = {
        language: parsed.spec.language,
        cefrLevel: parsed.spec.cefrLevel,
        grammarPoint,
        cellKey: buildTheoryCellKey({
          language: parsed.spec.language,
          cefrLevel: parsed.spec.cefrLevel,
          grammarPointKey: parsed.spec.grammarPointKey,
        }),
      };

      // 8. Soft-deadline AbortController (Req 2a.2 — PR #79 fix). When the
      //    Lambda is within SOFT_DEADLINE_SAFETY_MARGIN_MS of the runtime's
      //    hard timeout, abort the signal so `runOneTheoryCell`'s `failClosed`
      //    branch can UPDATE the audit row to `status='failed'` before AWS
      //    hard-kills the process. `Math.max(..., 1)` floors the timeout at
      //    1 ms (never schedule a negative timer if the Lambda is already
      //    inside the safety margin at the start of this record).
      const controller = new AbortController();
      const remainingMs = context.getRemainingTimeInMillis();
      const softDeadlineMs = Math.max(
        remainingMs - SOFT_DEADLINE_SAFETY_MARGIN_MS,
        1,
      );
      const timer = setTimeout(() => controller.abort(), softDeadlineMs);
      try {
        // 9. Dispatch. `runOneTheoryCell` already accepts `signal?: AbortSignal`
        //    (Phase 3 contract) and threads it through generator + validator
        //    with `failClosed` finalization on abort.
        //
        //    Wrapped in `withLlmTrace` so the Anthropic Proxy can tag every
        //    `generate-theory` AND `validate-theory` call inside this cell
        //    with the shared job + cell metadata. The Proxy disambiguates
        //    feature='generate-theory' vs 'validate-theory' from the
        //    outgoing tool name via `TOOL_NAME_TO_FEATURE` (one outer ALS
        //    scope is sufficient — see design Component 2).
        let result: TheoryCellResult;
        try {
          result = await withLlmTrace(
            {
              feature: 'generate-theory',
              env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
              promptVersion: THEORY_GENERATION_PROMPT_VERSION,
              requestId: record.messageId,
              jobId: parsed.jobId,
              cellKey: cell.cellKey,
              language: parsed.spec.language,
              cefrLevel: parsed.spec.cefrLevel,
              exerciseType: 'theory',
            },
            () =>
              runOneTheoryCell({
                db,
                client,
                cell,
                args: {
                  batchSeed: parsed.spec.batchSeed,
                  maxCostUsd: parsed.maxCostUsd,
                },
                jobId: parsed.jobId,
                trigger: parsed.trigger,
                signal: controller.signal,
              }),
          );
        } catch (err) {
          // The orchestrator's failClosed branch should swallow most errors,
          // but a defensive catch here keeps the per-record flow isolated.
          log({
            level: 'error',
            jobId: parsed.jobId,
            messageId: record.messageId,
            error: errMessage(err),
            message: 'runOneTheoryCell threw',
          });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          continue;
        }

        // 10. Result dispatch.
        if (result.status === 'succeeded') {
          log({
            level: 'info',
            jobId: parsed.jobId,
            ...summarizeTheoryResult(result),
            message: 'cell succeeded',
          });
          continue;
        }

        // 'failed' OR 'skipped-cost-cap' — terminal failure; audit row
        // carries the verdict. Silent ack (no batchItemFailures push) —
        // redelivery would just trip the idempotency guard on the next call.
        log({
          level: 'warn',
          jobId: parsed.jobId,
          status: result.status,
          errorMessage: result.errorMessage,
          message: 'cell terminal-failed',
        });
      } finally {
        // Req 2a.5 — clearTimeout regardless of outcome so the timer cannot
        // leak across invocations in the same warm Lambda container.
        clearTimeout(timer);
        // Drain buffered traces per record so each cell's generate-theory +
        // validate-theory traces land in Langfuse before the Lambda freezes
        // between SQS batches. No-op when Langfuse is disabled.
        await flushObservability();
      }
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
    }
  }

  return { batchItemFailures };
}

