# Implementation Plan

## Task Overview

Phase 3 ships in nine thin layers, each independently mergeable. The order is "foundation first": the schema migration + the widened `normaliseSurface` ship before any validator code so the dedup index is in place when the writer first tries to use it.

1. **Foundation** (Tasks 1–3) — `normaliseSurface` widening + its co-located tests, then the schema declaration + Drizzle-generated migration.
2. **Validation prompts** (Tasks 4–5) — pure prompt builders + their tests; no Claude calls yet.
3. **Validator core** (Tasks 6–9) — `validate.ts` filled in three thin slices (constants + tool schema; `parseValidationResult`; `validateDraft` body), then the test file.
4. **Public surface** (Task 10) — `@language-drill/ai` barrel re-exports the new validator symbols. Lands after Tasks 4–9 so every advertised symbol exists.
5. **Routing helper** (Tasks 11–12) — pure `routeValidationResult` + its tests, in `packages/db/scripts/`.
6. **Mock infrastructure** (Tasks 13–14) — fixture set + the validator mock dispatched alongside the existing generator mock.
7. **`runOneCell` extension** (Tasks 15–17) — `validateAndInsertWithRetry` helper, then the per-cell wiring + audit-row column updates, then the summary printer extension.
8. **Review CLI** (Tasks 18–24) — extracted `parse-args-common.ts` (18), `env-helpers.ts` (19), `review-flagged-parse-args.ts` + tests (20), `review-flagged.ts` in three thin slices (21 read+render; 22 interactive writes; 23 main+summary), then integration tests (24).
9. **Integration + script wiring + manual smoke** (Tasks 25–27) — extended generator-CLI integration tests, `pnpm review:flagged` script wiring + pre-push, then the one-shot Claude smoke before merge.

## Steering Document Compliance

