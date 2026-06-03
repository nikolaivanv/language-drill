# Design Document

## Overview

This design implements **Phase 4 — Productionization (Lambda + SQS + EventBridge)** from `docs/exercise-generation-plan.md` against the requirements in `requirements.md`. Phase 4 closes the unattended-operation gap left open by Phase 3: the same generator → validator → router → dedup-retry pipeline that today runs from a developer's laptop now runs on AWS, triggered by an EventBridge daily rule that walks the curriculum and posts SQS messages for any cell whose approved-exercise count has fallen below the per-cell threshold.

Phase 4 produces five sets of artifacts:

1. A **`runOneCell` extraction** from `packages/db/scripts/generate-exercises.ts` to a published package surface at `packages/db/src/generation/`. Phase 3's orchestration becomes the byte-identical core that both the CLI script and the new Lambda handler import. The CLI's wrapper (argument parsing, summary printing, SIGINT handling, exit-code logic) stays in `scripts/`; only the per-cell pipeline moves.
2. A **dedicated SQS infrastructure** (`infra/lib/constructs/generation-queue.ts`): a new `GenerationQueue` with 600 s visibility, paired with a `GenerationDeadLetterQueue` (14 d retention, `maxReceiveCount = 3`), and a CloudWatch alarm on the DLQ depth. Separate from the existing `QueueConstruct` (the legacy `JobsQueue`) which stays scaffolded but unconsumed.
3. **Two Lambda functions** wired in two CDK constructs:
   - `GenerationLambda` (`infra/lib/constructs/generation-lambda.ts` + `infra/lambda/src/generation/handler.ts`) — SQS consumer, reserved concurrency 3, 1024 MB / 600 s. Reads `DATABASE_URL` + `ANTHROPIC_API_KEY` from Secrets Manager (existing pattern), parses each `GenerationJobMessage`, dispatches to the extracted `runOneCell`, reports partial-batch failures via `reportBatchItemFailures`.
   - `SchedulerLambda` (`infra/lib/constructs/scheduler-lambda.ts` + `infra/lambda/src/generation/scheduler.ts`) — invoked by an EventBridge daily rule (gated by `enableScheduledJobs`), enumerates every curriculum cell, runs one SQL aggregate to count approved exercises per cell, computes the under-target diff in memory, posts SQS messages in batches of ≤ 10. Reads only `DATABASE_URL`; never calls Claude.
4. A **CLI `--queue` flag** in `pnpm generate:exercises` that posts `GenerationJobMessage`s to SQS instead of running cells locally. Operator workflow stays identical (`--lang/--level/--type/--grammar-point/--count`), with the work moved to the Lambda. Local-run path is the default; `--queue` is opt-in.
5. **Test coverage**: per-construct CDK unit tests (`Template.fromStack` matchers), per-handler unit tests (mocked `runOneCell`, mocked SQS client), unit tests for `parseGenerationJobMessage` and the scheduler's diff logic, an integration test under `MOCK_CLAUDE=1` for the extracted `runOneCell`, snapshot refresh, and a dev-stack assertion that no EventBridge rule appears when `enableScheduledJobs=false`.

What this phase deliberately does **not** ship: the Anthropic Messages Batches API path (Phase 4b), the Clerk-gated admin HTTP route to enqueue jobs (Phase 5), the cost / approval-rate / pool-coverage CloudWatch dashboard (Phase 5.3), the pool-status API endpoint (Phase 5.1), skill-aware adaptive target sizes (Phase 5.2), and any work on new exercise types (Phase 6). These slot in cleanly against Phase 4's seams: the message schema is forward-extensible, the `runOneCell` extraction is the natural place for Batches sibling functions, and the queue/Lambda surface is the natural attach point for an admin route.

## Steering Document Alignment

### Technical Standards (`CLAUDE.md` — no formal `tech.md` is checked in)

