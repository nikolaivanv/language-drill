# Requirements Document

## Introduction

This spec implements **Phase 4 — Productionization (Lambda + SQS + EventBridge)** from `docs/exercise-generation-plan.md`. Phases 1–3 shipped a working dev-time generator: a CLI (`pnpm generate:exercises`) that runs locally, calls Claude for generation + validation, deduplicates against the partial UNIQUE index from Phase 3, and writes one `generation_jobs` audit row per cell. Today the only way to refill the pool is for a human to run that CLI from a laptop.

Phase 4 closes four gaps the plan calls out:

1. **Unattended generation on AWS.** A new `GenerationLambda` consumes one `(cell, count, batchSeed)` per SQS message and runs the Phase 3 pipeline end-to-end against the dev/prod Neon branch. No human at a terminal; failures land in a dead-letter queue with the audit row marked `'failed'`.
2. **Scheduled refills.** A daily EventBridge rule fires a `SchedulerLambda` that walks every curriculum cell, finds the ones whose approved count has dropped below a threshold, and posts SQS messages to refill them back to target. The pool replenishes itself in steady state without operator intervention.
3. **Per-environment toggle.** The existing `enableScheduledJobs` flag on `LanguageDrillStackProps` is finally consumed: prod (`true`) creates the EventBridge rule; dev (`false`) ships the Lambda + queue but no rule, so dev can be exercised by ad-hoc CLI/SQS calls without unattended fills.
4. **CLI parity with the queue.** The Phase 2/3 CLI gains a `--queue` flag that posts a `GenerationJobMessage` to SQS instead of running the cell locally — the same operator workflow as today, with the work done by the Lambda. The local-run path stays as the default for dev iteration.

Phase 3's `runOneCell` orchestration (validator → router → dedup retry → audit row) is the heart of the pipeline; Phase 4 extracts it from `packages/db/scripts/generate-exercises.ts` to a shared module under `packages/db/src/generation/` so the CLI and the Lambda call into byte-identical code. No re-implementation, no behavioral drift between the two triggers.

Per resolved decision #6 in the plan, the generation Lambda's reserved concurrency stays capped at **3** to leave headroom for the live evaluator under the org-tier rate limit. The dead-letter queue's retention (14 days) and `maxReceiveCount = 3` mirror the existing `JobsQueue` defaults; the new queue's visibility timeout is **600 s** because cell processing takes minutes (50 drafts × 2 Claude calls × ~3 s = ~5 min in the worst case).

### Files added or modified by this phase

```
infra/lib/constructs/generation-queue.ts                 (new)  — dedicated SQS queue + DLQ for generation
infra/lib/constructs/generation-queue.test.ts            (new)  — CDK construct unit test
infra/lib/constructs/generation-lambda.ts                (new)  — Lambda construct, secrets wiring, IAM
infra/lib/constructs/generation-lambda.test.ts           (new)
infra/lib/constructs/scheduler-lambda.ts                 (new)  — scheduler Lambda + EventBridge rule
infra/lib/constructs/scheduler-lambda.test.ts            (new)
infra/lib/stack.ts                                       (mod)  — wire new constructs, gate scheduler on flag
infra/lambda/src/generation/handler.ts                   (new)  — SQS event source handler for generation
infra/lambda/src/generation/handler.test.ts              (new)
infra/lambda/src/generation/scheduler.ts                 (new)  — EventBridge handler: enumerate cells, post SQS
infra/lambda/src/generation/scheduler.test.ts            (new)
infra/lambda/src/generation/job-message.ts               (new)  — GenerationJobMessage type + parser
infra/lambda/src/generation/job-message.test.ts          (new)
infra/lambda/package.json                                (mod)  — add @aws-sdk/client-sqs dep
infra/test/stack.snapshot.test.ts                        (mod)  — refresh snapshot for new resources
infra/test/stack.dev.test.ts                             (mod)  — assert dev stack omits the EventBridge rule
packages/db/src/generation/run-one-cell.ts               (new)  — extracted from generate-exercises.ts
packages/db/src/generation/run-one-cell.test.ts          (new)
packages/db/src/generation/index.ts                      (new)  — barrel re-export of runOneCell + types
packages/db/src/index.ts                                 (mod)  — re-export the generation barrel
packages/db/scripts/generate-exercises.ts                (mod)  — import shared runOneCell; add --queue flag
packages/db/scripts/generate-exercises-parse-args.ts     (mod)  — accept --queue
packages/db/scripts/generate-exercises-queue.ts          (new)  — SQS-posting helper for --queue
packages/db/scripts/generate-exercises-queue.test.ts     (new)
packages/db/scripts/generate-exercises.test.ts           (mod)  — extend coverage for --queue path
packages/db/package.json                                 (mod)  — add @aws-sdk/client-sqs dep
```

### Out of scope (this phase)

The following are explicitly deferred to later phases of the exercise-generation plan and SHALL NOT be implemented here:

