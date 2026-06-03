# Implementation Plan

## Task Overview

25 atomic tasks across 4 change clusters (validator prompt; generator prompt + TR curriculum; scheduler + retry-loop + schema; Langfuse `exerciseId` propagation) plus revalidator-demotion tests. Tasks are ordered by dependency: schema and curriculum-version constants first (other tasks need them), then prompt edits and test extensions, then the retry-loop refactor, then the scheduler refactor (which depends on the curriculum-version constants and the schema column), then observability, then the one-shot revalidator demotion verification.

The four prompt-edit requirements (R2 on the generator side; R3 + R4 + R7 on the validator side) ship as **two coordinated commits per file** per R7.5: one bumped version per prompt file. Tasks within a coordinated commit MAY be combined at PR time; they're split here so each is independently testable.

## Steering Document Compliance

- All file paths follow the existing monorepo layout (`packages/ai/src/`, `packages/db/src/`, `infra/lambda/src/generation/`). No new top-level directories.
- Prompt edits bump the relevant `*_PROMPT_VERSION` constant in the same commit, per CLAUDE.md.
- Schema change is forward-only, one nullable column, no backfill — consistent with the project's migration discipline.
- Tests live next to the modules they cover (`*.test.ts`) and run through the existing Vitest pipeline. No new test runners.
- New pure module (`scheduler-decision.ts`) follows the existing pattern of separating pure logic from AWS-SDK-touching handler code (mirroring `job-message.ts` / `scheduler.ts` split).

## Atomic Task Requirements

Each task touches 1–3 related files, completable in 15–30 minutes, with one testable outcome.

## Tasks

### Phase 1 — Schema + curriculum-version constants (prerequisites)

- [x] 1. Add `curriculum_version` nullable column to `generation_jobs` schema
  - File: `packages/db/src/schema/generation.ts`
  - Add `curriculumVersion: text('curriculum_version')` to the `generationJobs` table definition (nullable, no default)
  - Run `pnpm --filter @language-drill/db db:generate` to generate the Drizzle migration SQL file
  - Commit both the schema edit and the generated migration file
  - Purpose: Persist the curriculum-source version a job ran against, so the scheduler can clear suppression on edits
  - _Leverage: packages/db/src/schema/generation.ts (existing `generationJobs` table), drizzle-kit_
  - _Requirements: R6.4, NFR Reliability "backward-compatible except for one additive nullable column"_

- [x] 2. Add `CURRICULUM_VERSION_<LANG>` constants to each curriculum file
  - Files: `packages/db/src/curriculum/{es,de,tr}.ts` (3 files — EN is intentionally not a learning target per `LearningLanguage = Exclude<Language, Language.EN>` in `@language-drill/shared/onboarding.ts`, so there is no `en.ts`)
  - Add a named export `export const CURRICULUM_VERSION_<LANG> = '<today YYYY-MM-DD>'` at the top of each file, following the same convention as `*_PROMPT_VERSION` constants
  - Use today's date when this task ships; bump in the same commit as any future curriculum edit (documented convention)
  - Purpose: Give the scheduler a clearable invariant that a curriculum edit has occurred since the suppressing job
  - _Leverage: packages/db/src/curriculum/{es,de,tr}.ts (existing module shape)_
  - _Requirements: R6.4_

- [x] 3. Export `CURRICULUM_VERSION_BY_LANGUAGE` barrel from curriculum/index.ts
  - File: `packages/db/src/curriculum/index.ts`
  - Import `CURRICULUM_VERSION_<LANG>` from each language module (ES, DE, TR — there is no EN curriculum module)
  - Export `CURRICULUM_VERSION_BY_LANGUAGE: Readonly<Record<LearningLanguage, string>>` mapping each `LearningLanguage` value to its constant. Use `LearningLanguage = Exclude<Language, Language.EN>` from `@language-drill/shared/onboarding.ts` so the type system enforces that EN cannot be looked up here.
  - Purpose: One-stop lookup for the scheduler and `run-one-cell.ts` to resolve a cell's expected curriculum version by language
  - _Leverage: packages/db/src/curriculum/index.ts (existing `ALL_CURRICULA` export), @language-drill/shared LearningLanguage type_
  - _Requirements: R6.4_

