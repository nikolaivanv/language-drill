# Implementation Plan

## Task Overview

Phase 4 ships in ten thin layers, each independently mergeable. The order is "shared helpers first, then orchestration extraction, then producers/consumers, then CDK glue, then operator-facing surfaces" — every task leaves the codebase compiling, linting clean, and passing every existing Phase 3 test.

1. **Shared helpers** (Tasks 1–4) — `requireEnv` move + `chunk`/`buildCellKey`/`enumerateCurriculumCells` helpers + `ROUND_1_CEFR_LEVELS`. These unblock both the orchestration extraction and the Lambda code that follows.
2. **`runOneCell` extraction** (Tasks 5–8) — create the new module as dead-code first (Task 5, fully green), swap the CLI's imports + delete the in-script copy + bridge SIGINT to `AbortController` (Task 6, fully green), move the Phase 3 integration tests (Task 7), ship the package barrel (Task 8).
3. **Message schema + idempotency** (Tasks 9–10) — `GenerationJobMessage` type + `parseGenerationJobMessage` + `checkAuditRowState` helper, then their co-located tests.
4. **Lambda handler** (Tasks 11–13) — `log.ts` helpers, `handler.ts` per-record flow with the Req 2.4-amendment routing, then handler tests with mocked `runOneCell`.
5. **Scheduler handler** (Tasks 14–15) — `scheduler.ts` (curriculum enumeration + SQL aggregate + in-memory diff + SendMessageBatch loop) + tests with mocked DB and SQS client.
6. **Package deps + parity test** (Tasks 16–17) — add `@aws-sdk/client-sqs` and `@types/aws-lambda` to both `infra/lambda` and `packages/db` `package.json`s, then the major-version parity test required by Req 3.9.
7. **CDK constructs** (Tasks 18–23) — three constructs in pairs (source + co-located test): `GenerationQueueConstruct` with DLQ alarm; `GenerationLambdaConstruct` with the SQS event source + Errors alarm + log retention; `SchedulerLambdaConstruct` with the conditional EventBridge rule.
8. **Stack wiring + test extensions** (Tasks 24–26) — wire the new constructs into `LanguageDrillStack`, add `CfnOutput`, update the dev-stack assertion test (Lambda count 1→3, prod EventBridge rule 0→1), refresh the snapshot test.
9. **CLI `--queue` mode** (Tasks 27–30) — argument-parser flags, `postCellsToQueue` helper, `mainQueue` dispatch in `generate-exercises.ts`, queue-test file.
10. **Pre-merge gates + manual smoke** (Tasks 31–32) — repo-level pre-push gate (with `cdk synth` for both stacks, `cdk diff` against deployed prod, `packages/ai` no-change assertion, CI-workflow audit), then a one-shot deploy + smoke against the dev stack.

## Steering Document Compliance

- **CDK + Lambda + Hono pattern** (`CLAUDE.md` §"Tech Stack"): every new construct mirrors the existing `LambdaConstruct` / `QueueConstruct` patterns. New Lambda handlers follow the existing `infra/lambda/src/{routes,middleware,lib}/` file-by-feature shape, adding a sibling `infra/lambda/src/generation/`.
- **Forward-only migrations** (`CLAUDE.md` §"CI/CD"): Phase 4 ships **zero** schema migrations. The `generation_jobs.trigger` column already accepts `'cli' | 'scheduled' | 'admin'` from Phase 1.
- **Co-located tests** (`CLAUDE.md` §Testing): every new construct, handler, helper has its test file next to the module. Phase 3's `runOneCell` integration tests move with the orchestration core.
- **Shared package surface for orchestration** (Phase 3 reuse): `runOneCell` lives in `packages/db/src/generation/`, not in `packages/db/scripts/lib/` or `infra/lambda/src/lib/` — Component 1's design rationale.
- **Tests-before-merge**: every task that touches code closes by running `pnpm test --filter <package>` for the affected package. The phase-level pre-push (`pnpm lint && pnpm typecheck && pnpm test` from the repo root) runs in Task 31.
- **Green at every task boundary**: no task leaves the codebase non-compiling or with failing tests. The `runOneCell` extraction (Tasks 5–6) achieves this by introducing the new module as dead code in Task 5, then atomically swapping the CLI's call sites in Task 6 — both states pass the pre-push gate.
- **No dependency-graph regression**: existing `packages/db` → `packages/ai` edge stays the only cross-package edge in `packages/`. New Lambda code (`infra/lambda/`) imports from `@language-drill/{db,ai,shared}` exclusively — no deep relative imports across the boundary. Task 31's pre-push gate verifies `packages/ai/src/` has zero `git diff` against the merge base (Req 7.6).

## Atomic Task Requirements

Each task below touches ≤ 3 files, is bounded to 15–30 minutes for an experienced developer, and has a single testable outcome. Tasks 5 and 6 (the `runOneCell` extraction) are at the upper end of the box because each carries ~150 LOC of pattern-matched moves; they remain single-file-or-small-set, single-purpose, and trivially reviewable against design Component 1's symbols-migration table.

## Tasks

### Layer 1 — Shared helpers (`packages/db/src/lib/`)

- [x] 1. Move `requireEnv` from `packages/db/scripts/env-helpers.ts` to `packages/db/src/lib/env.ts`
  - File: `packages/db/src/lib/env.ts` (new)
  - File: `packages/db/scripts/env-helpers.ts` (modify — re-export from `../src/lib/env` for back-compat with Phase 3 callers)
  - File: `packages/db/src/index.ts` (modify — add `export { requireEnv } from './lib/env';`)
  - Move the function body verbatim from `packages/db/scripts/env-helpers.ts` into `packages/db/src/lib/env.ts`. The signature `requireEnv(name: string): string` is unchanged. The script-side file becomes a one-line re-export so existing Phase 3 imports (`import { requireEnv } from './env-helpers';`) keep working.
  - Run `pnpm --filter @language-drill/db typecheck` and `pnpm --filter @language-drill/db test` — every Phase 3 test that imports `requireEnv` MUST still pass without source change.
  - Purpose: make `requireEnv` importable by the Lambda (`@language-drill/db` barrel), since `packages/db/scripts/` is not in the Lambda's bundling tree.
  - _Leverage: existing `requireEnv` from Phase 3 (`packages/db/scripts/env-helpers.ts:14-20`)_
  - _Requirements: design Component 3 helper consolidation_

- [x] 2. Add `chunk` helper to `packages/db/src/lib/chunk.ts` + co-located tests
  - File: `packages/db/src/lib/chunk.ts` (new)
  - File: `packages/db/src/lib/chunk.test.ts` (new)
  - File: `packages/db/src/index.ts` (modify — add `export { chunk } from './lib/chunk';`)
  - Implement `export function chunk<T>(arr: readonly T[], size: number): T[][]`. Throws when `size <= 0`. Empty input returns empty array. The function uses a `for (let i = 0; i < arr.length; i += size)` + `arr.slice(i, i + size)` pattern. Pure, no dependencies.
  - Test cases: empty input → `[]`; size 1 → array of singletons; size larger than input → one batch containing the whole input; exact-multiple input → no trailing partial batch; non-multiple input → final partial batch.
  - Purpose: SQS `SendMessageBatchCommand` batches of ≤ 10. Used by both the scheduler (Component 4) and the CLI's `--queue` mode (Component 9).
  - _Leverage: none — small standalone utility_
  - _Requirements: design Component 4, design Component 9_