- **Anthropic Messages Batches API integration** — plan §4.2. Phase 4 ships the real-time `client.messages.create` path only. The 50%-discount Batches path requires JSONL formatting, S3 result polling, a separate batch-collector Lambda, and async coordination — a substantial integration that lands as Phase 4b. The cost model in plan §5 is computed against list prices, so the Phase 4 budget already accommodates real-time generation.
- **Web admin HTTP trigger** — Phase 5. The CLI's `--queue` flag is the only operator-facing way to enqueue ad-hoc jobs in this phase. Adding a Clerk-gated `POST /admin/generation/jobs` route waits until the admin dashboard ships.
- **CloudWatch dashboard with cost / latency / approval-rate panels** — Phase 5.3. Phase 4 ships only the operational alarms (DLQ depth > 0; daily failure count) needed to keep the system healthy unattended. Aggregate cost/health visualization is a dashboard concern that pairs with Phase 5's admin surface.
- **Pool-depth API (`GET /admin/pool-status`)** — Phase 5.1. The scheduler reads the same data directly from `exercises` and `generation_jobs`; an HTTP-exposed depth endpoint waits for the dashboard.
- **Skill-aware adaptive target sizes** — Phase 5.2. Phase 4 uses a single `MIN_PER_CELL` constant (refill threshold) and `TARGET_PER_CELL` constant (refill goal) for every cell. The `targetCellSize(cellKey)` function from plan §5.2 is a follow-up.
- **New exercise types** — Phase 6. The Lambda + scheduler operate over the same `cloze | translation | vocab_recall` types the generator and validator already support.
- **L2→EN translation generation** — resolved decision #2. The Lambda inherits the generator's hard-coded `sourceLanguage: 'EN'`, `targetLanguage: spec.language` direction.
- **Domain-aware cell scheduling** — resolved decision #3. The scheduler enumerates `(language, level, type, grammarPoint)` cells; `topicDomain` stays unset.
- **Migration of existing `JobsQueue` consumers** — the Phase 1 `JobsQueue` is currently scaffolded with no consumer. Phase 4 introduces a *separate* `GenerationQueue` and leaves the existing queue untouched for future job types.
- **EN curriculum scheduling** — `packages/db/src/curriculum/en.ts` does not exist (resolved decision #4); the scheduler skips EN as a learning language.
- **Multi-cell-per-message batching** — every SQS message represents exactly one cell. Coalescing multiple cells per message would require the Lambda to coordinate retries across them and is deferred until throughput becomes the bottleneck (it isn't, at the round-1 scale).

## Alignment with Product Vision

The product is positioned (`product.md` §2) as **"what you do between italki sessions"** — a practice app for intermediate learners stuck at the plateau. That positioning depends on a *full* pool: every `(language, level, type, grammar point)` cell the user can request must have enough drafts to support a session that doesn't repeat. Phase 3 made the pool *trustworthy*; Phase 4 is what makes it *self-maintaining*.

This phase delivers on three load-bearing pieces of the product vision and tech strategy:

- **Operator-free pool maintenance** (`docs/exercise-strategy.md` §"Pre-generated pool"). The strategy doc treats the pool as a refillable queue. With Phase 3, refilling required a human to run `pnpm generate:exercises` against every depleted cell. Phase 4's scheduler closes the loop: the pool refills itself daily, and the operator's only role is reviewing flagged drafts via the existing `pnpm review:flagged` CLI.
- **Cost-controlled productionization** (`tech.md` §7, plan §1.5, plan §6 resolved decision #6). Lambda reserved concurrency = 3 keeps the generator from spiking the org-tier rate limit and starving the live evaluator. CloudWatch alarms (DLQ depth, daily failure count) surface anomalies before they become budget incidents. The same `--max-cost-usd` cap from Phase 2 carries into the Lambda via the `GenerationJobMessage`.
- **Dev/prod parity with safe defaults** (`tech.md` §"Environment matrix"). The new constructs deploy to both stacks (`LanguageDrillStack` and `LanguageDrillStack-dev`) so dev exercises the same code paths as prod. Only the EventBridge rule is gated on `enableScheduledJobs` — dev runs the Lambda by manual SQS posts (via the new CLI `--queue` flag), prod runs it on a schedule.

## Requirements

### Requirement 1 — Dedicated `GenerationQueue` SQS resource

**User Story:** As the operator (today's CLI user, tomorrow's scheduler), I want a dedicated SQS queue for generation jobs that doesn't share a visibility timeout with shorter-running future jobs, so that a long generation never gets re-delivered mid-flight and the dead-letter queue isolates only generation failures.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `infra/lib/constructs/generation-queue.ts` SHALL define and export a `GenerationQueueConstruct` that creates exactly two SQS queues — a `GenerationQueue` and a `GenerationDeadLetterQueue` — with the dead-letter queue wired as the source's redrive policy. Both queues SHALL be exposed as `public readonly` fields on the construct (`queue` and `deadLetterQueue`) so the rest of the stack can grant permissions.
2. WHEN the `GenerationQueue` is created THEN it SHALL have `visibilityTimeout = Duration.seconds(600)` and `retentionPeriod` left at the SDK default (4 days) — a job that loiters past 4 days is operationally stale and intentionally lost. The DLQ SHALL have `retentionPeriod = Duration.days(14)` matching the existing `QueueConstruct` defaults.
3. WHEN the redrive policy is configured THEN `maxReceiveCount = 3` SHALL match the existing `QueueConstruct` defaults (`infra/lib/constructs/queue.ts:20`). Three retries match the Phase 3 dedup-retry budget — a transient Anthropic 429 has three chances to clear before the job lands in the DLQ.
4. WHEN the codebase is built THEN the existing `QueueConstruct` (`infra/lib/constructs/queue.ts`) SHALL NOT be modified — Phase 4 introduces a *new* construct and leaves `JobsQueue` scaffolded for unrelated future jobs. The existing `queue.queue.grantSendMessages(lambda.handler)` line in `infra/lib/stack.ts:44` SHALL stay, preserving the API Lambda's existing send permission to the old queue.
5. WHEN the construct is unit-tested via `infra/lib/constructs/generation-queue.test.ts` THEN the test SHALL synthesize a single-construct test stack and assert via the CDK `Template.fromStack` matcher that exactly two `AWS::SQS::Queue` resources exist, the redrive policy is set, and the visibility timeout is 600 s.

### Requirement 2 — `GenerationJobMessage` schema and Lambda event handler

**User Story:** As the Lambda (consumer) and the CLI (producer), I want one typed JSON shape for the SQS message that carries everything needed to run one cell, so that schema drift between producer and consumer is a compile-time error and message validation is a single named function.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `infra/lambda/src/generation/job-message.ts` SHALL export a `GenerationJobMessage` type whose `cefrLevel` field reuses `CurriculumCefrLevel` from `@language-drill/db` (currently `'A1' | 'A2' | 'B1' | 'B2'`) so that any future widening of the curriculum's level set propagates without a Phase 4 schema change. The full shape SHALL be:
   ```ts
   import type { CurriculumCefrLevel } from '@language-drill/db';
   import type { ExerciseType, LearningLanguage } from '@language-drill/shared';

   type GenerationJobMessage = {
     jobId: string;            // UUID, used as both SQS-message id and generation_jobs.id
     trigger: 'cli' | 'scheduled' | 'admin';   // matches generation_jobs.trigger TS-enforced union
     spec: {
       language: LearningLanguage;
       cefrLevel: CurriculumCefrLevel;
       exerciseType: ExerciseType;
       grammarPointKey: string;                 // resolved server-side via curriculum lookup
       topicDomain: string | null;
       count: number;                            // [1, 200], same range as the CLI's --count
       batchSeed: string;
     };
     maxCostUsd: number;                         // cell-level cost cap; Lambda aborts if cumulative cost exceeds this
   };
   ```
   The grammar point is sent by **key** rather than by a full `GrammarPoint` object — the Lambda re-imports the curriculum module and resolves the `key → GrammarPoint` lookup itself, so the SQS message stays small and the curriculum stays the single source of truth for descriptions / examples / commonErrors. The Phase 4 round-1 scope is enforced by the **scheduler** (Req 4.5) via a `ROUND_1_CEFR_LEVELS = ['A1','A2','B1','B2'] as const` constant — the message type itself does not narrow `CurriculumCefrLevel`, so a future Phase 6 message carrying `'C1'` is parseable by an unchanged Lambda.
2. WHEN the codebase is built THEN `job-message.ts` SHALL export `parseGenerationJobMessage(raw: unknown): GenerationJobMessage` — a pure parser that throws an Error naming the offending field on any shape violation (mirror of `parseValidationResult` in `packages/ai/src/validate.ts`). The parser SHALL accept `raw` as a parsed JSON value (not a string), since the SQS event payload arrives pre-parsed in `record.body` after one `JSON.parse`.
3. WHEN the Lambda's SQS event handler `infra/lambda/src/generation/handler.ts` is invoked with one or more SQS records THEN it SHALL process them serially (no `Promise.all`) — the reserved-concurrency = 3 setting (Requirement 3) already provides the parallelism, and serial per-Lambda processing keeps the validator's prompt cache hot within a cell. For each record: parse the body with `parseGenerationJobMessage`, resolve the curriculum entry via `getGrammarPoint(spec.grammarPointKey)`, build a `Cell` matching the CLI's shape, and call the shared `runOneCell` from `@language-drill/db`.
4. WHEN `runOneCell` returns `status: 'succeeded'` for a record THEN that record's `messageId` SHALL NOT appear in the handler reply's `batchItemFailures` array — acknowledgment is implicit by absence (per the AWS [partial-batch-failure](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting) contract). WHEN the Lambda's per-record processing throws **before** `runOneCell` could open or update the audit row (parse failure, curriculum lookup miss, audit-row pre-check, pre-cell DB connection error) THEN the Lambda SHALL append the record's `messageId` to `batchItemFailures` so SQS redelivers — those are the cases the at-least-once redelivery contract is designed to cover. WHEN `runOneCell` returns `status: 'failed'` OR `status: 'skipped-cost-cap'` THEN the audit row already records the terminal outcome (Phase 3 cell-level catch behavior) and the messageId SHALL NOT be appended — Req 2.9's audit-row idempotency check would skip the redelivery anyway, so adding it to `batchItemFailures` would only burn redelivery slots. The next legitimate retry path for a failed cell is the next-day scheduler run (which produces a different `batchSeed` → different `jobId` → no audit-row collision); manual operator retry is via SQL deletion of the audit row + a fresh CLI `--queue` post. This requires `reportBatchItemFailures` in the event source mapping (Requirement 3.4).
5. WHEN the Lambda is invoked with a malformed `record.body` THEN `parseGenerationJobMessage` SHALL throw, the `catch` block SHALL log the malformed payload (truncated to 500 chars to avoid CloudWatch log injection of huge bodies) plus the `messageId`, and the handler SHALL list that `messageId` in `batchItemFailures`. After three malformed deliveries the message lands in the DLQ where it can be inspected without blocking the Lambda from processing valid messages.
6. WHEN the Lambda is invoked AND `process.env['ENV_NAME'] === 'production'` AND a record's `trigger` field is `'cli'` THEN the handler SHALL refuse to process that record, log a warning naming the record's `messageId`, and add it to `batchItemFailures`. The `trigger='cli'` value is reserved for dev / admin local runs; production scheduled refills SHALL use `trigger='scheduled'`. (The CLI's `--queue` flag SHALL refuse to post to the prod queue without an explicit `--allow-prod` (Requirement 6.5), so this is a defense-in-depth backstop.)
7. WHEN the Lambda receives a message whose `spec.cefrLevel` is in `ROUND_1_CEFR_LEVELS` (Req 2.1) but whose `spec.grammarPointKey` is not present in the curriculum module for `spec.language` THEN the handler SHALL throw a clear error naming the offending key BEFORE any DB or Claude call — mirroring the CLI's existing `resolveCells` validation. WHEN `spec.cefrLevel` is outside `ROUND_1_CEFR_LEVELS` THEN the Lambda SHALL log "Skipping out-of-scope CEFR level <level>" and add the messageId to `batchItemFailures` so SQS redelivers; after `maxReceiveCount` redeliveries the message lands in the DLQ where the operator can inspect it.

8. WHEN the Lambda's `runOneCell` invocation returns `status: 'failed'` THEN the audit row in `generation_jobs` SHALL already have been UPDATED to `status='failed'` with `error_message` populated by `runOneCell` itself (Phase 3 cell-level catch behavior). The Lambda SHALL NOT perform any additional audit-row write — `runOneCell` is the sole owner of the `generation_jobs` row's lifecycle. WHEN `runOneCell` THROWS (e.g. on a pre-cell DB connection error) before its own catch could update the audit row THEN the Lambda's `catch` block SHALL log the error with the `jobId` and `messageId` and add the messageId to `batchItemFailures`; the audit row is left as `status='running'` and will be picked up by the next-day scheduler's idempotency check (Req 2.9) or by manual operator intervention.

9. WHEN the Lambda begins processing a record THEN it SHALL first issue `SELECT status FROM generation_jobs WHERE id = ${jobId}` and:
   - if no row exists → proceed normally (this is the first delivery; `runOneCell` will INSERT the audit row).
   - if a row exists with `status IN ('succeeded', 'failed')` → log "Job <jobId> already completed; skipping" and treat as success (no `batchItemFailures` entry, no Claude call). This is the SQS at-least-once-delivery idempotency guard.
   - if a row exists with `status = 'running'` → log "Job <jobId> already running; deferring" and add the messageId to `batchItemFailures` so SQS retries after the visibility timeout (covers the rare case where a sibling Lambda crashed mid-cell and SQS redelivered before the audit row was closed).

### Requirement 3 — `GenerationLambda` CDK construct

**User Story:** As the stack author, I want one CDK construct that wires the Lambda to its event source, secrets, and IAM permissions, so that adding the construct to the stack is one line and the dev/prod difference is just `enableScheduledJobs`.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `infra/lib/constructs/generation-lambda.ts` SHALL define and export a `GenerationLambdaConstruct` class taking these props:
   ```ts
   {
     queue: sqs.IQueue;            // GenerationQueue (Requirement 1)
     secretsPrefix: string;         // matches existing LambdaConstructProps
     reservedConcurrency: number;   // 3 in prod, 3 in dev (configurable to allow lowering during incidents)
     additionalEnv?: Record<string, string>;
   }
   ```
   It SHALL expose `public readonly handler: lambda.NodejsFunction` so other constructs (the scheduler in Requirement 4) can grant permissions.
2. WHEN the construct is constructed THEN the Lambda SHALL be a `NodejsFunction` with `entry = path.join(__dirname, '../../lambda/src/generation/handler.ts')`, `handler = 'handler'`, `runtime = Runtime.NODEJS_20_X`, `timeout = Duration.seconds(600)` (matches the queue's visibility timeout — Requirement 1.2), `memorySize = 1024` (more than the API Lambda's 256 MB; generation buffers a 50-draft batch + per-draft validator response in memory), and `reservedConcurrentExecutions = props.reservedConcurrency`. Bundling SHALL reuse the same monorepo aliases as `LambdaConstruct` (`infra/lib/constructs/lambda.ts:60-75`) so package paths resolve identically.
3. WHEN the construct is constructed THEN the Lambda's environment SHALL include `DATABASE_URL` and `ANTHROPIC_API_KEY` resolved from Secrets Manager via `secretsmanager.Secret.fromSecretNameV2(...)` mirroring `LambdaConstruct`'s pattern (`infra/lib/constructs/lambda.ts:19-48`). It SHALL NOT include the Clerk / Upstash secrets — the generation Lambda has no end-user request path. This is the security minimum-privilege rule from `tech.md`.
4. WHEN the construct is constructed THEN the Lambda SHALL be wired as an SQS event source on `props.queue` via `lambda.addEventSource(new SqsEventSource(props.queue, { batchSize: 1, reportBatchItemFailures: true }))`. Batch size = 1 makes the partial-batch-failure mechanism trivial: every record is its own invocation, and the reserved concurrency = 3 caps cell-level parallelism cleanly.
5. WHEN the construct is unit-tested via `infra/lib/constructs/generation-lambda.test.ts` THEN it SHALL synthesize a one-construct test stack and assert via `Template.fromStack`: exactly one `AWS::Lambda::Function` is created, its timeout is 600, its memory is 1024, its reserved concurrency is 3, and exactly one `AWS::Lambda::EventSourceMapping` is created with `ReportBatchItemFailures: true` and `BatchSize: 1`.
6. WHEN the construct grants IAM permissions THEN it SHALL grant the Lambda only: read on the four secrets it reads (`grantRead` on each), and the SQS event source's auto-attached read on the queue. It SHALL NOT grant SendMessage on any queue (the Lambda is a consumer, not a producer).
7. WHEN the stack is deployed THEN the `GenerationLambda` SHALL be created on **both** environments (`LanguageDrillStack` and `LanguageDrillStack-dev`) — the gating in Requirement 4 applies only to the EventBridge rule. Dev's Lambda is exercised via manual SQS posts (the CLI's `--queue` flag) and the integration test, so the construct must always exist.
8. WHEN the Lambda is bundled THEN the esbuild config SHALL externalize every `@aws-sdk/*` package (the Lambda runtime ships AWS SDK v3 already via `nodejs20.x`). Without this, the bundled Lambda payload doubles in size and cold-start latency (Req NFR Performance) regresses. The externalize list SHALL be passed via `bundling.externalModules` on the `NodejsFunction` props.
9. WHEN both `infra/lambda/package.json` (Lambda runtime) and `packages/db/package.json` (CLI runtime) add `@aws-sdk/client-sqs` THEN they SHALL pin the same major version. The version SHALL be the latest stable on npm at the time of authoring (per CLAUDE.md "Always use the latest stable version of packages"). A test SHALL exist (`infra/lambda/package.json`-side or root-level) that asserts the two pinned majors match — preventing silent drift when one package's deps are bumped without the other.

### Requirement 4 — `SchedulerLambda` + EventBridge rule (gated by `enableScheduledJobs`)

**User Story:** As the prod operator, I want the pool to top itself up daily without me running anything, but in dev I want the Lambda + queue scaffolded without a recurring schedule that would burn budget on a quiet branch.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `infra/lib/constructs/scheduler-lambda.ts` SHALL define and export a `SchedulerLambdaConstruct` class taking these props:
   ```ts
   {
     queue: sqs.IQueue;             // GenerationQueue (the scheduler posts to it)
     secretsPrefix: string;
     enableScheduledJobs: boolean;  // gate for the EventBridge rule
     scheduleExpression?: events.Schedule;  // default: every day at 04:00 UTC
   }
   ```
   The Lambda itself SHALL always be created; the EventBridge rule SHALL be created only when `enableScheduledJobs === true`.
2. WHEN `enableScheduledJobs === true` THEN exactly one `AWS::Events::Rule` SHALL be created targeting the scheduler Lambda with the supplied (or default-computed) `scheduleExpression`. WHEN `enableScheduledJobs === false` THEN no `AWS::Events::Rule` resource SHALL appear in the synthesized template — `infra/test/stack.dev.test.ts` SHALL assert this absence.
3. WHEN the Lambda's handler `infra/lambda/src/generation/scheduler.ts` is invoked THEN it SHALL:
   1. Connect to the database via `createDb(requireEnv('DATABASE_URL'))`.
   2. Enumerate every cell in the curriculum by importing from `@language-drill/db` (`ALL_CURRICULA` × cross-product with each `(cefrLevel, exerciseType)` per the existing `resolveCells` rules — vocab umbrellas only with `vocab_recall`, grammar points with `cloze | translation`). The output is an in-memory `Cell[]` matching the CLI's shape.
   3. Run a single SQL aggregate over `exercises`: `SELECT language, difficulty, type, grammar_point_key, COUNT(*) FROM exercises WHERE review_status IN ('auto-approved', 'manual-approved') GROUP BY language, difficulty, type, grammar_point_key`. The result is materialized into a JS `Map<cellKey, approvedCount>`. The under-target diff is then computed **in memory** by iterating the in-code `Cell[]` and looking up each cellKey in the map (returning 0 for missing entries) — there is no SQL JOIN against the in-code curriculum because the curriculum lives in TypeScript modules, not in a DB table.
   4. For every cell whose approved count is `< MIN_PER_CELL = 25` (constant in `scheduler.ts`), construct a `GenerationJobMessage` with:
      - `jobId = deterministicUuid([cellKey, batchSeed].join('|'))` (reusing `deterministicUuid` from `@language-drill/db`) — this makes two scheduler runs on the same UTC day produce identical `jobId`s, which the Lambda's idempotency guard (Req 2.9) keys off.
      - `trigger = 'scheduled'`.
      - `spec.count = TARGET_PER_CELL - currentCount` (`TARGET_PER_CELL = 50`).
      - `spec.batchSeed = \`scheduled-${YYYY-MM-DD}\`` (UTC).
      - `maxCostUsd = SCHEDULER_PER_CELL_COST_CAP_USD = 0.50` — chosen as ~1.85× the plan §5 per-cell estimate (~$0.27/cell at round-1 list prices), giving headroom for cache-cold cells, retry overhead from Phase 3's dedup loop, and Phase 6 type expansion.
   5. Post each message to `props.queue` via the AWS SDK v3 `@aws-sdk/client-sqs` `SendMessageBatchCommand` (up to 10 messages per batch; SQS's per-batch hard limit). The Lambda SHALL aggregate jobIds and post a structured log line per batch.
4. WHEN the scheduler computes its today's `batchSeed` THEN the date string SHALL be UTC ISO-8601 `YYYY-MM-DD` (no time component) so two scheduler runs on the same UTC day produce identical seeds and hence identical deterministic `generation_jobs.id` values — the audit row's `INSERT … ON CONFLICT DO NOTHING` from Phase 3 then makes a second scheduler invocation (e.g. EventBridge retry) safely idempotent.
5. WHEN the scheduler enumerates cells THEN it SHALL skip cells whose curriculum entry's CEFR level is not in the shared `ROUND_1_CEFR_LEVELS = ['A1','A2','B1','B2'] as const` constant (declared once in `packages/db/src/generation/index.ts` and imported by both the scheduler and Req 2.7's Lambda guard). Phase 4 inherits the round-1 scope from plan §5 (B2 is the upper bound in this phase); C1 / C2 curriculum entries are skipped silently.
6. WHEN the scheduler queries `exercises` for the per-cell approved count THEN the predicate SHALL be `review_status IN ('auto-approved', 'manual-approved')` — exactly the predicate used by the partial index `exercises_pool_lookup_idx` (`packages/db/src/schema/exercises.ts:33-35`), so the query is index-only.
7. WHEN the scheduler Lambda is unit-tested via `scheduler.test.ts` THEN the test SHALL stub the DB query (returning a fixed under-target cell list), stub the SQS client's `send` (capturing batched messages), and assert: every message body parses via `parseGenerationJobMessage`; `trigger === 'scheduled'`; `count = TARGET_PER_CELL - currentCount`; `batchSeed === \`scheduled-${todayUtc}\``; one batch is sent for ≤ 10 messages, multiple batches for > 10.
8. WHEN the scheduler Lambda is constructed in CDK THEN it SHALL be granted `queue.grantSendMessages(handler)` and `secretsmanager.Secret.fromSecretNameV2(...).grantRead(handler)` for `DATABASE_URL` only (it does not call Claude — no `ANTHROPIC_API_KEY` needed).
9. WHEN the scheduler runs against an empty curriculum slice (every cell at or above target) THEN it SHALL log a single line "Pool at target — no jobs enqueued" and exit cleanly without calling SQS.
10. WHEN the scheduler runs and the cell-enumeration query takes longer than 30 seconds THEN the Lambda SHALL log a warning (the timeout is set to 60 seconds — twice the warning threshold). This is a Phase 5 follow-up signal: when scheduling becomes slow, an indexed view becomes worth building.

### Requirement 5 — Cost guardrails and CloudWatch alarms

**User Story:** As the on-call (today: the project owner), I want a small set of CloudWatch alarms that fire when the generation pipeline misbehaves, so that runaway cost or DLQ accumulation surfaces before the next monthly bill.

#### Acceptance Criteria

1. WHEN `runOneCell` is invoked from the Lambda with a `maxCostUsd` value THEN the cell-level cost cap from Phase 2 SHALL apply unchanged: if accumulated `costUsd > maxCostUsd`, the cell aborts with `status: 'failed'` and `errorMessage` naming the cap (Phase 2's existing behavior, no new code).
2. WHEN the stack is deployed THEN exactly one CloudWatch alarm SHALL be created on the `GenerationDeadLetterQueue`'s `ApproximateNumberOfMessagesVisible` metric: threshold `>= 1`, evaluation period `5 minutes`, statistic `Maximum`. Treat-missing-data SHALL be `notBreaching`. The alarm SHALL be defined in `GenerationQueueConstruct` (Requirement 1) so adding the queue automatically adds the alarm.
3. WHEN the stack is deployed THEN exactly one CloudWatch alarm SHALL be created on the `GenerationLambda`'s `Errors` metric: threshold `> 5` over a 1-day evaluation period, statistic `Sum`. This catches systemic Lambda-level failures (e.g. cold-start crashes, IAM regressions) distinct from per-job validator failures.
4. WHEN both alarms are created THEN their alarm actions SHALL be left empty (no SNS topic) — Phase 4 ships the alarms as visible signal in the AWS Console; SNS / PagerDuty wiring is a Phase 5 concern that pairs with the dashboard.
5. WHEN the alarms are unit-tested THEN `infra/test/stack.snapshot.test.ts` SHALL be refreshed to include the two new `AWS::CloudWatch::Alarm` resources, and `infra/lib/constructs/generation-queue.test.ts` SHALL assert the DLQ-depth alarm exists with the correct threshold and metric name.

### Requirement 6 — CLI integration: `--queue` flag

**User Story:** As the operator running ad-hoc fills (today's CLI workflow), I want the existing `pnpm generate:exercises` command to optionally post to SQS instead of running locally, so that I can use the same flags (`--lang`, `--level`, `--type`, `--grammar-point`, `--count`, `--batch-seed`) and let the Lambda do the heavy lifting against the dev/prod Neon branch.

#### Acceptance Criteria

1. WHEN `pnpm generate:exercises --queue …` is invoked THEN the CLI SHALL resolve the cell list as it does today (via `resolveCells` from the curriculum), construct one `GenerationJobMessage` per cell, post them to the `GenerationQueue` via `@aws-sdk/client-sqs`, print a one-line confirmation per cell with the `jobId`, and exit. No DB connection, no Claude call — the local-run code path is skipped entirely when `--queue` is set.
2. WHEN the CLI's `--queue` flag is set THEN the `trigger` field on every produced message SHALL be `'cli'`. The CLI SHALL NOT allow `--trigger admin` or `--trigger scheduled` (those are reserved for the future admin route and the scheduler Lambda).
3. WHEN the CLI's `--queue` flag is set THEN it SHALL read the `GenerationQueue` URL from the env var `GENERATION_QUEUE_URL`. If unset, the CLI SHALL throw an error with a clear message ("Set GENERATION_QUEUE_URL — find it in the CDK stack outputs or `aws sqs get-queue-url --queue-name LanguageDrillStack-dev-GenerationQueue-…`"). The dev queue URL is added to the project's `.env.example` as a comment line.
4. WHEN the CLI's `--queue` flag is set THEN the AWS region SHALL be read from `AWS_REGION` (project convention; already required for `dotenv-cli` workflows). Missing → clear error.
5. WHEN the CLI is invoked with `--queue` and `--allow-prod` is **not** set (the default) THEN it SHALL refuse to post to a queue whose URL does not contain the substring `LanguageDrillStack-dev-`. The dev stack synthesizes resources with names like `LanguageDrillStack-dev-GenerationQueue…` and the prod stack synthesizes `LanguageDrillStack-GenerationQueue…` (no `-dev-` infix), so the predicate "URL contains `-dev-`" reliably distinguishes them. The check SHALL be a literal `String.includes('-dev-')` — defense-in-depth against accidental prod fills. On refusal the CLI SHALL print "Refusing to post to prod queue without --allow-prod" and exit 1.
6. WHEN the CLI is invoked with `--queue` AND the cell list resolves to more than `MAX_CLI_CELLS_PER_INVOCATION = 100` cells THEN the CLI SHALL refuse to post and exit 1 with a clear error message — a single CLI invocation that posts > 100 cells is almost certainly a mistake (the scheduler is the right tool for the language-wide fill case). The constant is named to disambiguate it from `SendMessageBatch`'s 10-message hard limit (Req 4.3.5).
7. WHEN the CLI is invoked with `--queue --dry-run` THEN it SHALL print every `GenerationJobMessage` it *would* post, including the resolved `jobId` and `batchSeed`, but SHALL NOT call SQS. (Phase 2's `--dry-run` already prints the cell list; Phase 4 widens it to also include the message bodies.)
8. WHEN `pnpm generate:exercises` is invoked **without** `--queue` THEN the local-run behavior SHALL be byte-identical to Phase 3 — same prompts, same writes, same audit-row contents. The shared `runOneCell` extraction (Requirement 8) is a refactor; it must not change observable behavior on the local-run path.

### Requirement 7 — `runOneCell` extraction to a shared module

**User Story:** As the Lambda author, I want the Phase 3 `runOneCell` (with validator, router, dedup retry, audit row) to be importable as a published API from `@language-drill/db`, so that the Lambda's handler is a thin shell over the same orchestration the CLI runs and there is one source of truth for the pipeline's behavior.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/db/src/generation/run-one-cell.ts` SHALL exist and SHALL contain the `runOneCell` function (and its inner helpers: `validateAndInsertWithRetry`, `runRetryGeneration`, the `failClosed` helper, the `DraftOutcome` and `CellResult` types) — moved verbatim from `packages/db/scripts/generate-exercises.ts`. No behavioral change.
2. WHEN the codebase is built THEN `packages/db/src/generation/index.ts` SHALL re-export `runOneCell`, `CellResult`, and any types the CLI / Lambda needs (`Cell` from the CLI's `resolve-cells` continues to live in `packages/db/scripts/` because it depends on parser shapes; the shared module exports only the orchestration core).
3. WHEN the codebase is built THEN `packages/db/src/index.ts` SHALL re-export the contents of the new `generation/index.ts` so consumers import via `import { runOneCell } from '@language-drill/db'`.
4. WHEN `packages/db/scripts/generate-exercises.ts` is updated THEN it SHALL replace its in-file `runOneCell` definition with `import { runOneCell } from '../src/generation';` (or via the package barrel if cleaner). Every other line in the script — argument parsing, summary printing, SIGINT handling, exit code logic — SHALL stay unchanged.
5. WHEN the existing Phase 3 tests run (`pnpm test --filter @language-drill/db`) THEN they SHALL still pass without modification — the test file imports are agnostic to whether `runOneCell` lives in `scripts/` or `src/generation/`.
6. WHEN the codebase is built THEN `packages/ai` SHALL NOT gain any new imports — `runOneCell` lives in `packages/db` because it imports the schema and the Drizzle client. The package boundary from Phase 2/3 (`packages/db/scripts/` → `packages/ai`) widens to (`packages/db/src/generation/` → `packages/ai`); `packages/ai` continues to not import from `packages/db`.
7. WHEN `runOneCell` is moved THEN the `aborted` SIGINT flag (currently a module-level `let aborted = false` in `generate-exercises.ts:94`) SHALL stay in the **CLI script**, not move into the shared module. The shared `runOneCell` SHALL accept an optional `signal?: AbortSignal` parameter that the CLI wires from its SIGINT handler and the Lambda wires from a heartbeat (or leaves undefined, since the Lambda's failure mode is a hard timeout, not a graceful abort). This decouples the orchestration from the CLI's process model.

### Requirement 8 — Tests

**User Story:** As the next person picking this up, I want every new behavior covered by a unit test next to the module and the cross-stack flows covered by snapshot + dev-stack tests, so that future changes can be made with confidence.

#### Acceptance Criteria

1. WHEN the test suite is run THEN `infra/lib/constructs/generation-queue.test.ts` SHALL exist and SHALL cover: two queues created, redrive policy with `maxReceiveCount=3`, visibility timeout 600 s, DLQ retention 14 days, the DLQ-depth alarm exists with threshold 1.
2. WHEN the test suite is run THEN `infra/lib/constructs/generation-lambda.test.ts` SHALL exist and SHALL cover: one `AWS::Lambda::Function` with timeout 600, memory 1024, reserved concurrency 3, runtime nodejs20.x; one `AWS::Lambda::EventSourceMapping` with `ReportBatchItemFailures: true` and `BatchSize: 1`; environment variables include `DATABASE_URL` and `ANTHROPIC_API_KEY` (asserted by checking the property exists on the synthesized resource); secrets are read from the construct's `secretsPrefix`-based names.
3. WHEN the test suite is run THEN `infra/lib/constructs/scheduler-lambda.test.ts` SHALL exist and SHALL cover: when `enableScheduledJobs=true`, exactly one `AWS::Events::Rule` exists targeting the scheduler Lambda; when `enableScheduledJobs=false`, no `AWS::Events::Rule` exists.
4. WHEN the test suite is run THEN `infra/lambda/src/generation/job-message.test.ts` SHALL exist and SHALL cover: every required field validated (string/number/union); out-of-range `count` rejected; unknown `trigger` value rejected; the `cefrLevel` union enforced.
5. WHEN the test suite is run THEN `infra/lambda/src/generation/handler.test.ts` SHALL exist and SHALL cover: a single SQS record with a valid body invokes `runOneCell` once; a malformed body adds the messageId to `batchItemFailures`; a `runOneCell` throw adds the messageId to `batchItemFailures`; a `runOneCell` `status: 'failed'` return adds the messageId to `batchItemFailures` (the audit row was already written by `runOneCell`); the handler processes records serially when given a batch (asserted via mock-call ordering, even though `BatchSize=1` means batches of 1 in production). The test SHALL stub `runOneCell` via `vi.mock` to avoid the DB and Claude.
6. WHEN the test suite is run THEN `infra/lambda/src/generation/scheduler.test.ts` SHALL exist and SHALL cover: a fixture DB result with two under-target cells produces two `GenerationJobMessage`s with `trigger='scheduled'` and `count = TARGET_PER_CELL - currentCount`; an empty fixture produces zero messages and exits cleanly; > 10 under-target cells produce multiple `SendMessageBatch` calls of at most 10 each. The test SHALL stub the SQS client and the DB query.
7. WHEN the test suite is run THEN `packages/db/scripts/generate-exercises-queue.test.ts` SHALL exist and SHALL cover: the CLI's `--queue` mode produces one message per resolved cell; `--queue --dry-run` does not call SQS; the prod-queue guard refuses without `--allow-prod`; a missing `GENERATION_QUEUE_URL` throws a clear error; a cell count > 100 refuses to post.
8. WHEN the test suite is run THEN `packages/db/src/generation/run-one-cell.test.ts` SHALL exist and SHALL cover the same Phase 3 integration scenarios that previously lived in `generate-exercises.test.ts` (mixed-outcome batch, dedup-retry happy path, dedup-given-up path, validator-failure path) — moved here so the orchestration is tested independently of the CLI script. The tests SHALL be `describe.skipIf(!process.env.TEST_DATABASE_URL)` (Phase 3 convention).
9. WHEN the test suite is run THEN `infra/test/stack.snapshot.test.ts` SHALL be refreshed to include the new `GenerationQueue`, `GenerationDeadLetterQueue`, `GenerationLambda`, `GenerationLambdaEventSourceMapping`, `SchedulerLambda` (always), `SchedulerEventBridgeRule` (prod only), and the two CloudWatch alarms.
10. WHEN the test suite is run THEN `infra/test/stack.dev.test.ts` SHALL be extended with one new assertion: the dev stack's synthesized template SHALL contain zero `AWS::Events::Rule` resources whose targets reference the scheduler Lambda. (The existing test currently asserts other dev-vs-prod differences; this is one more.)
11. WHEN the test suite is run THEN every test file SHALL pass via `pnpm test` (root). Pre-push (`pnpm lint && pnpm typecheck && pnpm test` from the repo root) SHALL exit zero.
12. WHEN the manual smoke is run THEN it SHALL: deploy the dev stack via `cdk deploy LanguageDrillStack-dev`, capture the `GenerationQueue` URL, run `pnpm generate:exercises --queue --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 3 --batch-seed phase-4-smoke`, observe the Lambda's CloudWatch logs for the cell processing, and confirm 2–3 rows land in `exercises` matching the deterministic `(jobId, ordinal)` ids. The smoke is documented in the design phase; the requirement is that one such smoke exists and passes before merge.

### Requirement 9 — Operational guards and forward compatibility

**User Story:** As the future Phase 4b (Batches API), Phase 5 (admin dashboard), and Phase 6 (new exercise types), I want Phase 4 to leave the message schema, package boundaries, and CDK construct surface in shape that I can extend without rewriting, so that follow-up phases are deployment exercises, not refactors.

#### Acceptance Criteria

1. WHEN Phase 4 ships THEN no public API surface from `@language-drill/shared` SHALL change. Phase 4 introduces no new content shapes; it only orchestrates the existing ones.
2. WHEN Phase 4 ships THEN `@language-drill/db`'s public barrel SHALL gain only additive exports — `runOneCell`, `CellResult`, and supporting types from `src/generation/`. Existing exports (Phase 1–3) SHALL be byte-identical.
3. WHEN Phase 4 ships THEN the dependency graph SHALL still have the same single cross-package edge (`packages/db` → `packages/ai`) plus the new edge (`infra/lambda` → `@language-drill/db` and `→ @language-drill/ai`). `infra/lambda` already depends on both via the API Lambda; Phase 4 does not introduce new package edges.
4. WHEN Phase 4 ships THEN the `generation_jobs` schema SHALL NOT change. The `trigger` column already accepts `'cli' | 'scheduled' | 'admin'`; the Lambda just starts populating it with `'scheduled'` for the scheduler path and `'cli'` for the CLI's `--queue` path. (The `'admin'` value is reserved for Phase 5's HTTP route.)
5. WHEN the `GenerationJobMessage` type is bumped in a future PR (e.g. to add a `priority` field for Phase 4b's Batches integration) THEN the bump SHALL preserve every field this phase defines so old in-flight messages from a still-running Lambda continue to parse. New fields SHALL be optional or have a default; existing fields SHALL NOT be renamed or have their union widened to incompatible values.
6. WHEN Phase 4 deploys THEN the existing `JobsQueue` SHALL remain in the synthesized template — Phase 4 introduces a *new* construct and leaves the legacy queue untouched. Removing the legacy queue is not in scope.
7. WHEN Phase 4 ships THEN both stacks (`LanguageDrillStack` and `LanguageDrillStack-dev`) SHALL synth and deploy without manual intervention. The CI pipeline already runs `cdk synth` against both per `tech.md` §"Environment matrix"; Phase 4 SHALL not break that.
8. WHEN a future Phase 4b adds the Batches API path THEN it SHALL slot in at the `runOneCell` level (a new `runOneCellBatched` sibling) or at the message level (a new `trigger='batch-collected'` value) — Phase 4's `runOneCell` extraction is shaped to admit either approach without refactoring the SQS / Lambda / scheduler glue.
9. WHEN the CDK deploys Phase 4 THEN the new IAM permissions (`secretsmanager:GetSecretValue` on the new SecretId references, `sqs:ReceiveMessage` / `sqs:DeleteMessage` / `sqs:GetQueueAttributes` on `GenerationQueue` for the Lambda execution role, `sqs:SendMessage` on `GenerationQueue` for the scheduler Lambda's role, `lambda:InvokeFunction` on the scheduler Lambda for the EventBridge rule) SHALL be deployable by the existing CI IAM user without policy changes. The CI IAM user already grants the same permission shapes for the API Lambda's queue + secrets access; Phase 4 reuses those broad `secretsmanager:GetSecretValue` / `sqs:*` action patterns under different resource ARNs. If a deployment fails with `User: arn:aws:iam::…:user/<ci-user> is not authorized to perform: <action>`, the requirement is unmet and the spec is paused for IAM-policy review.

## Non-Functional Requirements

### Performance

- **Cold-start budget.** The generation Lambda SHALL cold-start in under 5 seconds at 1024 MB (esbuild-bundled, monorepo aliases inlined). Cold start is amortized over a 5-minute cell processing window so even worst-case cold-starts add <2% to wall time.
- **Per-cell wall time.** With prompt caching active, a 50-draft cell SHALL complete in ~3 minutes at the median: one batched `generateBatch` call returning all 50 drafts (~30 s, dominated by the bulk-tool-use response), plus 50 sequential validator calls × ~3 s each (~150 s, mostly cache-hit on the system block) ≈ 180 s. Phase 3's dedup-retry loop adds <6% in the worst case (Phase 3 NFR). The 600 s visibility timeout gives ~3× headroom.
- **Reserved concurrency.** Capped at 3 — three cells in flight at once. The scheduler enqueues at most 50 cells per day at round-1 scale (plan §5: 720 cells × 0.07 daily depletion ≈ 50), so the queue drains in ≤ 100 minutes even with no parallelism beyond 3.
- **Scheduler runtime.** The scheduler's cell-enumeration query SHALL complete in <30 s against the round-1 row volume (36k exercises). The 60 s Lambda timeout gives 2× headroom; Requirement 4.10 logs a warning at the 30 s mark.

### Security

- **Secrets minimum-privilege.** The generation Lambda has read access to `DATABASE_URL` and `ANTHROPIC_API_KEY` only. The scheduler Lambda has read access to `DATABASE_URL` only. Neither Lambda touches Clerk or Upstash secrets.
- **No public ingress to the queue.** The `GenerationQueue` SHALL have no SNS, no CloudWatch Events, and no public Lambda URL beyond the scheduler's `grantSendMessages` and the API Lambda's existing legacy grant on `JobsQueue` (which is unrelated). External callers cannot post to the queue.
- **CLI prod-queue guard.** The CLI's `--queue` flag refuses to post to the prod queue without `--allow-prod` (Requirement 6.5). This is a defense-in-depth backstop on top of the Lambda's `trigger='cli'`-rejection in production (Requirement 2.6).
- **Credential handling.** Secrets are inlined into Lambda env vars via `secretValue.unsafeUnwrap()` — same pattern as the API Lambda. Per `tech.md`, this is an acceptable trade-off for cold-start performance vs. SDK-fetch-on-invoke; the secrets are encrypted at rest and only decryptable by the Lambda's execution role.

### Reliability

- **Idempotent reprocessing.** SQS at-least-once delivery means the Lambda may receive the same message twice. The Lambda's audit-row idempotency guard (Req 2.9) is the sole mechanism: a second delivery observes the existing `generation_jobs` row and either skips (`succeeded`/`failed`) or defers (`running`). Standard SQS queues do **not** provide content-based deduplication; that's a FIFO-queue feature and Phase 4 explicitly uses standard queues for the throughput characteristics. Phase 3's `INSERT … ON CONFLICT DO NOTHING` for `exercises` rows is the second-line defense — even if Req 2.9's guard is bypassed by some future code path, the deterministic per-ordinal `exerciseDraftId` keeps duplicate rows out of the `exercises` table.
- **DLQ as the failure backstop.** A message that fails 3 receives lands in the `GenerationDeadLetterQueue` with full context (the original `GenerationJobMessage` body). The DLQ-depth alarm fires within 5 minutes, surfacing the failure to the operator. Manual replay is via `aws sqs send-message` from the DLQ to the main queue after the underlying issue (e.g. an Anthropic outage) is resolved.
- **Scheduler idempotency.** Two scheduler runs on the same UTC day produce identical `batchSeed` values (Requirement 4.3.4) and hence identical deterministic `jobId`s (also Req 4.3.4). The second run's SQS posts ARE redelivered to the Lambda — standard SQS does not deduplicate by content — but the Lambda's audit-row guard (Req 2.9) observes the prior `succeeded`/`failed` row and skips the work. This is what makes the EventBridge rule safe to re-fire on retry without producing double-cost cells.
- **Partial-batch reporting.** The `reportBatchItemFailures` mechanism (Requirement 2.4) ensures a successfully-processed record is never redelivered just because a sibling record in the same batch failed. With `BatchSize=1` this is a paranoid guard, but it costs nothing and protects against future batch-size tuning.

### Usability

- **Stack outputs document the queue URL.** The stack SHALL `CfnOutput` the `GenerationQueue.queueUrl` so operators can find it without navigating the SQS console. The dev queue URL is the value to set in `GENERATION_QUEUE_URL` for the CLI's `--queue` flag.
- **CLI --queue confirmation is precise.** Each posted message produces one stdout line: `Posted job <jobId> for <cellKey> (count=N, trigger=cli)` — the same level of detail the local-run path emits per cell, so operators who switch between modes don't lose visibility.
- **Scheduler logs are structured.** Each scheduler run logs one start line, one per-cell decision line (`enqueued` / `at-target`), one per-batch summary line (`SendMessageBatch sent N messages`), and one end line. Structured JSON via `console.log({...})` so CloudWatch Insights queries against the field names work out of the box.
- **Failure messages name the offending field.** Lambda parse errors and scheduler enumeration errors SHALL identify the offending `messageId`, `cellKey`, or `grammarPointKey` in the log message, so an operator inspecting CloudWatch can find the offending row immediately. Mirrors Phase 2/3's "name the field" convention.
