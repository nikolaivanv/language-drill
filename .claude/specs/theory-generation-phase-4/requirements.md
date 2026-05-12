# Requirements Document — theory-generation-phase-4

## Introduction

Phase 4 of theory generation productionizes the generator that Phases 1–3 shipped at the dev CLI level. Today (post-Phase 3 merge in `b85a96b`) an operator can run `pnpm generate:theory` locally against a real Anthropic key and a real Neon branch, but there is no scheduled refill, no admin-triggered path, no AWS deployment, and no way for the system to notice that `theory_topics` is missing a row for some grammar point and fill it without an operator typing the command.

Phase 4 closes that loop by adding three AWS pieces and one CLI affordance:

1. **An SQS-driven theory generator Lambda** (`infra/lambda/src/theory-generation/handler.ts`) that consumes `TheoryGenerationJobMessage` records and runs `runOneTheoryCell` per message — the same orchestrator the CLI uses today.
2. **An EventBridge-invoked scheduler Lambda** (`infra/lambda/src/theory-generation/scheduler.ts`) that walks the curriculum on a weekly cron, diffs against `theory_topics`, and enqueues a job for every cell missing an approved row. Deterministic `jobId` + audit-row idempotency makes re-fires safe.
3. **A `--queue` flag on the CLI** that dispatches a single message to SQS instead of invoking the generator in-process — the operator-facing path to the new infrastructure.
4. **CDK constructs** (`theory-generation-queue.ts`, `theory-generation-lambda.ts`, `theory-scheduler-lambda.ts`) that mirror the exercise-side constructs, plus three lines of stack wiring.

Phase 4 ships only after the pre-push gate is green (`pnpm lint && pnpm typecheck && pnpm test`) and a manual smoke test against the dev stack confirms the round-trip: scheduler-fired SQS message → consumer Lambda → `theory_topics` row appears within ~30 seconds.

**Intentionally deferred:** the panel registry fallback and the admin coverage tile are Phase 5, not Phase 4 (per `docs/theory-generation-plan.md` §4). A Phase 4-only deploy is invisible to learners — flagged rows still land but the panel does not query the new table yet.

**Building on the 2026-05-12 exercise-generation production incidents.** The exercise pipeline's first production scheduled run on 2026-05-12 exposed three failure modes the original Phase 4 design didn't anticipate. Theory Phase 4 ships with the fixes from day 1 rather than rediscovering them:
- **PR #71** — Lambda timeout 600 s → **900 s**, queue `visibilityTimeout` matched. Without it, runs near the timeout were silently killed before `failClosed` could finalize the audit row.
- **PR #76** — `maxConcurrency: reservedConcurrency` on the SQS event source. Without it, AWS pre-fetches messages beyond the Lambda's reserved-concurrency ceiling, cycles them through `visibilityTimeout` expirations, and silently DLQs them after `maxReceiveCount` cycles **without the Lambda ever running**. Observed live: 24/34 phantom DLQs on a 34-message redrive.
- **PR #79 (fix not yet shipped on exercises)** — soft-deadline `AbortController` from `context.getRemainingTimeInMillis() - 10_000` so cells approaching the timeout finalize cleanly via `failClosed` before AWS hard-kills the runtime. Theory ships this preemptively (Req 2a.2–5).

Three other exercise-side patches are intentionally **N/A for theory** and documented in Req 7.7: PR #87's per-ordinal loss tolerance (theory has no per-ordinal loop — one page per cell), PR #90's validator parallel pool (theory has one validator call per cell, nothing to parallelize), and PR #70's `.mapWith` aggregate decoder fix (read-side admin tile, deferred to Phase 5).

## Alignment with Product Vision

`product.md` positions the app for the **intermediate plateau** — learners past A2 who need accurate, complete reference material to push toward fluency. Phase 4 is the mechanism that lets ES, DE, TR theory coverage *grow without an operator in the loop*. The Phase 3 generator is correct but operator-bound; without Phase 4 the cost is "I forgot to run the CLI this week, and a learner just hit an empty theory panel for `de-b1-passive-voice`." Phase 4 turns the catalog from "what the author has remembered to generate" into "what the curriculum says we should have."