- [x] 4. Extend `curriculum.test.ts` to assert the new constants
  - File: `packages/db/src/curriculum/curriculum.test.ts`
  - Add a test block that asserts every learning-language module exports `CURRICULUM_VERSION_<LANG>` matching `/^\d{4}-\d{2}-\d{2}$/`
  - Add a test asserting `CURRICULUM_VERSION_BY_LANGUAGE` has an entry for every `LearningLanguage` value (exhaustiveness — ES, DE, TR; EN is excluded by type)
  - Purpose: Catch curriculum-edit-without-version-bump at PR time
  - _Leverage: packages/db/src/curriculum/curriculum.test.ts (existing test file), @language-drill/shared LearningLanguage type_
  - _Requirements: R6.4, CLAUDE.md prompt-versioning rule (extended to curriculum modules)_

### Phase 2 — TR curriculum + generator prompt (cluster B coordinated commit)

- [x] 5. Expand `tr-a1-vowel-harmony` curriculum entry
  - File: `packages/db/src/curriculum/tr.ts`
  - In the existing `tr-a1-vowel-harmony` entry, expand `examplesPositive` to ≥2 low-vowel (e/a) plural-suffix forms AND ≥4 non-plural high-vowel (i/ı/u/ü) suffix forms (accusative `-(y)I`, locative `-DA` on a high-vowel stem, possessive `-(s)I`, dative `-(y)A` on a high-vowel stem)
  - Update `description` to name both 2-way and 4-way harmony patterns by their CEFR-typical surface forms
  - Add 1-2 new entries to `commonErrors` covering high-vowel slot confusions
  - Bump `CURRICULUM_VERSION_TR` to today's date (same commit)
  - Purpose: Force the generator to cover both harmony patterns, not just plural suffix
  - _Leverage: packages/db/src/curriculum/tr.ts (`tr-a1-vowel-harmony` entry lines 18-30)_
  - _Requirements: R2.1, R2.2, R6.4_

- [x] 6. Update `GENERATION_SYSTEM_PROMPT_TEMPLATE` with vowel-harmony diversity + buffer-consonant + vocab-fill rules
  - File: `packages/ai/src/generation-prompts.ts`
  - Under "Hard constraints", add: (a) the R2.3 vowel-harmony diversity bullet ("within a single batch, cover ≥3 of i/ı/u/ü AND both e/a; do not blank the plural suffix more than 50 % of the batch"); (b) the R3.B.7 vocab-fill unique-answer reiteration ("either constrain to one lexeme OR populate `acceptableAnswers`"); (c) the R7.1 buffer-consonant rule ("embed buffer in stem OR list both forms in `acceptableAnswers`")
  - Bump `GENERATION_PROMPT_VERSION` to `generate@<today YYYY-MM-DD>`
  - Keep all `{{flatVar}}` placeholders unchanged (prompt-cache parity)
  - Purpose: Make the generator produce diverse, unambiguous, buffer-aware drafts
  - _Leverage: packages/ai/src/generation-prompts.ts (`GENERATION_SYSTEM_PROMPT_TEMPLATE` constant, `GENERATION_PROMPT_VERSION` constant)_
  - _Requirements: R2.3, R2.5, R3.B.7, R7.1, R7.5_

- [x] 7. Extend `generation-prompts.test.ts` byte-parity test + new bullet assertions
  - File: `packages/ai/src/generation-prompts.test.ts`
  - Update the existing template snapshot to match the new rendered prompt
  - Add three string-contains assertions: (a) "vowel harmony" + a recognizable substring of the R2.3 diversity rule; (b) buffer-consonant rule; (c) unique-answer-or-acceptableAnswers reiteration
  - Purpose: Pin the new bullets so future edits don't silently drop them
  - _Leverage: packages/ai/src/generation-prompts.test.ts (existing parity/snapshot test)_
  - _Requirements: R2.3, R3.B.7, R7.1_

### Phase 3 — Validator prompt (cluster A coordinated commit)