- **Tool-use + `cache_control: ephemeral`** (`tech.md` §"AI / GenAI"): Tasks 6–8 mirror `evaluate.ts` and `generate.ts` beat-for-beat — same `Anthropic.Tool` shape, same `tool_choice`, same cached `system` block. No new client construction logic.
- **Co-located tests** (`CLAUDE.md` §Testing): every test file lives next to the module it tests (Tasks 1, 5, 9, 12, 21, 23). No orphan test files.
- **Forward-only migrations** (`tech.md` §5): Task 3 adds exactly one migration (the `0006_*.sql` index); no column additions; no alters.
- **`onConflictDoNothing` + deterministic IDs** (existing pattern in Phase 2's writer): Task 16's `validateAndInsertWithRetry` per-draft INSERT is identical syntax. Re-runs of the CLI never produce duplicate rows. The dedup-retry path uses bumped `batchSeed` to derive different deterministic UUIDs.
- **Drizzle barrel + helper re-exports** (`packages/db/src/index.ts`): no changes — Phase 2 already promoted everything Phase 3 needs.
- **Tests-before-merge**: every task that touches code closes by running `pnpm test --filter <package>` for the affected package. The phase-level pre-push (`pnpm lint && pnpm typecheck && pnpm test`) runs in Task 26.

## Atomic Task Requirements

Each task below touches ≤ 3 files, is bounded to 15–30 minutes for an experienced developer, and has a single testable outcome. The validator-core tasks (6–9) are at the upper end of the box because each adds ~80–120 LOC of pattern-matched code; they remain single-file, single-purpose, and trivially reviewable against the design's component definitions.

## Tasks

### Layer 1 — Foundation: `normaliseSurface` widening + dedup migration

- [x] 1. Widen `normaliseSurface` in `generation-prompts.ts` to fold whitespace
  - File: `packages/ai/src/generation-prompts.ts` (modify)
  - Extend `normaliseSurface` (lines 144-149) with two additional steps after the diacritic strip: `.replace(/\s+/gu, ' ')` (collapse whitespace runs), then `.trim()` (strip leading/trailing). Order matters — whitespace collapse before trim so that a single trailing whitespace run is squashed first then trimmed.
  - Do NOT change `canonicalSurface` (lines 151-166) — it delegates to `normaliseSurface` and inherits the new behavior automatically. Every existing caller (`recentStems` accumulation in `generate.ts:593-596`, in-batch dedup marker logic) inherits without modification.
  - Purpose: make `canonicalSurface` robust against trivial whitespace differences before the dedup index relies on it for uniqueness.
  - _Leverage: existing `normaliseSurface` + `canonicalSurface` from Phase 2_
  - _Requirements: 4.8_

- [x] 2. Extend `generation-prompts.test.ts` with whitespace-folding cases
  - File: `packages/ai/src/generation-prompts.test.ts` (modify)
  - Add three new assertions inside the existing `describe('canonicalSurface', ...)` block: (a) cloze `sentence: 'Yo  HABLO   españól.'` → `'yo hablo espanol.'` (multiple spaces fold); (b) cloze `sentence: '  espero que llegues a tiempo.  '` → `'espero que llegues a tiempo.'` (leading/trailing trimmed); (c) translation `sourceText: 'I\thope\nyou arrive on time.'` → `'i hope you arrive on time.'` (tabs/newlines treated as whitespace via `\s`).
  - Verify the existing diacritic + lowercase + NFKD assertion (Phase 2) still passes unchanged.
  - Run `pnpm test --filter @language-drill/ai` — every Phase 2 test in this file MUST still pass.
  - Purpose: pin the new whitespace behavior before any caller depends on it.
  - _Leverage: existing test file from Phase 2_
  - _Requirements: 4.8, 7.8_

- [x] 3. Declare `exercises_dedup_idx` and generate the `0006_*.sql` migration
  - File: `packages/db/src/schema/exercises.ts` (modify)
  - File: `packages/db/migrations/0006_*.sql` (new — name auto-generated by Drizzle)
  - Import `uniqueIndex` from `drizzle-orm/pg-core`. In the `exercises` table builder, add a second key alongside `poolLookupIdx`: `dedupIdx: uniqueIndex('exercises_dedup_idx').on(table.language, table.type, table.difficulty, table.grammarPointKey, sql\`(content_json->>'_dedupKey')\`).where(sql\`${table.reviewStatus} IN ('auto-approved', 'manual-approved', 'flagged') AND content_json ? '_dedupKey'\`)`.
  - Add a one-line comment on the `contentJson` column declaration noting that the JSONB blob carries an underscore-prefixed `_dedupKey` writer field beyond the discriminated-union shape (design Component 4 closing note + Data Models clarification).
  - Run `pnpm --filter @language-drill/db drizzle-kit generate` to emit `0006_*.sql`. Verify the generated SQL contains the partial `WHERE` clause exactly as specified in the design's Component 4. Add a `-- TODO(prod): change to CREATE UNIQUE INDEX CONCURRENTLY when running on the production branch.` line at the top of the generated file (the dev branch is too small for `CONCURRENTLY` to matter; production needs it).
  - Run `pnpm db:migrate` against the dev Neon branch. The migration MUST succeed against the existing 36 hand-authored seed exercises (none have `_dedupKey`, so they're excluded by the partial-index `WHERE`).
  - Purpose: enforce across-batch surface dedup at the storage layer.
  - _Leverage: existing `index()` declaration pattern from `exercises.ts:27-30`; existing `WHERE`-clause idiom from `poolLookupIdx`_
  - _Requirements: 4.1, 4.2, 8.4_

### Layer 2 — Validation prompts (pure)

- [x] 4. Create `validation-prompts.ts` with `buildValidationSystemPrompt` and `buildValidationUserPrompt`
  - File: `packages/ai/src/validation-prompts.ts` (new)
  - Export `VALIDATION_SYSTEM_PROMPT_TEMPLATE: string` (the raw template constant for tests to assert against).
  - Implement `buildValidationSystemPrompt(spec: GenerationSpec): string` — pure, deterministic. Render the template described in design Component 2: header with language + cefrLevel + grammar point name; "strict reviewer" framing; explicit routing-implication block (the rules from plan §3.1 verbatim); grammar point context (description + examplesPositive + commonErrors); `CEFR_LEVEL_DESCRIPTORS` block interpolated from `./prompts.js` (one source of truth across all three Claude paths); a "Dimensions to score" section mapping one-to-one to `ValidationResult` fields; an output instruction telling Claude to use `submit_validation_result`.
  - Implement `buildValidationUserPrompt(draft: ExerciseDraft): string` — branches on `draft.contentJson.type`. For each type, render the per-type body shown in design Component 2 (cloze: instructions / sentence / correctAnswer / options? / context?; translation: instructions / sourceText / sourceLanguage / targetLanguage / referenceTranslation; vocab_recall: instructions / prompt / expectedWord / hints / exampleSentence). Each user prompt SHALL include a "Spec:" preamble naming the language, cefrLevel, and grammar point key so the validator can independently judge `levelMatch` and `grammarPointMatch`.
  - Two calls with the same `(spec)` SHALL produce byte-identical strings (cache requirement). Two calls with the same `(draft)` SHALL produce byte-identical strings.
  - Purpose: one file owning every validator-prompt decision. Pure — no I/O, no Claude.
  - _Leverage: `packages/ai/src/prompts.ts` (`CEFR_LEVEL_DESCRIPTORS`); `@language-drill/db` (`GrammarPoint` via `GenerationSpec`); `@language-drill/shared` (`ExerciseContent`, `ExerciseType`); the structural pattern of `packages/ai/src/generation-prompts.ts` Phase 2 file_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 5. Create `validation-prompts.test.ts`
  - File: `packages/ai/src/validation-prompts.test.ts` (new)
  - Fixture: pick `getGrammarPoint('es-b1-present-subjunctive')` for assertions (same fixture Phase 2 used).
  - Tests:
    - Two calls with identical `spec` → identical system prompt strings (cache invariant).
    - System prompt contains: the chosen grammar point's `name`, `description`, every `examplesPositive[i]` verbatim, every `commonErrors[i]` verbatim.
    - System prompt contains the B1 descriptor verbatim from `CEFR_LEVEL_DESCRIPTORS` AND the same descriptor appears verbatim in `EVALUATION_SYSTEM_PROMPT` (locks the DRY invariant — same shape Phase 2 uses for the generator).
    - System prompt contains the routing-implication block verbatim (asserts the `qualityScore < 0.5 OR culturalIssues → REJECTED` line, the `0.5..0.7 → FLAGGED` line, the auto-approved conjunction line).
    - For each `ExerciseType`, `buildValidationUserPrompt` returns a string containing every documented field for that type (cloze: instructions/sentence/correctAnswer; translation: instructions/sourceText/sourceLanguage/targetLanguage/referenceTranslation; vocab_recall: instructions/prompt/expectedWord/hints/exampleSentence) AND the "Spec:" preamble line naming language, cefrLevel, grammar point key.
  - Purpose: pin every validator-prompt invariant before any Claude call enters the picture.
  - _Leverage: Tasks 2, 4; `@language-drill/db` `getGrammarPoint`; `@language-drill/ai` `EVALUATION_SYSTEM_PROMPT`, `CEFR_LEVEL_DESCRIPTORS`_
  - _Requirements: 7.2_

### Layer 3 — Validator core

- [x] 6. Create `validate.ts` with constants and `VALIDATION_TOOL` schema
  - File: `packages/ai/src/validate.ts` (new)
  - Define and export: `VALIDATION_MODEL = 'claude-sonnet-4-5' as const`; `VALIDATION_MAX_TOKENS = 1024`; `VALIDATION_TEMPERATURE = 0.0`; `VALIDATION_TOOL_NAME = 'submit_validation_result'`.
  - Define and export `VALIDATION_TOOL: Anthropic.Tool` with the input_schema described in design Component 1: six required properties (`qualityScore` number, `ambiguous` boolean, `levelMatch` boolean, `grammarPointMatch` boolean, `culturalIssues` array of strings, `flaggedReasons` array of strings). Each property's `description` SHALL include the routing implication so Claude can self-calibrate.
  - Define and export the `ValidationResult` and `ValidateDraftResult` types per design Component 1.
  - Do NOT implement `parseValidationResult` or `validateDraft` yet — those land in Tasks 7 and 8.
  - File compiles via `pnpm typecheck --filter @language-drill/ai`.
  - Purpose: lock the validator's static surface (constants + tool schema + types) before any logic.
  - _Leverage: `evaluate.ts` `EVALUATION_TOOL` shape (`evaluate.ts:22-104`) for the schema layout pattern; `generate.ts` `GENERATION_MODEL`/`GENERATION_TEMPERATURE` constants for the export pattern_
  - _Requirements: 1.2, 1.7, 8.5_

- [x] 7. Implement `parseValidationResult` in `validate.ts`
  - File: `packages/ai/src/validate.ts` (modify)
  - Implement and export `parseValidationResult(input: unknown): ValidationResult`. Mirror of `parseEvaluationResult` (`evaluate.ts:128-200`): assert `input` is an object; for each numeric field validate type AND range (`qualityScore` in `[0, 1]`); for each boolean field validate `typeof === 'boolean'`; for each array-of-strings field validate `Array.isArray` AND every element `typeof === 'string'`. On any mismatch, throw an `Error` whose message names the offending field and shows `JSON.stringify(value)` (mirror of evaluator's error-message format).
  - Reuse the small private helpers from `generate.ts:269-330` (`isObject`, `requireString`, `optionalString`, `requireStringArray`) by either re-importing them (if they're exported) or by re-declaring local equivalents at the top of `validate.ts`. Pick whichever keeps the import graph cleaner — these helpers are private to `generate.ts` today; re-declaring them is fine and keeps the validator self-contained.
  - Purpose: structured-output parser, same shape as the evaluator. Throws on every shape error before the validator returns.
  - _Leverage: `parseEvaluationResult` (`packages/ai/src/evaluate.ts:128-200`) as the exact structural template_
  - _Requirements: 1.4_

- [x] 8. Implement `validateDraft` body in `validate.ts`
  - File: `packages/ai/src/validate.ts` (modify)
  - Import `addUsage`, `ZERO_USAGE`, `ClaudeUsageBreakdown` from `./cost-model.js`; `ExerciseDraft`, `GenerationSpec`, `TOOL_NAME_BY_TYPE` from `./generate.js`; `buildValidationSystemPrompt`, `buildValidationUserPrompt` from `./validation-prompts.js`.
  - Implement and export `validateDraft(client, draft, spec)` per the design Component 1 body sketch:
    1. Top-of-function guard: `if (!(draft.contentJson.type in TOOL_NAME_BY_TYPE)) throw new Error(\`Unsupported draft.contentJson.type: ${draft.contentJson.type}\`);` — keys off `draft.contentJson.type`, not `spec.exerciseType` (Requirement 1.8 + design fix).
    2. Build `systemText = buildValidationSystemPrompt(spec)` and `userText = buildValidationUserPrompt(draft)`.
    3. Call `client.messages.create` with `model: VALIDATION_MODEL`, `max_tokens: VALIDATION_MAX_TOKENS`, `temperature: VALIDATION_TEMPERATURE`, `system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]`, `messages: [{ role: 'user', content: userText }]`, `tools: [VALIDATION_TOOL]`, `tool_choice: { type: 'tool', name: VALIDATION_TOOL_NAME }`.
    4. Find the tool-use block in `response.content`. Throw with `stop_reason` in the message if absent (mirror `evaluate.ts:257-263`); throw with the unexpected name in the message if name mismatch (mirror `evaluate.ts:265-269`).
    5. Run `parseValidationResult(toolUseBlock.input)` to get the typed result; on parser throw, re-raise unchanged (the parser already names the field).
    6. Build `tokenUsage` from `response.usage` using the same `readUsage` shape `generate.ts:494-502` defines (re-declare a local copy or extract — pick whichever keeps the diff small).
    7. Return `{ result, tokenUsage }`.
  - SHALL NOT mutate `draft` or `spec` — both are treated as immutable.
  - Purpose: the public function. Mirror of `evaluateAnswer` structurally.
  - _Leverage: `evaluateAnswer` (`packages/ai/src/evaluate.ts:220-272`) end-to-end pattern_
  - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.8, 1.9, 2.7_

- [x] 9. Create `validate.test.ts`
  - File: `packages/ai/src/validate.test.ts` (new)
  - Mocked-SDK pattern from `evaluate.test.ts:283-337`. Tests:
    - **Happy path:** mock `client.messages.create` to return a valid tool_use block with all six fields populated; assert `validateDraft` returns the expected `ValidationResult`; assert the call args include `model: VALIDATION_MODEL`, `temperature: 0`, `max_tokens: VALIDATION_MAX_TOKENS`, `tools: [VALIDATION_TOOL]`, `tool_choice: { type: 'tool', name: VALIDATION_TOOL_NAME }`, and the `system` block carries `cache_control: { type: 'ephemeral' }`.
    - **Unsupported type guard (Req 1.8):** construct a draft by spreading a real `ClozeContent` and forcing `type` to `'unknown' as ExerciseType`; assert `validateDraft` throws AND `mockCreate` was never called. The test SHALL also confirm the throw fires when `spec.exerciseType` is the *correct* `'cloze'` but `draft.contentJson.type` is `'unknown'` — proving the guard reads from the draft, not the spec.
    - **Malformed responses:** (a) no tool_use block → throws with `stop_reason` in message; (b) wrong tool name → throws with the unexpected name in message; (c) tool input fails `parseValidationResult` (e.g. `qualityScore = 1.5`) → throws.
    - **`parseValidationResult` rejections:** non-object input; `qualityScore` of `'not a number'`, `-0.1`, `1.1`; `ambiguous` not boolean; non-array `culturalIssues`; non-string element in `culturalIssues`; missing required field.
    - **Cross-file model invariant (Req 8.5):** `expect(VALIDATION_MODEL).toBe(GENERATION_MODEL)` AND `expect(VALIDATION_MODEL).toBe('claude-sonnet-4-5')`.
    - **Immutability:** capture deep copies of `draft` and `spec` before the call; deep-equal against the originals after.
    - **Token usage extraction:** mock returns a `usage` block with all four tiers populated; assert `tokenUsage` reflects each field correctly (defaults 0 when SDK omits).
  - Run `pnpm test --filter @language-drill/ai` and confirm every assertion passes.
  - Purpose: pin the validator's behavior before any caller depends on it.
  - _Leverage: `evaluate.test.ts` mocked-SDK pattern (`evaluate.test.ts:283-401`)_
  - _Requirements: 7.1_

### Layer 4 — `@language-drill/ai` public surface

- [x] 10. Re-export validator symbols from the `@language-drill/ai` barrel
  - File: `packages/ai/src/index.ts` (modify)
  - Add at the end of the file (alphabetically in the existing block layout):
    ```ts
    export {
      validateDraft,
      parseValidationResult,
      VALIDATION_TOOL,
      VALIDATION_TOOL_NAME,
      VALIDATION_MODEL,
      VALIDATION_MAX_TOKENS,
      VALIDATION_TEMPERATURE,
    } from './validate.js';
    export type { ValidationResult, ValidateDraftResult } from './validate.js';
    export {
      buildValidationSystemPrompt,
      buildValidationUserPrompt,
      VALIDATION_SYSTEM_PROMPT_TEMPLATE,
    } from './validation-prompts.js';
    ```
  - Run `pnpm typecheck --filter @language-drill/ai` and `pnpm typecheck --filter @language-drill/db` to confirm both still pass — the new exports must be importable from `packages/db/scripts/`.
  - Purpose: unblock Tasks 11+ from importing validator symbols through the public package boundary.
  - _Leverage: existing barrel structure (`packages/ai/src/index.ts:31-67`)_
  - _Requirements: 1.1, 8.7_

### Layer 5 — Routing helper

- [x] 11. Create `generate-exercises-validate.ts` with `routeValidationResult`
  - File: `packages/db/scripts/generate-exercises-validate.ts` (new)
  - Import `ValidationResult` from `@language-drill/ai`.
  - Define and export: `VALIDATION_THRESHOLDS = Object.freeze({ approveQualityFloor: 0.7, flagQualityFloor: 0.5 })`; `ReviewStatus` type union (`'auto-approved' | 'flagged' | 'rejected' | 'manual-approved'`); `RoutingDecision` type (`{ reviewStatus: ReviewStatus; flaggedReasons: string[] }`).
  - Implement `routeValidationResult(result: ValidationResult): RoutingDecision` exactly per the design Component 3 body. Reasons-ordering rules:
    - **Rejected branch** (`qualityScore < 0.5` OR `culturalIssues.length > 0`): push `'low quality score (<0.5)'` first only when `qualityScore < 0.5`, then push every `result.culturalIssues` entry in original order. Return `{ reviewStatus: 'rejected', flaggedReasons }`.
    - **Auto-approve branch** (`qualityScore >= 0.7` AND `!ambiguous` AND `levelMatch` AND `grammarPointMatch` AND `culturalIssues.length === 0`): return `{ reviewStatus: 'auto-approved', flaggedReasons: [] }`.
    - **Flagged branch** (otherwise): push reasons in this exact order — `'low quality score (<0.7)'` (when `qualityScore < 0.7`), `'ambiguous'` (when `result.ambiguous`), `'level mismatch'` (when `!result.levelMatch`), `'grammar point mismatch'` (when `!result.grammarPointMatch`), then every `result.flaggedReasons` entry in original order.
  - `'manual-approved'` SHALL NOT be returned by this function — it is set only by the review CLI.
  - Purpose: single source of truth for the routing rule from plan §3.1. Pure — no I/O.
  - _Leverage: `Object.freeze` pattern from `cost-model.ts:21`; `ValidationResult` type from `@language-drill/ai`_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 12. Create `generate-exercises-validate.test.ts`
  - File: `packages/db/scripts/generate-exercises-validate.test.ts` (new)
  - Cover every routing branch with deterministic fixture inputs:
    - `qualityScore: 0.4, ambiguous: false, levelMatch: true, grammarPointMatch: true, culturalIssues: [], flaggedReasons: []` → `rejected` with `flaggedReasons: ['low quality score (<0.5)']`.
    - `qualityScore: 0.9, ambiguous: false, levelMatch: true, grammarPointMatch: true, culturalIssues: ['stereotyping middle-eastern characters'], flaggedReasons: []` → `rejected` with `flaggedReasons: ['stereotyping middle-eastern characters']` (no `'low quality score'` reason because score is fine).
    - `qualityScore: 0.3, ambiguous: false, levelMatch: true, grammarPointMatch: true, culturalIssues: ['issue A', 'issue B'], flaggedReasons: []` → `rejected` with `flaggedReasons: ['low quality score (<0.5)', 'issue A', 'issue B']` (deterministic order).
    - `qualityScore: 0.85, ambiguous: false, levelMatch: true, grammarPointMatch: true, culturalIssues: [], flaggedReasons: []` → `auto-approved` with `flaggedReasons: []`.
    - `qualityScore: 0.6, ambiguous: false, levelMatch: true, grammarPointMatch: true, culturalIssues: [], flaggedReasons: []` → `flagged` with `flaggedReasons: ['low quality score (<0.7)']`.
    - `qualityScore: 0.8, ambiguous: true, levelMatch: true, grammarPointMatch: true, culturalIssues: [], flaggedReasons: []` → `flagged` with `flaggedReasons: ['ambiguous']`.
    - `qualityScore: 0.8, ambiguous: false, levelMatch: false, grammarPointMatch: true, culturalIssues: [], flaggedReasons: []` → `flagged` with `flaggedReasons: ['level mismatch']`.
    - `qualityScore: 0.8, ambiguous: false, levelMatch: true, grammarPointMatch: false, culturalIssues: [], flaggedReasons: []` → `flagged` with `flaggedReasons: ['grammar point mismatch']`.
    - **Multi-failure determinism:** `qualityScore: 0.6, ambiguous: true, levelMatch: false, grammarPointMatch: false, culturalIssues: [], flaggedReasons: ['extra reason']` → `flagged` with `flaggedReasons: ['low quality score (<0.7)', 'ambiguous', 'level mismatch', 'grammar point mismatch', 'extra reason']` in exact order.
    - **`flaggedReasons` passthrough:** when only `qualityScore: 0.6` is below threshold and `result.flaggedReasons: ['x', 'y']`, the routed reasons end with `['low quality score (<0.7)', 'x', 'y']`.
  - Run `pnpm test --filter @language-drill/db`.
  - Purpose: pin the routing rule before `runOneCell` depends on it.
  - _Leverage: Task 11; the deterministic-order assertions in `generate-exercises.test.ts` (Phase 2) for the test-style template_
  - _Requirements: 7.3_

### Layer 6 — Mock infrastructure (validator fixture set + mock client extension)

- [x] 13. Author validator + retry fixture set
  - File: `packages/db/scripts/__fixtures__/claude-validation/cloze-approved.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/cloze-flagged.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/cloze-rejected.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/translation-approved.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/translation-flagged.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/translation-rejected.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/vocab_recall-approved.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/vocab_recall-flagged.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-validation/vocab_recall-rejected.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-generation/cloze-retry.json` (new) — one extra cloze fixture whose `sentence` differs from `cloze.json` ordinal 0; used by Task 25's dedup-retry happy-path test to simulate a regenerated draft with a different canonical surface.
  - Each validator file contains a single JSON object matching the `ValidationResult` shape. Use the values from design Component 7's example: approved → `{ qualityScore: 0.85, ambiguous: false, levelMatch: true, grammarPointMatch: true, culturalIssues: [], flaggedReasons: [] }`. Flagged → `{ qualityScore: 0.6, ambiguous: true, levelMatch: true, grammarPointMatch: true, culturalIssues: [], flaggedReasons: ['borderline answer ambiguity'] }`. Rejected → `{ qualityScore: 0.3, ambiguous: false, levelMatch: false, grammarPointMatch: false, culturalIssues: [], flaggedReasons: [] }`.
  - The nine validator files are 3 outcomes × 3 types — currently the validator is type-agnostic in its outcome shape so the per-type variations are identical, but the per-type files give the integration tests room to specialize fixtures later (e.g. type-specific cultural-issue strings) without restructuring.
  - The `cloze-retry.json` file matches the `ClozeContent` shape (mirror of `cloze.json` ordinal 0 fixture from Phase 2 with one altered sentence — e.g. swap the subject from `Yo` to `Tú` so `canonicalSurface` returns a clearly different value).
  - Purpose: deterministic validator responses + a known-different retry surface for `MOCK_CLAUDE=1` integration tests.
  - _Leverage: Phase 2 fixture pattern at `packages/db/scripts/__fixtures__/claude-generation/`_
  - _Requirements: 7.4_

- [x] 14. Extend the mock Anthropic client to dispatch validator calls
  - File: `packages/db/scripts/generate-exercises-mock-client.ts` (modify)
  - At the top of the `create` function (around line 86), add a branch BEFORE the existing `TYPE_BY_TOOL_NAME` lookup: `if (toolChoice.name === VALIDATION_TOOL_NAME) { return mockValidationResponse(args, totalCalls); }`. Increment `totalCalls` inside this branch the same way the generator branch does so cache-write/cache-read accounting stays accurate.
  - Implement `mockValidationResponse(args, callIndex)` **inline in this same file** (the design's Component 7 floats the option of a sibling `generate-exercises-validation-mock.ts`; locking the decision here as inline keeps the diff localized and the per-file LOC under 250):
    - Read `MOCK_VALIDATION_OUTCOMES` env var: a JSON object mapping `string(ordinal)` → `'approved' | 'flagged' | 'rejected'`. Default to `{}` when unset.
    - Maintain a per-validator-type counter analogous to the generator counters; use it to derive the ordinal.
    - Read the user-message body to determine which `ExerciseType` to load (the user prompt's "Spec:" preamble names it; or simpler: read it from the most-recently-dispatched generator call by tracking it in module-local state). Simpler still: each test sets `MOCK_VALIDATION_OUTCOMES` keyed by the validator-call ordinal independent of type, since the integration tests construct their batches deliberately.
    - Look up the fixture file at `__fixtures__/claude-validation/<type>-<outcome>.json` (default outcome: `'approved'` when no entry for the ordinal in `MOCK_VALIDATION_OUTCOMES`).
    - Return an `Anthropic.Message`-shaped response with one `tool_use` block whose `name = VALIDATION_TOOL_NAME` and `input = <fixture contents>`. Reuse the same `usage` shape the generator branch uses (first call: cache-write; subsequent: cache-read). Validator usage should be its OWN counter — first validator call in a batch is its own cache-write.
  - Import `VALIDATION_TOOL_NAME` from `@language-drill/ai`.
  - Purpose: integration tests can drive the full pipeline (generator → validator → router → DB) without contacting Claude.
  - _Leverage: existing `createMockAnthropicClient` (`generate-exercises-mock-client.ts:64-163`)_
  - _Requirements: 7.4_

### Layer 7 — `runOneCell` extension

- [x] 15. Add `validateAndInsertWithRetry` helper to `generate-exercises.ts`
  - File: `packages/db/scripts/generate-exercises.ts` (modify)
  - Add imports at the top: `validateDraft`, `canonicalSurface`, `ZERO_USAGE` (already imported), `addUsage` (already imported) from `@language-drill/ai`; `routeValidationResult`, `ReviewStatus` (type) from `./generate-exercises-validate.js`.
  - Add the private `DraftOutcome` type per design Component 5: `{ terminalStatus: 'inserted-approved' | 'inserted-flagged' | 'rejected' | 'first-attempt-dedup-then-success' | 'dedup-given-up'; terminalReviewStatus?: 'auto-approved' | 'flagged'; extraUsage: ClaudeUsageBreakdown; extraProduced: number; validatedCount: number; }`.
  - Implement `runRetryGeneration(opts, retryN)` per design Component 5: builds `retrySpec` with `count: 1, batchSeed: '<seed>::retry-N'`, calls `generateBatch`, returns `{ draft: result.drafts[0], usage: result.tokenUsage }`.
  - Implement `validateAndInsertWithRetry(opts)` per design Component 5 body. Critical correctness invariants:
    - `MAX_RETRIES = 3`. The loop counter `attempt` runs `0..3` inclusive; `attempt = 0` is the original draft.
    - **Every validator call** (including attempt 0) folds `valUsage` into `extraUsage` via `addUsage` — there is NO conditional guard on attempt index. (This is the bug the design validator caught; the test in Task 25 is the regression guard.)
    - On `decision.reviewStatus === 'rejected'`: if currently retrying a dedup slot (`firstAttemptDeduped` is true), continue to the next retry; otherwise return `terminalStatus: 'rejected'` immediately.
    - On `decision.reviewStatus === 'auto-approved' | 'flagged'`: write `_dedupKey = canonicalSurface(currentDraft.contentJson)` into the `contentJson` (spread + add) before INSERT. Use `db.insert(exercises).values(...).onConflictDoNothing().returning({ id: exercises.id })`. If `inserted.length > 0`: also INSERT into `exercise_tags`, return `terminalStatus` of `'first-attempt-dedup-then-success'` (when `firstAttemptDeduped` is true) OR `'inserted-approved' | 'inserted-flagged'` per `decision.reviewStatus`. If `inserted.length === 0`: set `firstAttemptDeduped = true`, dispatch `runRetryGeneration` (when attempt < MAX_RETRIES), continue the loop.
    - After exhausting all 3 retries with no successful INSERT: return `terminalStatus: 'dedup-given-up'`.
    - Check `aborted` (Phase 2 module-level flag at line 90) at the top of every loop iteration; throw `'Aborted by user (SIGINT)'` when set.
  - Do NOT change `runOneCell` yet — Task 16 wires this in.
  - Purpose: the per-draft retry+validation loop, isolated and individually testable.
  - _Leverage: `generateBatch`, `validateDraft`, `canonicalSurface` from `@language-drill/ai`; `routeValidationResult` from Task 11; `aborted` from `generate-exercises.ts:90`; `addUsage`, `ZERO_USAGE`, `ClaudeUsageBreakdown` from `@language-drill/ai`_
  - _Requirements: 4.4, 4.5, 4.6, 4.7, 5.1, 5.4_

- [x] 16. Wire validator + retry into `runOneCell` and update audit-row writes
  - File: `packages/db/scripts/generate-exercises.ts` (modify)
  - Extend the existing `CellResult` type (lines 96-107) with the four new fields: `validatedCount: number; flaggedCount: number; rejectedCount: number; dedupGivenUpCount: number;`.
  - Inside `runOneCell` (lines 158-299), after `generateBatch` resolves successfully and BEFORE the existing bulk-INSERT block:
    1. Replace the bulk INSERT with a per-ordinal loop iterating `batch.drafts`. For each draft, check `aborted` (throw on set); call `validateAndInsertWithRetry({ db, client, spec, draft, ordinal, cell, args, generatedAt })`; switch on `outcome.terminalStatus` to maintain accumulators: `producedCount` (initialize to `batch.drafts.length`, then `+= outcome.extraProduced` per draft), `validatedCount`, `approvedCount`, `flaggedCount`, `rejectedCount`, `dedupGivenUpCount`, `insertedCount`, `firstAttemptSkippedCount` (the new local accumulator for `CellResult.skippedCount`); fold `outcome.extraUsage` into `combinedUsage` via `addUsage`.
    2. Initialize `combinedUsage = batch.tokenUsage` BEFORE the per-ordinal loop so generator tokens are counted once. Per-ordinal `outcome.extraUsage` covers every validator call + every retry's generator + every retry's validator.
    3. Compute `inBatchDuplicateCount = batch.drafts.filter((d) => d.metadata.inBatchDuplicate).length` once before the loop (Phase 2 marker preserved).
  - Update the closing `db.update(generationJobs)` block (lines 273-286) to write all four count columns: `producedCount`, `approvedCount`, `flaggedCount`, `rejectedCount`. Existing `inputTokensUsed` / `outputTokensUsed` / `costUsdEstimate` writes use `combinedUsage` and `estimateCostUsd(combinedUsage)`.
  - Update the success-path return (`return { ... }` lines 288-298) to include the four new `CellResult` fields.
  - Update `failClosed` (lines 304-336) so the failure-path return ALSO includes the four new fields, all initialized to `0`.
  - Run `pnpm typecheck --filter @language-drill/db` — confirm both call sites compile against the widened `CellResult`.
  - Purpose: wire the validator + dedup retry into the existing cell-runner without changing its outer contract.
  - _Leverage: Task 15; existing `runOneCell` skeleton at `generate-exercises.ts:158-299`; existing `failClosed` helper at `:304-336`; `combinedUsage` accumulation pattern from Phase 2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_

- [x] 17. Extend the summary printer for new validation counts
  - File: `packages/db/scripts/generate-exercises.ts` (modify)
  - Update `formatCellLine` (lines 385-417) to render the new counts after the existing `inserted/skipped` block. Format:
    ```
    [<lang> <level> <type> <gp.key>] <total> drafts → <inserted> inserted (<approved> approved, <flagged> flagged, <rejected> rejected, <dedupGivenUp> dedup-given-up) — <input>k input (<cached>k cached) / <output>k output tokens — $<cost> — <duration> — <status>
    ```
    Falls back to Phase 2's format for `failed` / `skipped-cost-cap` rows (no validation counts to show).
  - Update `printSummary` (lines 419-456) to add a new section between the per-cell lines and the Total block, summing across all results: `Validation outcomes: <totalRejected> rejected, <totalDedupGivenUp> dedup-given-up`. Drafts inserted line widens to `Drafts inserted: <total> (<approved> approved, <flagged> flagged)`.
  - Run `pnpm test --filter @language-drill/db` and confirm any existing summary-printer tests still pass (they should — the additions are pure print-format extensions).
  - Purpose: operator-visible signal of validator activity in the per-cell + total summary.
  - _Leverage: existing `formatCellLine` and `printSummary` (`generate-exercises.ts:385-456`)_
  - _Requirements: 5.5_

### Layer 8 — Review CLI

- [x] 18. Extract shared parse-args helpers into `parse-args-common.ts`
  - File: `packages/db/scripts/parse-args-common.ts` (new)
  - File: `packages/db/scripts/generate-exercises-parse-args.ts` (modify)
  - Move `collectRawFlags`, `requireString`, and the `BOOLEAN_FLAGS` set from `generate-exercises-parse-args.ts:172-221` into a new `parse-args-common.ts`. Export each. The `BOOLEAN_FLAGS` set in the common file is the union of every boolean flag used across CLIs (currently `['dry-run', 'allow-prod', 'help']`); `parseReviewArgs` (Task 20) will add to this set if it needs new boolean flags.
  - Update `generate-exercises-parse-args.ts` to import these helpers from `./parse-args-common.js` instead of declaring them locally.
  - Run `pnpm test --filter @language-drill/db` — every Phase 2 test for `parseGenerateArgs` MUST still pass without modification.
  - Purpose: avoid duplicating the ~50 LOC of arg-parsing scaffolding when `review-flagged-parse-args.ts` lands in Task 20.
  - _Leverage: existing `collectRawFlags` / `requireString` / `BOOLEAN_FLAGS` from Phase 2_
  - _Requirements: 6.2, NFR Usability_

- [x] 19. Extract `requireEnv` into a shared `env-helpers.ts`
  - File: `packages/db/scripts/env-helpers.ts` (new)
  - File: `packages/db/scripts/generate-exercises.ts` (modify)
  - Move `requireEnv` (`generate-exercises.ts:113-119`) into a new `env-helpers.ts` and export it. Update `generate-exercises.ts` to `import { requireEnv } from './env-helpers'` instead of declaring it locally.
  - Run `pnpm test --filter @language-drill/db` — every Phase 2 test that uses the generator CLI MUST still pass without modification.
  - Purpose: Task 21 (review CLI) needs `requireEnv` too; keep it shared rather than duplicated.
  - _Leverage: existing `requireEnv` from Phase 2_
  - _Requirements: NFR Reliability_

- [x] 20. Create `review-flagged-parse-args.ts`
  - File: `packages/db/scripts/review-flagged-parse-args.ts` (new)
  - Define and export `ReviewArgs` per design Component 6: `{ lang, level: <opt>, type: <opt>, grammarPoint: <opt>, limit: number, allowProd: boolean }`.
  - Implement `parseReviewArgs(argv)` reusing `collectRawFlags`, `requireString` from `./parse-args-common.js`. Validation rules:
    - `--lang` is required, must be one of `ES | DE | TR` (case-insensitive). EN is rejected with the same posture as the generator CLI.
    - `--level` is optional; when present, must be one of `A1 | A2 | B1 | B2 | C1 | C2`.
    - `--type` is optional; when present, must be one of `cloze | translation | vocab_recall`.
    - `--grammar-point` is optional; passed through as a string with no curriculum lookup (the DB query just filters on the column value).
    - `--limit` is optional integer in `[1, 200]`, default 20.
    - `--allow-prod` is a boolean flag.
    - `--help` prints a usage block and exits 0.
  - Test file: `packages/db/scripts/review-flagged-parse-args.test.ts` (new) covers: every valid flag combination; `--lang en` throws; missing `--lang` throws; unknown `--type` throws; out-of-range `--limit` throws; `--help` exits 0.
  - Run `pnpm test --filter @language-drill/db`.
  - Purpose: pure CLI parser, fully testable without DB or Claude.
  - _Leverage: Task 18; `parseGenerateArgs` (`generate-exercises-parse-args.ts:94-166`) as a structural template_
  - _Requirements: 6.2, 6.7_

- [x] 21. Create `review-flagged.ts` DB-read + render helpers
  - File: `packages/db/scripts/review-flagged.ts` (new)
  - Imports: `createDb`, `exercises` from `@language-drill/db`; `and`, `eq`, `count` from `drizzle-orm`; `requireEnv` from `./env-helpers.js`; types from `./review-flagged-parse-args.js`.
  - Define a private `FlaggedRow` type matching the columns the script reads (`id`, `language`, `difficulty`, `type`, `grammarPointKey`, `contentJson`, `qualityScore`, `flaggedReasons`, `generatedAt`).
  - Implement `selectFlaggedRows(db: Db, args: ReviewArgs): Promise<FlaggedRow[]>` — Drizzle SELECT over `exercises` filtered by `review_status = 'flagged'` AND the slice predicates from `args` (only include the predicates whose source field is non-null — `args.level`, `args.type`, `args.grammarPoint` each get an `eq()` clause when set, omitted when null). ORDER BY `generated_at` ASC, LIMIT `args.limit`.
  - Implement `renderRow(row: FlaggedRow): void` — write to `process.stdout` the header line (`─── <id-prefix>... ───  <lang> <level> <type> <grammar_point_key>  qualityScore=<score>`), then `JSON.stringify(content_json, null, 2)` with `_dedupKey` stripped (use `const { _dedupKey, ...rest } = row.contentJson; JSON.stringify(rest, null, 2)`), then a `Flagged reasons:` block bullet-listing `flagged_reasons`.
  - Implement `countFlagged(db: Db, args: ReviewArgs): Promise<number>` — `SELECT count(*) FROM exercises WHERE review_status='flagged' AND <slice>` using the same predicate construction as `selectFlaggedRows`. Returns the integer for the "remaining" line in the summary.
  - Do NOT implement the keystroke reader, write helpers, or `main` yet — those land in Tasks 22 and 23.
  - Run `pnpm typecheck --filter @language-drill/db`.
  - Purpose: pure DB-read + render layer of the review CLI; isolated and testable.
  - _Leverage: Task 19, Task 20; existing `createDb` (`packages/db/src/client.ts`); Drizzle `eq`/`and` patterns from Phase 2 generator CLI_
  - _Requirements: 6.3, 6.4_

- [x] 22. Add interactive write helpers to `review-flagged.ts`
  - File: `packages/db/scripts/review-flagged.ts` (modify)
  - Add imports: `readline` from `node:readline`; `Readable` type from `node:stream` (or a TS type-only import).
  - Implement `createKeystrokeReader(stdinSource: NodeJS.ReadStream | Readable)` — when `stdinSource === process.stdin`, set up `readline.emitKeypressEvents(stdinSource); stdinSource.setRawMode(true)`; expose `next(): Promise<string>` that resolves with the next single-character keystroke. When `stdinSource` is an injected `Readable` (test harness), listen for `data` events, buffer incoming chunks, and resolve `next()` with the head of the buffer. Both paths normalize Enter / Return to be ignored (the test harness pushes raw single chars; the production path's `keypress` event provides the char directly).
  - Implement `isUniqueViolation(err: unknown): boolean` — checks `err instanceof Error && 'code' in err && (err as { code: string }).code === '23505'`.
  - Implement `tryApprove(db: Db, row: FlaggedRow): Promise<'approved' | 'demoted'>` per design Component 6: parameterized UPDATE with `WHERE id=? AND review_status='flagged'`; wrapped in try/catch; on `isUniqueViolation`, fall back to UPDATE `SET review_status='rejected'` and return `'demoted'`.
  - Implement `rejectRow(db: Db, row: FlaggedRow): Promise<void>` — same parameterized UPDATE shape, `SET review_status='rejected'`. Preserves `flagged_reasons`.
  - Run `pnpm typecheck --filter @language-drill/db`.
  - Purpose: interactive input + state-changing writes for the review CLI; isolated from orchestration so Task 24 can mock either side.
  - _Leverage: Task 21; `node:readline` raw-mode pattern; Drizzle `update` pattern_
  - _Requirements: 6.5, 6.10_

- [x] 23. Wire `review-flagged.ts` `main` + summary printer + direct-run guard
  - File: `packages/db/scripts/review-flagged.ts` (modify)
  - Add imports: `parseReviewArgs` from `./review-flagged-parse-args.js`; `fileURLToPath` from `node:url`.
  - Implement `printReviewSummary(counts: { approved: number; rejected: number; skipped: number }, totalReviewed: number, remaining: number): void` — write to `process.stdout`: `Reviewed <totalReviewed> exercise(s): <approved> approved, <rejected> rejected, <skipped> skipped`. When `remaining > 0`, append a second line: `(<remaining> flagged remain in this slice — re-run to continue)`.
  - Implement `main(argv: readonly string[] = process.argv.slice(2), stdinSource: NodeJS.ReadStream | Readable = process.stdin): Promise<void>` per design Component 6:
    1. Parse args via `parseReviewArgs`.
    2. Production guard — if `process.env['NODE_ENV'] === 'production' && !args.allowProd`, write the error and `process.exit(1)` BEFORE any DB connection.
    3. Construct `db = createDb(requireEnv('DATABASE_URL'))`.
    4. Pull rows via `selectFlaggedRows(db, args)`. Empty list → write "No flagged exercises in this slice." and return.
    5. Initialize `counts = { approved: 0, rejected: 0, skipped: 0 }` and `reader = createKeystrokeReader(stdinSource)`.
    6. `outer:` labelled `for (const row of rows)`. Inside: `renderRow(row)`, then an inner `while (true)` prompting `[a]pprove / [r]eject / [s]kip / [q]uit > `. On `'a'` → call `tryApprove`; on `'approved'` write "Approved.", on `'demoted'` write "Cannot approve — duplicate of an existing approved exercise in this cell. Marking rejected instead." On `'r'` → call `rejectRow`, write "Rejected." On `'s'` → no DB call, count as skipped. On `'q'` → `break outer`. On unknown char → write `use a/r/s/q\n` and re-prompt.
    7. After the loop: `const remaining = await countFlagged(db, args)`; call `printReviewSummary(counts, processedCount, remaining)`.
  - At the bottom of the file, add `isDirectRun` guard via `fileURLToPath(import.meta.url)` (mirror of `generate-exercises.ts:555`); when direct-run, call `main().catch((err) => { console.error(...); process.exit(1); })`.
  - Run `pnpm typecheck --filter @language-drill/db`.
  - Purpose: top-level orchestration of the review CLI.
  - _Leverage: Tasks 19, 20, 21, 22; Phase 2 `generate-exercises.ts` `main` shape (`:462-549`) and `isDirectRun` guard (`:555-561`)_
  - _Requirements: 6.1, 6.6, 6.8, 6.9_

- [x] 24. Create `review-flagged.test.ts`
  - File: `packages/db/scripts/review-flagged.test.ts` (new)
  - Test infrastructure: a small `createTestStdin()` helper inside the test file that returns `{ stdin: Readable, push(key: string): void }` so tests can drive the prompt loop synchronously.
  - **Pure planning tests (always run):** the parser tests are already in Task 20's separate `review-flagged-parse-args.test.ts`; this file covers the orchestration only.
  - **DB-touching tests (`describe.skipIf(!process.env.TEST_DATABASE_URL)`):**
    - Setup helper: insert three flagged rows in `exercises` with distinct ids, all in `(ES, B1, cloze)` cell. Pre-test cleanup: `DELETE FROM exercises WHERE id IN (...)`.
    - **Happy path:** drive stdin with `a`, `r`, `s` (one keystroke per row); assert row 0 → `manual-approved` with `flagged_reasons=NULL`, row 1 → `rejected` with original `flagged_reasons` preserved, row 2 → still `flagged` (untouched). Assert printed summary contains `1 approved, 1 rejected, 1 skipped`.
    - **Quit early:** drive stdin with `q`; assert no row was modified; printed summary contains `Reviewed 0` AND `(3 flagged remain in this slice — re-run to continue)`.
    - **Unknown key re-prompt:** drive stdin with `x` then `a`; assert the unknown-key path prints `use a/r/s/q` and the subsequent `a` approves correctly.
    - **Dedup-on-approval (Req 6.10):** insert one `auto-approved` row in `(ES, B1, cloze, gp-key)` with `_dedupKey: 'foo'`; insert one `flagged` row in the same cell with `_dedupKey: 'foo'`. Drive stdin with `a` against the flagged row. Assert (i) the approve UPDATE throws a `23505` error internally; (ii) the script catches it and demotes to `rejected`; (iii) printed text contains `Cannot approve — duplicate of an existing approved exercise`.
    - **Production guard:** set `process.env.NODE_ENV = 'production'`; `process.env.NODE_ENV` restored in `afterEach`. Run `main([...])` without `--allow-prod`; assert process exit code is non-zero AND no DB reads happened (mock `selectFlaggedRows` was not called, or assert via row-untouched).
  - Run `pnpm test --filter @language-drill/db`.
  - Purpose: pin the review CLI's interactive behavior.
  - _Leverage: Tasks 20-23; Phase 2 `generate-exercises.test.ts` `describe.skipIf` pattern_
  - _Requirements: 7.5_

### Layer 9 — Integration tests, script wiring, manual smoke

- [x] 25. Extend `generate-exercises.test.ts` with Phase 3 integration coverage
  - File: `packages/db/scripts/generate-exercises.test.ts` (modify)
  - Add a new `describe('Phase 3: validator + dedup', ...)` block at the bottom of the file. All tests in this block use `describe.skipIf(!process.env.TEST_DATABASE_URL)`.
  - **Mixed-outcome batch:** with `MOCK_CLAUDE=1` and `MOCK_VALIDATION_OUTCOMES='{"0":"approved","1":"flagged","2":"rejected"}'`, run `main([...])` for `--lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 3 --batch-seed phase-3-test-mixed`. Assert:
    - Two rows in `exercises` for that cell + batch-seed: one with `review_status='auto-approved'`, `quality_score≈0.85`, `flagged_reasons=NULL`, `_dedupKey` non-null in `content_json`; one with `review_status='flagged'`, `quality_score≈0.6`, `flagged_reasons` non-null array.
    - Zero rows for the rejected ordinal (deterministic ID lookup confirms absence).
    - One `generation_jobs` row with `produced_count=3`, `approved_count=1`, `flagged_count=1`, `rejected_count=1`, non-null `cost_usd_estimate`.
    - **Token regression guard:** `output_tokens_used === expectedGeneratorOutput + 3 * expectedValidatorOutput` per the deterministic mock token shape. Fails CI if attempt-0 validator usage is ever silently dropped.
  - **Dedup-retry happy path:** pre-seed an `auto-approved` row with `content_json._dedupKey` matching `canonicalSurface` of `cloze.json` ordinal 0 (the fixture content is deterministic). Author one extra retry-only fixture `__fixtures__/claude-generation/cloze-retry.json` whose surface is intentionally different. Configure the mock client to return `cloze.json` ordinal 0 for the first generator call AND return `cloze-retry.json` for any subsequent generator call within the same cell when the call args include the retry batchSeed suffix. Run `main` for `--count 1 --batch-seed phase-3-test-retry`. Assert: ordinal 0 first hits the dedup index (no row inserted at the original deterministic id); the retry path's regenerated draft inserts under the `::retry-1` deterministic id; the audit row has `produced_count=2`, `approved_count=1`.
  - **Dedup-given-up path:** seed three colliding rows with `_dedupKey`s matching three retry attempts (the mock returns three distinct surfaces but each one is pre-seeded). Assert ordinal 0 yields `dedup-given-up`; the audit row has `produced_count=4` (original + 3 retries), `rejected_count=1`; the per-cell summary line includes `[1 dedup-given-up]`.
  - **Validator-failure path:** configure the mock to throw on the first validator call. Run `main` for `--count 3`. Assert: `runOneCell` returns `status: 'failed'`; the audit row's `error_message` contains the validator failure text; zero rows inserted into `exercises` for the cell.
  - Run `pnpm test --filter @language-drill/db` with `TEST_DATABASE_URL` set. Confirm every Phase 2 test in the file STILL passes unchanged.
  - Purpose: prove the full Phase 3 pipeline (validator + dedup retry + audit-row counts + token totals) works end-to-end without contacting Claude.
  - _Leverage: Tasks 13, 14, 15, 16; Phase 2 integration test patterns at the bottom of `generate-exercises.test.ts`_
  - _Requirements: 7.4, 7.6_

- [x] 26. Wire `pnpm review:flagged` script + run pre-push checks
  - File: `packages/db/package.json` (modify)
  - File: `package.json` (modify)
  - Add to `packages/db/package.json` under `scripts`: `"review:flagged": "npx tsx scripts/review-flagged.ts"` (alphabetical order).
  - Add to root `package.json` under `scripts`: `"review:flagged": "dotenv -e .env -- pnpm --filter @language-drill/db review:flagged"` (alphabetical near the existing `generate:exercises` entry).
  - Run `pnpm review:flagged --help` from the repo root and confirm the help text from Task 20 prints AND the exit code is 0. (No DB connection needed for `--help`.)
  - Run the full pre-push suite from the repo root: `pnpm lint && pnpm typecheck && pnpm test`. Every check MUST exit 0. Resolve any failures before proceeding to Task 27.
  - Purpose: make the review CLI runnable via the project's standard script wrapping; final pre-merge gate.
  - _Leverage: Phase 2 `generate:exercises` script wrapping at root `package.json:13` + `packages/db/package.json:scripts`_
  - _Requirements: 6.1, 7.6_

- [x] 27. One-shot manual smoke against real Claude
  - File: (no source changes — verification step only; record observed numbers in the PR description)
  - **Generator smoke** (mirrors Phase 2 Task 22, now with validator wired in): with a real `ANTHROPIC_API_KEY` and a Neon dev branch, run `pnpm generate:exercises --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 3 --batch-seed phase-3-smoke`. Verify:
    - The CLI completes within ~60s (3 generator + 3 validator calls; validator's `cache_control` should hit on calls 2-3).
    - Exactly 3 `generation_jobs` rows are NOT created; exactly 1 row with `produced_count=3`, plausible `approved_count` (likely 2-3), plausible `flagged_count` (likely 0-1), `rejected_count` likely 0, `cost_usd_estimate` ~$0.02-0.05.
    - At least the auto-approved rows in `exercises` have non-null `quality_score` and `_dedupKey` in `content_json`.
  - **Review CLI smoke:** if the generator smoke produced no `flagged` rows, manually flip one auto-approved row to `'flagged'` via SQL: `UPDATE exercises SET review_status='flagged', flagged_reasons='["test smoke"]'::jsonb WHERE id = '<one-of-the-inserted-ids>'`. Then run `pnpm review:flagged --lang es --level B1 --type cloze --limit 5`. Drive the prompt with `s` (skip) on the first row, then re-run and use `a` to approve it. Verify the row's final state is `review_status='manual-approved'`, `flagged_reasons=NULL`.
  - **Validator standalone smoke (Req 7.7):** quickest form is `pnpm tsx -e "import { validateDraft, createClaudeClient, ... } from '@language-drill/ai'; ..."` against one cloze + one translation + one vocab-recall draft already in the dev DB. Print the routed status + `flaggedReasons` + token usage for each. (If the inline script gets unwieldy, save it as `packages/db/scripts/smoke-validator.ts` and add a `pnpm` script — but per design "the requirement is that one such smoke exists and passes before merge", an inline `pnpm tsx` invocation is acceptable.)
  - Record the cost numbers, approval counts, and any observed failure modes in the PR description.
  - Purpose: end-to-end confidence with one real Claude call before merge.
  - _Leverage: Phase 2 manual smoke pattern (`exercise-generation-phase-2/tasks.md` Task 22)_
  - _Requirements: 7.6, 7.7_
