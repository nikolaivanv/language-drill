# Implementation Plan

## Task Overview

Phase 4 productionizes the dev-CLI theory generator. The plan delivers six independently testable layers, each layer's last task being its co-located test file:

1. **Job-message contract** (Tasks 1–4) — `infra/lambda/src/theory-generation/job-message.ts` + tests. The typed SQS payload and `checkTheoryAuditRowState` idempotency helper. No AWS, no DB writes — pure parsing + a single SELECT.
2. **Logging helpers** (Tasks 5–6) — `log.ts` + tests. `errMessage` + `summarizeTheoryResult`. Smallest layer; the formula adapts to theory's 0-or-1 cell model.
3. **Consumer Lambda handler** (Tasks 7–10) — `handler.ts` skeleton → guards → soft-deadline + dispatch → tests. The new pattern is the `AbortController` from `context.getRemainingTimeInMillis() - 10_000` with `clearTimeout` in `finally` (PR #79 fix, theory ships ahead of exercises).
4. **Scheduler Lambda** (Tasks 11–13) — `scheduler.ts` skeleton + diff → batch posting → tests. Theory's diff is a `Set<string>` lookup, not a `Map<string, number>` threshold (cells are 0-or-1).
5. **CLI `--queue` path** (Tasks 14–17) — `generate-theory-queue.ts` helper + `--queue` flag wiring + round-trip alignment test. Producer-side message type duplication is intentional (cycle constraint).
6. **CDK constructs + stack wiring** (Tasks 18–24) — three new constructs + their assertions tests + stack changes. The PR #76 `maxConcurrency: reservedConcurrency` assertion is the load-bearing test.
7. **Verification** (Task 25) — repo-root `pnpm lint && pnpm typecheck && pnpm test` plus the manual smoke-test procedure against the dev stack.

Phase 4 ships only after Task 25 is green. Phase 5 (panel registry fallback + admin tile) is downstream and intentionally absent.

## Steering Document Compliance

- **AWS Lambda + SQS + EventBridge + CDK** (`tech.md` §3 Infrastructure, §5 CI/CD): every new file follows the patterns from `infra/lambda/src/generation/` and `infra/lib/constructs/generation-*.ts` shipped on `main` as of 2026-05-12.
- **AWS Secrets Manager with prefix convention** (`tech.md` §12): no new secrets; both Lambdas read from `${secretsPrefix}/{DATABASE_URL,ANTHROPIC_API_KEY}`.
- **Co-located tests** (`CLAUDE.md` §Testing): every test file sits next to the module it tests — `infra/lambda/src/theory-generation/*.test.ts`, `infra/lib/constructs/theory-*.test.ts`, `packages/db/scripts/generate-theory-queue.test.ts`. No orphan test directories.
- **Pre-push gate** (`CLAUDE.md` §Pre-Push Checks): Task 25 runs the three repo-root commands; Phase 4 ships only when green.
- **No new dependencies** (`CLAUDE.md` §Package Management): Phase 4 introduces zero npm packages. `@aws-sdk/client-sqs`, `aws-cdk-lib`, `aws-lambda` types, Vitest, Drizzle — all already on the dependency closure.
- **Package boundaries** (`tech.md` §Monorepo): `infra/lambda/src/theory-generation/` is the consumer side; `packages/db/scripts/generate-theory-queue.ts` is the producer side. The producer never imports from `infra/lambda/` at runtime (cycle constraint); a one-way test-only import edge powers the round-trip alignment test.

## Atomic Task Requirements

Each task below touches ≤ 3 files, fits in 15–30 minutes for an experienced developer, and has a single testable outcome. Tasks 8, 9, 12, 15, and 19 are at the upper end of the box because they compose substantial guard chains, batch-posting logic, or CDK construct properties; they remain single-purpose and reviewable against the design's component definitions.

## Tasks

### Layer 1 — Job-message contract (`infra/lambda/src/theory-generation/job-message.ts`)

- [x] 1. Create `infra/lambda/src/theory-generation/job-message.ts` with types + allowed-value sets
  - File: `infra/lambda/src/theory-generation/job-message.ts` (new)
  - Imports: `CurriculumCefrLevel`, `Db` (type-only), `theoryGenerationJobs` from `@language-drill/db`; `Language`, `type LearningLanguage` from `@language-drill/shared`; `eq` from `drizzle-orm`.
  - Export `type TheoryGenerationJobTrigger = 'cli' | 'scheduled' | 'admin'`.
  - Export `type TheoryGenerationJobMessage` matching design Data Model 1: `jobId: string`, `trigger`, `spec: { language: LearningLanguage; cefrLevel: CurriculumCefrLevel; grammarPointKey: string; batchSeed: string }`, `maxCostUsd: number`. **No `exerciseType`, no `count`, no `topicDomain`.**
  - Export `type TheoryAuditRowState = { status: 'absent' } | { status: 'in-progress' } | { status: 'completed'; jobStatus: 'succeeded' | 'failed' }`.
  - Add module-private constants: `VALID_TRIGGERS = new Set(['cli', 'scheduled', 'admin'])`, `VALID_CEFR_LEVELS = new Set(['A1','A2','B1','B2','C1','C2'])` (forward-compat — round-1 narrowing in handler), `VALID_LANGUAGES = new Set([Language.ES, Language.DE, Language.TR])` (NO `Language.EN`), `BATCH_SEED_MAX_LENGTH = 100`, `MAX_COST_USD_EXCLUSIVE_MAX = 100`.
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: pin the public surface so subsequent tasks (parser, audit-row check, handler, scheduler, CLI helper) compile against a stable contract.
  - _Leverage: `infra/lambda/src/generation/job-message.ts:32-104` (the exercise-side mirror)_
  - _Requirements: 1.1, 1.4_

- [x] 2. Add `parseTheoryGenerationJobMessage` + internal field validators
  - File: `infra/lambda/src/theory-generation/job-message.ts` (modify — continue from Task 1)
  - Add internal helpers: `isPlainObject`, `describe`, `requireNonEmptyString`, `requireUnion`, `requireIntegerInRange` (the integer helper is unused for theory but kept for forward-compat — vendor copy from `generation/job-message.ts:218-295` minus the helpers theory doesn't use; alternatively skip `requireIntegerInRange` since theory has no integer fields). Also add `requireBatchSeed` (non-empty + ≤ 100 chars) and `requireMaxCostUsd` (finite, exclusive `(0, 100)`). All helpers module-private (no `export`).
  - Export `parseTheoryGenerationJobMessage(input: unknown): TheoryGenerationJobMessage`:
    1. If `!isPlainObject(input)` throw `\`TheoryGenerationJobMessage: expected object, got ${describe(input)}\``.
    2. Validate `jobId` (non-empty string), `trigger` (union), `spec` (object).
    3. Inside `spec`: `language` (union, EN rejected via not being in `VALID_LANGUAGES`), `cefrLevel` (union, accepts C1/C2 for forward-compat), `grammarPointKey` (non-empty string), `batchSeed` (≤ 100 chars).
    4. Validate `maxCostUsd` (finite number, `(0, 100)` exclusive).
    5. Return the typed `TheoryGenerationJobMessage`.
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: defensive parsing so a malformed SQS body surfaces a field-level error message in CloudWatch instead of a runtime crash deep in `runOneTheoryCell`.
  - _Leverage: `infra/lambda/src/generation/job-message.ts:119-171` (parseGenerationJobMessage)_
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6_

- [x] 3. Add `checkTheoryAuditRowState` to `job-message.ts`
  - File: `infra/lambda/src/theory-generation/job-message.ts` (modify — continue from Task 2)
  - Export `async function checkTheoryAuditRowState(db: Db, jobId: string): Promise<TheoryAuditRowState>`:
    1. `SELECT status FROM theory_generation_jobs WHERE id = jobId LIMIT 1`.
    2. Zero rows → `{ status: 'absent' }`.
    3. `'succeeded'` or `'failed'` → `{ status: 'completed', jobStatus: status }`.
    4. Anything else (`'running'` or forward-compat `'queued'`) → `{ status: 'in-progress' }`.
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: SQS at-least-once redelivery → audit-row state-machine primitive. The handler uses this before re-running `runOneTheoryCell` on a redelivered message.
  - _Leverage: `infra/lambda/src/generation/job-message.ts:194-212` (checkAuditRowState)_
  - _Requirements: 1.7_

- [x] 4. Write unit tests for `job-message.ts`
  - File: `infra/lambda/src/theory-generation/job-message.test.ts` (new)
  - Mock `@language-drill/db` to expose `theoryGenerationJobs: { id: 'id', status: 'status' }` (the only fields `checkTheoryAuditRowState` references).
  - Tests:
    - `parseTheoryGenerationJobMessage` happy path with a literal known-good message (one per `LearningLanguage`).
    - Field-level error tests: one `it` per malformed field (`jobId` empty, `trigger` invalid, `spec.language === 'EN'`, `spec.cefrLevel === 'D1'`, `spec.grammarPointKey` empty, `spec.batchSeed` empty + > 100 chars, `maxCostUsd` ≤ 0 + ≥ 100 + non-finite). Each asserts the field name appears in the thrown message.
    - `cefrLevel ∈ {C1, C2}` happy-path (forward-compat: parser accepts, handler enforces round-1 elsewhere).
    - `checkTheoryAuditRowState` with mocked `db.select(...).from(...).where(...).limit(...)` returning each of: empty array, one row with `status='running'`, `'queued'`, `'succeeded'`, `'failed'`, `'unknown-future-value'`. Assert each maps to the documented `TheoryAuditRowState`.
  - Run `pnpm --filter @language-drill/lambda test src/theory-generation/job-message` and confirm zero failures.
  - Purpose: contract tests for the parser + audit-row check. Re-runnable without AWS, Claude, or a real DB.
  - _Leverage: `infra/lambda/src/generation/job-message.test.ts` (test layout + DB mock pattern)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 8.3, 8.4_

### Layer 2 — Logging helpers (`infra/lambda/src/theory-generation/log.ts`)

- [x] 5. Create `infra/lambda/src/theory-generation/log.ts` with `errMessage` + `summarizeTheoryResult`
  - File: `infra/lambda/src/theory-generation/log.ts` (new)
  - Imports: `TheoryCellResult` (type-only) from `@language-drill/db`.
  - Export `errMessage(err: unknown): string` — `err instanceof Error ? err.message : String(err)`. Vendor copy from `generation/log.ts:12`.
  - Export `summarizeTheoryResult(r: TheoryCellResult): { inserted: number; approved: number; flagged: number; rejected: number; durationMs: number }`:
    ```ts
    return {
      inserted: r.insertedCount,
      approved: r.insertedCount === 1 && r.flaggedCount === 0 ? 1 : 0,
      flagged: r.flaggedCount,
      rejected: r.rejectedCount,
      durationMs: r.durationMs,
    };
    ```
    **NOTE** the formula differs from the exercise side (`approved = insertedCount - flagged`) because theory cells are 0-or-1 (one row per cell at most).
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: keep the handler's structured-log call sites short and stable.
  - _Leverage: `infra/lambda/src/generation/log.ts` (both helpers — the summarizer formula is adapted)_
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 6. Write unit tests for `log.ts`
  - File: `infra/lambda/src/theory-generation/log.test.ts` (new)
  - Tests:
    - `errMessage(new Error('boom'))` → `'boom'`.
    - `errMessage('string thrown')` → `'string thrown'`.
    - `errMessage({ code: 500 })` → `'[object Object]'` (or whatever `String({})` returns — assert the actual coerced value).
    - `errMessage(undefined)` → `'undefined'`.
    - `summarizeTheoryResult` for the four cell-result combinations: succeeded-auto-approved (insertedCount: 1, flaggedCount: 0, rejectedCount: 0), succeeded-flagged (1, 1, 0), succeeded-rejected (0, 0, 1), succeeded-dedup-skip (0, 0, 0). Assert all four counts + `durationMs` passthrough.
  - Run `pnpm --filter @language-drill/lambda test src/theory-generation/log` and confirm zero failures.
  - Purpose: pin the log-line projection so a future formula refactor can't silently drift the structured-log shape downstream consumers (CloudWatch Insights queries) rely on.
  - _Leverage: `infra/lambda/src/generation/log.test.ts` (test layout)_
  - _Requirements: 6.1, 6.2, 6.3, 8.3_

### Layer 3 — Consumer Lambda handler (`infra/lambda/src/theory-generation/handler.ts`)

- [x] 7. Create `handler.ts` skeleton with cold-start singletons + outer loop + parse branch
  - File: `infra/lambda/src/theory-generation/handler.ts` (new)
  - Imports: `buildTheoryCellKey`, `createDb`, `getGrammarPoint`, `requireEnv`, `runOneTheoryCell`, `THEORY_ROUND_1_CEFR_LEVELS`, `type TheoryCell`, `type TheoryCellResult` from `@language-drill/db`; `createClaudeClient` from `@language-drill/ai`; `type Context`, `type SQSBatchResponse`, `type SQSEvent` from `aws-lambda`; `parseTheoryGenerationJobMessage`, `checkTheoryAuditRowState` from `./job-message`; `errMessage`, `summarizeTheoryResult` from `./log`.
  - Module-level cold-start singletons: `const db = createDb(requireEnv('DATABASE_URL'))`, `const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'))`.
  - Module-private `log(payload: Record<string, unknown>): void` calling `console.log(JSON.stringify(payload))`.
  - Module-private constant: `const SOFT_DEADLINE_SAFETY_MARGIN_MS = 10_000`.
  - Export `async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse>`:
    1. `const batchItemFailures: SQSBatchResponse['batchItemFailures'] = []`.
    2. `for (const record of event.Records) { try { ... } catch (err) { ... } }`.
    3. Inside the outer try: inner try-catch for `parseTheoryGenerationJobMessage(JSON.parse(record.body))`. On parse-fail: `log({ level: 'error', messageId: record.messageId, body: record.body.slice(0, 500), error: errMessage(err), message: 'failed to parse SQS message' })`, push `messageId`, `continue`. (No `parsed` yet at this point — that's why the inner catch lives in the parse step only.)
    4. Outer catch: `log({ level: 'error', messageId: record.messageId, error: errMessage(err), message: 'unhandled error in per-record flow' })`, push `messageId`.
    5. Return `{ batchItemFailures }`.
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: handler shell. All subsequent handler tasks add branches inside the outer try.
  - _Leverage: `infra/lambda/src/generation/handler.ts:21-83, 215-231` (skeleton + cold-start + parse branch + outer catch)_
  - _Requirements: 2.1, 2a.1_

- [x] 8. Add round-1, prod-cli, audit-state, curriculum, kind guards to `handler.ts`
  - File: `infra/lambda/src/theory-generation/handler.ts` (modify — continue from Task 7)
  - After the parse success in the outer try, add five sequential guards in order:
    1. **Round-1 narrowing:** `if (!(THEORY_ROUND_1_CEFR_LEVELS as readonly string[]).includes(parsed.spec.cefrLevel)) { log({ level: 'warn', jobId, messageId, cefrLevel, message: 'out-of-scope CEFR level' }); batchItemFailures.push({ itemIdentifier: messageId }); continue; }`.
    2. **Production-trigger guard:** `if (process.env['ENV_NAME'] === 'production' && parsed.trigger === 'cli') { log({ level: 'warn', jobId, messageId, message: 'rejecting cli-trigger in production' }); push; continue; }`.
    3. **Audit-state check:** `const audit = await checkTheoryAuditRowState(db, parsed.jobId);` then branch on `audit.status`: `'completed'` → `log({ level: 'info', jobId, message: \`already ${audit.jobStatus}; skipping\` })` and `continue` (no push — silent ack); `'in-progress'` → `log({ level: 'warn', jobId, messageId, message: 'already running; deferring' })`, push, continue.
    4. **Curriculum lookup:** `const grammarPoint = getGrammarPoint(parsed.spec.grammarPointKey);` then `if (!grammarPoint) throw new Error(\`grammarPointKey not in curriculum: ${parsed.spec.grammarPointKey}\`)` — outer catch handles it.
    5. **Kind check:** `if (grammarPoint.kind !== 'grammar') { log({ level: 'warn', jobId, messageId, grammarPointKey, kind: grammarPoint.kind, message: 'curriculum entry is not a grammar point' }); push; continue; }`.
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: every failure mode short-circuits with a structured log line + batchItemFailures push before any side-effecting Claude/DB call.
  - _Leverage: `infra/lambda/src/generation/handler.ts:85-149` (the same guards minus the kind check, which is theory-specific)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 9. Add soft-deadline `AbortController` + cell construction + dispatch + result handling
  - File: `infra/lambda/src/theory-generation/handler.ts` (modify — continue from Task 8)
  - After the kind guard, construct the cell:
    ```ts
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
    ```
  - Add soft-deadline setup (the PR #79 zombie-prevention fix):
    ```ts
    const controller = new AbortController();
    const remainingMs = context.getRemainingTimeInMillis();
    const softDeadlineMs = Math.max(
      remainingMs - SOFT_DEADLINE_SAFETY_MARGIN_MS,
      1, // never set a negative timeout
    );
    const timer = setTimeout(() => controller.abort(), softDeadlineMs);
    try {
      // dispatch + result handling here
    } finally {
      clearTimeout(timer);
    }
    ```
  - Inside the `try`: dispatch + result handling.
    1. Call `runOneTheoryCell` in its own try-catch (the orchestrator can throw; `runOneTheoryCell` already accepts `signal?: AbortSignal`):
       ```ts
       let result: TheoryCellResult;
       try {
         result = await runOneTheoryCell({ db, client, cell, args: { batchSeed: parsed.spec.batchSeed, maxCostUsd: parsed.maxCostUsd }, jobId: parsed.jobId, trigger: parsed.trigger, signal: controller.signal });
       } catch (err) {
         log({ level: 'error', jobId: parsed.jobId, messageId: record.messageId, error: errMessage(err), message: 'runOneTheoryCell threw' });
         batchItemFailures.push({ itemIdentifier: record.messageId });
         continue;
       }
       ```
    2. Result dispatch:
       - `result.status === 'succeeded'` → `log({ level: 'info', jobId, ...summarizeTheoryResult(result), message: 'cell succeeded' })`, `continue` (silent ack).
       - Otherwise (`'failed'` or `'skipped-cost-cap'`) → `log({ level: 'warn', jobId, status: result.status, errorMessage: result.errorMessage, message: 'cell terminal-failed' })`, `continue` (silent ack — audit row carries verdict).
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: the actual happy + error-path wiring that closes the per-record flow. The `clearTimeout` in `finally` prevents the timer-leak failure mode flagged in Req 2a.5.
  - _Leverage: `infra/lambda/src/generation/handler.ts:151-214` (cell construction + dispatch + result handling); design Component 2 (soft-deadline pattern)_
  - _Requirements: 2a.2, 2a.3, 2a.4, 2a.5, 2a.6, 2a.7, 2a.8_

- [x] 10. Write unit tests for `handler.ts`
  - File: `infra/lambda/src/theory-generation/handler.test.ts` (new)
  - Mock layout (matching `infra/lambda/src/generation/handler.test.ts:21-58`):
    - `vi.mock('@language-drill/db', async (importOriginal) => { const actual = await importOriginal(); return { ...actual, createDb: vi.fn(() => ({}) as never), requireEnv: vi.fn(name => \`fake-${name}\`), runOneTheoryCell: (...args) => mockRunOneTheoryCell(...args) }; })`.
    - `vi.mock('@language-drill/ai', () => ({ createClaudeClient: vi.fn(() => ({}) as never) }))`.
    - Real `parseTheoryGenerationJobMessage` + `getGrammarPoint` via `importOriginal`.
    - Mock `checkTheoryAuditRowState` from `./job-message` so tests can return each state-machine value.
  - Tests, one `it` per branch:
    - **Parse-fail:** record body `'{"jobId":1}'` (jobId not a string) → response has one `batchItemFailures` entry; truncated body in the logged error.
    - **C1 narrowing:** valid message with `cefrLevel: 'C1'` → `batchItemFailures` push; `runOneTheoryCell` never called.
    - **Prod-cli guard:** `ENV_NAME=production` + `trigger='cli'` → push.
    - **Audit `'completed'`:** mocked `checkTheoryAuditRowState` returns `{ status: 'completed', jobStatus: 'succeeded' }` → silent ack (no push); `runOneTheoryCell` never called.
    - **Audit `'in-progress'`:** push.
    - **Curriculum miss:** `spec.grammarPointKey: 'es-b1-no-such-point'` → outer catch fires, push.
    - **Kind not grammar:** mock `getGrammarPoint` to return `{ kind: 'vocab', ... }` → push, `runOneTheoryCell` never called.
    - **Happy path:** valid message + audit `'absent'` + grammar point resolves → `runOneTheoryCell` called with `signal: controller.signal`; mock returns `status: 'succeeded'`; response has empty `batchItemFailures`.
    - **`runOneTheoryCell` throws:** mock rejects with `new Error('boom')` → push; error message logged.
    - **`runOneTheoryCell` returns `'failed'`:** silent ack (no push); `warn`-level log.
    - **Soft-deadline armed:** spy on `setTimeout`; `mockContext.getRemainingTimeInMillis = () => 30_000` → `setTimeout` called with `20_000` (30 000 − 10 000 ms safety margin).
    - **Soft-deadline cleared on normal completion:** spy on `clearTimeout`; resolves before deadline → `clearTimeout` called with the timer handle.
    - **Soft-deadline fires:** `mockContext.getRemainingTimeInMillis = () => 100`; `runOneTheoryCell` hangs; assert `controller.signal.aborted` becomes `true` mid-call; mock orchestrator returns `status: 'failed'` with the Phase 3 `'Aborted by user (SIGINT)'` message. Handler logs `warn`-level + silent ack.
    - **Soft-deadline cleared on throw:** `runOneTheoryCell` rejects → `clearTimeout` still called (timer-leak prevention).
    - **Safety floor:** `getRemainingTimeInMillis() = 5_000` → `setTimeout` called with `1` (the `Math.max(..., 1)` floor), not with `-5_000`.
  - Run `pnpm --filter @language-drill/lambda test src/theory-generation/handler` and confirm all cases pass.
  - Purpose: pin every routing branch documented in design Component 2 + Error Handling §1–§9.
  - _Leverage: `infra/lambda/src/generation/handler.test.ts` (mock layout + branch tests as the structural template)_
  - _Requirements: 2.1–2.7, 2a.1–2a.8, 8.3, 8.4_

### Layer 4 — Scheduler Lambda (`infra/lambda/src/theory-generation/scheduler.ts`)

- [x] 11. Create `scheduler.ts` skeleton with enumeration + SQL query
  - File: `infra/lambda/src/theory-generation/scheduler.ts` (new)
  - Imports: `ALL_CURRICULA`, `chunk`, `createDb`, `deterministicUuid`, `enumerateTheoryCells`, `requireEnv`, `theoryTopics`, `THEORY_ROUND_1_CEFR_LEVELS`, `type TheoryCell` from `@language-drill/db`; `SendMessageBatchCommand`, `SQSClient` from `@aws-sdk/client-sqs`; `inArray` from `drizzle-orm`; `type TheoryGenerationJobMessage` from `./job-message`.
  - Module-level constants: `const SCHEDULER_PER_CELL_COST_CAP_USD = 0.25`, `const SLOW_QUERY_WARNING_MS = 30_000`, `const MAX_BATCH_SIZE = 10`.
  - Cold-start singletons: `const db = createDb(requireEnv('DATABASE_URL'))`, `const sqs = new SQSClient({ region: requireEnv('AWS_REGION') })`.
  - Module-private `log(payload: Record<string, unknown>): void` (same shape as the handler's).
  - Export `async function handler(): Promise<void>`:
    1. `const startedAt = Date.now()`.
    2. `const queueUrl = requireEnv('THEORY_GENERATION_QUEUE_URL')`.
    3. `const todayUtc = new Date().toISOString().slice(0, 10)`; `const batchSeed = \`theory-scheduled-${todayUtc}\``.
    4. `log({ level: 'info', batchSeed, message: 'theory scheduler started' })`.
    5. `const allCells = enumerateTheoryCells(ALL_CURRICULA)` — vocab umbrellas already filtered upstream.
    6. SQL query (no `GROUP BY` — design Component 3): `const queryStartedAt = Date.now(); const approved = await db.select({ language: theoryTopics.language, grammarPointKey: theoryTopics.grammarPointKey }).from(theoryTopics).where(inArray(theoryTopics.reviewStatus, ['auto-approved', 'manual-approved'])); const queryDurationMs = Date.now() - queryStartedAt;`.
    7. Slow-query warning: `if (queryDurationMs > SLOW_QUERY_WARNING_MS) log({ level: 'warn', durationMs: queryDurationMs, message: \`enumeration query exceeded ${SLOW_QUERY_WARNING_MS}ms warning threshold\` });`.
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: scheduler shell up to the diff. Subsequent task adds the diff + posting + final log.
  - _Leverage: `infra/lambda/src/generation/scheduler.ts:23-111` (skeleton + enumeration + query + slow-query warning)_
  - _Requirements: 3.1, 3.2, 3.8_

- [x] 12. Add Set-based diff + deterministic-jobId message build + `SendMessageBatch` posting
  - File: `infra/lambda/src/theory-generation/scheduler.ts` (modify — continue from Task 11)
  - Build the approved-set: `const approvedSet = new Set<string>(); for (const row of approved) { approvedSet.add(\`${row.language}|${row.grammarPointKey}\`); }`.
  - Diff (theory cells are 0-or-1 — set-membership, not threshold comparison):
    ```ts
    const undersized: TheoryCell[] = [];
    for (const cell of allCells) {
      if (!(THEORY_ROUND_1_CEFR_LEVELS as readonly string[]).includes(cell.cefrLevel)) continue;
      const lookup = `${cell.language}|${cell.grammarPoint.key}`;
      if (!approvedSet.has(lookup)) undersized.push(cell);
    }
    ```
  - Empty-slice fast path: `if (undersized.length === 0) { log({ level: 'info', durationMs: Date.now() - startedAt, message: 'Pool at target — no jobs enqueued' }); return; }`.
  - Build messages with deterministic `jobId`:
    ```ts
    const messages: TheoryGenerationJobMessage[] = undersized.map((cell) => ({
      jobId: deterministicUuid([cell.cellKey, batchSeed].join('|')),
      trigger: 'scheduled',
      spec: {
        language: cell.language,
        cefrLevel: cell.cefrLevel,
        grammarPointKey: cell.grammarPoint.key,
        batchSeed,
      },
      maxCostUsd: SCHEDULER_PER_CELL_COST_CAP_USD,
    }));
    ```
  - Post in batches:
    ```ts
    for (const batch of chunk(messages, MAX_BATCH_SIZE)) {
      await sqs.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((msg, i) => ({ Id: String(i), MessageBody: JSON.stringify(msg) })),
      }));
      log({ level: 'info', batchSize: batch.length, jobIds: batch.map(m => m.jobId), message: 'SendMessageBatch sent' });
    }
    ```
  - Final log: `log({ level: 'info', enqueued: messages.length, durationMs: Date.now() - startedAt, message: 'theory scheduler complete' });`.
  - Run `pnpm --filter @language-drill/lambda typecheck` and confirm zero errors.
  - Purpose: complete the scheduler's enumeration → diff → enqueue flow.
  - _Leverage: `infra/lambda/src/generation/scheduler.ts:113-189` (diff + message build + post + final log)_
  - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 7.3_

- [x] 13. Write unit tests for `scheduler.ts`
  - File: `infra/lambda/src/theory-generation/scheduler.test.ts` (new)
  - Hoisted mocks for `@aws-sdk/client-sqs`: `SQSClient` returns an object whose `send` is the captured `mockSqsSend`; `SendMessageBatchCommand` is a constructor that records its `input`.
  - Partial-stub of `@language-drill/db`: `createDb` + `requireEnv` replaced; `enumerateTheoryCells`, `chunk`, `deterministicUuid`, `THEORY_ROUND_1_CEFR_LEVELS`, `ALL_CURRICULA`, `theoryTopics` real via `importOriginal`.
  - Drizzle chain mock: `db.select(...).from(...).where(...)` terminates with a `mockWhere` returning the per-test approved-row array.
  - Tests:
    - **Empty curriculum slice:** `mockWhere` returns rows for every cell → `undersized.length === 0` → `info` log `Pool at target — no jobs enqueued`; `mockSqsSend` not called.
    - **All cells undersized:** `mockWhere` returns `[]` → every cell in scope is enqueued; total `messages.length` matches `enumerateTheoryCells(ALL_CURRICULA).filter(kind=grammar, cefrLevel∈round1).length`; `mockSqsSend` called `Math.ceil(N / 10)` times with `≤ 10` Entries each.
    - **Partial diff:** `mockWhere` returns rows for the first half of grammar points → only the unmatched ones are enqueued.
    - **C1/C2 skip:** an `ALL_CURRICULA` entry at `cefrLevel: 'C1'` (mocked) is silently filtered out of `undersized`. *(If no real C1 entries exist in the curriculum at test time, drive a fixture path via spying on `THEORY_ROUND_1_CEFR_LEVELS`.)*
    - **Deterministic-jobId same-day re-fire:** call `handler()` twice on the same UTC day; assert both runs produce identical `jobId`s for the same cell. Spy on `Date.now`/`new Date().toISOString()` if the test crosses midnight risk.
    - **Slow-query warning:** spy on `Date.now` to return `0` at query start and `31_000` at query end → `warn`-level log fires.
  - Run `pnpm --filter @language-drill/lambda test src/theory-generation/scheduler` and confirm zero failures.
  - Purpose: pin curriculum enumeration → diff → batch-posting invariants without hitting Postgres or SQS.
  - _Leverage: `infra/lambda/src/generation/scheduler.test.ts` (mock layout + slow-query test pattern)_
  - _Requirements: 3.1–3.9, 7.3, 8.3, 8.4_

### Layer 5 — CLI `--queue` path (`packages/db/scripts/`)

- [x] 14. Create `packages/db/scripts/generate-theory-queue.ts` with `postTheoryCellsToQueue`
  - File: `packages/db/scripts/generate-theory-queue.ts` (new)
  - Imports: `randomUUID` from `node:crypto`; `SendMessageBatchCommand`, `type SQSClient` from `@aws-sdk/client-sqs`; `type LearningLanguage` from `@language-drill/shared`; `chunk`, `type CurriculumCefrLevel`, `type TheoryCell` from `../src`.
  - Export **producer-side mirror** of the consumer-side message type:
    ```ts
    export type TheoryGenerationJobMessage = {
      jobId: string;
      trigger: 'cli' | 'scheduled' | 'admin';
      spec: { language: LearningLanguage; cefrLevel: CurriculumCefrLevel; grammarPointKey: string; batchSeed: string };
      maxCostUsd: number;
    };
    ```
    JSDoc note: must stay in lockstep with `infra/lambda/src/theory-generation/job-message.ts`. Round-trip test (Task 17) enforces alignment.
  - Export `type PostTheoryCellsToQueueArgs = { cells: readonly TheoryCell[]; batchSeed: string; maxCostUsd: number; allowProd: boolean; dryRun: boolean }`.
  - Export `type PostedTheoryJob = { cellKey: string; jobId: string; messageId?: string }`.
  - Constants: `export const MAX_CLI_CELLS_PER_INVOCATION = 100`; `const MAX_BATCH_SIZE = 10`.
  - Export `async function postTheoryCellsToQueue(sqs: SQSClient, queueUrl: string, args: PostTheoryCellsToQueueArgs): Promise<PostedTheoryJob[]>`:
    1. If `args.cells.length > MAX_CLI_CELLS_PER_INVOCATION` throw with the "scheduler is the right tool" hint.
    2. If `!args.allowProd && !queueUrl.includes('-dev-')` throw the prod-substring-guard message.
    3. Build messages with `randomUUID()` for `jobId` (CLI is the "fresh jobs every time" path).
    4. `if (args.dryRun)` print the would-be messages and return without calling SQS.
    5. For each `chunk(messages, MAX_BATCH_SIZE)` send `SendMessageBatchCommand`; print one line per posted message.
  - Run `pnpm --filter @language-drill/db typecheck` and confirm zero errors.
  - Purpose: pure SQS-posting helper. CLI wrapper (Task 16) calls this with an `SQSClient`; tests (Task 17) drive it with a mocked client.
  - _Leverage: `packages/db/scripts/generate-exercises-queue.ts` (the exercise-side mirror — minus exerciseType/topicDomain/count)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 15. Add `--queue` flag to `generate-theory-parse-args.ts`
  - File: `packages/db/scripts/generate-theory-parse-args.ts` (modify)
  - Add `queue: boolean` to `ParsedTheoryArgs`.
  - Read `const queue = raw.get('queue') === 'true'` after the existing `dryRun` parse.
  - Add `--queue` to the HELP_TEXT under "Optional flags" — documented as: "Post one SQS message per resolved cell to the theory generation queue (requires `THEORY_GENERATION_QUEUE_URL` env var). Replaces in-process generation; the scheduler is the right tool for whole-curriculum fills."
  - Return `queue` in the args object.
  - Update the existing JSDoc top-of-file comment to drop the "No `--queue` branch" note (it's no longer accurate post-Phase-4).
  - Run `pnpm --filter @language-drill/db typecheck` and confirm zero errors.
  - Purpose: extend the parsed args without breaking existing callers (queue defaults to `false`).
  - _Leverage: existing `parseTheoryGenerateArgs` structure + `packages/db/scripts/generate-exercises-parse-args.ts` (the exercise-side `--queue` flag)_
  - _Requirements: 4.1, 4.7_

- [x] 16. Wire `--queue` branch into `generate-theory.ts` main
  - File: `packages/db/scripts/generate-theory.ts` (modify)
  - Imports: `SQSClient` from `@aws-sdk/client-sqs`; `postTheoryCellsToQueue` from `./generate-theory-queue`.
  - In `main`, immediately after the parse + cell-resolve step, add:
    ```ts
    if (args.queue) {
      const queueUrl = process.env['THEORY_GENERATION_QUEUE_URL'];
      if (!queueUrl) {
        process.stderr.write('--queue requires THEORY_GENERATION_QUEUE_URL env var\n');
        process.exit(1);
      }
      const sqs = new SQSClient({});
      try {
        await postTheoryCellsToQueue(sqs, queueUrl, {
          cells: resolved.cells,
          batchSeed: args.batchSeed,
          maxCostUsd: args.maxCostUsd,
          allowProd: args.allowProd,
          dryRun: args.dryRun,
        });
        process.exit(0);
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    }
    ```
  - Update the JSDoc top-of-file comment to mention the new `--queue` axis.
  - Run `pnpm --filter @language-drill/db typecheck` and confirm zero errors.
  - Verify: `pnpm generate:theory --help` prints the updated HELP_TEXT including `--queue`.
  - Purpose: branches the CLI between in-process generation (existing) and SQS dispatch (new). The else arm (in-process) is unchanged.
  - _Leverage: `packages/db/scripts/generate-exercises.ts:243-275` (the `args.queue` branch from the exercise CLI)_
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 17. Write tests for `generate-theory-queue.ts` + producer-consumer round-trip
  - File: `packages/db/scripts/generate-theory-queue.test.ts` (new)
  - Imports: `vi`, `describe`, `it`, `expect` from `vitest`; `SendMessageBatchCommand` from `@aws-sdk/client-sqs`; `postTheoryCellsToQueue`, `MAX_CLI_CELLS_PER_INVOCATION` from `./generate-theory-queue`; **the consumer parser** `parseTheoryGenerationJobMessage` from `../../infra/lambda/src/theory-generation/job-message` (one-way test-only edge — runtime modules in `packages/db` never import from `infra/lambda`).
  - Tests:
    - **Happy path 3 cells:** mocked `SQSClient.send`; assert one `SendMessageBatchCommand` with 3 entries; each entry's `MessageBody` parses cleanly through `parseTheoryGenerationJobMessage` and the parsed values match the producer-side message.
    - **> 10 cells:** 15 cells → 2 batches (10 + 5).
    - **--dry-run:** mocked `process.stdout.write` (spy); `sqs.send` never called; returned `PostedTheoryJob[]` has 3 entries with no `messageId`.
    - **Oversized invocation:** 101 cells → throws with `MAX_CLI_CELLS_PER_INVOCATION` mentioned in message.
    - **Prod-substring guard:** queue URL without `-dev-` → throws unless `allowProd: true`.
    - **Prod-substring guard bypass:** `allowProd: true` + non-dev URL → posts normally.
    - **Round-trip alignment:** for each test case that produces a message, run the produced JSON through `parseTheoryGenerationJobMessage` and assert the parsed result deep-equals the producer-side message. Any drift between the two `TheoryGenerationJobMessage` literal types fails this test.
  - Run `pnpm --filter @language-drill/db test scripts/generate-theory-queue` and confirm zero failures.
  - Purpose: every flag combination + the alignment test that prevents the duplicated message-type from drifting.
  - _Leverage: `packages/db/scripts/generate-exercises-queue.test.ts` (test layout); design Component 1 "Producer/consumer type-duplication" note_
  - _Requirements: 4.1–4.7, 8.3, 8.4_

### Layer 6 — CDK constructs (`infra/lib/constructs/`)

- [x] 18. Create `infra/lib/constructs/theory-generation-queue.ts`
  - File: `infra/lib/constructs/theory-generation-queue.ts` (new)
  - Imports: `Duration` from `aws-cdk-lib`; `* as cloudwatch` from `aws-cdk-lib/aws-cloudwatch`; `* as sqs` from `aws-cdk-lib/aws-sqs`; `Construct` from `constructs`.
  - Export `class TheoryGenerationQueueConstruct extends Construct` with `public readonly queue: sqs.Queue`, `public readonly deadLetterQueue: sqs.Queue`, `public readonly dlqDepthAlarm: cloudwatch.Alarm`.
  - Constructor:
    1. `deadLetterQueue` with `retentionPeriod: Duration.days(14)`.
    2. `queue` with `visibilityTimeout: Duration.seconds(900)` (matches Lambda timeout; PR #71 fix), `deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 3 }`.
    3. `dlqDepthAlarm` watching `deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: cloudwatch.Stats.MAXIMUM })`, threshold 1, `GREATER_THAN_OR_EQUAL_TO_THRESHOLD`, `treatMissingData: NOT_BREACHING`, `alarmDescription: 'Phase 4 (theory): ...'`.
  - Run `pnpm --filter @language-drill/infra typecheck` (or the project's equivalent) and confirm zero errors.
  - Purpose: dedicated SQS queue + DLQ + CloudWatch alarm for theory generation. Cell-level theory generation takes ~15–25 s; visibility 900 s leaves ample headroom while matching the Lambda's hard maximum.
  - _Leverage: `infra/lib/constructs/generation-queue.ts` (byte-for-byte mirror with renamed identifiers)_
  - _Requirements: 5.1_

- [x] 19. Create `infra/lib/constructs/theory-generation-lambda.ts`
  - File: `infra/lib/constructs/theory-generation-lambda.ts` (new)
  - Imports: `path`; `Duration` from `aws-cdk-lib`; `* as cloudwatch` from `aws-cdk-lib/aws-cloudwatch`; `Runtime` from `aws-cdk-lib/aws-lambda`; `SqsEventSource` from `aws-cdk-lib/aws-lambda-event-sources`; `* as lambda` from `aws-cdk-lib/aws-lambda-nodejs`; `* as logs` from `aws-cdk-lib/aws-logs`; `* as secretsmanager` from `aws-cdk-lib/aws-secretsmanager`; `* as sqs` from `aws-cdk-lib/aws-sqs`; `Construct` from `constructs`.
  - Export `interface TheoryGenerationLambdaConstructProps { queue: sqs.IQueue; secretsPrefix: string; envName: 'prod' | 'dev'; reservedConcurrency: number; additionalEnv?: Record<string, string> }`.
  - Export `class TheoryGenerationLambdaConstruct extends Construct` with `public readonly handler: lambda.NodejsFunction`, `public readonly errorsAlarm: cloudwatch.Alarm`.
  - Constructor:
    1. `databaseUrl` + `anthropicApiKey` from `secretsmanager.Secret.fromSecretNameV2(this, ..., \`${secretsPrefix}/...\`)`.
    2. `handler = new lambda.NodejsFunction(...)`:
       - `entry: path.join(__dirname, '../../lambda/src/theory-generation/handler.ts')`.
       - `runtime: Runtime.NODEJS_20_X`, `timeout: Duration.seconds(900)` (PR #71), `memorySize: 1024`, `reservedConcurrentExecutions: props.reservedConcurrency`.
       - Bundling: `minify: true`, `sourceMap: true`, `externalModules: ['@aws-sdk/*']`, esbuild aliases for `@language-drill/{shared,db,ai}`.
       - Env: `ENV_NAME`, `DATABASE_URL`, `ANTHROPIC_API_KEY` (`.secretValue.unsafeUnwrap()` matching the exercise side), plus `props.additionalEnv`.
       - `logRetention: logs.RetentionDays.ONE_MONTH`.
    3. `databaseUrl.grantRead(handler)`, `anthropicApiKey.grantRead(handler)`.
    4. `handler.addEventSource(new SqsEventSource(props.queue, { batchSize: 1, reportBatchItemFailures: true, maxConcurrency: props.reservedConcurrency }))` — **`maxConcurrency: reservedConcurrency` is the PR #76 fix; assertion-tested in Task 20**.
    5. `errorsAlarm` watching `handler.metricErrors({ period: Duration.days(1), statistic: SUM })`, threshold 5, `GREATER_THAN_THRESHOLD`.
  - Run `pnpm --filter @language-drill/infra typecheck` and confirm zero errors.
  - Purpose: SQS-consumer Lambda for theory generation. Reserved concurrency 2 keeps the rate-limit budget for the live evaluator (Req 5.2).
  - _Leverage: `infra/lib/constructs/generation-lambda.ts` (byte-for-byte mirror with renamed identifiers + entry path swap)_
  - _Requirements: 5.2_

- [x] 20. Write CDK construct test for queue + lambda
  - Files: `infra/lib/constructs/theory-generation-queue.test.ts` (new), `infra/lib/constructs/theory-generation-lambda.test.ts` (new)
  - Imports: `Stack` from `aws-cdk-lib`; `Match`, `Template` from `aws-cdk-lib/assertions`; `Queue` from `aws-cdk-lib/aws-sqs` (test fixture for the Lambda test); `TheoryGenerationQueueConstruct`, `TheoryGenerationLambdaConstruct` from the constructs.
  - **Queue test:** instantiate the construct under a test `Stack`; `Template.fromStack(stack)` asserts:
    - `AWS::SQS::Queue` with `VisibilityTimeout: 900` (the main queue).
    - `AWS::SQS::Queue` with `MessageRetentionPeriod: 1209600` (14 days; the DLQ).
    - `RedrivePolicy.maxReceiveCount: 3` on the main queue.
    - `AWS::CloudWatch::Alarm` with `Threshold: 1`, `EvaluationPeriods: 1`, `MetricName: ApproximateNumberOfMessagesVisible`.
  - **Lambda test:** instantiate the construct with a fake `Queue` + `secretsPrefix: 'test/'` + `envName: 'dev'` + `reservedConcurrency: 2`. Assertions:
    - `AWS::Lambda::Function` with `Timeout: 900`, `MemorySize: 1024`, `ReservedConcurrentExecutions: 2`, `Runtime: 'nodejs20.x'`.
    - `AWS::Lambda::EventSourceMapping` with `BatchSize: 1`, `FunctionResponseTypes: ['ReportBatchItemFailures']`, **`ScalingConfig: { MaximumConcurrency: 2 }`** (the PR #76 fix — **load-bearing**).
    - IAM grants: the Lambda's role has `secretsmanager:GetSecretValue` on both `test/DATABASE_URL` and `test/ANTHROPIC_API_KEY` ARNs.
    - `AWS::CloudWatch::Alarm` with `Threshold: 5`, `EvaluationPeriods: 1`.
  - Run `pnpm --filter @language-drill/infra test theory-generation-queue theory-generation-lambda` and confirm zero failures.
  - Purpose: CFN-shape pinning for the two infrastructure-critical constructs. The `MaximumConcurrency: 2` assertion is the regression gate for the 2026-05-12 phantom-DLQ failure mode.
  - _Leverage: `infra/lib/constructs/generation-queue.test.ts`, `infra/lib/constructs/generation-lambda.test.ts` (assertion patterns)_
  - _Requirements: 5.1, 5.2, 8.1, 8.2_

- [x] 21. Create `infra/lib/constructs/theory-scheduler-lambda.ts`
  - File: `infra/lib/constructs/theory-scheduler-lambda.ts` (new)
  - Imports: same as `generation-lambda.ts` minus `SqsEventSource`/`cloudwatch`, plus `* as events` from `aws-cdk-lib/aws-events` and `* as targets` from `aws-cdk-lib/aws-events-targets`.
  - Export `interface TheorySchedulerLambdaConstructProps { queue: sqs.IQueue; secretsPrefix: string; enableScheduledJobs: boolean; scheduleExpression?: events.Schedule; additionalEnv?: Record<string, string> }`.
  - Export `class TheorySchedulerLambdaConstruct extends Construct` with `public readonly handler: lambda.NodejsFunction`, `public readonly rule?: events.Rule`.
  - Constructor:
    1. `databaseUrl` secret read (no Anthropic key — scheduler doesn't call Claude).
    2. `handler = new lambda.NodejsFunction(...)`:
       - `entry: path.join(__dirname, '../../lambda/src/theory-generation/scheduler.ts')`.
       - `timeout: Duration.seconds(60)`, `memorySize: 512`.
       - Same bundling shape as the consumer Lambda.
       - Env: `DATABASE_URL`, `THEORY_GENERATION_QUEUE_URL` (= `props.queue.queueUrl`), plus `props.additionalEnv`.
    3. `databaseUrl.grantRead(handler)`, `props.queue.grantSendMessages(handler)`.
    4. **If `props.enableScheduledJobs`**: `rule = new events.Rule(this, 'TheorySchedulerRule', { schedule: props.scheduleExpression ?? events.Schedule.cron({ minute: '0', hour: '4', weekDay: 'MON' }), targets: [new targets.LambdaFunction(handler)], description: 'Phase 4 (theory): weekly refill scheduler — walks the curriculum and enqueues cells missing approved rows.' });` — **note the `weekDay: 'MON'` divergence from the exercise scheduler's daily cron**.
  - Run `pnpm --filter @language-drill/infra typecheck` and confirm zero errors.
  - Purpose: EventBridge-cron-triggered Lambda for the weekly refill. The Lambda is always created (dev can invoke manually); the cron rule is gated.
  - _Leverage: `infra/lib/constructs/scheduler-lambda.ts` (byte-for-byte mirror + cron-expression override)_
  - _Requirements: 5.3, 7.6_

- [x] 22. Write CDK construct test for scheduler Lambda
  - File: `infra/lib/constructs/theory-scheduler-lambda.test.ts` (new)
  - Two test stacks:
    - **`enableScheduledJobs: true`:** assert `AWS::Events::Rule` exists with `ScheduleExpression: 'cron(0 4 ? * MON *)'` (the weekly Monday 04:00 UTC cron), targets the Lambda, description mentions "Phase 4 (theory): weekly refill scheduler".
    - **`enableScheduledJobs: false`:** assert NO `AWS::Events::Rule` resource exists in the CFN output. The Lambda still exists.
  - Both tests also assert: `Timeout: 60`, `MemorySize: 512`, env vars include `THEORY_GENERATION_QUEUE_URL`, IAM has `sqs:SendMessages` on the queue ARN, no `ANTHROPIC_API_KEY` env var, no `secretsmanager:GetSecretValue` on `*/ANTHROPIC_API_KEY`.
  - Run `pnpm --filter @language-drill/infra test theory-scheduler-lambda` and confirm zero failures.
  - Purpose: pin the gating contract for the EventBridge rule + the weekly cadence + minimum-privilege IAM (no Anthropic key in the scheduler).
  - _Leverage: `infra/lib/constructs/scheduler-lambda.test.ts` (assertion patterns)_
  - _Requirements: 5.3, 7.6, 8.1, 8.2_

- [x] 23. Wire theory constructs into `infra/lib/stack.ts` + `CfnOutput`
  - File: `infra/lib/stack.ts` (modify)
  - Imports: add `TheoryGenerationQueueConstruct`, `TheoryGenerationLambdaConstruct`, `TheorySchedulerLambdaConstruct` from `./constructs/theory-*`.
  - After the existing exercise-side `SchedulerLambdaWrap` block, add:
    ```ts
    const theoryQueue = new TheoryGenerationQueueConstruct(
      this,
      "TheoryGenerationQueue",
    );
    new TheoryGenerationLambdaConstruct(this, "TheoryGenerationLambdaWrap", {
      queue: theoryQueue.queue,
      secretsPrefix: props.secretsPrefix,
      envName: props.envName,
      reservedConcurrency: 2,
    });
    new TheorySchedulerLambdaConstruct(this, "TheorySchedulerLambdaWrap", {
      queue: theoryQueue.queue,
      secretsPrefix: props.secretsPrefix,
      enableScheduledJobs: props.enableScheduledJobs,
    });
    ```
  - Add the `CfnOutput` next to the existing `GenerationQueueUrl`:
    ```ts
    new CfnOutput(this, "TheoryGenerationQueueUrl", {
      value: theoryQueue.queue.queueUrl,
      description:
        "SQS queue URL for theory generation (Phase 4). Set THEORY_GENERATION_QUEUE_URL to this for `pnpm generate:theory --queue`.",
    });
    ```
  - Run `pnpm --filter @language-drill/infra typecheck` and confirm zero errors.
  - Optional: snapshot-update if the stack uses snapshot tests (`pnpm --filter @language-drill/infra test -- -u`); inspect the diff to confirm only theory-side resources are added (no drift on the exercise constructs).
  - Purpose: instantiate the theory pipeline alongside the exercise pipeline. Reuses the existing `enableScheduledJobs` flag (Req 7.5 — single source of truth for both pipelines' cron gating).
  - _Leverage: `infra/lib/stack.ts:57-81` (the existing exercise-side construct wiring)_
  - _Requirements: 5.4, 5.5, 7.5_

- [x] 24. Add an AWS-SDK-version pin test (theory side)
  - File: `infra/lambda/src/theory-generation/aws-sdk-version.test.ts` (new)
  - Pattern: read `infra/lambda/package.json` `dependencies['@aws-sdk/client-sqs']` and assert it starts with `'^3.'` (allow minor/patch bumps; pin the major). This prevents accidental downgrade / pre-v3 reintroduction.
  - Run `pnpm --filter @language-drill/lambda test src/theory-generation/aws-sdk-version` and confirm zero failures.
  - Purpose: regression gate matching `infra/lambda/src/generation/aws-sdk-version.test.ts`. Same dep, same assertion.
  - _Leverage: `infra/lambda/src/generation/aws-sdk-version.test.ts` (byte-for-byte mirror)_
  - _Requirements: 8.3_

### Layer 7 — Verification

- [x] 25. Pre-push gate + manual smoke-test procedure (`cdk deploy` to dev)
  - File: (verification only — no code changes)
  - **Repo-root pre-push:**
    - `pnpm lint` — expect zero warnings, zero errors. Likely failure surfaces: unused imports in `theory-generation/{handler,scheduler}.ts`, missing return types on `log` helpers, `any` in test files.
    - `pnpm typecheck` — expect zero errors. Likely failure surfaces: missing field on `TheoryGenerationJobMessage` producer/consumer mismatch (Task 17's round-trip test catches this earlier), missing `Context` import in `handler.ts`.
    - `pnpm test` — expect every test green. Verify the new files run: `theory-generation/job-message.test.ts`, `theory-generation/log.test.ts`, `theory-generation/handler.test.ts`, `theory-generation/scheduler.test.ts`, `theory-generation/aws-sdk-version.test.ts`, `generate-theory-queue.test.ts`, `theory-generation-queue.test.ts`, `theory-generation-lambda.test.ts`, `theory-scheduler-lambda.test.ts`.
  - **Manual smoke test against the dev stack (after `cdk deploy LanguageDrillStack-dev`):**
    1. Copy the `TheoryGenerationQueueUrl` value from the CloudFormation outputs (or `cdk deploy` log).
    2. `export THEORY_GENERATION_QUEUE_URL='<url-from-step-1>'`.
    3. Pick a grammar point that does NOT have an approved row yet on the dev branch (`SELECT grammar_point_key FROM theory_topics WHERE language='ES' AND review_status IN ('auto-approved','manual-approved')` — pick a curriculum key NOT in the result).
    4. Run `pnpm generate:theory --lang es --grammar-point <key> --queue`. Expect one log line: `Posted job <jobId> for <cellKey> (trigger=cli)`.
    5. Within ~30 s, CloudWatch Insights query against `/aws/lambda/LanguageDrillStack-dev-TheoryGenerationLambdaWrap...`: `fields @timestamp, level, jobId, message, inserted, durationMs | sort @timestamp desc | limit 20`. Expect a `cell succeeded` line with `inserted: 1`.
    6. SELECT against the dev Neon branch: `SELECT review_status, generated_at FROM theory_topics WHERE grammar_point_key = '<key>'`. Expect one new row.
    7. Manually invoke the scheduler Lambda via the AWS console with test event `{}`. Expect `Pool at target` if all ES round-1 cells now have rows, OR a batch of `SendMessageBatch sent` followed by consumer-Lambda invocations on the remaining cells.
  - Commit and push.
  - Purpose: the ship gate. Phase 4 is not done until repo-root pre-push is green AND the manual smoke test passes against the dev stack.
  - _Leverage: `CLAUDE.md` §Pre-Push Checks; design Testing Strategy §End-to-End Testing_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