`tech.md` §5 (CI/CD) and §7 (Content & AI Strategy) commit to **pre-generated content via background Lambdas on EventBridge schedules** as the cost-control mechanism. The exercise generator has been on that footing since 2026-05; theory has been waiting. Phase 4 is additive to the existing AWS stack — same secrets, same IAM-policy shape, same construct organization, no new third-party service.

`docs/theory-generation-plan.md` §4 names Phase 4 as the gate between dev-time generation (CLI-only, shipped) and admin-triggered productionization (Phase 5). Without Phase 4 a Phase 5 admin tile would have nothing to dispatch into — the tile would render a button with no destination.

## Requirements

### Requirement 1 — `TheoryGenerationJobMessage` contract + parser

**User Story:** As a producer (CLI `--queue`, scheduler Lambda, future admin route) I want a typed, validated SQS message shape, so that the consumer Lambda can dispatch a message to `runOneTheoryCell` without ad-hoc JSON parsing.

#### Acceptance Criteria

1. WHEN a `TheoryGenerationJobMessage` is defined THEN it SHALL declare exactly these fields: `jobId: string` (UUID), `trigger: 'cli' | 'scheduled' | 'admin'`, `spec: { language: LearningLanguage; cefrLevel: CurriculumCefrLevel; grammarPointKey: string; batchSeed: string }`, `maxCostUsd: number`. **No `exerciseType`, no `count`, no `topicDomain`** (Req 7.4 / §3 *What does NOT transfer cleanly*).
2. WHEN `parseTheoryGenerationJobMessage(input: unknown)` is called THEN it SHALL throw an `Error` whose message names the offending field on every shape violation, mirroring `parseGenerationJobMessage` (the exercise-side parser at `infra/lambda/src/generation/job-message.ts:119`).
3. WHEN `spec.cefrLevel` is `'C1'` or `'C2'` THEN the parser SHALL accept it (forward-compat with a Phase 6 widening of the curriculum) and the consumer Lambda SHALL reject it via the round-1 guard (Req 2.5).
4. WHEN `spec.language` is `'EN'` THEN the parser SHALL throw — theory is L2-only (metalanguage is English, not a theory subject); the validated set is `{ ES, DE, TR }`.
5. WHEN `maxCostUsd` is ≤ 0 or ≥ 100 THEN the parser SHALL throw with the explicit `(0, 100)` range message.
6. WHEN `batchSeed` is empty or > 100 chars THEN the parser SHALL throw.
7. WHEN `checkTheoryAuditRowState(db, jobId)` is called THEN it SHALL inspect `theory_generation_jobs.status` for the row with `id = jobId` and return `{ status: 'absent' }` | `{ status: 'in-progress' }` | `{ status: 'completed'; jobStatus: 'succeeded' | 'failed' }`. The `'running'` and `'queued'` (forward-compat) statuses both map to `'in-progress'`. Mirrors `checkAuditRowState` at `infra/lambda/src/generation/job-message.ts:194`.

### Requirement 2 — Theory generator Lambda: guards + idempotency (`handler.ts` prelude)

**User Story:** As an SQS-driven consumer I want to apply parse / round-1 / prod-cli / curriculum / idempotency guards before invoking the orchestrator, so that misshapen or already-resolved messages never reach `runOneTheoryCell`.

#### Acceptance Criteria