- [x] 8. Add R3.A spoiler triples to `VALIDATION_SYSTEM_PROMPT_TEMPLATE`
  - File: `packages/ai/src/validation-prompts.ts`
  - Under the existing `contextSpoilsAnswer` dimension bullet, add three explicit `(spoiler context, blank, why-spoiled)` triples drawn from production: vowel-harmony "(u = back, unrounded → -lar)" / blank "lar"; locative "use -da/-de after voiced, -ta/-te after voiceless" / blank one of four; vowel-harmony "front vowel stems take -ler" / blank "ler"
  - Do NOT bump `VALIDATION_PROMPT_VERSION` yet (combined with task 9-10's edits in a single bump at task 11)
  - Purpose: Give Claude concrete shape to match against — the current prompt names the rule but produces no examples
  - _Leverage: packages/ai/src/validation-prompts.ts (`VALIDATION_SYSTEM_PROMPT_TEMPLATE` constant)_
  - _Requirements: R3.A.1, R3.A.2, R3.A.3_

- [x] 9. Add R3.B ambiguous triples + R7.3 buffer triple to the validator prompt
  - File: `packages/ai/src/validation-prompts.ts`
  - Under the existing `ambiguous` dimension bullet, add three `(ambiguous sentence, declared answer, why-ambiguous)` triples: `"Evde yeni ___ var. Onlar çok güzel."` / `"perdeler"`; `"Sınıfta sekiz ___ var."` / `"öğrenci"`; one translation example if a clean case exists in the pool (otherwise note it as a TBD non-binding)
  - Add the R7.3 buffer-consonant triple under the same `ambiguous` heading: `"Ben çok mutlu___"` / `"um"` vs `"yum"` — why-ambiguous: the blank position absorbs the buffer consonant `-y-` without `acceptableAnswers`
  - Verify combined R3.A + R3.B + R7.3 triple count is ≤8 (NFR sub-cap)
  - Purpose: Make the `ambiguous` veto actually fire on patterns it's nominally responsible for
  - _Leverage: packages/ai/src/validation-prompts.ts (existing "Sınıfta sekiz" bullet at line 64-70 — retain and reinforce, do not remove)_
  - _Requirements: R3.B.4, R3.B.5, R3.B.6, R7.2, R7.3_

- [x] 10. Add R4 anchored rubric + R2.4 over-concentration + R2.6 grammarPointMatch refinement
  - File: `packages/ai/src/validation-prompts.ts`
  - Replace the current single-floor wording for `qualityScore` with a 5-anchor rubric at `0.5 / 0.65 / 0.8 / 0.9 / 1.0`, each with a one-line description (e.g. `0.9` = "publishable as-is by a native-speaker teacher", `0.5` = "unusable; reject")
  - Under "Dimensions to score", add one bullet for R2.4: "if the batch over-concentrates on one form (>50 % of drafts blank the same suffix in a grammar-shape cell), add `'cell over-concentrated on plural suffix'` to `flaggedReasons`"
  - Under `grammarPointMatch`, add one bullet for R2.6: "set false when the construction the blank tests is a different grammar-point key from the cell's declared point, even when grammatically related" — include the `correctAnswer: "da"` outlier from the vowel-harmony pool as the example
  - Bump `VALIDATION_PROMPT_VERSION` to `validate@<today YYYY-MM-DD>` (single bump for tasks 8 + 9 + 10)
  - Purpose: Restore quality-score signal + flag cell-coherence and over-concentration
  - _Leverage: packages/ai/src/validation-prompts.ts_
  - _Requirements: R2.4, R2.6, R4.1, R4.4, R7.5_

- [x] 11. Extend `validation-prompts.test.ts` with byte-parity, length cap, and content assertions
  - File: `packages/ai/src/validation-prompts.test.ts`
  - Update the existing byte-parity assertion (`applyTemplate(TEMPLATE, vars) === buildValidationSystemPrompt(...)`) to match the new rendered prompt
  - Add a length assertion: `renderedPromptText.length ≤ 5500` (current 3,805 + ~44 % cap)
  - Add string-contains assertions for: "0.9", "publishable" (rubric); "Sınıfta sekiz" (retained), "Evde yeni", "mutlu" (new R3.B/R7.3 triples); "cell over-concentrated", "grammarPointMatch" example
  - Purpose: Pin the new content and enforce raw-size cap at PR time
  - _Leverage: packages/ai/src/validation-prompts.test.ts (existing parity test block)_
  - _Requirements: R3.A.1, R3.B.4, R4.1, R7.3, NFR Performance token budget_

- [x] 12. Extend `routing.test.ts` with new boolean-veto routing cases
  - File: `packages/db/src/generation/routing.test.ts`
  - Add three test cases asserting `routeValidationResult` mapping for: (a) `{ ambiguous: true, ...rest passing }` → `reviewStatus: 'flagged'` with `'ambiguous'` in `flaggedReasons`; (b) `{ contextSpoilsAnswer: true, ...rest passing }` → `'rejected'` with `'context spoils answer'` first; (c) `{ grammarPointMatch: false, ...rest passing }` → `'flagged'` with `'grammar point mismatch'`
  - Purpose: Confirm routing is wired correctly for the validator's now-firing booleans (routing itself unchanged; this is a regression net)
  - _Leverage: packages/db/src/generation/routing.test.ts (existing test cases), packages/db/src/generation/routing.ts:55-103 (existing `routeValidationResult`)_
  - _Requirements: R3.A.3, R3.B.6, R2.6_

### Phase 4 — R5: malformed retry handling

- [x] 13. Refactor `runRetryGeneration` to return discriminated union
  - File: `packages/db/src/generation/validate-and-insert.ts`
  - Define `RetryOutcome = { ok: true; draft; usage } | { ok: false; malformed: MalformedDraft; usage }` near the existing type declarations
  - Change `runRetryGeneration` return type from `Promise<{ draft: ExerciseDraft; usage: ClaudeUsageBreakdown }>` to `Promise<RetryOutcome>`
  - Body: after `await generateBatch(...)`, branch on `result.drafts.length === 0` and return the `ok: false` variant carrying `result.malformedDrafts[0]` and `result.tokenUsage`
  - Import `MalformedDraft` from `@language-drill/ai` (already exported from `generate.ts`)
  - Purpose: Stop returning `undefined` for malformed retries; surface the failure cleanly
  - _Leverage: packages/db/src/generation/validate-and-insert.ts:93-107 (existing `runRetryGeneration`), packages/ai/src/generate.ts:277-289 (`GenerateBatchResult.malformedDrafts`)_
  - _Requirements: R5.1_

- [x] 14. Update `validateAndInsertWithRetry` to consume the new `RetryOutcome`
  - File: `packages/db/src/generation/validate-and-insert.ts` (same file as task 13)
  - At both `await runRetryGeneration(...)` call sites (rejected-branch retry at line ~152 and dedup-branch retry at line ~190), fold `retry.usage` into `extraUsage` unconditionally, then branch on `retry.ok`
  - If `retry.ok === false` AND `attempt < MAX_DEDUP_RETRIES`: increment `extraProduced` (the retry counts as a producer call), `continue` the loop
  - If `retry.ok === false` AND `attempt >= MAX_DEDUP_RETRIES`: return `{ terminalStatus: 'rejected', parserFailedAtFinal: true, extraUsage, extraProduced, validatedCount }`
  - Add `parserFailedAtFinal?: boolean` to the existing `DraftOutcome` type
  - Purpose: Wire the new retry-outcome through the dedup retry loop without changing the existing budget
  - _Leverage: packages/db/src/generation/validate-and-insert.ts (existing retry loop and DraftOutcome type)_
  - _Requirements: R5.2, R5.3_

- [x] 15. Add `parserFailedCount` to `CellResult` and log it
  - File: `packages/db/src/generation/run-one-cell.ts`
  - Add `parserFailedCount: number` (default 0) to the `CellResult` type definition near `malformedDraftCount`
  - In the per-ordinal walk, increment `parserFailedCount` by 1 whenever the returned `DraftOutcome` has `parserFailedAtFinal === true`
  - Write `parserFailedCount` into the `generation_jobs` INSERT alongside existing counters
  - Add `parserFailedOrdinals: N` to the structured log line emitted at job completion (mirroring the existing `producedCount` / `approvedCount` / `rejectedCount` fields)
  - Purpose: Surface the per-ordinal parser-failed signal in observability + audit
  - _Leverage: packages/db/src/generation/run-one-cell.ts (existing `CellResult` type, per-ordinal loop, log helper)_
  - _Requirements: R5.4_

- [x] 16. Write `validate-and-insert.test.ts` test for the malformed-retry scenario
  - File: `packages/db/src/generation/validate-and-insert.test.ts`
  - New test: given a `generateBatch` mock that returns `{ drafts: [], malformedDrafts: [{ ordinal: 0, errorMessage: '...' }], tokenUsage: nonZeroUsage }` on the dedup-retry call, assert that (a) `validateAndInsertWithRetry` does not throw; (b) `extraUsage` contains the failed-call usage; (c) either retries are dispatched (if budget remains) or returns `terminalStatus: 'rejected'` with `parserFailedAtFinal: true`
  - Purpose: Pin the no-crash behavior at PR time
  - _Leverage: packages/db/src/generation/validate-and-insert.ts (refactored functions from tasks 13-14), existing test fixtures_
  - _Requirements: R5.1, R5.2, R5.3_

- [x] 17. Extend `run-one-cell.test.ts` for `parserFailedCount` accounting
  - File: `packages/db/src/generation/run-one-cell.test.ts`
  - Add one test: given a `validateAndInsertWithRetry` mock returning `parserFailedAtFinal: true` for one ordinal in a 3-ordinal batch, assert the final `CellResult.parserFailedCount === 1` and the structured log line contains `parserFailedOrdinals: 1`
  - Purpose: Pin the field+log wiring
  - _Leverage: packages/db/src/generation/run-one-cell.test.ts (existing fixtures and log assertions)_
  - _Requirements: R5.4_

### Phase 5 — R1, R6: scheduler refactor

- [x] 18. Create pure `scheduler-decision.ts` module
  - File: `infra/lambda/src/generation/scheduler-decision.ts` (new file)
  - Export constants: `TARGET_PER_CELL = 50`, `LOW_YIELD_THRESHOLD = 3`, `SATURATED_DEDUP_REQ_FRACTION = 0.5`, `SATURATED_DEDUP_APPROVED_FRACTION = 0.3`
  - Export `RecentJob` type: `{ approvedCount, requestedCount, dedupGivenUpCount, curriculumVersion, finishedAt }`
  - Export `EnqueueDecision` discriminated union: `{ kind: 'enqueue', need } | { kind: 'skip-target-reached' } | { kind: 'skip-low-yield' } | { kind: 'skip-saturated-dedup' } | { kind: 'skip-c2' }`
  - Export `decideEnqueue(cell, approvedInPool, recentJob, curriculumVersionOnDisk): EnqueueDecision` — pure function. Order: C2 → target-reached → curriculum-version mismatch clears suppression → saturated-dedup (R6.3 precedence) → low-yield → enqueue
  - No imports from `@aws-sdk/*`, no Drizzle, no env reads
  - Purpose: Make the new decision logic unit-testable in isolation
  - _Leverage: @language-drill/db (Cell type), @language-drill/shared (Language, CefrLevel)_
  - _Requirements: R1.1, R1.2, R1.3, R1.4, R6.1, R6.2, R6.3, R6.4_

- [x] 19. Write `scheduler-decision.test.ts` with ~12 table-driven cases
  - File: `infra/lambda/src/generation/scheduler-decision.test.ts` (new file)
  - Cases (table format): (1) C2 cell → `skip-c2`; (2) approvedInPool ≥ TARGET → `skip-target-reached`; (3) no recentJob, under target → `enqueue` (need = TARGET - approved); (4) low-yield + curriculum match → `skip-low-yield`; (5) low-yield + curriculum mismatch → `enqueue`; (6) saturated-dedup + curriculum match → `skip-saturated-dedup`; (7) saturated-dedup + curriculum mismatch → `enqueue`; (8) BOTH low-yield AND saturated-dedup with curriculum match → `skip-saturated-dedup` (R6.3 precedence); (9) `recentJob.curriculumVersion === null` → suppression cleared (treat as mismatch); (10) `curriculumVersionOnDisk === undefined` (missing constant) → `enqueue` (safe default); (11) edge: approvedInPool exactly 49 with no recent job → `enqueue` with need=1; (12) edge: requestedCount=0 boundary cases
  - Purpose: Lock the decision logic to the requirements table
  - _Leverage: infra/lambda/src/generation/scheduler-decision.ts (from task 18)_
  - _Requirements: all R1.* and R6.*_

- [x] 20. Refactor `scheduler.ts` to use `decideEnqueue` and add the second SQL aggregate
  - File: `infra/lambda/src/generation/scheduler.ts`
  - Delete `MIN_PER_CELL` constant
  - Add `loadMostRecentSucceededJobPerCell(db): Promise<Map<string, RecentJob>>` — one `SELECT DISTINCT ON (cell_key) cell_key, approved_count, requested_count, dedup_given_up_count, curriculum_version, finished_at FROM generation_jobs WHERE status='succeeded' ORDER BY cell_key, started_at DESC`
  - In the cell-enumeration loop, call `decideEnqueue(cell, approvedInPool, recentJobMap.get(cell.cellKey) ?? null, CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage])` and switch on the result (`Cell.language` is a `LearningLanguage` by construction — cells only exist for ES/DE/TR curricula)
  - Aggregate counters per skip reason; emit a final structured log line with `suppressed: { lowYield, saturatedDedup, targetReached }` summary + per-skip one-line `{ cellKey, reason }` records for grep-in-CloudWatch
  - Purpose: Replace hysteresis with top-up-to-target + suppression
  - _Leverage: infra/lambda/src/generation/scheduler.ts (existing handler shape, `generation_jobs_cell_idx`), packages/db/src/curriculum/index.ts (CURRICULUM_VERSION_BY_LANGUAGE from task 3), infra/lambda/src/generation/scheduler-decision.ts (from task 18)_
  - _Requirements: R1.1, R1.2, R1.3, R1.4, R6.2, R6.4, R6.5_

- [x] 21. Extend `scheduler.test.ts` for top-up-to-target + suppression-clearing
  - File: `infra/lambda/src/generation/scheduler.test.ts`
  - Add scenario A: seed `exercises` with 30 approved + a recent saturated-dedup job with matching curriculum version → scheduler enqueues 0 messages → log emits `suppressed.saturatedDedup === 1`
  - Add scenario B: same setup, but bump the language's curriculum version → scheduler enqueues 1 message with `need = 20`
  - Add scenario C: 48 approved + no recent job → scheduler enqueues 1 message with `need = 2` (top-up to target, previously skipped under MIN_PER_CELL hysteresis)
  - Purpose: Lock the new scheduler behavior at the integration level
  - _Leverage: infra/lambda/src/generation/scheduler.test.ts (existing fixtures, db seeding helpers)_
  - _Requirements: R1.1, R1.3, R6.2, R6.4_

- [x] 22. Wire `run-one-cell.ts` to record `curriculum_version` on job INSERT
  - File: `packages/db/src/generation/run-one-cell.ts`
  - Import `CURRICULUM_VERSION_BY_LANGUAGE` from `packages/db/src/curriculum`
  - At the `generation_jobs` row INSERT, populate `curriculumVersion: CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage]`. `Cell.language` is a `LearningLanguage` by construction (cells are enumerated from curricula, which only exist for ES/DE/TR), so the lookup is total — no `?? null` fallback needed.
  - Purpose: Persist the version so the scheduler can compare it on the next tick
  - Test coverage is transitive: task 21 scenario B asserts the suppression-clearing behavior end-to-end, which depends on this column being populated correctly. No dedicated unit test required.
  - _Leverage: packages/db/src/generation/run-one-cell.ts (existing INSERT site for generation_jobs), packages/db/src/curriculum/index.ts (CURRICULUM_VERSION_BY_LANGUAGE from task 3)_
  - _Requirements: R6.4_

### Phase 6 — R8: Langfuse `exerciseId` propagation

- [x] 23. Add per-ordinal `withLlmTrace` scope inside `validateAndInsertWithRetry`
  - File: `packages/db/src/generation/validate-and-insert.ts`
  - Context: the cell-level `withLlmTrace` lives in `infra/lambda/src/generation/handler.ts:222` wrapping the `runOneCell(...)` call with `feature: 'generate'` and cell-wide fields (jobId, cellKey, language, cefrLevel, exerciseType). Because `withLlmTrace` is ALS-based, an inner call nests the context for the duration of the wrapped function.
  - Inside `validateAndInsertWithRetry`, wrap the entire per-ordinal body in `withLlmTrace({ exerciseId: opts.draft.id }, async () => { ... })` — the ALS scope already has the cell-level fields from the outer wrap; the inner call only contributes the `exerciseId`
  - Import `withLlmTrace` from `@language-drill/ai` (already exported)
  - Confirm `opts.draft.id` is the deterministic UUID for the ordinal (generated upstream by `deterministicUuid(spec | batchSeed | ordinal)` and used as the `exercises.id` primary key on insert)
  - Do NOT modify the cell-level wrap in `handler.ts:222` (cell scope is intentionally broader than one ordinal — keep it)
  - Purpose: Each ordinal's generator + validator + retry traces share the `exerciseId` join key in Langfuse
  - _Leverage: packages/ai/src/observability.ts:63 (`LlmTraceContext.exerciseId`), :160-169 (`withLlmTrace` ALS-nesting helper), :460 (`buildTraceMetadata` insertion); infra/lambda/src/generation/handler.ts:222 (outer cell-level wrap)_
  - _Requirements: R8.1, R8.2, R8.4, R8.5_

- [x] 24. Add `exerciseId` to the runtime evaluator `withLlmTrace` call
  - File: `infra/lambda/src/routes/exercises.ts` (specifically the `withLlmTrace` block at lines 209-228 inside `POST /exercises/:id/submit`)
  - The route already wraps `evaluateAnswer(...)` in `withLlmTrace` at line 209 with `feature: 'evaluate'` and other fields. Add one new field to the context object: `exerciseId: id` (the `id` variable is `params.id` from the path, already in scope)
  - Confirm the metadata key is exactly `exerciseId` (camelCase) — must match the key used in tasks 23 and the existing `LlmTraceContext` type
  - Purpose: Runtime evaluation traces carry the same join key as generation/validation
  - _Leverage: infra/lambda/src/routes/exercises.ts:209-228 (existing `withLlmTrace` wrap of `evaluateAnswer`), packages/ai/src/observability.ts:63 (`LlmTraceContext.exerciseId`)_
  - _Requirements: R8.3, R8.4, R8.5_

### Phase 7 — Revalidator demotion verification (R3.C.8)

- [x] 25. Extend `revalidate-cloze-pool.test.ts` for new demotion patterns
  - File: `packages/db/scripts/revalidate-cloze-pool.test.ts`
  - Add three test cases (each uses an existing `validateDraft` mock returning the new judgment shape): (a) spoiled-context demote — `{ qualityScore: 0.5, contextSpoilsAnswer: true, ...passing }` → row's `reviewStatus` updates from `'auto-approved'` to `'rejected'` with `'context spoils answer'` in `flaggedReasons`; (b) ambiguous-fill demote — `{ qualityScore: 0.65, ambiguous: true, ...passing }` → row demotes to `'flagged'`; (c) buffer-consonant demote — same shape as (b), different example fixture
  - Use the existing `--apply` code path with mocked validator
  - Purpose: Verify the existing revalidator CLI demotes existing offenders correctly under the new validator judgment
  - _Leverage: packages/db/scripts/revalidate-cloze-pool.test.ts (existing dry-run + apply test cases), packages/db/scripts/revalidate-cloze-pool.ts:388-402 (`applyDemotion`)_
  - _Requirements: R3.C.8_
