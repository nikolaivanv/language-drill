# Implementation Plan

## Task Overview

Phase 3 closes the quality loop on theory generation. It ships in four thin layers, each independently testable:

1. **Validator layer** (Tasks 1–7) — `packages/ai/src/theory-validation-thresholds.ts` + `theory-validation-prompts.ts` + `theory-validate.ts` + tests + `index.ts` re-exports. The Claude-touching side of the phase.
2. **Router layer** (Tasks 8–9) — `packages/db/src/theory-generation/routing.ts` + tests. Pure function, no I/O, three terminal branches.
3. **Orchestrator wiring** (Tasks 10–12) — modify `packages/db/src/theory-generation/run-one-cell.ts` + extend the existing Phase 2 mock client + extend `run-one-cell.test.ts`.
4. **Review CLI layer** (Tasks 13–20) — `theory-json-to-text.ts` + parse-args + main CLI + DB helpers + `pnpm` script wiring + tests.
5. **Verification** (Task 21) — the repo-root `pnpm lint && pnpm typecheck && pnpm test` gate.

The phase ships only after Task 21 is green. Phase 4 (Lambda + scheduler) is downstream and deliberately absent here. After Task 21 the operator can run `pnpm generate:theory --lang es --grammar-point <real ES B1 key>` and produce one of three outcomes: an `auto-approved` row, a `flagged` row (visible to `pnpm review:flagged-theory`), or no row at all (rejected — audit-row-only). The reviewer can then clear the flagged queue with single keystrokes.

## Steering Document Compliance