- [x] 3. Add `buildCellKey` + `buildCellKeyFromRow` helpers to `packages/db/src/lib/cell-key.ts` + tests
  - File: `packages/db/src/lib/cell-key.ts` (modify — adjacent to existing `assertValidCellKey`)
  - File: `packages/db/src/lib/cell-key.test.ts` (new — or modify if already exists)
  - File: `packages/db/src/index.ts` (modify — add `export { buildCellKey, buildCellKeyFromRow }` to the existing `cell-key` re-export line)
  - Implement `buildCellKey({ language, cefrLevel, exerciseType, grammarPointKey }): string` returning `\`${language.toLowerCase()}:${cefrLevel.toLowerCase()}:${exerciseType.toLowerCase()}:${grammarPointKey}\``. Implement `buildCellKeyFromRow(row: { language: string | null; difficulty: string | null; type: string | null; grammarPointKey: string | null }): string` calling `buildCellKey` after coercing each null to a sentinel that fails `assertValidCellKey` (e.g. `'?'`) — so a row with NULL columns produces an invalid cellKey that the scheduler can detect and skip.
  - Test cases: round-trip with `assertValidCellKey` (the result is always a valid key when inputs are non-null); null-handling for `buildCellKeyFromRow`.
  - Purpose: a single canonical cell-key formatter consumed by the Lambda handler (resolving message → cellKey for `runOneCell`), the scheduler (cellKey for the `Map<cellKey, count>`), and the existing `resolveCells` (which currently builds the key inline).
  - _Leverage: existing `assertValidCellKey` (`packages/db/src/lib/cell-key.ts`); existing inline cellKey construction in `packages/db/scripts/generate-exercises-resolve-cells.ts`_
  - _Requirements: design Component 3, design Component 4_

- [x] 4. Add `ROUND_1_CEFR_LEVELS` + `enumerateCurriculumCells` to `packages/db/src/generation/cells.ts`, refactor `resolveCells` to delegate
  - File: `packages/db/src/generation/cells.ts` (new)
  - File: `packages/db/src/generation/cells.test.ts` (new)
  - File: `packages/db/scripts/generate-exercises-resolve-cells.ts` (modify — delegate cross-product to `enumerateCurriculumCells`)
  - Define and export `ROUND_1_CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const` + the matching type alias `Round1CefrLevel = typeof ROUND_1_CEFR_LEVELS[number]`. Define and export `enumerateCurriculumCells(curricula: readonly GrammarPoint[]): Cell[]` reproducing the cross-product `resolveCells` builds today: every grammar point × every compatible exercise type (vocab umbrellas only with `vocab_recall`; grammar points with `cloze | translation`); the cell's CEFR level comes from the grammar point's `cefrLevel`. The output `Cell` type is reused unchanged from `packages/db/scripts/generate-exercises-resolve-cells.ts`.
  - Refactor `resolveCells` to call `enumerateCurriculumCells(curricula)` for the universe, then layer on its argument-driven slicing (filter by `--lang`, `--level`, `--type`, `--grammar-point`) on top of the universe. This eliminates the drift risk between the scheduler's enumeration (Task 14) and the CLI's resolution (design Component 4 closing note).
  - Tests: `enumerateCurriculumCells(ALL_CURRICULA)` count matches `resolveCells({ type: 'all', grammarPoint: null, ... })` count for every supported `(language, level)` slice (the canonical-implementation invariant); kind compatibility matches Phase 2 (every vocab cell has `exerciseType === 'vocab_recall'`; every grammar cell has `exerciseType ∈ {cloze, translation}`).
  - Run `pnpm --filter @language-drill/db test` — every Phase 2/3 test for `resolveCells` MUST still pass without test-source changes.
  - Purpose: scheduler imports `enumerateCurriculumCells` to compute the universe of cells; Lambda imports `ROUND_1_CEFR_LEVELS` for its message guard; the CLI's existing `resolveCells` becomes a thin slice-by-args wrapper.
  - _Leverage: `packages/db/scripts/generate-exercises-resolve-cells.ts` (cross-product logic to extract); `ALL_CURRICULA` from `packages/db/src/curriculum/index.ts`_
  - _Requirements: 4.5, 2.7_

### Layer 2 — `runOneCell` extraction