1. WHEN a record body fails `parseTheoryGenerationJobMessage` THEN the handler SHALL log an `error`-level structured line with the truncated body (≤ 500 chars to bound CloudWatch line size + prevent log injection), push the `messageId` to `batchItemFailures`, and continue with the next record.
2. WHEN `spec.cefrLevel` is `'C1'` or `'C2'` THEN the handler SHALL log a `warn`-level line and push `messageId` to `batchItemFailures` (round-1 narrowing — the parser accepted it for forward-compat; the handler is the enforcement boundary).
3. WHEN `trigger === 'cli'` AND `process.env['ENV_NAME'] === 'production'` THEN the handler SHALL log a `warn`-level line and push `messageId` to `batchItemFailures` — defense-in-depth on top of the CLI's prod-queue substring guard.
4. WHEN `checkTheoryAuditRowState` returns `'completed'` THEN the handler SHALL log an `info`-level line and silently ack the record (no `batchItemFailures` push) — redelivery would be a no-op anyway.
5. WHEN `checkTheoryAuditRowState` returns `'in-progress'` THEN the handler SHALL log a `warn`-level line and push `messageId` to `batchItemFailures` so SQS redelivers after the visibility timeout.
6. WHEN `getGrammarPoint(spec.grammarPointKey)` returns `undefined` THEN the handler SHALL throw, which the outer catch logs at `error` level and pushes `messageId` to `batchItemFailures` — a curriculum miss is unexpected and warrants redelivery in case the curriculum module was updated between deliveries.
7. WHEN the curriculum entry's `kind !== 'grammar'` THEN the handler SHALL log a `warn`-level line and push `messageId` to `batchItemFailures` — vocab umbrellas are not theory subjects.

### Requirement 2a — Theory generator Lambda: dispatch + result handling (`handler.ts` body)

**User Story:** As an SQS-driven consumer I want to dispatch one cell-job per record, soft-finalize the audit row before AWS hard-kills the runtime, and report per-record outcomes back to SQS, so that AWS's partial-batch-failure mechanism redelivers transient failures without ever leaving a zombie 'running' audit row behind.

#### Acceptance Criteria

1. WHEN the Lambda is invoked with an `SQSEvent` THEN it SHALL iterate `event.Records`, run each record in its own try/catch, and return `{ batchItemFailures: [...] }` per AWS's partial-batch-failure contract.
2. WHEN per-record processing begins THEN the handler SHALL construct an `AbortController` and arm a soft-deadline `setTimeout` at `context.getRemainingTimeInMillis() - SOFT_DEADLINE_SAFETY_MARGIN_MS` (default safety margin: 10 s). Reason: PR #79's documented zombie failure mode — when AWS hard-kills the runtime at the Lambda timeout, `runOneTheoryCell`'s `failClosed` finally-block does not run and the `theory_generation_jobs` row stays `status='running'` forever. The soft deadline gives `failClosed` time to write `status='failed'` with a real `error_message` before AWS terminates. Theory ships this pattern from day 1 even though the exercise side does not yet have it.
3. WHEN `runOneTheoryCell` is invoked THEN the handler SHALL pass `{ db, client, cell, args: { batchSeed: spec.batchSeed, maxCostUsd }, jobId, trigger, signal: controller.signal }` — the `Db` and `Anthropic` clients are cold-start singletons constructed at module load. `runOneTheoryCell` already accepts `signal?: AbortSignal` (Phase 3 contract) and threads it through the generator and validator with `failClosed` finalization on abort.
4. WHEN the soft-deadline fires (signal aborts mid-cell) THEN `runOneTheoryCell` SHALL return `status: 'failed'` with `errorMessage: 'Aborted by user (SIGINT)'` (the Phase 3 abort message — unchanged) and the audit row SHALL carry `status='failed'`, `finished_at=now()`, partial token usage, and the truncated error. The handler SHALL log `warn`-level and silently ack — terminal failure, no redelivery (the next scheduler firing will produce the same `jobId` and the idempotency guard short-circuits it).
5. WHEN `runOneTheoryCell` returns OR throws THEN the handler SHALL `clearTimeout` the soft-deadline timer (regardless of outcome) so the timer cannot leak across invocations in the same Lambda container.
6. WHEN `runOneTheoryCell` throws THEN the handler SHALL log `error`-level, push `messageId` to `batchItemFailures`, and continue.
7. WHEN `runOneTheoryCell` returns `status: 'succeeded'` THEN the handler SHALL log `info`-level with the count projection from `summarizeTheoryResult` and silently ack.
8. WHEN `runOneTheoryCell` returns `status: 'failed'` (whether from soft-deadline abort or any other failure mode) THEN the handler SHALL log `warn`-level and silently ack (terminal failure — the audit row carries the verdict; redelivery would just trip the idempotency guard).