- **Anthropic Claude API + tool use + `cache_control: ephemeral`** (`tech.md` §"AI / GenAI"): Tasks 1–6 follow the exact pattern `validate.ts` + `validation-prompts.ts` established — `client.messages.create` with one cached system block, `tool_choice` forced-call against a strict `input_schema`, temperature 0.0.
- **`claude-sonnet-4-5` model pinning** (resolved decision #2 from the plan): Task 3 aliases `THEORY_VALIDATION_MODEL = GENERATION_MODEL`; Task 6 adds the cross-file equality assertion so bumping the model breaks CI for *all three* paths (generator, validator, evaluator).
- **Drizzle + JSONB + typed reads/writes** (`tech.md` §"Database"): Task 10 uses Drizzle's typed `theoryTopics` + `theoryGenerationJobs` (Phase 1 already shipped these with `$type<TheoryTopicJson>()`). No casts at INSERT or SELECT.
- **Co-located tests** (`CLAUDE.md` §Testing): every test file sits next to the module it tests. No orphan test directories.
- **Pre-push gate** (`CLAUDE.md` §Pre-Push Checks): Task 21 runs the three repo-root commands; Phase 3 ships only when green.
- **No new dependencies** (`CLAUDE.md` §"Package Management"): Phase 3 introduces zero npm packages. Anthropic SDK, Drizzle, Vitest, `node:readline` are unchanged.
- **Package boundaries** (`tech.md` §"Monorepo Structure"): `packages/ai` owns validator + prompts + thresholds; `packages/db/src/theory-generation/` owns router + orchestrator wiring; `packages/db/scripts/` owns the review CLI. **Forbidden direction `packages/ai → packages/db` is preserved** — thresholds live in `packages/ai` and are re-exported by the router.

## Atomic Task Requirements

Each task below touches ≤ 3 files, fits in 15–30 minutes for an experienced developer, and has a single testable outcome. Tasks 5, 11, and 18 are at the upper end of the box because they compose substantial prompt/orchestrator/CLI logic; they remain single-purpose and reviewable against the design's component definitions.

## Tasks

### Layer 1 — Validator (`packages/ai`)

- [x] 1. Create `packages/ai/src/theory-validation-thresholds.ts` with frozen threshold constants
  - File: `packages/ai/src/theory-validation-thresholds.ts` (new)
  - Export `THEORY_VALIDATION_THRESHOLDS = Object.freeze({ approveQualityFloor: 0.7, flagQualityFloor: 0.5 })` with a JSDoc block explaining each field's routing semantic and noting that these are also the values the validator's system prompt interpolates (Req 2.5).
  - Export `THEORY_VALIDATION_THRESHOLDS_TYPE` as `typeof THEORY_VALIDATION_THRESHOLDS` for downstream consumers that want a strict type.
  - Add a self-test invariant comment: `// Invariant: flagQualityFloor < approveQualityFloor` (asserted in Task 9's test).
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm zero errors.
  - Purpose: single source of truth for the 0.5 / 0.7 thresholds. Lives in `packages/ai` so the validator prompt can import them without violating the forbidden `packages/ai → packages/db` direction; re-exported by the router in Task 8.
  - _Leverage: `packages/db/src/generation/routing.ts:23-28` (the `Object.freeze` pattern for the exercise-side thresholds — duplicated literals there; theory introduces the shared-constant pattern)_
  - _Requirements: 2.5, 3.4, 3.5_

- [x] 2. Create `packages/ai/src/theory-validation-prompts.ts` with system + user prompt builders
  - File: `packages/ai/src/theory-validation-prompts.ts` (new)
  - Imports: `CefrLevel`, `LANGUAGE_NAMES`, `Language` from `@language-drill/shared`; `CEFR_LEVEL_DESCRIPTORS` from `./prompts.js`; `THEORY_VALIDATION_THRESHOLDS` from `./theory-validation-thresholds.js`; `TheoryPromptInputs` from `./theory-prompts.js` (Phase 2's input struct shape works as-is); `TheoryDraft, TheoryGenerationSpec` from `./theory-generate.js`.
  - Export `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` (raw string with `{{placeholders}}` for structural test assertions — mirror of `validation-prompts.ts:45-87`).
  - Export `buildTheoryValidationSystemPrompt(spec: TheoryGenerationSpec): string` — deterministic, `spec`-derived only, byte-identical for equal specs. Contents in order: role line (`You are a strict reviewer of language reference material for adult learners. The page is for CEFR {{cefrLevel}} {{language}}.`), `## Grammar point context` block (`name` + `description`), positive examples bullets, common learner errors bullets, CEFR level descriptor block via `CEFR_LEVEL_DESCRIPTORS`, the six required theory sections in order (`what is it?`, `when to use it`, `formation`, `examples in context`, `common pitfalls`), a `## Routing implication` block that **interpolates** `THEORY_VALIDATION_THRESHOLDS.flagQualityFloor` and `…approveQualityFloor` (NOT hard-typed `0.5` / `0.7`), a per-dimension scoring rubric (one bullet per of the six tool fields), and the closing `You MUST use the submit_theory_validation_result tool. Do not return plain text.`
  - Export `buildTheoryValidationUserPrompt(draft: TheoryDraft, spec: TheoryGenerationSpec): string` — single user message: `\`Validate the following theory page for ${spec.grammarPoint.key} at CEFR ${spec.cefrLevel}:\n\n\\\`\\\`\\\`json\n${JSON.stringify(draft.contentJson, null, 2)}\n\\\`\\\`\\\`\``.
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm zero errors.
  - Purpose: separate prompt text from the Claude call (Task 3) so voice/section changes don't require touching the validator core.
  - _Leverage: `packages/ai/src/validation-prompts.ts:45-87` (exercise validator template structure); `packages/ai/src/prompts.ts` (CEFR_LEVEL_DESCRIPTORS)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Create `packages/ai/src/theory-validate.ts` with model constants, tool schema, and types
  - File: `packages/ai/src/theory-validate.ts` (new)
  - Imports: `Anthropic` SDK type; `ClaudeUsageBreakdown` from `./cost-model.js`; `GENERATION_MODEL` from `./generate.js`; `TheoryDraft, TheoryGenerationSpec` from `./theory-generate.js`; `buildTheoryValidationSystemPrompt, buildTheoryValidationUserPrompt` from `./theory-validation-prompts.js`.
  - Export constants: `THEORY_VALIDATION_MODEL = GENERATION_MODEL`; `THEORY_VALIDATION_MAX_TOKENS = 1024`; `THEORY_VALIDATION_TEMPERATURE = 0.0`; `THEORY_VALIDATION_TOOL_NAME = 'submit_theory_validation_result' as const`.
  - Export `THEORY_VALIDATION_TOOL: Anthropic.Tool` with `name: THEORY_VALIDATION_TOOL_NAME`, description per design Component 1, and `input_schema` declaring six required properties: `qualityScore` (`number`, 0–1, description includes the routing implication block), `factualErrors` (`array of string`, description: *"Wrong rule claims, conjugation errors, etc. **A non-empty array is a HARD REJECT** regardless of qualityScore — this is intentional and stricter than the exercise validator. A wrong rule in a theory page is the canonical reference for that grammar point."*), `levelMismatch` (`boolean`), `sectionsIncomplete` (`array of string` — names of missing/thin sections), `examplesUseGrammarPoint` (`boolean`), `culturalIssues` (`array of string`, description includes the hard-reject note), `flaggedReasons` (`array of string`).
  - Export types `TheoryValidationResult` (matching the schema 1:1; see design Data Models) and `ValidateTheoryDraftResult = { result: TheoryValidationResult; tokenUsage: ClaudeUsageBreakdown }`.
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm the schema compiles against `Anthropic.Tool['input_schema']`.
  - Purpose: pin the public surface so subsequent tasks (parser, main function, tests, orchestrator wiring) compile against a stable contract.
  - _Leverage: `packages/ai/src/validate.ts:29-138` (constants + tool-schema + types pattern)_
  - _Requirements: 1.1, 1.5, 1.6_

- [x] 4. Add `parseTheoryValidationResult` to `theory-validate.ts`
  - File: `packages/ai/src/theory-validate.ts` (modify — continue from Task 3)
  - Add internal `isObject(value: unknown): value is Record<string, unknown>` and `requireStringArray(raw, field): string[]` helpers — verbatim copy from `validate.ts:148-170` (cannot import: `validate.ts` declares them module-private).
  - Export `parseTheoryValidationResult(input: unknown): TheoryValidationResult`:
    1. If `!isObject(input)` throw `"Theory validation result must be an object"`.
    2. Validate `qualityScore` is a number in [0, 1]; throw `\`Invalid qualityScore: must be a number between 0 and 1, got ${JSON.stringify(value)}\`` on mismatch.
    3. Validate `levelMismatch` and `examplesUseGrammarPoint` are booleans; throw `\`Invalid <field>: must be a boolean, got ${JSON.stringify(value)}\`` on mismatch.
    4. Validate `factualErrors`, `sectionsIncomplete`, `culturalIssues`, `flaggedReasons` are string arrays via `requireStringArray`.
    5. Return the typed `TheoryValidationResult`.
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm zero errors.
  - Purpose: defensive parsing so a malformed Claude response surfaces a field-level error message in the audit-row's `error_message` column, not a runtime crash deep in `runOneTheoryCell`.
  - _Leverage: `packages/ai/src/validate.ts:148-208` (parseValidationResult shape)_
  - _Requirements: 1.4_

- [x] 5. Add `validateTheoryDraft` async function to `theory-validate.ts`
  - File: `packages/ai/src/theory-validate.ts` (modify — continue from Task 4)
  - Add internal `readUsage(response: Anthropic.Message): ClaudeUsageBreakdown` helper — verbatim copy from `validate.ts:217-228` (re-declared locally to keep the module self-contained, per the Phase 2 convention).
  - Export `async function validateTheoryDraft(client: Anthropic, draft: TheoryDraft, spec: TheoryGenerationSpec): Promise<ValidateTheoryDraftResult>`:
    1. Build `systemText = buildTheoryValidationSystemPrompt(spec)` and `userText = buildTheoryValidationUserPrompt(draft, spec)`.
    2. Call `client.messages.create({ model: THEORY_VALIDATION_MODEL, max_tokens: THEORY_VALIDATION_MAX_TOKENS, system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: userText }], tools: [THEORY_VALIDATION_TOOL], tool_choice: { type: 'tool', name: THEORY_VALIDATION_TOOL_NAME }, temperature: THEORY_VALIDATION_TEMPERATURE })`.
    3. Find the `tool_use` block in `response.content`. If none, throw `\`Validator did not return a tool use block. Stop reason: ${response.stop_reason}. Content types: ${response.content.map(b => b.type).join(', ')}\``.
    4. If `toolUseBlock.name !== THEORY_VALIDATION_TOOL_NAME`, throw `\`Unexpected tool name: expected "${THEORY_VALIDATION_TOOL_NAME}", got "${toolUseBlock.name}"\``.
    5. Return `{ result: parseTheoryValidationResult(toolUseBlock.input), tokenUsage: readUsage(response) }`.
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm zero errors.
  - Purpose: the single Claude call that grades one theory page.
  - _Leverage: `packages/ai/src/validate.ts:217-293` (validateDraft pattern)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 6. Write unit tests for `theory-validate.ts` and `theory-validation-prompts.ts`
  - Files: `packages/ai/src/theory-validate.test.ts` (new), `packages/ai/src/theory-validation-prompts.test.ts` (new)
  - In `theory-validate.test.ts`:
    - `parseTheoryValidationResult` happy path: build a literal six-field object, assert the typed result equals it.
    - Field-level error tests: one `it` per malformed field (`qualityScore` out of range, `levelMismatch` not boolean, `factualErrors` not array, etc.) asserting the `Invalid <field>: …` substring.
    - `validateTheoryDraft` happy path with a mocked Anthropic client whose `messages.create` returns a canned response with one `tool_use` block; assert the parsed result and the `tokenUsage` shape.
    - `validateTheoryDraft` malformed-response tests: no `tool_use` block, wrong tool name.
    - **Cross-file model equality:** `expect(THEORY_VALIDATION_MODEL).toBe(GENERATION_MODEL)` (Req 1.6) — single test to prevent the generator and validator from drifting.
  - In `theory-validation-prompts.test.ts`:
    - Byte-identity test: two calls with equal `spec` produce the same string (Req 2.2).
    - Threshold-interpolation cross-check: rendered prompt contains the literal `THEORY_VALIDATION_THRESHOLDS.flagQualityFloor.toString()` and `…approveQualityFloor.toString()` substrings (Req 2.5; design Testing Strategy).
    - Required-sections-in-order test: the prompt contains the five section names in the order the generator produces them (`what is it?` before `when to use it` before `formation` before `examples in context` before `common pitfalls`).
    - User-prompt embedding test: `buildTheoryValidationUserPrompt` output contains `JSON.stringify(draft.contentJson, null, 2)` verbatim.
  - Use a `getGrammarPoint` test helper that pulls a real ES B1 grammar point from the curriculum (matches the pattern in `validate.test.ts`).
  - Run `pnpm test --filter @language-drill/ai` and confirm both files pass.
  - Purpose: contract tests for the validator's public surface. Re-runnable in CI without a live Claude credential.
  - _Leverage: `packages/ai/src/validate.test.ts` (test layout); `packages/ai/src/validation-prompts.test.ts` if it exists_
  - _Requirements: 1.4, 1.6, 2.2, 2.5, 6.3, 6.4_

- [x] 7. Re-export theory-validator surface from `packages/ai/src/index.ts`
  - File: `packages/ai/src/index.ts` (modify)
  - Add an `export { ... } from './theory-validation-thresholds.js'` block exporting `THEORY_VALIDATION_THRESHOLDS`.
  - Add an `export { ... } from './theory-validate.js'` block exporting `THEORY_VALIDATION_MODEL`, `THEORY_VALIDATION_MAX_TOKENS`, `THEORY_VALIDATION_TEMPERATURE`, `THEORY_VALIDATION_TOOL_NAME`, `THEORY_VALIDATION_TOOL`, `validateTheoryDraft`, `parseTheoryValidationResult`.
  - Add an `export type { ... } from './theory-validate.js'` block exporting `TheoryValidationResult`, `ValidateTheoryDraftResult`.
  - Add an `export { ... } from './theory-validation-prompts.js'` block exporting `buildTheoryValidationSystemPrompt`, `buildTheoryValidationUserPrompt`, `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE`.
  - Run `pnpm typecheck` from the repo root and confirm `@language-drill/ai`'s public surface compiles. Also run a quick `grep -r "from '@language-drill/ai'" packages/db/` to confirm no existing import is broken.
  - Purpose: without this step, the router (Task 8) and the orchestrator wiring (Task 10) cannot import the new validator symbols.
  - _Leverage: `packages/ai/src/index.ts:69-78` (existing exercise-validator re-exports)_
  - _Requirements: 1.1, 1.5_

### Layer 2 — Router (`packages/db/src/theory-generation`)

- [x] 8. Create `packages/db/src/theory-generation/routing.ts` with thresholds re-export and pure router
  - File: `packages/db/src/theory-generation/routing.ts` (new)
  - Imports: `TheoryValidationResult`, `THEORY_VALIDATION_THRESHOLDS` from `@language-drill/ai`; `ReviewStatus` from `../generation/routing.js` (the exercise-side union — single source of truth for the four-value enum).
  - Re-export `THEORY_VALIDATION_THRESHOLDS` so downstream consumers in `packages/db` can pick whichever package they're already in.
  - Export type `TheoryReviewStatus = Exclude<ReviewStatus, 'manual-approved'>` — the router can only produce three values; `'manual-approved'` is set only by the review CLI's UPDATE path. Add a JSDoc invariant: *"`routeTheoryValidationResult` NEVER returns `'manual-approved'`; that value is set only by `tryApproveTheory` (Task 15)."*
  - Export type `TheoryRoutingDecision = { reviewStatus: TheoryReviewStatus; flaggedReasons: string[] }`.
  - Export `routeTheoryValidationResult(result: TheoryValidationResult): TheoryRoutingDecision` implementing the decision table from design Component 3:
    1. If `result.factualErrors.length > 0` → return `{ reviewStatus: 'rejected', flaggedReasons: [...result.factualErrors] }`.
    2. Else if `result.culturalIssues.length > 0` → return `{ reviewStatus: 'rejected', flaggedReasons: [...result.culturalIssues] }`.
    3. Else if `result.qualityScore < flagQualityFloor` → return `{ reviewStatus: 'rejected', flaggedReasons: ['low quality score (<0.5)', ...result.flaggedReasons] }`.
    4. Else if `result.qualityScore >= approveQualityFloor && !result.levelMismatch && result.sectionsIncomplete.length === 0 && result.examplesUseGrammarPoint` → return `{ reviewStatus: 'auto-approved', flaggedReasons: [] }`.
    5. Else build a `reasons: string[]` accumulator in fixed order: push `'low quality score (<0.7)'` if `qualityScore < approveQualityFloor`; push `'level mismatch'` if `levelMismatch`; for each entry of `sectionsIncomplete` push `\`incomplete section: ${name}\``; push `'examples off-target'` if `!examplesUseGrammarPoint`; spread `...result.flaggedReasons`. Return `{ reviewStatus: 'flagged', flaggedReasons: reasons }`.
  - Add JSDoc comments naming the rejection-vs-flag rationale and noting that this is *stricter* than the exercise router (factualErrors are a hard reject; the exercise side has no equivalent).
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: deterministic, testable mapping from validator output to writer decision. No I/O, no Claude calls.
  - _Leverage: `packages/db/src/generation/routing.ts` (exercise-side router — same accumulating-list pattern, decision-table structure, JSDoc convention)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 9. Write unit tests for `routing.ts`
  - File: `packages/db/src/theory-generation/routing.test.ts` (new)
  - One `describe` block per branch of the decision table; one `it` per acceptance criterion of Req 3:
    - `factualErrors` non-empty → rejected with factualErrors as reasons (Req 3.2).
    - `culturalIssues` non-empty → rejected with culturalIssues as reasons (Req 3.3).
    - `qualityScore < 0.5` → rejected with synthetic header + flaggedReasons (Req 3.4).
    - All four auto-approve conjuncts hold → auto-approved with empty reasons (Req 3.5).
    - Quality in [0.5, 0.7), no other failures → flagged with `'low quality score (<0.7)'` as the only reason.
    - `levelMismatch` only → flagged with `['level mismatch']`.
    - `sectionsIncomplete: ['formation']` only → flagged with `['incomplete section: formation']`.
    - `examplesUseGrammarPoint: false` only → flagged with `['examples off-target']`.
    - Multiple flag conditions hold → flagged with reasons in the documented fixed order (Req 3.6).
  - Add an exhaustive property test: `it('never returns manual-approved')` — instead of `Math.random()` (non-deterministic, flaky in CI), enumerate the relevant input axes by hand: `qualityScore ∈ {0.0, 0.49, 0.5, 0.69, 0.7, 1.0}` × `levelMismatch ∈ {true, false}` × `examplesUseGrammarPoint ∈ {true, false}` × `sectionsIncomplete ∈ {[], ['formation']}` × `factualErrors ∈ {[], ['x']}` × `culturalIssues ∈ {[], ['x']}` (= 384 cases, finite and reproducible). For each case, assert `routeTheoryValidationResult(...).reviewStatus !== 'manual-approved'` (Req 3.8).
  - Add an invariant test: `expect(THEORY_VALIDATION_THRESHOLDS.flagQualityFloor < THEORY_VALIDATION_THRESHOLDS.approveQualityFloor).toBe(true)` (Task 1's commented invariant).
  - Add a `Object.freeze` test: `expect(() => { (THEORY_VALIDATION_THRESHOLDS as any).flagQualityFloor = 0.9 }).toThrow()`. ESM is strict-mode by default under Vitest, so the assignment throws — no `'use strict'` directive needed.
  - Run `pnpm test --filter @language-drill/db` and confirm zero failures.
  - Purpose: exhaustive coverage of every decision-table branch. Pure-function tests; no DB, no Claude, no fixtures.
  - _Leverage: existing exercise-side routing tests under `packages/db/src/generation/` (if present, mirror the layout)_
  - _Requirements: 3.1–3.8, 6.3_

### Layer 3 — Orchestrator wiring (`packages/db/src/theory-generation`)

- [x] 10. Wire validator + router into `run-one-cell.ts`
  - File: `packages/db/src/theory-generation/run-one-cell.ts` (modify)
  - Imports: add `validateTheoryDraft, type TheoryValidationResult, addUsage` from `@language-drill/ai`; add `routeTheoryValidationResult, type TheoryRoutingDecision` from `./routing.js`.
  - After the existing `generateTheoryTopic` call returns (current code at ~line 194), insert:
    1. SIGINT recheck #1 (matching the existing pattern at lines 213–223). If aborted, `failClosed` with `tokenUsage = result.tokenUsage` and message `'Aborted by user (SIGINT)'`.
    2. `let validationResult: TheoryValidationResult` and `let validatorUsage: ClaudeUsageBreakdown`. Wrap `await validateTheoryDraft(client, draft, spec)` in a try/catch; on throw, return `failClosed({ ..., tokenUsage: result.tokenUsage, errorMessage: <message>, auditRowExists: true })`. Otherwise assign both.
    3. Accumulate `tokenUsage = addUsage(result.tokenUsage, validatorUsage)`.
    4. SIGINT recheck #2 after the validator's `await`. If aborted, `failClosed` with the accumulated `tokenUsage`.
    5. `const decision = routeTheoryValidationResult(validationResult)`.
  - Replace the existing single-branch INSERT (line ~231 — currently always inserts with `review_status: 'auto-approved'`) with a `switch (decision.reviewStatus)`:
    - `'rejected'`: skip INSERT. UPDATE `theoryGenerationJobs` with `status: 'succeeded'`, `approved: false`, `flagged: false`, `rejected: true`, `inputTokensUsed`, `outputTokensUsed: tokenUsage.outputTokens`, `costUsdEstimate: costUsd.toFixed(4)`. Return `{ cell, jobId, status: 'succeeded', insertedCount: 0, skippedCount: 0, tokenUsage, costUsd, durationMs, errorMessage: undefined }`.
    - `'flagged'`: INSERT into `theoryTopics` with `reviewStatus: 'flagged'`, `qualityScore: validationResult.qualityScore`, `flaggedReasons: decision.flaggedReasons` (the unique partial index does NOT fire on flagged rows — its predicate is `IN ('auto-approved', 'manual-approved')`). UPDATE the audit row with `approved: false, flagged: true, rejected: false`, the same token/cost fields. Return `{ ..., status: 'succeeded', insertedCount: 1, skippedCount: 0 }`.
    - `'auto-approved'`: INSERT into `theoryTopics` with `reviewStatus: 'auto-approved'`, `qualityScore: validationResult.qualityScore`, `flaggedReasons: null` — keep the existing `.onConflictDoNothing()`. If `inserted.length === 0` (dedup-skip branch), preserve the existing Phase 2 behavior verbatim. Otherwise UPDATE the audit row with `approved: true, flagged: false, rejected: false`.
  - The existing failClosed helper, audit-row-open step, `assertValidTheoryCellKey` precheck, and SIGINT-precheck-#0 stay verbatim. The cost-cap field (`args.maxCostUsd`) is **not** read in Phase 3 (design says defer to Phase 4); it stays in the type without enforcement.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the actual wiring change that switches the production write path from always-auto-approved to validator-driven routing.
  - _Leverage: existing Phase 2 scaffolding in the same file (audit row, SIGINT, failClosed, dedup branch); `packages/db/src/generation/run-one-cell.ts` (exercise-side equivalent wiring as a reference structure)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 11. Create Phase 3 validation fixtures + extend `generate-theory-mock-client.ts`
  - Files: `packages/db/scripts/__fixtures__/claude-theory-validation/auto-approved.json` (new), `…/flagged-quality.json` (new), `…/rejected-factual.json` (new), `packages/db/scripts/generate-theory-mock-client.ts` (modify)
  - **Fixtures first** so the mock client's fixture loader has something to read on its first call:
    - `auto-approved.json`: `{ "qualityScore": 0.85, "factualErrors": [], "levelMismatch": false, "sectionsIncomplete": [], "examplesUseGrammarPoint": true, "culturalIssues": [], "flaggedReasons": [] }`.
    - `flagged-quality.json`: `{ "qualityScore": 0.6, "factualErrors": [], "levelMismatch": false, "sectionsIncomplete": [], "examplesUseGrammarPoint": true, "culturalIssues": [], "flaggedReasons": ["voice is too encouraging"] }`.
    - `rejected-factual.json`: `{ "qualityScore": 0.4, "factualErrors": ["claims subjunctive is used after \"creo que\"; in modern usage it takes indicative"], "levelMismatch": false, "sectionsIncomplete": [], "examplesUseGrammarPoint": true, "culturalIssues": [], "flaggedReasons": [] }`.
  - **Then extend the mock client:**
    - Import `THEORY_VALIDATION_TOOL_NAME` from `@language-drill/ai`.
    - Add a fixtures-loader call for the new directory `__fixtures__/claude-theory-validation/`. If the dir doesn't exist or is empty, throw the same "no .json fixtures found" message as the generation loader.
    - Replace the single-dispatch tool_choice assertion: if `requestArgs.tool_choice?.name === THEORY_TOOL_NAME` → return the next generation fixture (existing behavior); if `…?.name === THEORY_VALIDATION_TOOL_NAME` → return the next validation fixture (cycle by ordinal-mod-length, same pattern as generation).
    - Maintain separate ordinals for generation and validation so the two streams don't interleave surprisingly.
    - Token usage: model validation as a small no-cache shape: `input_tokens: 4000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 200`. The validator's `cache_control` block is set up but the mock returns cache-write usage every call (matches the design's "ephemeral cache hits at ~0% in Phase 3" observation).
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the existing mock dispatches only generation calls. Phase 3 adds a validator round-trip per cell; without this change, the orchestrator's call to `validateTheoryDraft` would throw on the unexpected tool name. Pairing fixture creation with the mock update keeps the commit self-consistent.
  - _Leverage: existing dispatch logic in `generate-theory-mock-client.ts`; `packages/db/scripts/generate-exercises-mock-client.ts` (the exercise-side mock has a validator branch — match that shape)_
  - _Requirements: 6.4_

- [x] 12. Extend `run-one-cell.test.ts` with the three router-branch cases plus validator-failure path
  - File: `packages/db/src/theory-generation/run-one-cell.test.ts` (modify)
  - **Precondition:** Task 11's three validation fixtures already exist on disk. This task only modifies the existing Phase 2 test file.
  - In `run-one-cell.test.ts`, add three new test cases mirroring the existing Phase 2 happy-path test:
    - `it('inserts auto-approved row when validator approves')` — drive the mocked Claude client through one generation + one validation (auto-approve fixture); assert `theory_topics` has one row with `reviewStatus: 'auto-approved'`, `qualityScore: 0.85`, `flaggedReasons: null`; assert `theory_generation_jobs` row has `approved: true, flagged: false, rejected: false`.
    - `it('inserts flagged row when validator flags')` — flagged-quality fixture; assert one row with `reviewStatus: 'flagged'`, `qualityScore: 0.6`, `flaggedReasons: ['low quality score (<0.7)', 'voice is too encouraging']`; audit row has `approved: false, flagged: true, rejected: false`.
    - `it('skips INSERT when validator rejects')` — rejected-factual fixture; assert zero rows in `theory_topics` for the cell key; audit row has `approved: false, flagged: false, rejected: true`, `quality_score` denormalized.
    - `it('preserves generator tokenUsage when validator throws')` — drive the mock client to make `validateTheoryDraft` throw (mock generation succeeds; validation tool name mismatch); assert audit row's `inputTokensUsed` is non-zero (generator's) and the result's `errorMessage` is truncated to ≤ 1000 chars.
    - `it('aborts cleanly on SIGINT between generator and validator')` — pass an `AbortController.signal` that aborts after the generator call returns but before validator; assert `failClosed` result with the generator's `tokenUsage` recorded.
  - Run `pnpm test --filter @language-drill/db -- run-one-cell` and confirm all new cases pass.
  - Purpose: end-to-end coverage of the three terminal branches plus the two new failure paths added in Phase 3.
  - _Leverage: existing Phase 2 test cases in the same file (the happy-path test is the template); the new fixtures from this task_
  - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.8, 6.3, 6.4_

### Layer 4 — Review CLI (`packages/db/scripts`)

- [x] 13. Create `packages/db/scripts/theory-json-to-text.ts` plain-text renderer
  - File: `packages/db/scripts/theory-json-to-text.ts` (new)
  - Imports: `TheoryTopicJson, TheoryBlockJson, TheoryInlineJson, TheorySectionJson` from `@language-drill/shared`.
  - Export `theoryTopicJsonToText(topic: TheoryTopicJson): string` producing multi-line output per design Component 6:
    - Line 1: `topic.title` (no markup).
    - Line 2: `> ` + `topic.subtitle` (single-line, even if empty — emit `> ` alone).
    - Blank line.
    - For each section: `## ${section.title}` then the section body via `renderBlocks(section.body, indent: '')` then a blank line.
  - Internal helpers: `renderInline(node)` returns the text content for each variant (drops emphasis — terminal grep-ability over styling); `renderBlock(block, indent)` dispatches on `block.kind`: paragraph → indent + word-wrapped (80 cols) joined inline; callout → `${indent}! ` + `renderBlocks(block.children, indent + '  ')`; example → `${indent}• target: ${target}\n${indent}  en:     ${block.en}\n${indent}  note:   ${note}` (with `note` rendered via inline + word-wrap if present, else omit the note line); list → for each item, `${indent}- ${renderBlocks(item, indent + '  ')}`; conjugation-table → simple column-padded ASCII grid.
  - Add a `wordWrap(text: string, cols: number, indent: string): string` helper that wraps on word boundaries.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: replace the exercise-CLI's `JSON.stringify(row.contentJson, null, 2)` (unreadable for theory's deep tree) with something a reviewer can scan at glance.
  - _Leverage: `packages/shared/src/theory.ts` (the union types this dispatches on)_
  - _Requirements: 5.7_

- [x] 14. Write unit tests for `theory-json-to-text.ts`
  - File: `packages/db/scripts/theory-json-to-text.test.ts` (new)
  - One `it` per block kind (paragraph, callout, example, list, conjugation-table) with a hand-built `TheoryTopicJson` literal; assert the output contains the expected indent + content substrings.
  - One `it` per inline kind: assert emphasis is dropped (the text content survives, the wrapper markup does not).
  - Nested-callout test: a callout containing another callout — assert the inner block is indented two more spaces.
  - Word-wrap test: a paragraph with 200-char text wraps at 80 cols on word boundaries.
  - Hand-authored-fixture round-trip: load each of `apps/web/content/theory/es/{subjunctive,preterite-imperfect,conditional}.tsx`'s equivalent JSON (build a minimal literal for one of them inline; full fixture round-trip is overkill) and assert no thrown error.
  - Run `pnpm test --filter @language-drill/db -- theory-json-to-text` and confirm zero failures.
  - Purpose: catches rendering regressions early. Pure-function tests, no fixtures-on-disk dependency beyond what's inlined.
  - _Leverage: design Component 6 for expected output shape_
  - _Requirements: 5.7, 6.3_

- [x] 15. Create `packages/db/scripts/review-flagged-theory-parse-args.ts` argument parser
  - File: `packages/db/scripts/review-flagged-theory-parse-args.ts` (new)
  - Imports: `CurriculumCefrLevel, LearningLanguage` from `@language-drill/shared`; `collectRawFlags, requireString` from `./parse-args-common.js`.
  - Export `TheoryReviewArgs = { lang: LearningLanguage; level: CurriculumCefrLevel | null; grammarPoint: string | null; limit: number; allowProd: boolean }`.
  - Export `parseTheoryReviewArgs(argv: readonly string[]): TheoryReviewArgs`:
    1. If `argv.includes('--help')`, print HELP_TEXT to stdout and call `process.exit(0)`.
    2. `langRaw = requireString(raw, 'lang').toUpperCase()`. If `'EN'`, throw `"--lang en is not a learning language. Use es | de | tr."`. If not one of `ES | DE | TR`, throw `\`--lang must be one of ES, DE, TR (got '${langRaw}')\``.
    3. `level = parseLevelFlag(raw.get('level'))` — internal helper accepting `A1 | A2 | B1 | B2` (NOT C1/C2 — theory curriculum stops at B2). Throw on unsupported.
    4. `grammarPoint = raw.get('grammar-point') ?? null`.
    5. `limit = parseLimit(raw.get('limit'))` — default 25, range [1, 200].
    6. `allowProd = raw.get('allow-prod') === 'true'`. If `--allow-prod` passed but `NODE_ENV !== 'production'`, print a warning to stderr (non-fatal).
    7. Return the typed args object.
  - Add `HELP_TEXT` constant documenting the supported flags, with the example `pnpm review:flagged-theory --lang es --level B1`.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: pure CLI argument parser. No process spawn, no I/O — fully unit-testable.
  - _Leverage: `packages/db/scripts/review-flagged-parse-args.ts` (exercise-side parse-args — same shape minus `type`)_
  - _Requirements: 5.8_

- [x] 16. Write unit tests for `review-flagged-theory-parse-args.ts`
  - File: `packages/db/scripts/review-flagged-theory-parse-args.test.ts` (new)
  - Tests:
    - Required `--lang` happy path: `parseTheoryReviewArgs(['--lang', 'es'])` returns `{ lang: 'ES', level: null, grammarPoint: null, limit: 25, allowProd: false }`.
    - EN rejection: `parseTheoryReviewArgs(['--lang', 'en'])` throws with the explicit message.
    - Unsupported lang: `--lang fr` throws.
    - Level happy path: `--lang es --level B1` → `level: 'B1'`.
    - C1/C2 rejection: `--lang es --level C1` throws (theory stops at B2).
    - Grammar-point passthrough: `--grammar-point es-b1-foo` → `grammarPoint: 'es-b1-foo'`.
    - Limit happy path: `--limit 10` → 10; `--limit 0` throws; `--limit 201` throws; `--limit abc` throws.
    - `--help` calls `process.exit(0)` (spy on `process.exit`, assert called with 0).
    - `--allow-prod` outside production: warn to stderr (spy on `process.stderr.write`), still returns `allowProd: true`.
  - Run `pnpm test --filter @language-drill/db -- review-flagged-theory-parse-args` and confirm zero failures.
  - Purpose: contract tests for every documented flag combination.
  - _Leverage: `packages/db/scripts/review-flagged-parse-args.test.ts` (exercise-side tests as the structural template)_
  - _Requirements: 5.8, 6.3_

- [x] 17. Create `review-flagged-theory.ts` DB helpers (select, count, render, write)
  - File: `packages/db/scripts/review-flagged-theory.ts` (new — first half: helpers only; CLI main lands in Task 18)
  - Imports: `and, asc, count, eq` from `drizzle-orm`; `Db, createDb` from `../src/client.js`; `theoryTopics` from `../src/schema/index.js`; `TheoryTopicJson, parseTheoryTopicJson` from `@language-drill/shared`; `TheoryReviewArgs` from `./review-flagged-theory-parse-args.js`; `theoryTopicJsonToText` from `./theory-json-to-text.js`; `isUniqueViolation` from `./review-flagged.js`.
  - Export `FlaggedTheoryRow = { id, language, cefrLevel, grammarPointKey, topicId, contentJson, qualityScore, flaggedReasons, generatedAt }` (column subset per design Data Models).
  - Internal helper `flaggedTheorySlicePredicate(args: TheoryReviewArgs): SQL` building `review_status = 'flagged' AND language = $lang [AND cefr_level = $level] [AND grammar_point_key = $gp]`.
  - Export `selectFlaggedTheoryRows(db: Db, args: TheoryReviewArgs): Promise<FlaggedTheoryRow[]>` selecting the column subset, ordered by `asc(theoryTopics.generatedAt)`, limited by `args.limit`.
  - Export `countFlaggedTheory(db: Db, args: TheoryReviewArgs): Promise<number>` returning the slice count for the summary print.
  - Export `renderTheoryRow(row: FlaggedTheoryRow, stdout: NodeJS.WriteStream): void`:
    - Header line: `─── ${row.id.slice(0,8)}... ───  ${row.language} ${row.cefrLevel} ${row.grammarPointKey}  qualityScore=${score.toFixed(2)}`.
    - Body: try `theoryTopicJsonToText(parseTheoryTopicJson(row.contentJson))` and print; on throw print `(content render error: ${truncated})` instead.
    - Footer: `Flagged reasons:` then bulleted `row.flaggedReasons` (or `(none recorded)` if empty/null).
  - Export `tryApproveTheory(db: Db, row: FlaggedTheoryRow): Promise<'approved' | 'demoted'>`:
    - First UPDATE: `set({ reviewStatus: 'manual-approved', flaggedReasons: null }).where(and(eq(theoryTopics.id, row.id), eq(theoryTopics.reviewStatus, 'flagged')))`.
    - On thrown `isUniqueViolation` → second UPDATE setting `reviewStatus: 'rejected'` with the same WHERE; return `'demoted'`.
    - On other errors, re-throw.
  - Export `rejectTheoryRow(db: Db, row: FlaggedTheoryRow): Promise<void>` issuing the rejected-UPDATE; `flaggedReasons` is intentionally preserved.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the DB read + write surface for the CLI. Each export is independently testable.
  - _Leverage: `packages/db/scripts/review-flagged.ts:64-176, 314-376` (slice predicate + select/count + render + write patterns)_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

- [x] 18. Add `main` driver + summary printer to `review-flagged-theory.ts`
  - File: `packages/db/scripts/review-flagged-theory.ts` (modify — continue from Task 17)
  - Imports (add): `createKeystrokeReader, type KeystrokeReader` from `./review-flagged.js`; `requireEnv` from `./env-helpers.js`; `fileURLToPath` from `node:url`; `Readable` from `node:stream`; `parseTheoryReviewArgs` from `./review-flagged-theory-parse-args.js`.
  - Export `TheoryReviewCounts = { approved: number; rejected: number; skipped: number; demoted: number }`.
  - Export `printTheoryReviewSummary(counts: TheoryReviewCounts, totalReviewed: number, remaining: number, stdout: NodeJS.WriteStream): void`:
    - `Reviewed ${totalReviewed} theory page(s): ${counts.approved} approved, ${counts.rejected} rejected, ${counts.skipped} skipped, ${counts.demoted} demoted`.
    - If `remaining > 0`: `(${remaining} flagged remain in this slice — re-run to continue)`.
  - Export `async function main(argv: readonly string[] = process.argv.slice(2), stdinSource: NodeJS.ReadStream | Readable = process.stdin): Promise<void>`:
    1. `const args = parseTheoryReviewArgs(argv)`.
    2. Production guard: `if (process.env['NODE_ENV'] === 'production' && !args.allowProd) { console.error('Refusing to run in production. Pass --allow-prod or use the Phase 5 admin UI.'); process.exit(1); }`.
    3. `const db = createDb(requireEnv('DATABASE_URL'))`.
    4. `const rows = await selectFlaggedTheoryRows(db, args)`. If `rows.length === 0` print `No flagged theory pages match the filter.` and return.
    5. `const counts: TheoryReviewCounts = { approved: 0, rejected: 0, skipped: 0, demoted: 0 }`; `const reader = createKeystrokeReader(stdinSource)`; `let processedCount = 0`.
    6. `try { outer: for (const row of rows) { renderTheoryRow(row, process.stdout); while (true) { process.stdout.write('[a]pprove / [r]eject / [s]kip / [q]uit > '); const key = await reader.next(); if (key === 'a') { const result = await tryApproveTheory(db, row); if (result === 'approved') { stdout.write('✓ approved\n'); counts.approved++; } else { stdout.write('↓ demoted (another approved row already in cell)\n'); counts.demoted++; } processedCount++; break; } else if (key === 'r') { await rejectTheoryRow(db, row); stdout.write('✗ rejected\n'); counts.rejected++; processedCount++; break; } else if (key === 's') { counts.skipped++; processedCount++; break; } else if (key === 'q') { break outer; } else { stdout.write('use a/r/s/q\n'); } } } const remaining = await countFlaggedTheory(db, args); printTheoryReviewSummary(counts, processedCount, remaining, process.stdout); } finally { reader.close(); }`.
  - Add the direct-run guard at the bottom (mirror of `review-flagged.ts:489-503`): if invoked directly, run `main()` and `process.exit(0)` on success or `1` on error.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the interactive driver. Importable from tests via the exported `main(argv, stdinSource)` signature.
  - _Leverage: `packages/db/scripts/review-flagged.ts:412-503` (main + summary + direct-run guard pattern)_
  - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.9, 5.10_

- [x] 19. Wire `review:flagged-theory` script in `package.json` files
  - Files: root `package.json` (modify), `packages/db/package.json` (modify)
  - In root `package.json` `scripts` block, add `"review:flagged-theory": "dotenv -e .env -- pnpm --filter @language-drill/db review:flagged-theory"` next to the existing `review:flagged` line.
  - In `packages/db/package.json` `scripts` block, add `"review:flagged-theory": "tsx scripts/review-flagged-theory.ts"` next to the existing `review:flagged` script.
  - Verify: `pnpm review:flagged-theory --help` from repo root prints the HELP_TEXT and exits 0.
  - Purpose: makes the CLI invocable via the conventional `pnpm` alias.
  - _Leverage: existing `review:flagged` wiring in both files_
  - _Requirements: 5.1_

- [x] 20. Write integration tests for `review-flagged-theory.ts`
  - File: `packages/db/scripts/review-flagged-theory.test.ts` (new)
  - Unit tests (no DB):
    - `printTheoryReviewSummary` formatting: zero / non-zero / with-remaining cases.
    - `renderTheoryRow` with a minimal `FlaggedTheoryRow` literal: assert header substring, plain-text body presence, footer reasons bullets.
    - `renderTheoryRow` with broken `contentJson` (e.g. `{ kind: 'unknown-block' }`): assert `(content render error: ...)` substring.
  - Integration tests (DB-touching — use the existing project pattern):
    - Seed three rows directly via `db.insert(theoryTopics)` with `reviewStatus: 'flagged'`, distinct `id`/`grammarPointKey`/`generatedAt`.
    - Drive `main(['--lang', 'es'], buildReadable(['a', 'r', 's']))` where `buildReadable` is a small helper returning a `Readable` that pushes one character per `data` event.
    - After `main` returns, assert row states: first row `reviewStatus='manual-approved'`, second `'rejected'`, third still `'flagged'`.
    - `tryApproveTheory` demote test: seed an `auto-approved` row in cell `(ES, es-b1-foo)`, then seed a `flagged` duplicate in the same cell; call `tryApproveTheory(db, flaggedRow)`; assert it returns `'demoted'` and the flagged row's state is now `'rejected'` while the auto-approved row is untouched.
    - Concurrent-write no-op test: select a flagged row, then `UPDATE … SET review_status='rejected' WHERE id = …` directly, then call `tryApproveTheory(db, row)` — assert it succeeds with no rows affected (the `AND review_status = 'flagged'` guard) and the row remains `rejected`.
  - Run `pnpm test --filter @language-drill/db -- review-flagged-theory` and confirm zero failures.
  - Purpose: the CLI's behavioral correctness gate. Covers every Req 5 acceptance criterion behavioral case.
  - _Leverage: `packages/db/scripts/review-flagged.test.ts` (the structural template — buildReadable helper, DB-seeding pattern, integration-test layout)_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.9, 5.10, 6.3_

### Layer 5 — Verification

- [x] 21. Pre-push gate — run lint + typecheck + tests from repo root
  - File: (verification only — no code changes)
  - Run `pnpm lint` from repo root; expect zero warnings, zero errors. If anything in `packages/ai/src/theory-validate.ts`, `theory-validation-prompts.ts`, `theory-validation-thresholds.ts`, `packages/db/src/theory-generation/routing.ts`, `packages/db/scripts/review-flagged-theory*.ts`, or `theory-json-to-text.ts` reports an ESLint warning, fix in place (most likely candidates: unused imports, missing return types on internal helpers, `any` in test files).
  - Run `pnpm typecheck` from repo root; expect zero errors. Most likely failure surfaces: missing `index.ts` re-export (Task 7), import cycle between `theory-validation-prompts.ts` and `theory-validate.ts`, missing `flaggedReasons: null` vs `[]` in INSERT statement.
  - Run `pnpm test` from repo root; expect every test green. Verify the new test files run: `theory-validate.test.ts`, `theory-validation-prompts.test.ts`, `routing.test.ts` (theory), `run-one-cell.test.ts` (extended), `review-flagged-theory-parse-args.test.ts`, `review-flagged-theory.test.ts`, `theory-json-to-text.test.ts`.
  - **Manual smoke test (not in CI, runs against dev Neon branch):**
    1. `pnpm db:migrate` (no-op if Phase 1 schema is already applied).
    2. `MOCK_CLAUDE=1 pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive` — should produce one row; verify `review_status` matches whatever the first validation fixture dictates.
    3. With a real `ANTHROPIC_API_KEY`: `pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive` against a clean dev branch — verify it produces one row, then run `pnpm review:flagged-theory --lang es` to confirm the CLI either reports `No flagged theory pages match the filter.` (if auto-approved) or walks the flagged row.
  - Commit and push.
  - Purpose: the ship gate. Phase 3 is not done until this is green.
  - _Leverage: `CLAUDE.md` §Pre-Push Checks_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