- [x] 5. Create `packages/db/src/generation/run-one-cell.ts` with the full extracted implementation (dead code, fully green)
  - File: `packages/db/src/generation/run-one-cell.ts` (new)
  - Create the new file with the full extracted implementation: the bodies of `runOneCell`, `validateAndInsertWithRetry`, `runRetryGeneration`, `failClosed`, the `MAX_DEDUP_RETRIES = 3` constant, and the `DraftOutcome` + `RunOneCellInput` types. Copy each body byte-identically from `packages/db/scripts/generate-exercises.ts` (lines 165, 167-184, 186-195, 202-214, 216-344, 353-525, 538-574). Imports follow them: `validateDraft`, `routeValidationResult`, `canonicalSurface`, `addUsage`, `ZERO_USAGE`, `ClaudeUsageBreakdown`, the schema imports, `deterministicUuid`. The skill-topic precheck inside `runOneCell` (lines 367-386) moves with the function.
  - Apply the four design-Component-1 caller-shape changes in this single task (since the new module is dead code, no external callers break):
    1. `runOneCell` signature takes a single `RunOneCellInput` object with `db`, `client`, `cell`, `args: { count, batchSeed, topicDomain, maxCostUsd }`, `jobId: string`, `trigger: 'cli' | 'scheduled' | 'admin'`, `signal?: AbortSignal`.
    2. `validateAndInsertWithRetry`'s `RunOneCellOpts` updates in lockstep — `args: ParsedArgs` becomes the same narrow `args: { count, batchSeed, topicDomain, maxCostUsd }` shape (only `args.topicDomain` is read inside the helper).
    3. Every `if (aborted)` site (six sites: top of `runOneCell`'s try, after `generateBatch` resolves, top of the per-ordinal loop, top of every `validateAndInsertWithRetry` retry-loop iteration, before each `validateDraft` call, inside `runRetryGeneration`) is replaced by `if (signal?.aborted) throw new Error('Aborted by user (SIGINT)')`. Error message stays byte-identical so existing `/Aborted by user/` test matchers still pass.
    4. The internal `randomUUID` call (Phase 3 line 360) is removed; the audit row uses `opts.jobId` from the caller.
  - Do NOT modify `packages/db/scripts/generate-exercises.ts` in this task — the script's existing in-file `runOneCell` continues to drive the CLI tests. The new module is dead code at the end of this task; Task 6 makes it live.
  - Run `pnpm --filter @language-drill/db typecheck` — passes (the new module compiles in isolation; the script is untouched). Run `pnpm --filter @language-drill/db test` — every Phase 3 test still passes (they exercise the script's local copy).
  - Purpose: introduce the new module as dead code so the swap in Task 6 is a localized, reviewable change. After this task lands, the codebase is fully green; the new module is reachable but unused.
  - _Leverage: Phase 3's existing `runOneCell` body in `packages/db/scripts/generate-exercises.ts:158-525, 538-574` (move verbatim except the four signature changes)_
  - _Requirements: 7.1, 7.2, 7.7_

- [x] 6. Switch `generate-exercises.ts` to import the extracted `runOneCell`, delete the in-script copy, bridge SIGINT to `AbortController`
  - File: `packages/db/scripts/generate-exercises.ts` (modify)
  - Add `import { runOneCell, type CellResult, type RunOneCellInput } from '../src/generation/run-one-cell';`. Delete the script's now-redundant copies of `runOneCell`, `validateAndInsertWithRetry`, `runRetryGeneration`, `failClosed`, `MAX_DEDUP_RETRIES`, `DraftOutcome`, `RunOneCellOpts` (the same lines that were copied into the new file in Task 5). Delete the `randomUUID` import if unused after the deletion; otherwise keep it for the CLI's per-cell `jobId` derivation.
  - Replace the `let aborted = false; process.on('SIGINT', () => { aborted = true; })` pattern in `main` with `const abortController = new AbortController(); process.on('SIGINT', () => abortController.abort());`. The `aborted` references that remain in CLI-only code paths (`runWithCostCap`'s cost-cap-and-skip check, `failClosed` return values for skipped cells) become `abortController.signal.aborted`.
  - Update every `runOneCell(db, client, cell, args)` call site in the script to construct the new `RunOneCellInput` object: `{ db, client, cell, args: { count: args.count, batchSeed: args.batchSeed, topicDomain: args.topicDomain, maxCostUsd: args.maxCostUsd / cellCount }, jobId: randomUUID(), trigger: 'cli', signal: abortController.signal }`. The `maxCostUsd` per-cell allocation is the existing Phase 3 behavior.
  - Run `pnpm --filter @language-drill/db typecheck` — passes. Run `pnpm --filter @language-drill/db test` — every Phase 3 test that exercises the CLI's `main` path MUST still pass without test-source changes (tests assert on the audit-row contents, exercise rows, summary output — none of which change).
  - Purpose: the CLI is now the first consumer of the extracted `runOneCell`. After this task lands, the CLI's local-run path drives the new shared orchestration; the codebase is fully green; the new module is live.
  - _Leverage: Task 5; Phase 3 SIGINT handling in `packages/db/scripts/generate-exercises.ts:78-94, 466-468`_
  - _Requirements: 7.4, 7.5, 7.7_

- [x] 7. Move Phase 3 integration tests to `packages/db/src/generation/run-one-cell.test.ts`
  - File: `packages/db/src/generation/run-one-cell.test.ts` (new)
  - File: `packages/db/scripts/generate-exercises.test.ts` (modify — delete the moved `describe('Phase 3: validator + dedup', ...)` block)
  - Move the four DB-touching integration tests (mixed-outcome batch, dedup-retry happy path, dedup-given-up path, validator-failure path) from `generate-exercises.test.ts` to `run-one-cell.test.ts`. Update imports: `runOneCell`/`CellResult` come from `../../src/generation/run-one-cell`; `cleanCellRows` + the test fixtures move with the tests; `parseGenerateArgs` and `resolveCells` references that the tests use to construct args remain script-side (the tests can build a `Cell` directly without going through the CLI parser).
  - Update each test's `runOneCell` invocation to use the new `RunOneCellInput` shape (build the Cell directly via `getGrammarPoint` + the new helpers from Tasks 3-4, set `jobId = randomUUID()`, `trigger: 'cli'`, `args: { count: ..., batchSeed: ..., topicDomain: null, maxCostUsd: 5 }`).
  - Run `TEST_DATABASE_URL=<dev-branch> MOCK_CLAUDE=1 pnpm --filter @language-drill/db test run-one-cell` — the four tests MUST pass. Run `pnpm --filter @language-drill/db test` — Phase 3's other tests (parseGenerateArgs, resolveCells, the local-run integration tests at the top of `generate-exercises.test.ts`) MUST still pass.
  - Purpose: the integration tests now live next to the orchestration core, making the package self-testable without the script.
  - _Leverage: Phase 3's `Phase 3: validator + dedup` block in `packages/db/scripts/generate-exercises.test.ts`_
  - _Requirements: 7.5, 8.8_

- [x] 8. Add `packages/db/src/generation/index.ts` barrel + re-export from `packages/db/src/index.ts`
  - File: `packages/db/src/generation/index.ts` (new)
  - File: `packages/db/src/index.ts` (modify — add `export * from './generation';`)
  - The barrel exports: `runOneCell`, `CellResult`, `DraftOutcome`, `RunOneCellInput` (from `run-one-cell`); `ROUND_1_CEFR_LEVELS`, `Round1CefrLevel`, `enumerateCurriculumCells`, `Cell` (from `cells`).
  - Run `pnpm --filter @language-drill/db typecheck` — package barrel resolves cleanly. From a sibling test file or repl, confirm `import { runOneCell } from '@language-drill/db'` works (the worktree's pnpm workspace resolves `@language-drill/db` against `packages/db/src/index.ts` per the `LambdaConstruct` esbuild aliases).
  - Purpose: stable, additive public surface for the Lambda + the CLI. Phase 4b / Phase 5 / Phase 6 attach against this barrel.
  - _Leverage: existing `packages/db/src/index.ts` barrel structure (Phase 1-3)_
  - _Requirements: 7.3, 9.2_

### Layer 3 — `GenerationJobMessage` schema, parser, audit-row idempotency

- [x] 9. Create `infra/lambda/src/generation/job-message.ts` with type + parser + `checkAuditRowState`
  - File: `infra/lambda/src/generation/job-message.ts` (new)
  - Define and export the `GenerationJobMessage` type per design Component 2 (re-using `CurriculumCefrLevel` from `@language-drill/db`, `LearningLanguage` and `ExerciseType` from `@language-drill/shared`). Define and export `parseGenerationJobMessage(input: unknown): GenerationJobMessage` — pure runtime validator that throws `Error('<field>: <reason>, got <JSON.stringify(value)>')` on every shape error. Mirror of `parseValidationResult` in `packages/ai/src/validate.ts`. Validate every field including `cefrLevel ∈ ['A1','A2','B1','B2','C1','C2']` (the full `CurriculumCefrLevel` literal set — round-1 narrowing happens in the handler, NOT in the parser, so future Phase 6 messages parse cleanly).
  - Validate ranges: `count ∈ [1, 200]`, `batchSeed` non-empty and ≤ 100 chars, `maxCostUsd ∈ (0, 100)`.
  - Define and export `AuditRowState` discriminated union and `checkAuditRowState(db, jobId): Promise<AuditRowState>`. The function issues `SELECT status FROM generation_jobs WHERE id = ${jobId}` (Drizzle), and returns `{status: 'absent'}` when the row is missing, `{status: 'completed', jobStatus: 'succeeded'|'failed'}` when finished, `{status: 'in-progress'}` when still `'running'`.
  - Purpose: locked SQS message contract + the audit-row idempotency primitive that Req 2.9 keys off.
  - _Leverage: `parseValidationResult` shape from `packages/ai/src/validate.ts`; `generationJobs` schema from `packages/db/src/schema/generation.ts`; `Db` type from `packages/db/src/client.ts`_
  - _Requirements: 2.1, 2.2, 2.9_

- [x] 10. Create `infra/lambda/src/generation/job-message.test.ts`
  - File: `infra/lambda/src/generation/job-message.test.ts` (new)
  - Tests for `parseGenerationJobMessage`: missing each required field throws naming the field; wrong type per field throws; out-of-range `count` (0, 201) throws; unknown `trigger` value throws; unknown `cefrLevel` literal throws; unknown `exerciseType` throws; non-empty-string `batchSeed > 100 chars` throws; `maxCostUsd ≤ 0` and `≥ 100` throws; valid round-1 message round-trips byte-identically; valid `cefrLevel='C1'` message parses cleanly (Phase 6 forward-compat).
  - Tests for `checkAuditRowState`: `vi.mock` the Db's `select(...)` to return each of the three states (`[]`, `[{status:'running'}]`, `[{status:'succeeded'}]`, `[{status:'failed'}]`); assert the helper returns `{status:'absent'}`, `{status:'in-progress'}`, `{status:'completed', jobStatus:'succeeded'}`, `{status:'completed', jobStatus:'failed'}` respectively.
  - Run `pnpm --filter @language-drill/lambda test job-message` — every assertion passes.
  - Purpose: pin every parser and idempotency-helper invariant before the handler depends on them.
  - _Leverage: Task 9; `vi.mock` patterns from existing `infra/lambda/src/middleware/auth.test.ts`_
  - _Requirements: 8.4_

### Layer 4 — Lambda handler

- [x] 11. Create `infra/lambda/src/generation/log.ts` with `errMessage` + `summarizeResult`
  - File: `infra/lambda/src/generation/log.ts` (new)
  - File: `infra/lambda/src/generation/log.test.ts` (new)
  - Implement `errMessage(err: unknown): string` returning `err instanceof Error ? err.message : String(err)`. Implement `summarizeResult(r: CellResult): { inserted: number; approved: number; flagged: number; rejected: number; dedupGivenUp: number; durationMs: number }` picking the count fields from a successful CellResult — `approved = r.insertedCount - r.flaggedCount`, others as-named.
  - Tests cover both helpers including non-Error values (`null`, `'plain string'`, `123`) for `errMessage` and the arithmetic for `summarizeResult`.
  - Run `pnpm --filter @language-drill/lambda test log` — every assertion passes.
  - Purpose: tiny utility module so the handler stays focused on routing.
  - _Leverage: Phase 3's `CellResult` type from `@language-drill/db`_
  - _Requirements: design Component 3 helper consolidation_

- [x] 12. Create `infra/lambda/src/generation/handler.ts` with the SQS event-source handler
  - File: `infra/lambda/src/generation/handler.ts` (new)
  - Implement the SQS event-source `handler(event: SQSEvent): Promise<SQSBatchResponse>` per design Component 3. Module-level state: one `db` (created at module load via `createDb(requireEnv('DATABASE_URL'))`) and one `client` (`createClaudeClient(requireEnv('ANTHROPIC_API_KEY'))`). For each record: try/catch around the entire per-record flow; parse via `parseGenerationJobMessage`; round-1 CEFR guard via `ROUND_1_CEFR_LEVELS.includes(...)`; production-trigger guard (`process.env['ENV_NAME'] === 'production' && trigger === 'cli'`); audit-row idempotency check via `checkAuditRowState`; curriculum lookup via `getGrammarPoint`; cell construction via `buildCellKey` + the new helpers; dispatch to `runOneCell({ db, client, cell, args, jobId, trigger })`; on `result.status === 'succeeded'` log and continue; on `result.status === 'failed' | 'skipped-cost-cap'` log and continue (Req 2.4 amendment — do NOT add to batchItemFailures); on any thrown error before/during `runOneCell` log and add `messageId` to `batchItemFailures`.
  - **Truncate-to-500 rule (Req 2.5):** on parse failure, the body in the log line SHALL be `record.body.slice(0, 500)`. This bounds CloudWatch log injection from arbitrarily-large malformed payloads.
  - All log lines are structured JSON via `console.log(JSON.stringify({...}))` with `level`, `jobId` (when known), `messageId` (when known), `message`. Required fields per design Component 3.
  - Purpose: the SQS-consumer Lambda's entry point. Thin shell around `runOneCell`.
  - _Leverage: Tasks 1-8 (shared helpers + extracted runOneCell); Task 9 (job-message parser + idempotency); Task 11 (log helpers); existing Lambda module-level pattern from `infra/lambda/src/index.ts`_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 13. Create `infra/lambda/src/generation/handler.test.ts` with mocked `runOneCell`
  - File: `infra/lambda/src/generation/handler.test.ts` (new)
  - Use `vi.mock('@language-drill/db', ...)` to stub `runOneCell` and `checkAuditRowState`; `vi.mock('@language-drill/ai', ...)` if needed for `createClaudeClient` (or stub the Anthropic constructor). Test scenarios per design §Error Handling:
    - Valid record + `runOneCell` returns `'succeeded'` → `batchItemFailures` is empty, log lines emitted.
    - Malformed `record.body` → `messageId` in `batchItemFailures`; truncated body in log.
    - **Body length > 1000 chars + malformed JSON → log line carries body sliced to 500 chars** (assert via `vi.spyOn(console, 'log')` + the captured first arg's `body` field length).
    - Curriculum miss (parsed `grammarPointKey` not in `ALL_CURRICULA`) → throws → `messageId` in `batchItemFailures`.
    - Audit row in `'in-progress'` state → `messageId` in `batchItemFailures` (deferred); `runOneCell` was NOT called.
    - Audit row in `'completed', jobStatus: 'succeeded'` → record skipped silently (NOT in `batchItemFailures`); `runOneCell` was NOT called.
    - Out-of-scope CEFR level (`'C1'`) → `messageId` in `batchItemFailures`; `runOneCell` was NOT called.
    - Production-trigger guard: `process.env['ENV_NAME']='production'` + `trigger='cli'` → `messageId` in `batchItemFailures`; `runOneCell` was NOT called. (Restore env in `afterEach`.)
    - `runOneCell` throws → `messageId` in `batchItemFailures`.
    - `runOneCell` returns `'failed'` (Req 2.4 amendment) → `messageId` is NOT in `batchItemFailures` (audit row is the terminal record).
    - `runOneCell` returns `'skipped-cost-cap'` (Req 5.1 reuse) → `messageId` is NOT in `batchItemFailures` (same rationale).
  - Run `pnpm --filter @language-drill/lambda test handler` — every assertion passes.
  - Purpose: pin every routing branch in the handler before the CDK construct wires it.
  - _Leverage: Task 12; `vi.mock` patterns from existing Lambda tests; existing test helpers in `infra/lambda/src/middleware/auth.test.ts`_
  - _Requirements: 8.5_

### Layer 5 — Scheduler handler

- [x] 14. Create `infra/lambda/src/generation/scheduler.ts`
  - File: `infra/lambda/src/generation/scheduler.ts` (new)
  - Implement `handler(): Promise<void>` per design Component 4. Module-level state: one `db` + one `sqs = new SQSClient({ region: requireEnv('AWS_REGION') })`. Top-of-handler reads `requireEnv('GENERATION_QUEUE_URL')` and computes `todayUtc = new Date().toISOString().slice(0, 10)`, `batchSeed = \`scheduled-${todayUtc}\``.
  - Constants at top of file: `MIN_PER_CELL = 25`, `TARGET_PER_CELL = 50`, `SCHEDULER_PER_CELL_COST_CAP_USD = 0.50`.
  - Flow: enumerate cells via `enumerateCurriculumCells(ALL_CURRICULA)`; one Drizzle aggregate `db.select({ language, difficulty, type, grammarPointKey, approved: sql<number>...COUNT(*) }).from(exercises).where(inArray(reviewStatus, ['auto-approved', 'manual-approved'])).groupBy(...)`; build a `Map<cellKey, count>` from the result via `buildCellKeyFromRow`; iterate `enumerateCurriculumCells` skipping cells whose `cefrLevel` is not in `ROUND_1_CEFR_LEVELS`; for each undersized cell (`current < MIN_PER_CELL`), construct a `GenerationJobMessage` with `jobId = deterministicUuid([cell.cellKey, batchSeed].join('|'))`, `trigger = 'scheduled'`, `count = TARGET_PER_CELL - current`, `maxCostUsd = SCHEDULER_PER_CELL_COST_CAP_USD`. Post in batches of ≤ 10 via `chunk(messages, 10)` + `SendMessageBatchCommand`.
  - Edge cases: empty undersized list → log `"Pool at target — no jobs enqueued"` and return; query duration > 30 s → log warning (Req 4.10).
  - Purpose: the EventBridge-invoked refill scheduler. Idempotent across same-day re-fires via the deterministic jobId.
  - _Leverage: Tasks 1-4 (shared helpers); Task 8 (db barrel); existing patterns from the API Lambda's module-level db init_
  - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.9, 4.10_

- [x] 15. Create `infra/lambda/src/generation/scheduler.test.ts` with mocked DB and SQS
  - File: `infra/lambda/src/generation/scheduler.test.ts` (new)
  - Use `vi.mock('@language-drill/db', ...)` to stub the Drizzle select chain (returning an array of `(language, difficulty, type, grammarPointKey, approved)` rows), and `vi.mock('@aws-sdk/client-sqs', ...)` to capture every `SendMessageBatchCommand` invocation.
  - Test scenarios per design Component 4 / Req 4.7:
    - Two under-target cells → exactly two `GenerationJobMessage`s are produced; each parses cleanly via `parseGenerationJobMessage`; `jobId === deterministicUuid([cellKey, batchSeed].join('|'))`; `count === TARGET_PER_CELL - currentCount`; `trigger === 'scheduled'`; one `SendMessageBatchCommand` carries both messages.
    - Empty under-target list (every cell at target) → no `SendMessageBatchCommand` calls; "Pool at target" log line emitted.
    - 25 under-target cells → three `SendMessageBatchCommand` calls with batch sizes 10/10/5.
    - Same-day idempotency: invoke handler twice; both invocations produce identical jobIds (deterministic) → assertion on captured message bodies.
    - Out-of-scope cell (cefrLevel='C1') in the curriculum is skipped silently (no message produced for it).
    - Slow-query warning: stub `db.select` to resolve after 31 s. Use `vi.useFakeTimers({ shouldAdvanceTime: true })` so vitest's mocked `Date.now()` ticks in lockstep with awaited timers; advance via `await vi.advanceTimersByTimeAsync(31_000)` before awaiting the handler's resolution. The warning log line is emitted.
  - Run `pnpm --filter @language-drill/lambda test scheduler` — every assertion passes.
  - Purpose: pin the scheduler's enumeration + diff + post invariants without hitting AWS.
  - _Leverage: Task 14; mock patterns from `infra/lambda/src/middleware/auth.test.ts`; `deterministicUuid` semantics from `packages/db/src/lib/deterministic-uuid.ts`_
  - _Requirements: 8.6_

### Layer 6 — AWS SDK dependencies

- [x] 16. Add `@aws-sdk/client-sqs` and `@types/aws-lambda` to both package.json files
  - File: `infra/lambda/package.json` (modify)
  - File: `packages/db/package.json` (modify)
  - File: `pnpm-lock.yaml` (auto-updated by `pnpm install`)
  - Run `pnpm --filter @language-drill/lambda add @aws-sdk/client-sqs` and `pnpm --filter @language-drill/lambda add -D @types/aws-lambda` (the Lambda needs the SDK + the AWS Lambda event types). Then `pnpm --filter @language-drill/db add @aws-sdk/client-sqs` (the CLI's `--queue` mode needs the SDK from a Node process, not the Lambda runtime).
  - Confirm both `package.json`s pin the same major version of `@aws-sdk/client-sqs` (whatever is latest stable at time of authoring; per CLAUDE.md, "Always use the latest stable version"). The exact version pinning convention follows the existing `@anthropic-ai/sdk` lines (caret-pinned).
  - Run `pnpm install` from the worktree root and `pnpm --filter @language-drill/lambda typecheck` — both pass.
  - Purpose: SDK + types in place so Tasks 12, 14, 18+ compile.
  - _Leverage: existing dependency lines in both `package.json`s_
  - _Requirements: 3.8, 3.9_

- [x] 17. Create `infra/lambda/src/generation/aws-sdk-version.test.ts` (parity test)
  - File: `infra/lambda/src/generation/aws-sdk-version.test.ts` (new)
  - Read both `infra/lambda/package.json` and `packages/db/package.json` via `node:fs` `readFileSync` + `JSON.parse`. Sketch:
    ```ts
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    function readMajor(pkgPath: string): string {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const raw = pkg.dependencies['@aws-sdk/client-sqs'];
      return raw.replace(/^[\^~]/, '').split('.')[0];
    }
    expect(readMajor(join(__dirname, '../../../package.json')))
      .toBe(readMajor(join(__dirname, '../../../../../packages/db/package.json')));
    ```
  - Test fails if a future `pnpm up @aws-sdk/client-sqs` bumps one without the other.
  - Run `pnpm --filter @language-drill/lambda test aws-sdk-version` — assertion passes (with the matching pins from Task 16).
  - Purpose: pin the version-parity contract so silent drift is impossible.
  - _Leverage: `node:fs` `readFileSync`; standard `import.meta.dirname`/`__dirname` resolution_
  - _Requirements: 3.9_

### Layer 7 — CDK constructs

- [x] 18. Create `infra/lib/constructs/generation-queue.ts` with queues + DLQ alarm
  - File: `infra/lib/constructs/generation-queue.ts` (new)
  - Implement `GenerationQueueConstruct` per design Component 5: two `sqs.Queue` resources (`GenerationDeadLetterQueue` with `retentionPeriod: Duration.days(14)`; `GenerationQueue` with `visibilityTimeout: Duration.seconds(600)` + DLQ redrive `maxReceiveCount: 3`); one `cloudwatch.Alarm` on the DLQ's `metricApproximateNumberOfMessagesVisible` (period 5 min, statistic Maximum, threshold ≥ 1, treatMissingData NOT_BREACHING). Expose `public readonly queue`, `deadLetterQueue`, `dlqDepthAlarm` so the rest of the stack can grant permissions and wire alarms.
  - Do NOT call `addAlarmAction` on the alarm — Req 5.4 explicitly leaves alarm actions empty (no SNS topic in Phase 4).
  - Purpose: the dedicated SQS infrastructure for generation. Separate from the legacy `JobsQueue`.
  - _Leverage: existing `QueueConstruct` shape (`infra/lib/constructs/queue.ts`); `cloudwatch.Stats.MAXIMUM` + `ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD` + `TreatMissingData.NOT_BREACHING` from CDK v2_
  - _Requirements: 1.1, 1.2, 1.3, 5.2, 5.4_

- [x] 19. Create `infra/lib/constructs/generation-queue.test.ts`
  - File: `infra/lib/constructs/generation-queue.test.ts` (new)
  - Synthesize a one-construct test stack via `new App()` + `new Stack(...)` + `new GenerationQueueConstruct(stack, 'X')`. Use `Template.fromStack(stack)` matchers per design Testing Strategy: `resourceCountIs('AWS::SQS::Queue', 2)`; `hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 600 })` (matches the main queue); `hasResourceProperties('AWS::SQS::Queue', { MessageRetentionPeriod: 14 * 86400 })` (matches the DLQ); the redrive policy carries `maxReceiveCount: 3`; `resourceCountIs('AWS::CloudWatch::Alarm', 1)`; the alarm has `Threshold: 1` and `ComparisonOperator: 'GreaterThanOrEqualToThreshold'`.
  - Run `pnpm --filter language-drill-infra test generation-queue` — every assertion passes.
  - Purpose: pin the construct's CFN shape.
  - _Leverage: existing CDK assertion patterns in `infra/test/stack.dev.test.ts`_
  - _Requirements: 8.1_

- [x] 20. Create `infra/lib/constructs/generation-lambda.ts` with Lambda + event source + Errors alarm
  - File: `infra/lib/constructs/generation-lambda.ts` (new)
  - Implement `GenerationLambdaConstruct` per design Component 6. Props interface (explicit):
    ```ts
    export interface GenerationLambdaConstructProps {
      queue: sqs.IQueue;
      secretsPrefix: string;
      envName: 'prod' | 'dev';            // wired into environment.ENV_NAME — Req 2.6 prod-trigger guard keys off this
      reservedConcurrency: number;        // 3 in both stacks
      additionalEnv?: Record<string, string>;
    }
    ```
  - `NodejsFunction` config: `entry = ../../lambda/src/generation/handler.ts`, `runtime = NODEJS_20_X`, `timeout = Duration.seconds(600)`, `memorySize = 1024`, `reservedConcurrentExecutions = props.reservedConcurrency`, `bundling.externalModules = ['@aws-sdk/*']`, `bundling.esbuildArgs` reusing the `@language-drill/{shared,db,ai}` aliases from `LambdaConstruct`, `logRetention: logs.RetentionDays.ONE_MONTH`. Read `DATABASE_URL` and `ANTHROPIC_API_KEY` from Secrets Manager via `secretsmanager.Secret.fromSecretNameV2(...)`; `grantRead` on each. Set `environment.ENV_NAME = props.envName`. Wire `addEventSource(new SqsEventSource(props.queue, { batchSize: 1, reportBatchItemFailures: true }))`. Create one `cloudwatch.Alarm` on the Lambda's `metricErrors` (period 1 day, statistic Sum, threshold > 5, treatMissingData NOT_BREACHING). Do NOT call `addAlarmAction`.
  - Expose `public readonly handler`, `errorsAlarm`.
  - Purpose: the SQS-consumer Lambda's CDK wiring with bounded concurrency, externalized SDK, and operational alarm.
  - _Leverage: existing `LambdaConstruct` (`infra/lib/constructs/lambda.ts`) for the secrets + bundling pattern; `SqsEventSource` from `aws-cdk-lib/aws-lambda-event-sources`_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 5.3, 5.4_

- [x] 21. Create `infra/lib/constructs/generation-lambda.test.ts`
  - File: `infra/lib/constructs/generation-lambda.test.ts` (new)
  - Synthesize a test stack with a stub queue (`new sqs.Queue(...)`) + the construct. Assert via `Template.fromStack`: `resourceCountIs('AWS::Lambda::Function', 1)`; the function has `Timeout: 600`, `MemorySize: 1024`, `ReservedConcurrentExecutions: 3`, `Runtime: 'nodejs20.x'`. Assert `resourceCountIs('AWS::Lambda::EventSourceMapping', 1)` with `BatchSize: 1` and `FunctionResponseTypes: ['ReportBatchItemFailures']`. Assert `resourceCountIs('AWS::CloudWatch::Alarm', 1)` (the Errors alarm — the queue's DLQ alarm is in a different test).
  - **IAM assertion (using the stringify-and-includes pattern from `infra/test/stack.dev.test.ts:67-79`):** `const policies = template.findResources('AWS::IAM::Policy'); const serialized = JSON.stringify(policies);` then assert `serialized` contains `'/DATABASE_URL'` and `'/ANTHROPIC_API_KEY'` and does NOT contain `'/CLERK_SECRET_KEY'`, `'/CLERK_WEBHOOK_SECRET'`, `'/UPSTASH_REDIS_REST_URL'`, `'/UPSTASH_REDIS_REST_TOKEN'`. This pattern resolves CDK's `Fn::Join` token at synth time and is unambiguous.
  - Run `pnpm --filter language-drill-infra test generation-lambda` — every assertion passes.
  - Purpose: pin the Lambda's CFN shape and the IAM minimum-privilege contract.
  - _Leverage: Task 20; CDK assertion patterns from `infra/test/stack.dev.test.ts:67-79`_
  - _Requirements: 8.2_

- [x] 22. Create `infra/lib/constructs/scheduler-lambda.ts` with conditional EventBridge rule
  - File: `infra/lib/constructs/scheduler-lambda.ts` (new)
  - Implement `SchedulerLambdaConstruct` per design Component 7. Props interface (explicit):
    ```ts
    export interface SchedulerLambdaConstructProps {
      queue: sqs.IQueue;
      secretsPrefix: string;
      enableScheduledJobs: boolean;
      scheduleExpression?: events.Schedule;  // default: every day at 04:00 UTC
    }
    ```
  - `NodejsFunction` config: `entry = ../../lambda/src/generation/scheduler.ts`, `timeout = 60`, `memorySize = 512`, same bundling pattern (externals + aliases + `logRetention: ONE_MONTH`). Reads `DATABASE_URL` only from Secrets Manager via `secretsmanager.Secret.fromSecretNameV2(this, 'DatabaseUrl', \`${props.secretsPrefix}/DATABASE_URL\`)` (no `ANTHROPIC_API_KEY`). `environment.GENERATION_QUEUE_URL = props.queue.queueUrl`. Grants: `databaseUrl.grantRead(this.handler)`, `props.queue.grantSendMessages(this.handler)`. When `props.enableScheduledJobs` is true, create an `events.Rule` with `schedule = props.scheduleExpression ?? events.Schedule.cron({ minute: '0', hour: '4', day: '*', month: '*', year: '*' })` targeting `targets.LambdaFunction(this.handler)`. Expose `public readonly handler`, `public readonly rule?: events.Rule`.
  - Purpose: the scheduler Lambda's CDK wiring with the conditional EventBridge gate.
  - _Leverage: Task 20 (same Lambda construct pattern); `events.Rule` + `events.Schedule.cron` + `targets.LambdaFunction` from `aws-cdk-lib/aws-events*`_
  - _Requirements: 4.1, 4.2, 4.8_

- [x] 23. Create `infra/lib/constructs/scheduler-lambda.test.ts`
  - File: `infra/lib/constructs/scheduler-lambda.test.ts` (new)
  - Test 1 — `enableScheduledJobs=true`: synthesize the construct, assert `resourceCountIs('AWS::Events::Rule', 1)`, the rule's target points to the scheduler Lambda. Assert `resourceCountIs('AWS::Lambda::Function', 1)`. IAM assertion using the stringify-and-includes pattern (Task 21): policy text includes `'/DATABASE_URL'`, includes `'sqs:SendMessage'`, does NOT include `'/ANTHROPIC_API_KEY'`.
  - Test 2 — `enableScheduledJobs=false`: synthesize the construct, assert `resourceCountIs('AWS::Events::Rule', 0)` (the rule is omitted), `resourceCountIs('AWS::Lambda::Function', 1)` (the Lambda still exists for ad-hoc invocation).
  - Run `pnpm --filter language-drill-infra test scheduler-lambda` — both assertions pass.
  - Purpose: pin the gate behavior and the CFN shape.
  - _Leverage: Task 22; CDK assertion patterns from existing tests_
  - _Requirements: 8.3, 4.2_

### Layer 8 — Stack wiring + test extensions

- [x] 24. Wire new constructs into `infra/lib/stack.ts` + add `CfnOutput`
  - File: `infra/lib/stack.ts` (modify)
  - Import the three new constructs. Add to the `LanguageDrillStack` constructor body, after the existing `queue` construct, before `Tags.of(this).add(...)`:
    ```ts
    const generationQueue = new GenerationQueueConstruct(this, 'GenerationQueue');
    new GenerationLambdaConstruct(this, 'GenerationLambdaWrap', {
      queue: generationQueue.queue,
      secretsPrefix: props.secretsPrefix,
      envName: props.envName,
      reservedConcurrency: 3,
    });
    new SchedulerLambdaConstruct(this, 'SchedulerLambdaWrap', {
      queue: generationQueue.queue,
      secretsPrefix: props.secretsPrefix,
      enableScheduledJobs: props.enableScheduledJobs,
    });
    new CfnOutput(this, 'GenerationQueueUrl', {
      value: generationQueue.queue.queueUrl,
      description: 'SQS queue for generation jobs (Phase 4). Set GENERATION_QUEUE_URL to this for the CLI --queue flag.',
    });
    ```
  - Do NOT modify the existing `QueueConstruct` (`queue`) creation or its `grantSendMessages` line — they stay as legacy scaffolding.
  - Run `pnpm --filter language-drill-infra typecheck` — passes.
  - Purpose: stitch the constructs into both prod and dev stacks.
  - _Leverage: Tasks 18, 20, 22_
  - _Requirements: 1.4, 3.7, 4.2_

- [x] 25. Update `infra/test/stack.dev.test.ts` — Lambda count, EventBridge rule count
  - File: `infra/test/stack.dev.test.ts` (modify)
  - Update line 95's `expect(fns).toHaveLength(1)` to `toHaveLength(3)` (dev stack now has API + Generation + Scheduler Lambdas). Find the API Lambda by a discriminator property — its environment includes `CLERK_SECRET_KEY` while the new Lambdas do not. Replace `const fn = fns[0]` with `const fn = fns.find((f) => 'CLERK_SECRET_KEY' in f.Properties.Environment.Variables)` so the line-101/102 assertions on `ENV_NAME` and `ALLOWED_ORIGINS` still target the API Lambda.
  - Update line 113's `prodTemplate.resourceCountIs("AWS::Events::Rule", 0)` to `resourceCountIs("AWS::Events::Rule", 1)` and update the comment to reflect Phase 4's reality. Keep line 109's dev assertion at `0`.
  - Run `pnpm --filter language-drill-infra test stack.dev` — every assertion passes.
  - Purpose: update the dev-vs-prod boundary tests to reflect Phase 4's resources.
  - _Leverage: existing test patterns in `infra/test/stack.dev.test.ts`_
  - _Requirements: 8.10_

- [x] 26. Refresh `infra/test/stack.snapshot.test.ts` snapshot
  - File: `infra/test/stack.snapshot.test.ts` (modify — the test body stays as-is)
  - File: `infra/test/__snapshots__/stack.snapshot.test.ts.snap` (modify — auto-generated by vitest)
  - Run `pnpm --filter language-drill-infra test stack.snapshot -u` to update the snapshot file. Inspect the snapshot diff: it should show two new SQS queues, two new alarms, two new Lambda functions, one new EventSourceMapping, one new EventBridge rule, one new CfnOutput, and the IAM policies for both new Lambdas. The diff should NOT touch the API Lambda's existing CFN shape, the legacy `QueueConstruct`'s queues, the storage bucket, or the API Gateway resources.
  - After the snapshot update, run `pnpm --filter language-drill-infra test stack.snapshot` (without `-u`) — snapshot match passes.
  - Purpose: lock in the prod stack's CFN shape including Phase 4 resources. Future PRs that touch this snapshot are visible at PR time.
  - _Leverage: existing snapshot test_
  - _Requirements: 8.9_

### Layer 9 — CLI `--queue` mode

- [x] 27. Add `--queue` flag to `generate-exercises-parse-args.ts`
  - File: `packages/db/scripts/generate-exercises-parse-args.ts` (modify)
  - File: `packages/db/scripts/parse-args-common.ts` (modify — extend `BOOLEAN_FLAGS` with `'queue'`)
  - File: `.env.example` (modify — add commented `# GENERATION_QUEUE_URL=<from-cdk-output>` and `# AWS_REGION=eu-central-1` lines per Req 6.3)
  - Add `'queue'` to the `BOOLEAN_FLAGS` set in `parse-args-common.ts`. (`'allow-prod'` is already present from Phase 2.)
  - Extend the `ParsedArgs` type with `queue: boolean`. (`allowProd` is already a Phase 2 field — `parseGenerateArgs` line 132 — so leave it untouched.) In `parseGenerateArgs`, set `queue = (raw.get('queue') === 'true')`. Add cross-flag validation: if `queue && concurrency > 1` throw `Error('--queue is incompatible with --concurrency >1; the scheduler caps Lambda parallelism')`. The combination `--queue --dry-run` is allowed (no SQS calls; print would-be messages).
  - Update `.env.example` with the two new commented lines so a fresh-checkout developer knows what to set.
  - Run `pnpm --filter @language-drill/db test parse-args` — Phase 2/3 tests still pass; add new tests covering `queue=true`, the cross-flag rejection, and `--queue --dry-run` accepted.
  - Purpose: extend the existing CLI parser; the new flag surfaces as a typed `ParsedArgs` field.
  - _Leverage: existing `parseGenerateArgs` shape (Phase 2-3); existing `allowProd` field (Phase 2); `parse-args-common.ts` BOOLEAN_FLAGS set (Phase 3)_
  - _Requirements: 6.1, 6.3_

- [x] 28. Create `packages/db/scripts/generate-exercises-queue.ts` with `postCellsToQueue`
  - File: `packages/db/scripts/generate-exercises-queue.ts` (new)
  - Implement `postCellsToQueue(sqs: SQSClient, queueUrl: string, args: PostToQueueArgs): Promise<PostedJob[]>` per design Component 9. `MAX_CLI_CELLS_PER_INVOCATION = 100` constant; throw if exceeded. Prod-queue substring guard: `if (!args.allowProd && !queueUrl.includes('-dev-')) throw Error('Refusing to post to prod queue without --allow-prod')`. For each cell, build a `GenerationJobMessage` with `jobId = randomUUID()` (NOT deterministic — CLI re-runs should post fresh jobs), `trigger: 'cli'`, `count`, `batchSeed`, `topicDomain`, `maxCostUsd` from args; on `args.dryRun` log every message and return without calling SQS; otherwise `chunk(messages, 10)` + `sqs.send(new SendMessageBatchCommand({...}))` per batch; return `{ cellKey, jobId, messageId }[]`.
  - Purpose: pure SQS-posting helper that the CLI's `mainQueue` wraps. Testable in isolation with a mocked SQSClient.
  - _Leverage: Task 1 (`requireEnv`); Task 2 (`chunk`); Task 16 (SDK); Task 27 (parsed args); design Component 9_
  - _Requirements: 6.1, 6.5, 6.6_

- [x] 29. Wire `mainQueue` dispatch into `packages/db/scripts/generate-exercises.ts`
  - File: `packages/db/scripts/generate-exercises.ts` (modify)
  - Top of `main`, after `parseGenerateArgs`: `if (args.queue) return await mainQueue(args);` and rename the existing main body to `mainLocal`. Implement `mainQueue(args)`: read `requireEnv('GENERATION_QUEUE_URL')` and `requireEnv('AWS_REGION')` (clear errors on missing); construct `new SQSClient({ region })`; resolve cell list via `resolveCells(args, ALL_CURRICULA)`; call `postCellsToQueue` (Task 28) with the args translated into `PostToQueueArgs`; print one stdout line per posted job (`Posted job <jobId> for <cellKey> (count=N, trigger=cli)`); exit 0.
  - Production guard reuse: the existing `if (process.env['NODE_ENV'] === 'production' && !args.allowProd)` block at the top of `main` runs before the `args.queue` branch, so `--queue` automatically inherits the same prod guard.
  - Run `pnpm --filter @language-drill/db typecheck` — passes. Existing `pnpm --filter @language-drill/db test` — Phase 3 local-run tests still pass (the queue path is gated behind `args.queue`).
  - Purpose: CLI entry-point dispatch between local-run and queue modes.
  - _Leverage: Task 28; existing `main` skeleton in `generate-exercises.ts`_
  - _Requirements: 6.1, 6.3, 6.4, 6.7_

- [x] 30. Create `packages/db/scripts/generate-exercises-queue.test.ts`
  - File: `packages/db/scripts/generate-exercises-queue.test.ts` (new)
  - Mock the AWS SQSClient via `vi.fn()` returning a stub `send` that captures every command. Test scenarios per design / Req 8.7:
    - 3 cells + valid `-dev-` queue URL → 3 messages produced; each parses via `parseGenerationJobMessage` (round-trip invariant); `trigger='cli'`; `jobId` is a UUID (not deterministic — different on each test invocation).
    - `dryRun: true` → SQSClient `send` is NOT called; each would-be message printed to stdout (assertion via `vi.spyOn(process.stdout, 'write')`).
    - 101 cells → throws `Error(/MAX_CLI_CELLS_PER_INVOCATION/)`.
    - Prod queue URL (`'https://...amazonaws.com/.../LanguageDrillStack-GenerationQueue...'`) without `-dev-`, `allowProd=false` → throws `Error(/Refusing to post to prod queue/)`.
    - Prod queue URL with `allowProd=true` → SQSClient is called.
    - 25 cells → three `SendMessageBatchCommand` calls with batch sizes 10/10/5.
  - Run `pnpm --filter @language-drill/db test generate-exercises-queue` — every assertion passes.
  - Purpose: pin the CLI's `--queue` posting behavior.
  - _Leverage: Task 28; `vi.fn()` patterns from existing tests; `parseGenerationJobMessage` from Task 9_
  - _Requirements: 8.7_

### Layer 10 — Pre-merge gates

- [x] 31. Run repo-level pre-push, `cdk synth`, `cdk diff` against deployed prod, `packages/ai` no-change check, CI-workflow audit
  - File: (no source changes — verification gate)
  - Run `pnpm lint && pnpm typecheck && pnpm test` from the worktree root. Every check exits 0. Resolve any failures before proceeding to Task 32. Common failure modes to watch for: missing import after the runOneCell extraction, unused-import from the helper migrations, snapshot drift from CDK synth output changes between the construct land time and the snapshot refresh.
  - Run `pnpm --filter language-drill-infra exec cdk synth LanguageDrillStack-dev > /dev/null` and `pnpm --filter language-drill-infra exec cdk synth LanguageDrillStack > /dev/null`. Both succeed without errors.
  - Run `pnpm --filter language-drill-infra exec cdk diff LanguageDrillStack` against the deployed prod state (read-only, NO `cdk deploy`). The diff SHALL show purely additive resources: 2 SQS queues + 2 alarms + 2 Lambda functions + 1 event source mapping + 1 EventBridge rule + 1 CfnOutput + IAM policies for the new Lambdas. The diff SHALL NOT show modifications to the existing API Lambda, API Gateway, S3 storage bucket, or the legacy `QueueConstruct` resources. If any non-additive diff appears, pause and investigate before Task 32's deploy.
  - Verify `packages/ai` has zero diff against the merge base (Req 7.6 — `packages/ai` gains no new imports): `git diff --name-only main -- packages/ai/src/` SHALL print nothing. (Uses `main` as the merge base; adjust if working from a different base.)
  - Audit CI workflows for hardcoded Lambda names: `grep -n 'LanguageDrillStack' .github/workflows/*.yml`. Any per-Lambda-name reference (e.g. for log-tailing, post-deploy invocation) needs to be updated to include `GenerationLambdaWrap` and `SchedulerLambdaWrap`. If grep returns no matches, no workflow changes are needed.
  - Purpose: final pre-merge gate covering the lint/typecheck/test triad, both stacks' synthesis, the prod-changeset preview, the package-boundary contract, and the CI integration.
  - _Leverage: existing pre-push convention in CLAUDE.md_
  - _Requirements: 7.6, 8.11, 9.7, 9.9_

- [x] 32. One-shot manual smoke against the dev stack
  - File: (no source changes — verification step only; record observed numbers in the PR description)
  - Pre-flight: confirm AWS credentials are available in the shell (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, OR `AWS_PROFILE`). The CLI's `--queue` mode and `cdk deploy` both fail without them.
  - Run `pnpm --filter language-drill-infra exec cdk deploy LanguageDrillStack-dev --require-approval never` from the worktree root. The deploy MUST succeed end-to-end without manual intervention. Capture the `GenerationQueueUrl` from the stack outputs.
  - Set `GENERATION_QUEUE_URL=<url>` and (if not already set) `AWS_REGION=<region>` in the worktree `.env` (Task 27 added the placeholder lines to `.env.example`).
  - Run `pnpm generate:exercises --queue --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 3 --batch-seed phase-4-smoke`. The CLI MUST print one `Posted job <jobId> for es:b1:cloze:es-b1-present-subjunctive (count=3, trigger=cli)` line and exit 0.
  - Tail the GenerationLambda's CloudWatch logs (e.g. `aws logs tail /aws/lambda/LanguageDrillStack-dev-GenerationLambdaWrap... --follow`) for ~3 minutes. Observe the structured-JSON log lines: parse, audit-check, runOneCell start, per-draft validator, audit-row close. The Lambda completes within the 600 s timeout.
  - Verify in the dev DB: `SELECT id, review_status, quality_score FROM exercises WHERE generation_source='claude-realtime' AND grammar_point_key='es-b1-present-subjunctive' ORDER BY generated_at DESC LIMIT 5` shows 2–3 fresh rows. `SELECT id, status, produced_count, approved_count, flagged_count, rejected_count, trigger FROM generation_jobs WHERE id = '<jobId-from-CLI-output>'` shows `status='succeeded'`, `trigger='cli'`, non-zero counts.
  - (Optional) Manually invoke the scheduler: `aws lambda invoke --function-name LanguageDrillStack-dev-SchedulerLambdaWrap... /tmp/scheduler-out.json` and confirm via the scheduler's CloudWatch logs that 0+ messages were enqueued (likely 0, since the dev branch is well-stocked).
  - Record the cost numbers, approval counts, and any observed failure modes in the PR description.
  - Purpose: end-to-end confidence that the deployed Lambda + scheduler match the design.
  - _Leverage: Phase 3 manual smoke pattern (`exercise-generation-phase-3/tasks.md` Task 27)_
  - _Requirements: 8.12_