- **AWS CDK + Lambda + Hono pattern**, per the Tech Stack table in `CLAUDE.md`. Phase 4's two Lambdas are `NodejsFunction` instances bundled by esbuild with monorepo aliases — the same shape `LambdaConstruct` (`infra/lib/constructs/lambda.ts:52-88`) already uses for the API Lambda. Differences from the API Lambda are in `runtime` envelope (memory + timeout + reserved concurrency), not in the bundling or secrets-loading mechanics.
- **Secrets via AWS Secrets Manager**, per `CLAUDE.md` §"Required secrets". Phase 4's Lambdas read `language-drill/DATABASE_URL` and `language-drill/ANTHROPIC_API_KEY` (prod) / `language-drill-dev/...` (dev) — exactly the secrets the API Lambda already reads. The scheduler Lambda reads only `DATABASE_URL` (it never calls Claude). No new secrets.
- **Drizzle + Neon serverless + `INSERT … ON CONFLICT DO NOTHING`**. The extracted `runOneCell` keeps Phase 3's idempotency guarantees byte-identical: deterministic per-ordinal `exerciseDraftId`, conflict-on-dedup-index detected via missing `RETURNING { id }`, audit-row UPDATE at end of cell. No new SQL patterns.
- **Forward-only migrations** (`tech.md` notes elsewhere; CLAUDE.md `## CI/CD`). Phase 4 ships **zero** migrations. The schema is unchanged. `generation_jobs.trigger` already accepts `'cli' | 'scheduled' | 'admin'` (Phase 1's column) — Phase 4 just starts populating it with `'scheduled'`.
- **Per-package `pnpm test` + root pre-push gate**, per `CLAUDE.md` §"Pre-Push Checks". Every new construct, handler, and helper ships with a co-located test file. The pre-push suite (`pnpm lint && pnpm typecheck && pnpm test`) runs unchanged.
- **Environment matrix** (`CLAUDE.md` §"Environment matrix"). Phase 4's resources deploy to both `LanguageDrillStack` (prod) and `LanguageDrillStack-dev` (dev), differentiated only by:
  - `enableScheduledJobs` — prod creates the EventBridge rule; dev does not.
  - The four secret references — prod reads `language-drill/*`, dev reads `language-drill-dev/*`.
  - The queue/Lambda/alarm logical IDs carry the `LanguageDrillStack-dev-` prefix on dev (CDK default behavior).

### Project Structure conventions (verified against the worktree)

- **Tests next to the module.** CDK construct tests live next to the construct (`infra/lib/constructs/generation-queue.test.ts` next to `generation-queue.ts`). Lambda handler tests live next to the handler (`infra/lambda/src/generation/handler.test.ts`). The `runOneCell` integration tests follow it from `packages/db/scripts/` to its new home in `packages/db/src/generation/`.
- **CDK constructs split into single-purpose files.** `infra/lib/constructs/` already has `lambda.ts`, `api-gateway.ts`, `storage.ts`, `queue.ts`. Phase 4 adds three siblings: `generation-queue.ts`, `generation-lambda.ts`, `scheduler-lambda.ts`. No mega-construct that combines them.
- **Lambda code organized by feature, not by AWS service.** The existing API Lambda has `infra/lambda/src/{routes,middleware,lib}/`. Phase 4 adds a sibling `infra/lambda/src/generation/{handler,scheduler,job-message}.ts`, parallel to `routes/` — the SQS handler and EventBridge handler are entry points, like routes are entry points for the API Lambda.
- **Shared package surface for the orchestration core.** `runOneCell` moves to `packages/db/src/generation/` (a published surface), not to `packages/db/scripts/lib/` (a script-internal helper). This is the same boundary Phase 3 used for `packages/db/scripts/generate-exercises-validate.ts` (script-side) vs `packages/ai/src/validate.ts` (package surface): operational policy stays in scripts, orchestration core moves to the package.

## Code Reuse Analysis

### Existing components to leverage

- **`packages/db/scripts/generate-exercises.ts` `runOneCell` + `validateAndInsertWithRetry` + `runRetryGeneration` + `failClosed`** (Phase 3, lines 156-344). The entire per-cell orchestration moves verbatim to `packages/db/src/generation/run-one-cell.ts`. No behavioral change. The CLI script imports it back via `import { runOneCell } from '../src/generation';`.
- **`packages/db/scripts/generate-exercises.ts` `aborted` flag** (lines 78-94). Phase 4 *does not* move this to the shared module — it stays in the CLI script, gated behind a SIGINT handler installed in `main`. The shared `runOneCell` instead takes an optional `signal?: AbortSignal` parameter that the CLI's main bridges from its `aborted` flag and the Lambda leaves undefined (Lambda failure mode is hard timeout, not graceful abort). Decouples orchestration from the CLI's process model — Requirement 7.7.
- **`packages/db/scripts/generate-exercises.ts` `CellResult` type** (lines 100-123). Stays unchanged. Re-exported through the new `packages/db/src/generation/index.ts` barrel so the Lambda's handler reads `result.status` to decide the partial-batch-failure response.
- **`infra/lib/constructs/lambda.ts` `LambdaConstruct`** (lines 13-97). The secrets-wiring pattern (`secretsmanager.Secret.fromSecretNameV2(...)` + `.secretValue.unsafeUnwrap()` into env vars + `.grantRead(handler)`) is reused in `GenerationLambdaConstruct` and `SchedulerLambdaConstruct`. The bundling block — esbuild monorepo aliases for `@language-drill/{shared,db,ai}` — is identical. The only differences: Phase 4 reads fewer secrets (no Clerk/Upstash for generation; only `DATABASE_URL` for the scheduler) and uses different `runtime` settings.
- **`infra/lib/constructs/queue.ts` `QueueConstruct`** (lines 5-24). The DLQ pattern (separate `Queue` resource with `retentionPeriod = Duration.days(14)` + main queue's redrive policy with `maxReceiveCount = 3`) is reused in `GenerationQueueConstruct`. The only difference is `visibilityTimeout`: 600 s for the new queue vs 90 s for the legacy `JobsQueue`. The legacy construct is **not modified**.
- **`infra/lambda/src/index.ts` Hono handler shape** (lines 1-61). `Phase 4` does *not* reuse Hono — the new handlers are SQS event-source handlers and EventBridge cron handlers, not HTTP. But the file-organization conventions (`handler.ts` exporting a named `handler`, dependencies imported at the top) match.
- **`infra/test/stack.snapshot.test.ts`** (lines 1-73). Phase 4 refreshes the snapshot to include the new resources. The `scrubAssetHashes` helper handles both new Lambdas' bundled-asset hashes the same way it handles the existing API Lambda's.
- **`infra/test/stack.dev.test.ts`** (lines 1-116). The "no EventBridge rules in dev" assertion at line 109 currently passes because *no* stack has rules; Phase 4 turns it into a real test. The corresponding line 113 ("prod stack currently has zero EventBridge rules (Phase 1 will add them)") is replaced with a positive assertion that prod has exactly 1 rule.
- **`packages/db/src/curriculum/index.ts` `ALL_CURRICULA` + `getGrammarPoint`**. The scheduler imports them to enumerate cells; the Lambda imports `getGrammarPoint` to resolve the message's `grammarPointKey` into the full `GrammarPoint` shape needed by `runOneCell`.
- **`packages/db/src/lib/cell-key.ts` `assertValidCellKey` + cellKey format**. The scheduler computes `cellKey = '<lang>:<level>:<type>:<grammar_point_key>'.toLowerCase()` and uses it as both the in-memory map key and the deterministic-UUID seed input.
- **`packages/db/src/lib/deterministic-uuid.ts` `deterministicUuid`**. The scheduler uses it to derive `jobId = deterministicUuid([cellKey, batchSeed].join('|'))` so two scheduler runs on the same UTC day produce identical jobIds — the precondition for the Lambda's audit-row idempotency guard (Req 2.9).
- **`packages/db/scripts/generate-exercises-resolve-cells.ts` `resolveCells`**. The CLI's `--queue` mode reuses it unchanged: same cell-list resolution as the local-run mode, then each cell is mapped to a `GenerationJobMessage` instead of a local invocation.
- **`packages/db/scripts/parse-args-common.ts`** (Phase 3). The `collectRawFlags` + `requireString` + `BOOLEAN_FLAGS` helpers extend by one entry: `--queue` is a boolean flag (added to `BOOLEAN_FLAGS`).
- **`packages/db/scripts/env-helpers.ts` `requireEnv`** (Phase 3). The CLI's `--queue` mode uses it for `requireEnv('GENERATION_QUEUE_URL')` and `requireEnv('AWS_REGION')`.
- **`@language-drill/ai` package** — unchanged. Phase 4 does not import any new symbols from `packages/ai`; the Lambda transitively depends on it through `runOneCell`'s imports.

### Integration points

- **`generation_jobs` table**: Phase 4 starts populating `trigger` with `'scheduled'` (from the scheduler Lambda) and `'cli'` (from the CLI's `--queue` flag). The `'admin'` value is reserved for Phase 5's HTTP route. No schema change.
- **`exercises` table**: Phase 4 writes through the existing `runOneCell` insert path, so columns / indexes / dedup behavior are byte-identical to Phase 3. The Lambda is just a different process invoking the same writer.
- **`exercise_tags` table**: same insert path as Phase 3 — `runOneCell` writes one tag row per inserted exercise.
- **Application read paths** (`infra/lambda/src/lib/exercise-filters.ts:21` `APPROVED_STATUSES`): unchanged. The user-facing routes never see flagged or rejected drafts; the Lambda just adds rows to the same table the API Lambda reads from.
- **`@language-drill/db` package barrel** (`packages/db/src/index.ts`): gains a single new line `export * from './generation';` plus the new `generation/index.ts` re-exports `runOneCell`, `CellResult`, `DraftOutcome`, and `ROUND_1_CEFR_LEVELS`.
- **`@language-drill/shared`**: unchanged. No new types.
- **CDK outputs**: the prod and dev stacks each gain one new `CfnOutput` for `GenerationQueueUrl` so the operator can read the URL from `aws cloudformation describe-stacks` without navigating the SQS console.

### Why the orchestration core lives in `packages/db/src/generation/`, not `infra/lambda/src/lib/`

Three competing places: stay in `packages/db/scripts/` (script-internal), move to `packages/db/src/generation/` (db-package surface), or extract to `infra/lambda/src/lib/generation/` (Lambda-internal). The design picks the middle option because:

1. **The Lambda is a lightweight wrapper around `runOneCell`, not its owner.** Lambda code today is shaped like Hono routes — thin handlers that call into business logic in `packages/`. Phase 4's generation Lambda follows the same convention: `infra/lambda/src/generation/handler.ts` is ~50 lines (parse → resolve → call → report) and the orchestration is in `packages/db/src/generation/run-one-cell.ts`.
2. **Both the CLI and the Lambda are consumers.** Putting `runOneCell` inside `infra/lambda/` would make the CLI script depend on the Lambda's source tree, which is a layering violation — `packages/` is below `infra/` in the dependency graph today and should stay that way.
3. **Schema imports.** `runOneCell` writes to the `exercises`, `exercise_tags`, and `generation_jobs` tables via Drizzle; those imports come from `packages/db/src/schema/`. Co-locating with the schema avoids deep relative imports from outside the package and keeps the schema's consumers transparent.
4. **Phase 6 type expansion is structural.** When new exercise types ship, they extend the validator's tool schema and the generator's prompt builders — both in `packages/ai`. The orchestration in `packages/db/src/generation/` is type-agnostic (it iterates `batch.drafts` regardless of `contentJson.type`), so its location stays correct.

### Why a separate `GenerationQueue`, not the existing `JobsQueue`

Two competing places to attach the Lambda: the existing `JobsQueue` (provisioned in `infra/lib/constructs/queue.ts`, currently unconsumed) or a new `GenerationQueue`. The design picks the latter because:

1. **Visibility timeouts cannot mix.** A 50-draft cell takes 3–5 minutes; the existing `JobsQueue` has `visibilityTimeout = 90 s`. Sharing the queue would either redeliver mid-cell (corrupting the audit row) or force every future job type onto the slower 600 s timeout (defeating short-running consumers).
2. **DLQ isolation matters.** When generation fails, the operator wants the DLQ to contain only generation messages — not legacy jobs from a cancelled feature. Phase 4 lands a generation-specific DLQ-depth alarm (Req 5.2) that's only meaningful with a generation-specific DLQ.
3. **The legacy queue has an unused IAM grant.** `infra/lib/stack.ts:44` already does `queue.queue.grantSendMessages(lambda.handler)` — a leftover send-permission for the API Lambda. Reassigning the queue to generation would either break that grant (visible CFN diff) or extend it to the API Lambda needlessly. Leaving the legacy construct alone is the lowest-risk option; future job types can adopt either.
4. **Naming is operational.** A queue named `LanguageDrillStack-GenerationQueue` is what the CLI's `--queue` prod-guard substring check (`-dev-` infix) keys off. Reusing `JobsQueue` would force a different distinguishing naming scheme.

### Why externalize `@aws-sdk/*` from the Lambda bundle

The Node.js 20 Lambda runtime ships AWS SDK v3 in the runtime layer at `/opt/...`. esbuild can either bundle it (adds ~500 KB to the zip + cold-start cost) or mark it external (resolved at runtime). Externalize, because:

1. **Cold-start budget.** Requirement NFR Performance pins cold-start under 5 s at 1024 MB. A bundled `@aws-sdk/client-sqs` would push us over.
2. **The runtime SDK is what the AWS team maintains.** Bundling pins us to a specific version that may diverge from runtime patches.
3. **The CLI is different.** The CLI's `--queue` mode runs in Node from a developer's machine, not in Lambda — so `packages/db/scripts/generate-exercises-queue.ts` does *not* externalize. It pulls `@aws-sdk/client-sqs` from `node_modules`.

### Why the scheduler queries `exercises` once and diffs in memory

Two competing approaches: one big `LEFT JOIN VALUES (...) cells_v(...)` query that emits the diff in SQL, or a one-shot `GROUP BY` over `exercises` + an in-memory diff against the in-code curriculum. The design picks the latter because:

1. **The curriculum is a TypeScript module, not a DB table.** No view, no materialized view. The plan §4.3 sketch uses pseudo-SQL referencing a `curriculum_cells_view` that does not exist in the schema. Phase 4 deliberately skips creating one — the curriculum stays in code per resolved decision #5 in the plan.
2. **The aggregate is index-only.** `SELECT language, difficulty, type, grammar_point_key, COUNT(*) FROM exercises WHERE review_status IN ('auto-approved','manual-approved') GROUP BY 1,2,3,4` is exactly the predicate the partial index `exercises_pool_lookup_idx` (`packages/db/src/schema/exercises.ts:33-35`) accelerates. Round-1 row volume (36k) → query completes in <1 s.
3. **In-memory diff is trivial.** Curriculum cell count = 720 (round-1). A `Map<cellKey, approvedCount>` lookup is constant-time. The whole scheduler runs in <30 s with budget left for SQS post latency.

## Architecture

```mermaid
graph TD
    subgraph "EventBridge"
      EB["Daily Rule<br/>cron(0 4 * * ? *)<br/>(prod only)"]
    end

    subgraph "Lambdas"
      SCH["SchedulerLambda<br/>infra/lambda/src/generation/scheduler.ts<br/>• enumerate ALL_CURRICULA<br/>• one SQL aggregate over exercises<br/>• in-memory diff vs MIN_PER_CELL<br/>• post SQS in batches ≤10"]
      GEN["GenerationLambda<br/>infra/lambda/src/generation/handler.ts<br/>• parseGenerationJobMessage<br/>• audit-row idempotency check<br/>• runOneCell from @language-drill/db<br/>• reportBatchItemFailures"]
    end

    subgraph "SQS"
      Q["GenerationQueue<br/>visibility 600s"]
      DLQ["GenerationDeadLetterQueue<br/>retention 14d, maxReceive 3"]
    end

    subgraph "Postgres (Neon)"
      EX[("exercises")]
      GJ[("generation_jobs")]
      ET[("exercise_tags")]
    end

    subgraph "Anthropic API"
      Claude["Claude messages.create<br/>(generator + validator)"]
    end

    subgraph "CloudWatch"
      DA["DLQ depth alarm<br/>≥1 / 5min"]
      LE["Lambda Errors alarm<br/>>5 / 1d"]
    end

    subgraph "CLI (developer laptop)"
      CLI["pnpm generate:exercises<br/>--queue (NEW)"]
    end

    EB -->|invoke| SCH
    SCH -->|SendMessageBatch| Q
    CLI -->|SendMessage| Q
    Q -->|event source<br/>BatchSize=1<br/>reportBatchItemFailures| GEN
    Q -.->|maxReceive=3| DLQ
    DLQ --> DA
    GEN --> LE
    GEN --> Claude
    GEN --> EX
    GEN --> ET
    GEN --> GJ
    SCH --> GJ

    subgraph "Shared core (@language-drill/db)"
      ROC["packages/db/src/generation/<br/>run-one-cell.ts<br/>(extracted from Phase 3)"]
    end
    GEN -->|imports| ROC
    CLI -->|imports<br/>(local-run mode)| ROC
```

## Components and Interfaces

### Component 1 — Shared `runOneCell` extraction (`packages/db/src/generation/`)

**Purpose:** Move Phase 3's per-cell orchestration out of the CLI script into a published package surface so the CLI and the Lambda call into the same code. Algorithmic behavior (cell-isolated try/catch, audit-row open/close, validator + router, dedup retry, `failClosed`, the skill-topic precheck) moves byte-identically; the only changes are the four caller-shape changes enumerated under "Behavioral changes" below.

**Files:**
- `packages/db/src/generation/run-one-cell.ts` (new — orchestration core)
- `packages/db/src/generation/index.ts` (new — barrel)
- `packages/db/src/index.ts` (mod — re-export the new barrel)
- `packages/db/scripts/generate-exercises.ts` (mod — replace inline `runOneCell` with `import { runOneCell } from '../src/generation';`)
- `packages/db/src/generation/run-one-cell.test.ts` (new — moved Phase 3 integration tests)

**Functions / helpers that move with `runOneCell`** (listed so the extraction is fully enumerated and nothing falls through the cracks):

| Symbol | Phase 3 location | New location | Notes |
|---|---|---|---|
| `runOneCell` | `generate-exercises.ts:353-525` | `run-one-cell.ts` | Public; exported from the barrel |
| `validateAndInsertWithRetry` | `generate-exercises.ts:216-344` | `run-one-cell.ts` | Private to the module; its `RunOneCellOpts` shape updates to match the new caller-shape (point 2 below) |
| `runRetryGeneration` | `generate-exercises.ts:202-214` | `run-one-cell.ts` | Private |
| `failClosed` | `generate-exercises.ts:538-574` | `run-one-cell.ts` | Private; closes the audit row on failure paths |
| Skill-topic precheck | `generate-exercises.ts:367-386` (inline in `runOneCell`) | `run-one-cell.ts` (still inline) | Stays inside `runOneCell`; no behavioral change |
| `MAX_DEDUP_RETRIES` | `generate-exercises.ts:165` | `run-one-cell.ts` | Private constant; unchanged value (3) |
| `DraftOutcome` type | `generate-exercises.ts:167-184` | `run-one-cell.ts` | Re-exported from the barrel for tests |
| `ROUND_1_CEFR_LEVELS` | (new in Phase 4) | `index.ts` | Public; consumed by both the scheduler (Req 4.5) and the Lambda handler (Req 2.7) |

**Symbols that stay in the CLI script** (`packages/db/scripts/generate-exercises.ts`):

| Symbol | Why it stays |
|---|---|
| `aborted` module flag + SIGINT handler installation | Process-model concern, CLI-only |
| `pLimit` concurrency limiter | CLI-only — Lambda parallelism comes from reserved concurrency, not in-process pooling |
| `printSummary`, `formatCellLine`, `printDryRunSummary` | CLI output shape, irrelevant to the Lambda |
| `main`, `mainQueue`, `mainLocal` | CLI entry points |
| `parseGenerateArgs` ∋ `ParsedArgs` | Argument parsing, CLI-only |

**Public surface:**

```ts
// packages/db/src/generation/run-one-cell.ts
export type CellResult = {
  cell: Cell;
  jobId: string;
  status: 'succeeded' | 'failed' | 'skipped-cost-cap';
  insertedCount: number;
  skippedCount: number;
  tokenUsage: ClaudeUsageBreakdown;
  costUsd: number;
  errorMessage?: string;
  durationMs: number;
  inBatchDuplicateCount: number;
  validatedCount: number;
  flaggedCount: number;
  rejectedCount: number;
  dedupGivenUpCount: number;
};

export type RunOneCellInput = {
  db: Db;
  client: Anthropic;
  cell: Cell;
  args: {
    count: number;
    batchSeed: string;
    topicDomain: string | null;
    maxCostUsd: number;
  };
  jobId: string;                     // caller-supplied (CLI: randomUUID; Lambda: message.jobId)
  trigger: 'cli' | 'scheduled' | 'admin';
  signal?: AbortSignal;              // optional; CLI bridges from SIGINT, Lambda leaves undefined
};

export async function runOneCell(input: RunOneCellInput): Promise<CellResult>;

// Re-exported for the scheduler's round-1 guard (Req 4.5) and the Lambda's
// out-of-scope-level guard (Req 2.7).
export const ROUND_1_CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Round1CefrLevel = typeof ROUND_1_CEFR_LEVELS[number];
```

**Behavioral changes vs Phase 3** (the only diff vs the line-for-line move):

1. The function now takes `jobId` and `trigger` from the caller (in Phase 3 these were `randomUUID()` + the implicit `'cli'`). This is what makes the Lambda's deterministic-jobId idempotency work (the scheduler computes jobId; the Lambda passes it through; `runOneCell` writes the audit row with the supplied id).
2. The function takes a smaller `args` object (only the fields it actually reads — `count`, `batchSeed`, `topicDomain`, `maxCostUsd`) instead of the full `ParsedArgs` from the CLI. The CLI script wraps its `ParsedArgs` into this shape; the Lambda builds it from the message. **The inner `validateAndInsertWithRetry`'s `RunOneCellOpts` shape (Phase 3 line 186-195) updates in lockstep**: `args: ParsedArgs` becomes `args: { count: number; batchSeed: string; topicDomain: string | null; maxCostUsd: number }`. Inside `validateAndInsertWithRetry` only `args.topicDomain` is read (line 287), so the trim is safe.
3. The optional `signal: AbortSignal` parameter replaces the module-level `aborted` flag for the orchestration core. The CLI's `main` creates an `AbortController`, wires its signal into the SIGINT handler (`controller.abort()` on signal), and passes `signal: controller.signal`. The Lambda passes `undefined` (its abort path is the SQS visibility timeout + Lambda timeout). **Every Phase 3 site that today reads `if (aborted) throw new Error('Aborted by user (SIGINT)')`** (six sites: at the top of `runOneCell`'s try, after `generateBatch` resolves, inside the per-ordinal loop, at the top of every `validateAndInsertWithRetry` retry-loop iteration, before each `validateDraft` call, inside `runRetryGeneration`) is replaced byte-identically with `if (signal?.aborted) throw new Error('Aborted by user (SIGINT)')`. The error message stays the same so existing tests that match `/Aborted by user/` still pass.
4. `runOneCell` no longer imports `randomUUID` — the caller supplies the id. Its imports widen by exactly one type (`AbortSignal`).
5. `runOneCell` continues to OWN the `generation_jobs` row's lifecycle: it inserts the row at the start of the cell (`status='running'`), updates it to `'succeeded'`/`'failed'` at the end, and leaves it with whatever counts accumulated even on partial failure (Phase 3 invariant). The Lambda's pre-call audit-row idempotency check (Component 3 / Req 2.9) is the *outer* gate; `runOneCell` itself does no idempotency check and assumes its caller has cleared the way.

**Audit-row idempotency hook:** Per Req 2.9, the Lambda checks `generation_jobs` for an existing row before calling `runOneCell`. `runOneCell` itself does NOT add a defensive check — the contract is "the caller has confirmed the audit row doesn't exist or is in a recoverable state". This keeps the orchestration core focused; the Lambda's pre-check is in `handler.ts` (Component 4).

**`Cell` type:** Reused unchanged from `packages/db/scripts/generate-exercises-resolve-cells.ts` — but since `Cell` references `GrammarPoint` from `@language-drill/db`, the type is already importable from the package. The CLI's `resolveCells` continues to live in `scripts/` because it depends on the parser shape.

**Migration path for Phase 3 tests:** `packages/db/scripts/generate-exercises.test.ts`'s "Phase 3: validator + dedup" block (the four DB-touching integration tests) moves to `packages/db/src/generation/run-one-cell.test.ts`. Imports change from `from './generate-exercises'` to `from './run-one-cell'`. Test bodies are unchanged. The CLI's own test file (`generate-exercises.test.ts`) keeps the CLI-level tests (`parseGenerateArgs`, `resolveCells`, the integration tests for `main` end-to-end behavior).

### Component 2 — `GenerationJobMessage` type, parser, and idempotency helpers

**Purpose:** Lock the SQS message contract between the CLI/scheduler (producers) and the Lambda (consumer) at compile time, with a runtime parser that throws clear errors on malformed input.

**Files:**
- `infra/lambda/src/generation/job-message.ts` (new)
- `infra/lambda/src/generation/job-message.test.ts` (new)

**Type:**

```ts
import type { CurriculumCefrLevel } from '@language-drill/db';
import type { ExerciseType, LearningLanguage } from '@language-drill/shared';

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
```

The shape mirrors Phase 3's `GenerationSpec` minus the `grammarPoint: GrammarPoint` field (replaced by `grammarPointKey: string` so messages stay small and the curriculum stays the single source of truth for descriptions / examples).

**Parser:**

```ts
export function parseGenerationJobMessage(input: unknown): GenerationJobMessage;
```

- Asserts the top-level is an object; rejects with `Error('GenerationJobMessage: expected object, got <typeof>')` otherwise.
- Validates each field with named errors: `Error('jobId: expected non-empty string, got <JSON.stringify(value)>')`, etc. Mirror of `parseValidationResult` in `packages/ai/src/validate.ts`.
- Validates `trigger` is one of the three union literals.
- Validates `spec.cefrLevel` is one of `'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'` (the `CurriculumCefrLevel` runtime check). Round-1 narrowing happens in the handler (Req 2.7), not in the parser — this lets Phase 6 messages parse on an unchanged Lambda.
- Validates `spec.exerciseType` is one of `'cloze' | 'translation' | 'vocab_recall'`.
- Validates `spec.count` is an integer in `[1, 200]` (matches the CLI's bounds).
- Validates `spec.batchSeed` is a non-empty string ≤ 100 chars (defense against accidental SQS bombs).
- Validates `maxCostUsd > 0` and `< 100` (sanity bound; round-1 cells are <$0.50).

**Idempotency helper:**

```ts
export type AuditRowState =
  | { status: 'absent' }                    // first delivery — proceed
  | { status: 'completed'; jobStatus: 'succeeded' | 'failed' }  // skip
  | { status: 'in-progress' };              // defer (re-deliver after visibility timeout)

export async function checkAuditRowState(db: Db, jobId: string): Promise<AuditRowState>;
```

The helper is pure (one SELECT, no UPDATE), and the Lambda's handler dispatches on its return value per Req 2.9. Co-located with the message types because both the producer (scheduler) and the consumer (Lambda) reason about the same audit-row identity.

**Tests** cover every parser branch + the helper's three return cases (mocked DB).

### Component 3 — `GenerationLambda` handler

**Purpose:** SQS event-source handler that processes one `GenerationJobMessage` per invocation (`BatchSize=1`), routing to the shared `runOneCell` and reporting partial-batch failures.

**Resolves the Req 2.4 / Req 2.9 conflict surfaced by the validator:** Req 2.4 is amended in this phase's requirements doc to scope `batchItemFailures` redelivery to **pre-`runOneCell` failures only** (parse, curriculum miss, audit-row pre-check, pre-cell DB error). When `runOneCell` itself returns `'failed'` or `'skipped-cost-cap'` the audit row already records the terminal outcome and Req 2.9's idempotency guard would skip a redelivery anyway — so the handler logs but does NOT add to `batchItemFailures`. The next legitimate retry path for a failed cell is the next-day scheduler run (which produces a different `batchSeed` → different `jobId` → fresh audit row); manual retry is via SQL deletion of the audit row + a fresh CLI `--queue` post.

**Files:**
- `infra/lambda/src/generation/handler.ts` (new)
- `infra/lambda/src/generation/handler.test.ts` (new)
- `infra/lambda/src/generation/log.ts` (new — tiny module exporting `errMessage(err): string` and `summarizeResult(r): {…}` so the handler stays focused on routing)
- `infra/lambda/src/generation/cell-key.ts` (new — re-export of `assertValidCellKey` + the new `buildCellKey(spec)` helper from `packages/db/src/lib/cell-key.ts`)
- `infra/lambda/src/lib/env.ts` (already exists in the API Lambda? if not, add — exports `requireEnv` matching the script-side helper signature)

**Handler signature:**

```ts
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse>;
```

**Per-record processing flow:**

```ts
for (const record of event.Records) {
  let parsed: GenerationJobMessage;
  try {
    parsed = parseGenerationJobMessage(JSON.parse(record.body));
  } catch (err) {
    log({ level: 'error', messageId: record.messageId, body: record.body.slice(0, 500), error: errMessage(err) });
    batchItemFailures.push({ itemIdentifier: record.messageId });
    continue;
  }

  // Round-1 scope guard (Req 2.7).
  if (!ROUND_1_CEFR_LEVELS.includes(parsed.spec.cefrLevel)) {
    log({ level: 'warn', jobId: parsed.jobId, cefrLevel: parsed.spec.cefrLevel, message: 'out-of-scope CEFR level' });
    batchItemFailures.push({ itemIdentifier: record.messageId });
    continue;
  }

  // Production-trigger guard (Req 2.6).
  if (process.env['ENV_NAME'] === 'production' && parsed.trigger === 'cli') {
    log({ level: 'warn', jobId: parsed.jobId, messageId: record.messageId, message: 'rejecting cli-trigger in production' });
    batchItemFailures.push({ itemIdentifier: record.messageId });
    continue;
  }

  // Audit-row idempotency (Req 2.9).
  const audit = await checkAuditRowState(db, parsed.jobId);
  if (audit.status === 'completed') {
    log({ level: 'info', jobId: parsed.jobId, message: `already ${audit.jobStatus}; skipping` });
    continue;  // success — implicit acknowledgment
  }
  if (audit.status === 'in-progress') {
    log({ level: 'warn', jobId: parsed.jobId, message: 'already running; deferring' });
    batchItemFailures.push({ itemIdentifier: record.messageId });
    continue;
  }

  // Curriculum lookup + Cell construction.
  const grammarPoint = getGrammarPoint(parsed.spec.grammarPointKey);
  if (!grammarPoint) {
    throw new Error(`grammarPointKey not in curriculum: ${parsed.spec.grammarPointKey}`);
  }
  const cell: Cell = {
    language: parsed.spec.language,
    cefrLevel: parsed.spec.cefrLevel,
    exerciseType: parsed.spec.exerciseType,
    grammarPoint,
    cellKey: buildCellKey(parsed.spec),
  };

  // Dispatch.
  let result: CellResult;
  try {
    result = await runOneCell({
      db, client, cell,
      args: {
        count: parsed.spec.count,
        batchSeed: parsed.spec.batchSeed,
        topicDomain: parsed.spec.topicDomain,
        maxCostUsd: parsed.maxCostUsd,
      },
      jobId: parsed.jobId,
      trigger: parsed.trigger,
    });
  } catch (err) {
    log({ level: 'error', jobId: parsed.jobId, error: errMessage(err) });
    batchItemFailures.push({ itemIdentifier: record.messageId });
    continue;
  }

  if (result.status !== 'succeeded') {
    // Audit row already records the terminal state — don't redeliver
    // (Req 2.4 amendment). Log the warning and proceed.
    log({ level: 'warn', jobId: parsed.jobId, status: result.status, errorMessage: result.errorMessage });
    continue;
  }

  log({ level: 'info', jobId: parsed.jobId, ...summarizeResult(result) });
}
return { batchItemFailures };
```

**Helper definitions:**
- `errMessage(err: unknown): string` — `err instanceof Error ? err.message : String(err)`. Lives in `infra/lambda/src/generation/log.ts`.
- `summarizeResult(r: CellResult): Record<string, number>` — picks the count fields from a successful CellResult: `{ inserted: r.insertedCount, approved: r.insertedCount - r.flaggedCount, flagged: r.flaggedCount, rejected: r.rejectedCount, dedupGivenUp: r.dedupGivenUpCount, durationMs: r.durationMs }`. Lives in `log.ts` next to `errMessage`.
- `buildCellKey(spec)` and `buildCellKeyFromRow(row)` — deterministic `<lang>:<level>:<type>:<grammar_point_key>` (lowercased) construction. Both move to `packages/db/src/lib/cell-key.ts` as exported helpers next to the existing `assertValidCellKey`. The Lambda imports them from there; the scheduler does too.
- `requireEnv(name): string` — same signature as `packages/db/scripts/env-helpers.ts:requireEnv`. The Lambda needs an in-Lambda copy because `packages/db/scripts/` is not part of the Lambda's bundling tree (the bundling aliases under `infra/lib/constructs/lambda.ts:60-75` only include `packages/{shared,db,ai}/src/`, not `packages/db/scripts/`). Either: (a) move `requireEnv` to `packages/db/src/lib/env.ts` and re-export from the barrel so both the script and the Lambda can import, OR (b) inline a 5-line copy at `infra/lambda/src/lib/env.ts`. Pick (a) — single source of truth, no duplicate.

**Module-level state:**

The handler creates **one shared `db` and one shared `client`** at module load (cold-start time), reused across invocations within the same Lambda container. This matches the API Lambda's pattern of module-level Hono setup. The `db` connection pools across reused invocations; the `client` (Anthropic SDK) is stateless. Cold-start cost is paid once per container.

**Logging shape:** Every log line is a structured JSON object via `console.log(JSON.stringify({...}))` so CloudWatch Insights queries on field names work. Required fields: `level`, `jobId` (when known), `messageId` (when known), `message` (one-line description). Optional fields per call site.

**Tests** cover every branch in the per-record flow with `vi.mock` of `runOneCell`, `checkAuditRowState`, and the curriculum lookup. The integration test from Component 1 covers the end-to-end success path; the handler tests cover its routing logic in isolation.

### Component 4 — `SchedulerLambda` handler

**Purpose:** EventBridge-invoked handler that walks the curriculum, queries approved counts, and posts SQS messages for under-target cells.

**Files:**
- `infra/lambda/src/generation/scheduler.ts` (new)
- `infra/lambda/src/generation/scheduler.test.ts` (new)

**Handler signature:**

```ts
export async function handler(): Promise<void>;
```

No event payload — EventBridge cron triggers carry no useful data, and the scheduler is fully self-contained.

**Flow:**

```ts
const startedAt = Date.now();
const todayUtc = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
const batchSeed = `scheduled-${todayUtc}`;

// 1. Enumerate all curriculum cells (in-memory, from the bundled curriculum).
const allCells: Cell[] = enumerateCurriculumCells(ALL_CURRICULA);

// 2. One SQL aggregate over exercises.
const counts = await db
  .select({
    language: exercises.language,
    difficulty: exercises.difficulty,
    type: exercises.type,
    grammarPointKey: exercises.grammarPointKey,
    approved: sql<number>`COUNT(*)::int`,
  })
  .from(exercises)
  .where(inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']))
  .groupBy(exercises.language, exercises.difficulty, exercises.type, exercises.grammarPointKey);

// 3. In-memory diff.
const approvedByCell = new Map<string, number>();
for (const row of counts) {
  approvedByCell.set(buildCellKeyFromRow(row), row.approved);
}

const undersized: Array<{ cell: Cell; need: number }> = [];
for (const cell of allCells) {
  if (!ROUND_1_CEFR_LEVELS.includes(cell.cefrLevel)) continue;
  const current = approvedByCell.get(cell.cellKey) ?? 0;
  if (current < MIN_PER_CELL) {
    undersized.push({ cell, need: TARGET_PER_CELL - current });
  }
}

// 4. Build messages.
const messages = undersized.map(({ cell, need }) => ({
  jobId: deterministicUuid([cell.cellKey, batchSeed].join('|')),
  trigger: 'scheduled' as const,
  spec: {
    language: cell.language,
    cefrLevel: cell.cefrLevel as CurriculumCefrLevel,
    exerciseType: cell.exerciseType,
    grammarPointKey: cell.grammarPoint.key,
    topicDomain: null,
    count: need,
    batchSeed,
  },
  maxCostUsd: SCHEDULER_PER_CELL_COST_CAP_USD,
}));

if (messages.length === 0) {
  log({ level: 'info', message: 'Pool at target — no jobs enqueued' });
  return;
}

// 5. Post in batches of ≤ 10.
for (const batch of chunk(messages, 10)) {
  await sqs.send(new SendMessageBatchCommand({
    QueueUrl: requireEnv('GENERATION_QUEUE_URL'),
    Entries: batch.map((msg, i) => ({
      Id: `${i}`,
      MessageBody: JSON.stringify(msg),
    })),
  }));
  log({ level: 'info', batchSize: batch.length, jobIds: batch.map((m) => m.jobId), message: 'SendMessageBatch sent' });
}

const duration = Date.now() - startedAt;
log({ level: 'info', enqueued: messages.length, durationMs: duration, message: 'scheduler complete' });
if (duration > 30_000) {
  log({ level: 'warn', durationMs: duration, message: 'enumeration query exceeded 30s warning threshold' });
}
```

**Constants (top of `scheduler.ts`):**

```ts
const MIN_PER_CELL = 25;                          // Req 4.3.4
const TARGET_PER_CELL = 50;                       // Req 4.3.4
const SCHEDULER_PER_CELL_COST_CAP_USD = 0.50;     // Req 4.3.4 — ~1.85× plan §5 estimate
```

**Helper `enumerateCurriculumCells(curricula)`:** Re-implements the same cross-product the CLI's `resolveCells` does — every grammar point × every compatible exercise type × the level from the grammar point's `cefrLevel`. Vocab umbrellas only with `vocab_recall`; grammar points with `cloze | translation`. The helper is a pure function exported from `packages/db/src/generation/index.ts` so the scheduler test can import it directly without standing up a CDK stack. **The CLI's existing `resolveCells` (`packages/db/scripts/generate-exercises-resolve-cells.ts`) is refactored to delegate to this helper for the cross-product** so the scheduler and the CLI cannot drift on which cells exist; `resolveCells` then layers on its argument-driven slicing (filter by `--lang`, `--level`, `--type`, `--grammar-point`). This is one of the few non-extraction refactors in Phase 4 and is justified by the drift risk.

**Helper `chunk(arr, size)`:** Standard-issue array chunker (`for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size)`). Exported from `packages/db/src/lib/chunk.ts` as a small utility alongside the cell-key helpers — no new dependency, no lodash. The scheduler imports it. CLI's `--queue` mode (Component 9) uses the same helper.

**Why no `getGrammarPoint` call:** The scheduler has the full `GrammarPoint` object from `ALL_CURRICULA` already; the message just carries the `key` and the Lambda re-resolves on receive. This duplication is intentional — it lets the Lambda use a stale/cached curriculum if the scheduler runs before a curriculum-bumping deploy.

**Tests** cover: an empty database (every cell at 0 count → every cell undersized → 720 messages in 72 batches); a partially-filled database (mix of under-target and at-target cells → only undersized cells produce messages); a fully-populated database (zero messages → "Pool at target" log line); the > 30 s warning fires when stubbed `db.select` resolves slowly via `vi.useFakeTimers`. The SQS client is stubbed via `vi.mock('@aws-sdk/client-sqs')`.

### Component 5 — `GenerationQueueConstruct`

**Purpose:** CDK construct that creates the dedicated SQS queue, its DLQ, the redrive policy, and the DLQ-depth CloudWatch alarm.

**File:** `infra/lib/constructs/generation-queue.ts`

```ts
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export class GenerationQueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly dlqDepthAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'GenerationDeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'GenerationQueue', {
      visibilityTimeout: Duration.seconds(600),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    this.dlqDepthAlarm = new cloudwatch.Alarm(this, 'GenerationDlqDepthAlarm', {
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Generation DLQ has at least one message — operator review required.',
    });
  }
}
```

**Tests** assert exactly 2 `AWS::SQS::Queue` resources, exactly 1 `AWS::CloudWatch::Alarm`, the visibility timeout is 600, and the redrive policy carries `maxReceiveCount: 3`.

### Component 6 — `GenerationLambdaConstruct`

**Purpose:** CDK construct that creates the SQS-consumer Lambda, wires its IAM, and attaches the SQS event source with `reportBatchItemFailures: true`.

**File:** `infra/lib/constructs/generation-lambda.ts`

```ts
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as path from 'path';

export interface GenerationLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  envName: 'prod' | 'dev';
  reservedConcurrency: number;        // 3 in both stacks
  additionalEnv?: Record<string, string>;
}

export class GenerationLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly errorsAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: GenerationLambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this, 'DatabaseUrl', `${props.secretsPrefix}/DATABASE_URL`,
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this, 'AnthropicApiKey', `${props.secretsPrefix}/ANTHROPIC_API_KEY`,
    );

    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/generation/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(600),
      memorySize: 1024,
      reservedConcurrentExecutions: props.reservedConcurrency,
      depsLockFilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],            // Req 3.8 — runtime ships SDK v3
        esbuildArgs: {
          '--alias:@language-drill/shared': path.join(projectRoot, 'packages/shared/src/index.ts'),
          '--alias:@language-drill/db': path.join(projectRoot, 'packages/db/src/index.ts'),
          '--alias:@language-drill/ai': path.join(projectRoot, 'packages/ai/src/index.ts'),
        },
      },
      environment: {
        ...(props.additionalEnv ?? {}),
        ENV_NAME: props.envName,
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        ANTHROPIC_API_KEY: anthropicApiKey.secretValue.unsafeUnwrap(),
      },
      logRetention: logs.RetentionDays.ONE_MONTH,   // bound CloudWatch storage cost; see "Operational notes" below
    });

    databaseUrl.grantRead(this.handler);
    anthropicApiKey.grantRead(this.handler);

    this.handler.addEventSource(new SqsEventSource(props.queue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));

    this.errorsAlarm = new cloudwatch.Alarm(this, 'GenerationLambdaErrorsAlarm', {
      metric: this.handler.metricErrors({
        period: Duration.days(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
```

**Tests** assert: one `AWS::Lambda::Function` with timeout 600, memory 1024, reserved concurrency 3; one `AWS::Lambda::EventSourceMapping` with `ReportBatchItemFailures: true` and `BatchSize: 1`; environment includes `DATABASE_URL` and `ANTHROPIC_API_KEY`; no Clerk/Upstash secrets attached; one CloudWatch alarm with threshold 5 over 1 day.

### Component 7 — `SchedulerLambdaConstruct`

**Purpose:** CDK construct that creates the scheduler Lambda and conditionally attaches the daily EventBridge rule based on `enableScheduledJobs`.

**File:** `infra/lib/constructs/scheduler-lambda.ts`

```ts
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';

export interface SchedulerLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  enableScheduledJobs: boolean;
  scheduleExpression?: events.Schedule;  // default: every day at 04:00 UTC
}

export class SchedulerLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly rule?: events.Rule;        // undefined when enableScheduledJobs=false

  constructor(scope: Construct, id: string, props: SchedulerLambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this, 'DatabaseUrl', `${props.secretsPrefix}/DATABASE_URL`,
    );

    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/generation/scheduler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 512,
      depsLockFilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        esbuildArgs: {
          '--alias:@language-drill/shared': path.join(projectRoot, 'packages/shared/src/index.ts'),
          '--alias:@language-drill/db': path.join(projectRoot, 'packages/db/src/index.ts'),
          '--alias:@language-drill/ai': path.join(projectRoot, 'packages/ai/src/index.ts'),
        },
      },
      environment: {
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        GENERATION_QUEUE_URL: props.queue.queueUrl,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    databaseUrl.grantRead(this.handler);
    props.queue.grantSendMessages(this.handler);

    if (props.enableScheduledJobs) {
      this.rule = new events.Rule(this, 'DailyScheduleRule', {
        schedule: props.scheduleExpression ?? events.Schedule.cron({
          minute: '0', hour: '4', day: '*', month: '*', year: '*',
        }),
        targets: [new targets.LambdaFunction(this.handler)],
      });
    }
  }
}
```

**Default schedule choice:** 04:00 UTC = midnight US-Eastern in winter, 7 PM in summer. Picked because it's outside both Anthropic's busiest hours (US daytime) and the project's likely interactive-eval traffic. Configurable via `scheduleExpression` for any future tuning.

**Tests** assert:
- when `enableScheduledJobs=true` → exactly 1 `AWS::Events::Rule` exists, targeting the scheduler Lambda;
- when `enableScheduledJobs=false` → 0 `AWS::Events::Rule` resources exist (the Lambda still exists);
- the Lambda has `DATABASE_URL` only (no `ANTHROPIC_API_KEY`);
- IAM grants: secretsmanager:GetSecretValue on `${secretsPrefix}/DATABASE_URL` and `sqs:SendMessage` on the queue.

### Component 8 — Stack wiring (`infra/lib/stack.ts`)

**Purpose:** Add the three new constructs to `LanguageDrillStack`, wire their dependencies, surface the queue URL as a stack output.

**Diff (in pseudo-form):**

```ts
import { GenerationQueueConstruct } from './constructs/generation-queue';
import { GenerationLambdaConstruct } from './constructs/generation-lambda';
import { SchedulerLambdaConstruct } from './constructs/scheduler-lambda';

export class LanguageDrillStack extends Stack {
  constructor(scope: Construct, id: string, props: LanguageDrillStackProps) {
    super(scope, id, props);

    const lambda = new LambdaConstruct(this, 'Lambda', { /* unchanged */ });
    const apiGateway = new ApiGatewayConstruct(this, 'ApiGateway', { /* unchanged */ });
    const storage = new StorageConstruct(this, 'Storage');
    const queue = new QueueConstruct(this, 'Queue');                  // unchanged — legacy

    // Phase 4 — generation pipeline.
    const generationQueue = new GenerationQueueConstruct(this, 'GenerationQueue');
    const generationLambda = new GenerationLambdaConstruct(this, 'GenerationLambdaWrap', {
      queue: generationQueue.queue,
      secretsPrefix: props.secretsPrefix,
      envName: props.envName,
      reservedConcurrency: 3,
    });
    const scheduler = new SchedulerLambdaConstruct(this, 'SchedulerLambdaWrap', {
      queue: generationQueue.queue,
      secretsPrefix: props.secretsPrefix,
      enableScheduledJobs: props.enableScheduledJobs,
    });

    storage.bucket.grantRead(lambda.handler);
    queue.queue.grantSendMessages(lambda.handler);                    // unchanged — legacy

    new CfnOutput(this, 'ApiUrl', { /* unchanged */ });
    new CfnOutput(this, 'GenerationQueueUrl', {
      value: generationQueue.queue.queueUrl,
      description: 'SQS queue for generation jobs (Phase 4). Set GENERATION_QUEUE_URL to this for the CLI --queue flag.',
    });

    Tags.of(this).add('env', props.envName);
  }
}
```

**No removals.** The legacy `queue.queue.grantSendMessages(lambda.handler)` line stays; the `JobsQueue` and its DLQ remain in the synthesized template. Phase 4 is purely additive.

**Logical IDs are deterministic and stable.** CDK's auto-generated logical IDs are derived from the construct path. By picking `GenerationQueue`, `GenerationLambdaWrap`, `SchedulerLambdaWrap` as the construct ids, future Phase 4b additions (`BatchCollectorLambdaWrap`?) can be added without renaming any existing resource.

### Component 9 — CLI `--queue` flag

**Purpose:** Add a queue-posting mode to the existing `pnpm generate:exercises` so the operator's familiar CLI workflow can drive the new Lambda without learning `aws sqs send-message`.

**Files:**
- `packages/db/scripts/generate-exercises-parse-args.ts` (mod — add `--queue` and `--allow-prod` to BOOLEAN_FLAGS, validate compat with other flags)
- `packages/db/scripts/generate-exercises-queue.ts` (new — pure: takes `Cell[]` + flags, returns the messages and posts via SQS client)
- `packages/db/scripts/generate-exercises-queue.test.ts` (new)
- `packages/db/scripts/generate-exercises.ts` (mod — branch on `args.queue` after `resolveCells`)

**`postCellsToQueue(cells, args)` shape:**

```ts
export type PostToQueueArgs = {
  cells: readonly Cell[];
  batchSeed: string;
  topicDomain: string | null;
  count: number;
  maxCostUsd: number;
  allowProd: boolean;
  dryRun: boolean;
};

export type PostedJob = { cellKey: string; jobId: string; messageId?: string };

export async function postCellsToQueue(
  sqs: SQSClient,
  queueUrl: string,
  args: PostToQueueArgs,
): Promise<PostedJob[]>;
```

**Behavior:**
1. `MAX_CLI_CELLS_PER_INVOCATION = 100` check (Req 6.6) — throw before posting if exceeded.
2. Prod-queue substring check (Req 6.5) — `if (!args.allowProd && !queueUrl.includes('-dev-')) throw`. The `-dev-` infix reliably distinguishes dev from prod logical IDs.
3. For each cell: build a `GenerationJobMessage` with `jobId = randomUUID()` (NOT deterministic — the CLI is the same-day-rerun-must-make-fresh-jobs case; the scheduler is the deterministic case), `trigger = 'cli'`, `count = args.count`, `batchSeed = args.batchSeed`, `topicDomain = args.topicDomain`, `maxCostUsd = args.maxCostUsd`.
4. If `args.dryRun` — log every message with `jobId` and `cellKey` and return without calling SQS.
5. Otherwise — `SendMessageBatchCommand` in batches of ≤ 10. One stdout line per posted message: `Posted job <jobId> for <cellKey> (count=N, trigger=cli)`.

**Why CLI uses `randomUUID()` not `deterministicUuid`:** The CLI's `--queue` mode is for ad-hoc fills. Re-running `pnpm generate:exercises --queue --batch-seed phase-4-test --count 50` should post **fresh** jobs each time, not collide with the previous run's audit row (which would silently skip per Req 2.9). The scheduler is the case where determinism matters; the CLI mode wants explicit "give me 50 more" semantics.

**Caveat on the `-dev-` substring guard:** The check `!queueUrl.includes('-dev-')` is a defense-in-depth rail, not a primary safety boundary. It depends on the dev stack being named `LanguageDrillStack-dev` (which CDK then propagates into resource names like `…-dev-GenerationQueue…`). If a future deploy renames the dev stack — or if a third stack is added with no `-dev-` infix — the guard breaks silently. The PRIMARY safety boundary is the Lambda-side `ENV_NAME=production && trigger='cli'` reject (Req 2.6 / Component 3 flow), which depends on the Lambda's env-derived `ENV_NAME` and is unaffected by stack-naming changes. The CLI guard reduces the blast radius of "I forgot which terminal I was in"; the Lambda guard is the actual contract.

**Argument-parser changes:**

```ts
// In generate-exercises-parse-args.ts:
const BOOLEAN_FLAGS_PHASE_4 = new Set(['queue', 'allow-prod', /* phase 2/3 flags */]);
```

A new `--queue` boolean flag is added to `ParsedArgs`. Cross-flag validation:
- `--queue` is incompatible with `--concurrency` (the scheduler caps the parallelism, not the CLI). The parser throws if both are set.
- `--queue` is compatible with `--dry-run`; the CLI prints what *would* be posted without calling SQS.
- `--queue` requires `GENERATION_QUEUE_URL` and `AWS_REGION` (checked at the top of the queue path, not in the parser).

**`main` dispatch:**

```ts
async function main(argv) {
  const args = parseGenerateArgs(argv);
  if (args.queue) {
    return await mainQueue(args);     // never returns control to local-run path
  }
  return await mainLocal(args);       // unchanged Phase 3 path
}
```

`mainQueue` is a small wrapper that constructs an `SQSClient` from `@aws-sdk/client-sqs` (regions from `AWS_REGION`), calls `postCellsToQueue`, prints the per-job confirmation lines, and exits 0 on success. `mainLocal` is the renamed Phase 3 `main` body.

**Tests** cover: `--queue` produces one message per cell; `--queue --dry-run` does not call SQS; the prod-queue guard refuses without `--allow-prod`; missing `GENERATION_QUEUE_URL` throws; > 100 cells refuses; `--queue` + `--concurrency 2` fails parsing; the message bodies parse via `parseGenerationJobMessage` (round-trip invariant).

## Data Models

### `GenerationJobMessage` (SQS body)

| Field | Type | Source | Validated against |
|---|---|---|---|
| `jobId` | `string` (UUID) | producer-supplied | Used as `generation_jobs.id` and audit-row idempotency key |
| `trigger` | `'cli' \| 'scheduled' \| 'admin'` | producer | `generation_jobs.trigger` column constraint |
| `spec.language` | `LearningLanguage` | producer | matches CLI's `--lang` |
| `spec.cefrLevel` | `CurriculumCefrLevel` | producer | round-1 narrowed in handler |
| `spec.exerciseType` | `ExerciseType` | producer | matches CLI's `--type` |
| `spec.grammarPointKey` | `string` | producer | resolved against curriculum at handler time |
| `spec.topicDomain` | `string \| null` | producer | passed through; not used in Phase 4 |
| `spec.count` | `number` | producer | `[1, 200]` |
| `spec.batchSeed` | `string` | producer | non-empty, ≤ 100 chars |
| `maxCostUsd` | `number` | producer | `(0, 100)` |

### `RunOneCellInput` (extracted from Phase 3)

```ts
type RunOneCellInput = {
  db: Db;                           // shared at module load (cold-start)
  client: Anthropic;                // shared at module load
  cell: Cell;                       // Phase 3 type, unchanged
  args: {
    count: number;
    batchSeed: string;
    topicDomain: string | null;
    maxCostUsd: number;
  };
  jobId: string;                    // caller-derived; CLI = randomUUID, scheduler = deterministic
  trigger: 'cli' | 'scheduled' | 'admin';
  signal?: AbortSignal;             // CLI bridges from SIGINT, Lambda omits
};
```

### Constants (Phase 4 contract — collected here for scannability)

| Constant | Value | Defined in | Consumed by |
|---|---|---|---|
| `MIN_PER_CELL` | `25` | `infra/lambda/src/generation/scheduler.ts` | Scheduler under-target diff (Req 4.3.4) |
| `TARGET_PER_CELL` | `50` | `infra/lambda/src/generation/scheduler.ts` | Scheduler `count = target − current` (Req 4.3.4) |
| `SCHEDULER_PER_CELL_COST_CAP_USD` | `0.50` | `infra/lambda/src/generation/scheduler.ts` | Scheduler `maxCostUsd` per message (Req 4.3.4); ~1.85× the plan §5 per-cell estimate |
| `MAX_CLI_CELLS_PER_INVOCATION` | `100` | `packages/db/scripts/generate-exercises-queue.ts` | CLI `--queue` ceiling (Req 6.6) |
| `MAX_DEDUP_RETRIES` | `3` (Phase 3 reuse) | `packages/db/src/generation/run-one-cell.ts` | Per-ordinal dedup-retry budget (Phase 3 invariant) |
| Lambda reserved concurrency | `3` | `infra/lib/stack.ts` (passed to `GenerationLambdaConstruct`) | Both prod and dev (Req 3.1, plan §6 decision #6) |
| Generation Lambda timeout | `600 s` | `GenerationLambdaConstruct` (Component 6) | Matches queue visibility (Req 3.2, Req 1.2) |
| Generation Lambda memory | `1024 MB` | `GenerationLambdaConstruct` | (Req 3.2) |
| Generation queue visibility | `600 s` | `GenerationQueueConstruct` (Component 5) | (Req 1.2) |
| DLQ retention | `14 days` | `GenerationQueueConstruct` | Matches existing `QueueConstruct` (Req 1.2) |
| `maxReceiveCount` | `3` | `GenerationQueueConstruct` | Matches existing `QueueConstruct` + Phase 3's dedup-retry budget (Req 1.3) |
| SQS event source `BatchSize` | `1` | `GenerationLambdaConstruct` (Component 6) | (Req 3.4) |
| Scheduler Lambda timeout | `60 s` | `SchedulerLambdaConstruct` (Component 7) | Twice the 30 s warning threshold (Req 4.10) |
| Scheduler Lambda memory | `512 MB` | `SchedulerLambdaConstruct` | Smaller than generation Lambda — only one query + N SQS posts |
| EventBridge schedule | `cron(0 4 * * ? *)` (04:00 UTC daily) | `SchedulerLambdaConstruct` default | Configurable via `scheduleExpression` prop (Req 4.1) |
| Lambda log retention | `1 month` | both Lambda constructs | Bounds CloudWatch storage cost; revisit in Phase 5 dashboard work |
| `ROUND_1_CEFR_LEVELS` | `['A1','A2','B1','B2']` | `packages/db/src/generation/index.ts` | Scheduler enumeration filter (Req 4.5) + Lambda message guard (Req 2.7) |
| DLQ-depth alarm threshold | `≥ 1` over 5 min | `GenerationQueueConstruct` | (Req 5.2) |
| Lambda Errors alarm threshold | `> 5` over 1 day | `GenerationLambdaConstruct` | (Req 5.3) |

### IAM policy excerpts (synthesized)

**`GenerationLambdaConstruct` — execution role:**

```json
{
  "Statement": [
    { "Action": "secretsmanager:GetSecretValue", "Resource": "arn:aws:secretsmanager:*:*:secret:language-drill/DATABASE_URL-*" },
    { "Action": "secretsmanager:GetSecretValue", "Resource": "arn:aws:secretsmanager:*:*:secret:language-drill/ANTHROPIC_API_KEY-*" },
    { "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], "Resource": "<GenerationQueue arn>" },
    { "Action": "logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents", "Resource": "*" }
  ]
}
```

**`SchedulerLambdaConstruct` — execution role:**

```json
{
  "Statement": [
    { "Action": "secretsmanager:GetSecretValue", "Resource": "arn:aws:secretsmanager:*:*:secret:language-drill/DATABASE_URL-*" },
    { "Action": "sqs:SendMessage", "Resource": "<GenerationQueue arn>" },
    { "Action": "logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents", "Resource": "*" }
  ]
}
```

The CI deploy IAM user (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from `CLAUDE.md`'s "Required secrets" table) already grants `secretsmanager:GetSecretValue` and `sqs:*` action shapes for the API Lambda; Phase 4 reuses those permission patterns under different resource ARNs. No CI policy change.

## Error Handling

### Error Scenario 1 — Malformed SQS message body

- **Trigger:** `record.body` fails `JSON.parse` OR `parseGenerationJobMessage` throws.
- **Handling:** Log `{level: 'error', messageId, body: body.slice(0,500), error}` (truncate body to bound CloudWatch log injection of huge payloads). Add `messageId` to `batchItemFailures`. After 3 deliveries the message lands in the DLQ.
- **Operator impact:** DLQ-depth alarm fires within 5 minutes; operator inspects the DLQ message body in the AWS Console; the Lambda continues processing other records normally.

### Error Scenario 2 — Curriculum lookup miss

- **Trigger:** `getGrammarPoint(message.spec.grammarPointKey)` returns `undefined` (e.g. the curriculum was edited between the scheduler's enumeration and the Lambda's invocation).
- **Handling:** Throw `Error('grammarPointKey not in curriculum: <key>')`; the per-record `catch` adds the messageId to `batchItemFailures`.
- **Operator impact:** Same as Scenario 1 — DLQ landing after 3 retries. The error message names the offending key, so the fix (curriculum patch + redeploy + retry from DLQ) is straightforward.

### Error Scenario 3 — Audit-row in `running` state at delivery time

- **Trigger:** SQS redelivers a message whose audit row is still `running` because a sibling Lambda crashed mid-cell or the previous attempt is still executing.
- **Handling:** `checkAuditRowState` returns `{status: 'in-progress'}`; the handler logs a warning and adds the messageId to `batchItemFailures`. The next delivery (after the 600 s visibility timeout) sees the same state if the sibling is still running, OR a `succeeded`/`failed` state if it completed, OR `'absent'` if the audit row was somehow lost.
- **Operator impact:** A stuck-running audit row eventually reaches `maxReceiveCount = 3` and lands in the DLQ. The DLQ alarm fires; the operator inspects the audit row directly via SQL and either UPDATEs it to `'failed'` (releasing the next retry to proceed) or investigates the underlying cause.

### Error Scenario 4 — Out-of-scope CEFR level

- **Trigger:** A message with `spec.cefrLevel = 'C1'` reaches the Lambda (e.g. a Phase 6 producer running against a still-Phase-4 Lambda).
- **Handling:** Log warn, add messageId to `batchItemFailures`. The DLQ catches it after 3 retries.
- **Operator impact:** Visible in DLQ inspection; the fix is to upgrade the Lambda OR (operationally) drop the message from the DLQ.

### Error Scenario 5 — Production-trigger guard

- **Trigger:** A `trigger='cli'` message arrives in the prod Lambda (someone bypassed the CLI's `--allow-prod` substring guard).
- **Handling:** Log warn, add messageId to `batchItemFailures`. Same DLQ-after-3 path.
- **Operator impact:** The message body in the DLQ identifies the source (the `jobId` plus the absence of `'scheduled'` trigger reveals it was a CLI post). This is operationally a "should not happen" path; if it does, the operator investigates how the local CLI got the prod queue URL.

### Error Scenario 6 — `runOneCell` throws (pre-cell DB connection error)

- **Trigger:** `runOneCell` throws before its own internal try/catch updates the audit row (e.g. the pool can't connect to Neon during the `INSERT` of the audit row).
- **Handling:** The handler's `catch` logs the error with `jobId` and `messageId` and adds the messageId to `batchItemFailures`. The audit row may not exist OR may exist as `running` with no error_message.
- **Operator impact:** Same DLQ-after-3 path. If the audit row is stuck in `running`, Scenario 3's resolution applies.

### Error Scenario 7 — `runOneCell` returns `status: 'failed'`

- **Trigger:** The cell ran to completion (or partial completion) but the validator failed, the cost cap tripped, or the cell-level catch fired in Phase 3's normal path.
- **Handling:** Per the Req 2.4 amendment (Component 3 callout), the audit row is already updated to `status='failed'` with `error_message` populated by `runOneCell`'s own catch. The handler logs the warning and **does NOT add to `batchItemFailures`** — the audit row is the terminal record. SQS does not redeliver. The DLQ never receives this kind of failure.
- **Operator impact:** The audit row's `'failed'` state is the signal. The next-day scheduler run (with a different `batchSeed` and hence a different `jobId`) automatically re-attempts the cell. Manual same-day retry is via SQL `DELETE FROM generation_jobs WHERE id = '<jobId>'` followed by a fresh `pnpm generate:exercises --queue --batch-seed <something-new>` post.

This is the clean resolution to the requirements-doc conflict the validator surfaced: Req 2.4 was amended to scope `batchItemFailures` to pre-`runOneCell` failures only; Req 2.9 owns the redelivery-time idempotency.

### Error Scenario 8 — Scheduler enumeration query timeout

- **Trigger:** The scheduler's `SELECT … GROUP BY` takes longer than the Lambda's 60 s timeout (e.g. `exercises` table has grown to 100M rows because Phase 6's sub-types blew up).
- **Handling:** Lambda hits the 60 s ceiling; the runtime kills the function. EventBridge sees the failure and either retries (per its retry policy, default 2 attempts) or moves on. The next day's scheduler invocation proceeds normally.
- **Operator impact:** The Lambda Errors alarm fires after 5+ failures over a day. The operator investigates the query plan and (per Req 4.10's warning at the 30 s mark) likely creates an indexed view or materialized aggregate. Phase 5 follow-up territory.

### Error Scenario 9 — SQS post failure during scheduler

- **Trigger:** `SendMessageBatchCommand` returns a partial-success result (some `Failed` entries) or throws on a transient SQS error.
- **Handling:** Log `{level: 'error', failed: failedEntries, batchIndex}` and continue with the next batch. Failed entries stay un-enqueued for this run; the next day's scheduler computes the same diff and re-enqueues them.
- **Operator impact:** Visible in CloudWatch logs; no alarm (transient SQS errors are normal). Permanent SQS errors (e.g. queue deleted) would surface via the Lambda Errors alarm and a missing `GenerationQueueUrl` stack output.

### Error Scenario 10 — Scheduler crashes mid-run

- **Trigger:** The scheduler enqueues batch 1 (e.g. 10 cells) successfully and crashes (Lambda timeout, OOM, transient panic) before posting batch 2.
- **Handling:** The 10 already-posted messages reach the GenerationLambda normally, each opening its own audit row with the deterministic-per-day jobId. The remaining un-enqueued cells stay un-enqueued for *this* day. Next day's scheduler computes a new `batchSeed = scheduled-<tomorrow>` → new deterministic jobIds for every cell → enqueues every still-undersized cell (the previously-enqueued ones may now be at-target if their day-1 runs succeeded).
- **Operator impact:** Visible in the Lambda Errors alarm if recurring. Audit rows from the partially-successful day-1 run accumulate normally; no orphaned `running` rows because the GenerationLambda owns the audit-row lifecycle, not the scheduler.

### Error Scenario 11 — Anthropic outage during a scheduled-run window

- **Trigger:** Anthropic returns 5xx for every generator/validator call during the day's scheduled run.
- **Handling:** Each cell's `runOneCell` catches the SDK throw inside its cell-isolated try/catch, marks the audit row `'failed'` with the SDK's error message, and returns `status: 'failed'`. The GenerationLambda logs the warning (Req 2.4 amendment — does NOT add to `batchItemFailures`). The DLQ stays empty.
- **Operator impact:** The Lambda Errors alarm fires if > 5 cells fail in 24 h (likely during a sustained outage). The next day's scheduler runs with a different `batchSeed` and produces fresh jobIds, so the cells are retried automatically. Manual intervention is only needed when the outage spans multiple days.

### Error Scenario 12 — Same-day scheduler re-fire

- **Trigger:** EventBridge retries the daily rule (e.g. its own internal retry policy fires on a Lambda transient failure), producing two scheduler invocations on the same UTC day.
- **Handling:** Both invocations compute identical `batchSeed = scheduled-<today>` and identical deterministic jobIds. Both enqueue the same SQS messages. The GenerationLambda processes the first delivery normally; the second delivery (same jobId) hits Req 2.9's audit-row idempotency guard and skips with no Claude call. Net work = one cell's worth, regardless of how many EventBridge fires.
- **Operator impact:** None — this is the designed behavior. Visible in CloudWatch only as duplicate `'already succeeded; skipping'` log lines.

## Testing Strategy

### Unit Testing

**Per-construct CDK tests** (`infra/lib/constructs/*.test.ts`):
- `generation-queue.test.ts` — 2 SQS queues, 1 alarm, redrive policy, visibility timeout 600.
- `generation-lambda.test.ts` — 1 Lambda, 1 EventSourceMapping, environment vars, IAM grants on 2 secrets, Lambda Errors alarm.
- `scheduler-lambda.test.ts` — Lambda always exists; Rule exists ⇔ `enableScheduledJobs=true`; IAM grants on 1 secret + SQS SendMessage.

Pattern (already in use by `infra/test/stack.dev.test.ts`):
```ts
const app = new App();
const stack = new Stack(app, 'TestStack');
new MyConstruct(stack, 'X', { /* props */ });
const template = Template.fromStack(stack);
template.resourceCountIs('AWS::SQS::Queue', 2);
template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 600 });
```

**Per-handler unit tests** (`infra/lambda/src/generation/*.test.ts`):
- `job-message.test.ts` — every parser branch: missing field, wrong type, out-of-range count, unknown trigger, unknown cefrLevel literal, unknown exerciseType.
- `handler.test.ts` — `vi.mock('@language-drill/db')` to stub `runOneCell` and `checkAuditRowState`; assert per-record routing for each Scenario in §Error Handling above (malformed body, curriculum miss, in-progress audit, out-of-scope level, prod-cli guard, runOneCell throw, runOneCell `'failed'`, runOneCell `'succeeded'`).
- `scheduler.test.ts` — stub `db.select()` and `@aws-sdk/client-sqs`; assert message count, batch sizes (≤ 10), `jobId = deterministicUuid([cellKey, batchSeed].join('|'))`, `count = TARGET_PER_CELL - currentCount`, `trigger = 'scheduled'`.

**CLI tests** (`packages/db/scripts/`):
- `generate-exercises-queue.test.ts` — message round-trip, prod-guard, > 100 cells refusal, missing env var, dry-run skips SQS, `--queue + --concurrency` cross-flag rejection.
- `generate-exercises.test.ts` — extended to assert `--queue` mode dispatches to `mainQueue` and never opens a DB connection.

**Package-version parity test** (Req 3.9):
- `infra/lambda/src/generation/aws-sdk-version.test.ts` (new) — at runtime reads both `infra/lambda/package.json` and `packages/db/package.json`, parses each `@aws-sdk/client-sqs` pin via a small semver-major extractor, and asserts the two majors match. The test fails CI if a future `pnpm up @aws-sdk/client-sqs` bumps one without the other. The test is in the Lambda package (rather than the root) because the Lambda already has a vitest config and reads its own `package.json` is trivial.

### Integration Testing

**`packages/db/src/generation/run-one-cell.test.ts`** — the Phase 3 "validator + dedup" `describe.skipIf(!process.env.TEST_DATABASE_URL)` block moves here. Same four scenarios (mixed-outcome batch, dedup-retry happy path, dedup-given-up, validator-failure), now testing the package surface directly.

**`infra/test/stack.snapshot.test.ts`** — refresh the prod snapshot to include:
- 2 new SQS queues + 2 alarms.
- 2 new Lambda functions + their event source mappings.
- 1 new EventBridge rule (prod only).
- 1 new CfnOutput (`GenerationQueueUrl`); the existing `ApiUrl` output is unchanged.

**`infra/test/stack.dev.test.ts` extensions** (per Req 8.10):
- Replace the existing line 113 assertion (`prodTemplate.resourceCountIs("AWS::Events::Rule", 0)`) with `prodTemplate.resourceCountIs("AWS::Events::Rule", 1)`.
- Keep the dev-stack assertion at line 109 (`devTemplate.resourceCountIs("AWS::Events::Rule", 0)`) unchanged — it now asserts what Phase 4 promises (gating).
- Lambda count assertions: dev gains 2 Lambdas (Generation + Scheduler), so the existing `expect(fns).toHaveLength(1)` at line 95 becomes `toHaveLength(3)`. The find-the-API-Lambda lookup needs to be `.find((f) => f.Properties.Description?.includes('hono'))` or similar — pin the exact discriminator in the tasks phase.

The snapshot diff is the gate: any future refactor that changes resource shape forces a visible PR diff.

**`infra/test/stack.dev.test.ts`** — extend to assert:
- The dev stack now contains exactly 2 Lambdas (API + scheduler) — was 1 in Phase 3. Plus the GenerationLambda → 3 Lambdas in dev.
- The dev stack contains 0 `AWS::Events::Rule` resources (the existing test's intent, now load-bearing).
- The prod stack contains exactly 1 `AWS::Events::Rule` (replaces the existing "currently zero" assertion).

### End-to-End Testing (manual smoke before merge)

Required by Req 8.12. Steps:
1. Deploy the dev stack: `cdk deploy LanguageDrillStack-dev` from `infra/`. Capture the `GenerationQueueUrl` output.
2. Set `GENERATION_QUEUE_URL` and `AWS_REGION` in the worktree `.env`.
3. Run `pnpm generate:exercises --queue --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 3 --batch-seed phase-4-smoke`.
4. Observe CloudWatch logs for the GenerationLambda — one structured-JSON log per phase (parse, audit-check, runOneCell start, per-draft validator, audit-row close).
5. Verify in DB: `SELECT id, review_status, quality_score FROM exercises WHERE generation_source='claude-realtime' AND grammar_point_key='es-b1-present-subjunctive' ORDER BY generated_at DESC LIMIT 5`. 2–3 rows match the deterministic per-ordinal IDs derived from the message's `jobId` + `batchSeed`.
6. Verify the audit row: `SELECT id, status, produced_count, approved_count, flagged_count, rejected_count, trigger FROM generation_jobs WHERE id = '<jobId from CLI output>'`. Status `'succeeded'`, trigger `'cli'`, counts non-zero.
7. (Optional) Manually invoke the scheduler Lambda via `aws lambda invoke --function-name LanguageDrillStack-dev-SchedulerLambdaWrap-Handler... /dev/null` and confirm one or more SQS messages appear (visible via CloudWatch logs of the scheduler).

Smoke cost ≈ $0.05 (one cell × 3 drafts × generator + validator); same envelope as Phase 3's smoke. Documented in the PR body alongside the audit-row snapshot.