### Requirement 3 — Theory scheduler Lambda (`scheduler.ts`)

**User Story:** As an operator I want a weekly cron to walk the curriculum and enqueue every theory cell that's missing an approved row, so that DE / TR coverage grows without me typing CLI commands on a Monday.

#### Acceptance Criteria

1. WHEN the scheduler Lambda is invoked (EventBridge has no useful event payload) THEN it SHALL enumerate every grammar-point theory cell via `enumerateTheoryCells(ALL_CURRICULA)`. Vocab umbrellas are silently filtered (already implemented in `enumerateTheoryCells`).
2. WHEN building the under-target set THEN the scheduler SHALL run a single SQL aggregate over `theory_topics` filtered to `review_status IN ('auto-approved', 'manual-approved')` (matches the partial unique index's predicate so the scan is index-only) GROUPed by `(language, grammar_point_key)`.
3. WHEN a cell has zero approved rows in the aggregate THEN the scheduler SHALL include it in the enqueue set with a fresh job. WHEN a cell already has one approved row THEN it SHALL be skipped — theory cells are 0-or-1, not 0-or-N (Req 7.2).
4. WHEN `cell.cefrLevel` is `'C1'` or `'C2'` THEN the scheduler SHALL silently skip the cell — round-1 scope is A1–B2 (Req 7.4). Re-uses `THEORY_ROUND_1_CEFR_LEVELS` from `packages/db/src/theory-generation/cells.ts` (which itself aliases `ROUND_1_CEFR_LEVELS` from the exercise side — single source of truth).
5. WHEN `jobId` is computed THEN it SHALL be `deterministicUuid([cellKey, batchSeed].join('|'))` where `batchSeed = "theory-scheduled-${YYYY-MM-DD-UTC}"`. Same-week re-fires from EventBridge therefore produce identical `jobId`s; the consumer Lambda's `checkTheoryAuditRowState` collapses them.
6. WHEN under-target cells exist THEN the scheduler SHALL post `TheoryGenerationJobMessage` records via `SendMessageBatchCommand` in groups of ≤ 10 (SQS hard limit), each with `trigger: 'scheduled'`, `maxCostUsd: SCHEDULER_PER_CELL_COST_CAP_USD` (default `0.25` — half of the exercise scheduler's `0.5`, since theory averages ~$0.07/cell at Sonnet 4.5 list pricing per `docs/theory-generation-plan.md` §5).
7. WHEN no cells are under target THEN the scheduler SHALL log `info`-level `"Pool at target — no jobs enqueued"` and return without opening an SQS connection (no `SQSClient.send` call).
8. WHEN the enumeration query exceeds `SLOW_QUERY_WARNING_MS = 30_000` THEN the scheduler SHALL log a `warn`-level line — telemetry for operator visibility (matches the exercise-side pattern).
9. WHEN each SQS batch is posted THEN the scheduler SHALL log an `info`-level line carrying `{ batchSize, jobIds: [...] }` so an operator scanning CloudWatch Insights can correlate enqueued cells with consumer-Lambda runs.

### Requirement 4 — CLI `--queue` flag

**User Story:** As an operator I want `pnpm generate:theory --lang es --grammar-point es-b1-foo --queue` to dispatch one SQS message to the theory queue instead of running the generator in-process, so that I can test the production code path from my laptop and trigger one-off refills without invoking the scheduler.

#### Acceptance Criteria

1. WHEN `--queue` is passed to the CLI THEN `parseTheoryGenerateArgs` SHALL accept it as a boolean and surface it on `ParsedTheoryArgs.queue`.
2. WHEN `args.queue` is true THEN the CLI SHALL **not** invoke `runOneTheoryCell` in-process; instead it SHALL construct one `TheoryGenerationJobMessage` per resolved cell with `trigger: 'cli'` and post it via `SendMessageBatchCommand` (groups of ≤ 10) to the queue URL from `THEORY_GENERATION_QUEUE_URL`.
3. WHEN `args.queue` is true AND `THEORY_GENERATION_QUEUE_URL` is unset THEN the CLI SHALL print `--queue requires THEORY_GENERATION_QUEUE_URL env var` to stderr and `process.exit(1)`.
4. WHEN `args.queue` is true AND the queue URL contains the substring `prod` (case-insensitive) AND `args.allowProd !== true` THEN the CLI SHALL print `Refusing to post to a production queue without --allow-prod` to stderr and `process.exit(1)` — defense-in-depth substring guard, mirroring `generate-exercises.ts:queueModeGuard`.
5. WHEN `args.queue` is true AND a single `--grammar-point` is provided THEN one message is enqueued. WHEN `--lang es` (no grammar point) is provided THEN one message per cell in the slice is enqueued.
6. WHEN messages are posted THEN the CLI SHALL print a per-batch line: `enqueued <N> jobs (jobIds: <first-3 prefixes>...) to <queue-url-tail>` and exit 0 on success.
7. WHEN `args.queue` is true AND `args.dryRun` is true THEN the CLI SHALL print the would-be messages and the destination URL, then exit 0 without calling SQS. Mirrors the exercise CLI's `--queue --dry-run` combination.

### Requirement 5 — CDK constructs + stack wiring

**User Story:** As an infra owner I want three new CDK constructs (queue, consumer Lambda, scheduler Lambda) plus three lines of stack wiring, so that the theory pipeline ships through the same `cdk deploy` workflow as the exercise pipeline.

#### Acceptance Criteria

1. WHEN `infra/lib/constructs/theory-generation-queue.ts` is added THEN it SHALL define a `TheoryGenerationQueueConstruct` exposing `queue: sqs.Queue`, `deadLetterQueue: sqs.Queue`, and `dlqDepthAlarm: cloudwatch.Alarm`. The queue's `visibilityTimeout` matches the consumer Lambda's `timeout` (default 900 s — AWS hard maximum, same as the exercise queue), `maxReceiveCount = 3`, DLQ retention 14 days, DLQ-depth alarm fires at ≥ 1 message in a 5-minute window (no alarm action — visible in console + Insights).
2. WHEN `infra/lib/constructs/theory-generation-lambda.ts` is added THEN it SHALL define a `TheoryGenerationLambdaConstruct` exposing `handler: lambda.NodejsFunction` and `errorsAlarm: cloudwatch.Alarm`. Reserved concurrency: **2** (intentionally tighter than the exercise Lambda's 3 — theory generation is weekly + bursty, never live-traffic; the rate-limit budget belongs to the live evaluator). Also note: **AWS minimum for `maxConcurrency` on an SQS event-source mapping is 2**, so `reservedConcurrency = 2` is the floor — going below 2 would break the next criterion. SQS event source: `batchSize: 1`, `reportBatchItemFailures: true`, **`maxConcurrency: reservedConcurrency`** — this is the load-bearing fix from PR #76 (2026-05-12). Without this cap, the SQS poller pre-fetches messages beyond the Lambda's reserved-concurrency ceiling, holds them "in-flight" until `visibilityTimeout` expires, re-fetches them, and after `maxReceiveCount` of those visibility-expiry cycles silently DLQs them — **even though the Lambda never ran on them.** The exercise pipeline observed 24/34 phantom-DLQ'd messages on the post-PR #71 redrive before this fix landed. Bundling minifies + aliases to `packages/{ai,db,shared}/src/index.ts`. Secrets: `DATABASE_URL` + `ANTHROPIC_API_KEY` only.
3. WHEN `infra/lib/constructs/theory-scheduler-lambda.ts` is added THEN it SHALL define a `TheorySchedulerLambdaConstruct` exposing `handler: lambda.NodejsFunction` and `rule?: events.Rule`. The Lambda is always created (so dev can invoke it manually); the EventBridge cron rule is gated on `enableScheduledJobs` and defaults to **weekly Monday 04:00 UTC** via `events.Schedule.cron({ minute: '0', hour: '4', weekDay: 'MON' })` — theory cells fill once and stay (Req 7.6); the daily cadence the exercise scheduler uses is unnecessary spend. Secrets: `DATABASE_URL` only (the scheduler does not call Claude).
4. WHEN `infra/lib/stack.ts` is modified THEN it SHALL instantiate the three constructs alongside the existing exercise-side `GenerationQueue` / `GenerationLambdaWrap` / `SchedulerLambdaWrap`, reuse the existing `enableScheduledJobs` flag (Req 7.5 — same flag, both pipelines), and emit a `CfnOutput` named `TheoryGenerationQueueUrl` so an operator can copy the URL into `THEORY_GENERATION_QUEUE_URL` for the CLI's `--queue` mode.
5. WHEN both stacks are deployed THEN they SHALL share the existing AWS Secrets Manager prefix (`language-drill/` for prod, `language-drill-dev/` for dev — already covers `DATABASE_URL` + `ANTHROPIC_API_KEY`); no new secrets are introduced, no policy churn on the existing exercise resources.

### Requirement 6 — Logging helpers + result summarizer

**User Story:** As an operator scanning CloudWatch Insights I want each Lambda log line to carry a stable structured shape, so that I can grep by `jobId`, `level`, `message`, or `language` without parsing free-form text.

#### Acceptance Criteria

1. WHEN `infra/lambda/src/theory-generation/log.ts` is added THEN it SHALL export `errMessage(err: unknown): string` (mirrors the exercise-side helper) and `summarizeTheoryResult(r: TheoryCellResult): { inserted: number; approved: number; flagged: number; rejected: number; durationMs: number }`.
2. WHEN `summarizeTheoryResult` projects a `TheoryCellResult` THEN it SHALL compute `approved = insertedCount === 1 && !flaggedCount`, `flagged = flaggedCount`, `rejected = rejectedCount` — adapted from the exercise summary (which uses `approved = inserted - flagged` because the exercise side mints up to N drafts per cell; theory is 0-or-1).
3. WHEN any Lambda log line is emitted THEN it SHALL go through `console.log(JSON.stringify({ level, message, ...context }))` — no `winston`, no `pino`, no third-party logging dependency.

### Requirement 7 — Reused-as-is invariants

**User Story:** As a maintainer I want explicit acknowledgment of what Phase 4 does NOT change, so that a future PR doesn't accidentally drift Phase 4's theory pipeline from its exercise-side mirror.

#### Acceptance Criteria

1. WHEN the Phase 4 Lambda invokes `runOneTheoryCell` THEN it SHALL pass the same orchestrator the CLI uses (`packages/db/src/theory-generation/run-one-cell.ts`) — no Phase 4-specific orchestrator branch.
2. WHEN theory cells are enumerated for scheduling THEN they SHALL be 0-or-1 (one approved row max per `(language, grammar_point_key)`), enforced by the partial unique index `theory_topics_pool_lookup_idx` shipped in Phase 1. The scheduler decides "enqueue" iff the count is 0.
3. WHEN deterministic `jobId`s are computed THEN both producers (CLI `--queue`, scheduler) SHALL use `deterministicUuid([cellKey, batchSeed].join('|'))` — Phase 3's audit-row idempotency makes a redelivered message a no-op on the `INSERT ... ON CONFLICT DO NOTHING` for `theory_generation_jobs` (and the consumer's `checkTheoryAuditRowState` makes it a no-op even before reaching that INSERT).
4. WHEN the CDK construct shape is mirrored THEN the theory constructs SHALL share file organization with the exercise constructs (`infra/lib/constructs/theory-*.ts`), test layout (`*.test.ts` co-located), and bundling configuration. Phase 4 introduces zero new IaC patterns.
5. WHEN the `enableScheduledJobs` stack flag is consulted THEN both pipelines SHALL respect the same flag — dev = false (no recurring spend), prod = true. No `enableTheoryScheduledJobs` separate flag.
6. WHEN the cron cadence is chosen THEN it SHALL be weekly (Monday 04:00 UTC), explicitly diverging from the exercise pipeline's daily cadence. Reason: theory cells fill once and stay; daily firing produces 6 no-op runs out of 7 (visible in the `"Pool at target"` log line). Weekly is the right cadence for a "did the curriculum gain a new entry?" check.

7. WHEN Phase 4 deliberately does NOT adopt patterns from the exercise pipeline's 2026-05-12 production-incident PRs THEN the following exclusions SHALL be documented as intentional, not oversights:
   - **PR #87 (per-ordinal loss tolerance via `MalformedDraft[]`)** — N/A. `generateTheoryTopic` produces exactly one page per cell; there is no per-ordinal loop, so there is nothing for `try/catch-and-continue` to salvage. Whole-cell pass/fail is the correct and only mode for theory.
   - **PR #90 (`runValidatorPool` bounded-parallel validation, `MAX_VALIDATOR_CONCURRENCY = 5`)** — N/A. Theory has exactly one validator call per cell; the validator parallel-pool exists to fan out the 50-draft per-cell validation phase the exercise generator runs. Theory's `runOneTheoryCell` already runs generator + validator sequentially (Phase 3) and that ordering is correct.
   - **PR #70's `.mapWith` fix on raw SQL aggregates** — applies to the read-side admin tile (Phase 5). Not a Phase 4 concern.
   These exclusions are recorded here so a future PR doesn't try to backport them and waste review cycles.

### Requirement 8 — Pre-push parity + smoke test

**User Story:** As a developer I want Phase 4's additions to satisfy the same pre-push bar the rest of the repo does, so that `pnpm lint && pnpm typecheck && pnpm test` stays green at every commit and a manual smoke test against the dev stack confirms the round-trip works.

#### Acceptance Criteria

1. WHEN `pnpm lint` runs THEN every new file under `infra/lambda/src/theory-generation/` and `infra/lib/constructs/theory-*.ts` SHALL pass with zero ESLint warnings.
2. WHEN `pnpm typecheck` runs THEN every public export from the new modules SHALL be fully typed without `any`.
3. WHEN `pnpm test` runs THEN new Vitest files SHALL accompany every new module: `handler.test.ts`, `scheduler.test.ts`, `job-message.test.ts`, `log.test.ts` (theory-side), `theory-generation-queue.test.ts`, `theory-generation-lambda.test.ts`, `theory-scheduler-lambda.test.ts` (CDK construct tests via `aws-cdk-lib/assertions`).
4. WHEN any test invokes Claude OR SQS THEN it SHALL use a mocked client (the project does not call live Claude or live AWS from tests).
5. WHEN the manual smoke test runs against the dev stack (post-`cdk deploy`) THEN the operator SHALL be able to:
   - Set `THEORY_GENERATION_QUEUE_URL` from the `TheoryGenerationQueueUrl` CfnOutput
   - Run `pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive --queue` and observe one SQS message land
   - Observe the consumer Lambda invoke within ~30 s, log `info`-level success, and the row appear in `theory_topics` on the dev Neon branch
   - Manually invoke the scheduler Lambda from the AWS console and observe the `Pool at target` log line (assuming previous step already filled the only ES B1 cell in scope for the operator's test)

## Non-Functional Requirements

### Performance

- A single SQS-driven `runOneTheoryCell` invocation completes in ~15–25 s (Phase 3 generator ~12 s + validator ~5 s + DB writes ~1 s). The Lambda `timeout: 900` matches the exercise side's hard maximum — bursts of 60+ cells under reserved concurrency = 2 finish within ~15 min.
- The scheduler's single SQL aggregate (`SELECT language, grammar_point_key, COUNT(*) FROM theory_topics WHERE review_status IN (...) GROUP BY ...`) runs in < 100 ms on the dev Neon branch (~60 rows in scope). The 30-second warning threshold is a guard against pathological growth, not a real budget.
- Cold-start cost: the consumer Lambda's cold start is ~1.5 s (matches the exercise Lambda — same bundle shape, same singletons). Acceptable for a batch path; the live evaluator is on a separate Lambda.

### Security

- The new Lambdas inherit the same secret resolution path as the exercise generators: `DATABASE_URL` + `ANTHROPIC_API_KEY` (consumer) and `DATABASE_URL` (scheduler) from AWS Secrets Manager via the `secretsPrefix`. No new secrets, no new IAM surface.
- The IAM policy on the scheduler Lambda adds `sqs:SendMessage` on the new queue ARN — additive, no policy churn for existing resources (the existing scheduler keeps its `sqs:SendMessage` on the `GenerationQueue`).
- The CLI's `--queue` mode includes the same substring-`prod` guard as the exercise CLI to prevent an operator from accidentally posting to the production queue from their laptop.

### Reliability

- SQS at-least-once delivery is the failure model. The consumer Lambda's `checkTheoryAuditRowState` makes a redelivered message a no-op when the prior delivery has already completed; the audit-row INSERT inside `runOneTheoryCell` is gated by primary-key collision so the cell can't be opened twice.
- **Zombie-audit-row prevention (PR #79 fix, theory ships ahead of exercises).** The handler arms a soft-deadline `AbortController` at `context.getRemainingTimeInMillis() - 10_000`. If a cell ever approaches the 900 s Lambda timeout, the signal aborts `runOneTheoryCell` ~10 s before AWS hard-kills the runtime, the existing Phase 3 `failClosed` branch writes `status='failed'` with `errorMessage='Aborted by user (SIGINT)'`, and the audit row is properly closed — no zombie rows requiring operator SQL writes. This is the fix sketch from `.claude/bugs/zombie-running-audit-rows-on-lambda-timeout/report.md`, which the exercise pipeline has documented but not yet shipped; theory takes the opportunity to ship clean.
- **SQS pre-fetch phantom-DLQ prevention (PR #76 fix).** `maxConcurrency: reservedConcurrency` on the SQS event source mapping ensures AWS never fetches more messages than the Lambda can invoke on — no phantom DLQs from visibility-expiry cycling. Production-validated on the exercise side.
- DLQ retention is 14 days (matches the exercise side). A message that survives every redelivery lands there; the CloudWatch alarm makes it visible in the console within ~5 min.
- The Phase 4 deploy is invisible to learners — `getTheoryTopic` still reads only the static TSX registry (Phase 5 is the panel integration). A buggy theory Lambda cannot corrupt the user-visible reading path.

### Usability

- `pnpm generate:theory --queue` is the ergonomic admin-trigger path until Phase 5 ships the admin tile. The operator gets the same `--lang` / `--level` / `--grammar-point` flags they already know.
- CloudWatch Insights queries against the new log group reuse the same structured-JSON pattern as the exercise Lambdas. Operators familiar with `fields @timestamp, jobId, message | filter level = 'warn'` get equivalent queryability on theory runs.
- The scheduler's `Pool at target — no jobs enqueued` line is the explicit "I ran and there was nothing to do" signal — without it, an operator watching CloudWatch wouldn't be able to distinguish "scheduler healthy, pool full" from "scheduler crashed silently."
