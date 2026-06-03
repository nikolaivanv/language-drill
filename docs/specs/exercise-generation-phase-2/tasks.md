# Implementation Plan

## Task Overview

Phase 2 ships in ten thin layers, each independently mergeable:

1. **Cost model + descriptor DRY refactor** (Tasks 1–2) — pure math constants and the one-source-of-truth move that lets the generator and evaluator share CEFR descriptors.
2. **Generation prompts** (Tasks 3–4) — pure prompt builders + their tests; no Claude calls yet.
3. **`@language-drill/db` public surface** (Task 5) — adds the workspace dep to `packages/ai/package.json` and re-exports `deterministicUuid` + `assertValidCellKey` from the db barrel. Lands **before** the generator core because Task 8 imports `deterministicUuid` through `@language-drill/db`.
4. **Generator core** (Tasks 6–9, then test in 10) — `generate.ts` filled in four thin slices: types + tools (6); parsers (7); `exerciseDraftId` + guards + `generateBatch` skeleton (8); the per-iter Claude/parse/dedup loop body (9). Test file lands at task 10.
5. **`@language-drill/ai` public surface** (Task 11) — re-exports the new generator symbols. Lands **after** Tasks 1–10 so every symbol it advertises actually exists.
6. **CLI pure helpers** (Tasks 12–15) — `parseGenerateArgs`, `resolveCells`, fixtures, mock client. All testable without a DB or a Claude call.
7. **CLI main + DB writes** (Tasks 16–17) — skeleton then `runOneCell`. The CLI runs end-to-end in `--dry-run` after Task 16 and writes real rows after Task 17.
8. **CLI orchestration** (Tasks 18–19) — concurrency + cost cap + summary printer (18), then SIGINT handling (19).
9. **CLI tests + script wiring** (Tasks 20–21) — integration tests gated on `TEST_DATABASE_URL`; `pnpm` script definitions in both `package.json`s.
10. **Manual verification** (Task 22) — the one real Claude call before the PR is sent for review.

## Steering Document Compliance

- **Tool-use + `cache_control: ephemeral`** (`tech.md` §"AI / GenAI"): Tasks 5–8 mirror `evaluate.ts` beat-for-beat — same `Anthropic.Tool` shape, same `tool_choice` form, same cached `system` block. No new client construction logic.
- **Co-located tests** (`CLAUDE.md` §Testing): every test file lives next to the module it tests (Tasks 1, 4, 8, 18). No orphan test files.
- **`onConflictDoNothing` + deterministic IDs** (`tech.md` §"Database", existing pattern in `seed-exercises.ts`): Task 16's bulk insert is identical syntax. Re-runs of the CLI never produce duplicate rows.
- **Drizzle barrel + helper re-exports** (`packages/db/src/index.ts`): Task 5 makes `deterministicUuid` and `assertValidCellKey` part of the package's public surface for the first time — needed because `packages/ai` cannot import directly from `lib/`.
- **No new migrations** (`tech.md` §5 forward-only convention): Phase 1 already provisioned every column the CLI writes.
- **Tests-before-merge**: every task that touches code closes by running `pnpm test --filter <package>` for the affected package. The phase-level pre-push (`pnpm lint && pnpm typecheck && pnpm test`) runs in Task 20.

## Atomic Task Requirements

Each task below touches ≤ 3 files, is bounded to 15–30 minutes for an experienced developer, and has a single testable outcome. The generator-core tasks (5–7) are at the upper end of the box because each adds ~80–120 LOC of pattern-matched code; they remain single-file, single-purpose, and trivially reviewable against the design's component definitions.

## Tasks

### Layer 1 — Cost model and CEFR descriptor DRY refactor

- [x] 1. Create `cost-model.ts` with Sonnet 4.5 pricing constants and `estimateCostUsd`
  - File: `packages/ai/src/cost-model.ts` (new)
  - File: `packages/ai/src/cost-model.test.ts` (new)
  - Define `SONNET_4_5_PRICING` with the four `*UsdPerToken` rates exactly as specified in design Component 1 (input $3.00/M, cache-write $3.75/M, cache-read $0.30/M, output $15/M). Add a JSDoc block that names the pricing source URL and the date copied (today's date — 2026-05-05).
  - Define and export `ClaudeUsageBreakdown`, `ZERO_USAGE` (frozen), `addUsage(a, b)`, and `estimateCostUsd(usage)`. `estimateCostUsd` SHALL round to 4 decimal places with `Math.round(x * 10000) / 10000`.
  - Test: assert `estimateCostUsd(ZERO_USAGE) === 0`; assert a non-zero usage breakdown produces the expected USD per the four tiers (one fixture); assert `addUsage` sums field-by-field; assert `ZERO_USAGE` is frozen (`Object.isFrozen(ZERO_USAGE)`).
  - Purpose: single place where USD math lives; consumed by `runOneCell` and the CLI cost-cap.
  - _Leverage: existing `Object.freeze` pattern in `packages/shared/src/index.ts:35`_
  - _Requirements: 5.6, NFR Performance_

- [x] 2. Extract `CEFR_LEVEL_DESCRIPTORS` from `EVALUATION_SYSTEM_PROMPT`
  - File: `packages/ai/src/prompts.ts` (modify)
  - File: `packages/ai/src/evaluate.test.ts` (verify, may need a test note — see below)
  - Define and export `CEFR_LEVEL_DESCRIPTORS: Readonly<Record<CefrLevel, string>>` whose six values are the **exact same strings** currently inlined in the bullet list at `prompts.ts:36–43` (no rewording).
  - Refactor `EVALUATION_SYSTEM_PROMPT` to interpolate the constant: replace the markdown bullet block with a template-literal expression that renders `Object.entries(CEFR_LEVEL_DESCRIPTORS).map(([level, descriptor]) => \`- **${level}**: ${descriptor}\`).join('\n')`.
  - Run `pnpm test --filter @language-drill/ai`. The existing `EVALUATION_SYSTEM_PROMPT` tests at `evaluate.test.ts:138–158` (assert presence of "A1", "C2", "subjuntivo", "Akkusativ", "vowel harmony") MUST still pass with no changes — the interpolated text contains the same content. Do not modify these tests.
  - Purpose: one source of truth for the CEFR descriptors, consumed by both the evaluator's existing prompt and Task 3's generator prompt builder. Locks Requirement 2.2's "DRY" intent.
  - _Leverage: existing `EVALUATION_SYSTEM_PROMPT` text at `packages/ai/src/prompts.ts:22-72`_
  - _Requirements: 2.2_

### Layer 2 — Generation prompts (pure)

- [x] 3. Create `generation-prompts.ts` with prompt builders, `canonicalSurface`, and the LRU helper
  - File: `packages/ai/src/generation-prompts.ts` (new)
  - Export `MAX_RECENT_STEMS_IN_PROMPT = 30` and `tailRecentStems(stems)` (returns `stems.slice(-MAX_RECENT_STEMS_IN_PROMPT)`).
  - Export `GenerationPromptInputs` type per design Component 3.
  - Implement `buildGenerationSystemPrompt(inputs, recentStems)` — pure, deterministic. Render the template described in design Component 3: header, grammar-point name + description, positive/negative examples, common errors, the full CEFR descriptor list interpolated from `CEFR_LEVEL_DESCRIPTORS` (imported from `./prompts.js`), hard-constraints block (one bullet per stem in `recentStems` or the literal `(none yet)` when empty), and an output instruction telling Claude to use the matching tool. Because `TOOL_NAME_BY_TYPE` (the public constant) doesn't exist until Task 6 lands, hardcode the three names in this builder via a private `const TOOL_NAME = { cloze: 'submit_cloze_exercise', translation: 'submit_translation_exercise', vocab_recall: 'submit_vocab_recall_exercise' }` map. Task 6 refactors this file to import from `./generate.js` and removes the private map; Task 10's tool-name DRY assertion catches a forgotten swap.
  - Implement `buildGenerationUserPrompt(inputs, ordinal, topicDomain)` — short user message that interpolates the ordinal (1-indexed in the rendered text — i.e. `ordinal + 1`), the topic domain (or `mixed` when null), and the tool name. Concretely the rendered text reads: `Produce exercise #<N>.\n\nTopic domain: <topicDomain or 'mixed'>\n\nUse the <TOOL_NAME[inputs.exerciseType]> tool.`. Pure — no `count`, no spec passed, just the three arguments.
  - Implement `canonicalSurface(content: ExerciseContent): string` — branch on `content.type`: cloze → `content.sentence`; translation → `content.sourceText`; vocab → `content.expectedWord`. Then lowercase + `.normalize('NFKD').replace(/\p{Diacritic}+/gu, '')`.
  - Purpose: one file owning every prompt and surface-canonicalization decision.
  - _Leverage: `packages/ai/src/prompts.ts` (Task 2 — `CEFR_LEVEL_DESCRIPTORS`); `@language-drill/db` (`GrammarPoint`); `@language-drill/shared` (`ExerciseContent`, `ExerciseType`, `Language`)_
  - _Requirements: 2.1, 2.2, 2.3, 6.2, 6.3_

- [x] 4. Create `generation-prompts.test.ts`
  - File: `packages/ai/src/generation-prompts.test.ts` (new)
  - Fixture: pick one curriculum entry (`getGrammarPoint('es-b1-present-subjunctive')`) for assertions.
  - Tests:
    - Two calls with identical `(inputs, recentStems)` produce identical strings.
    - Empty `recentStems` → prompt contains `(none yet)`.
    - 3-element `recentStems` → prompt contains a bullet for each stem.
    - For the chosen grammar point, the prompt contains its `name`, `description`, every `examplesPositive[i]`, every `commonErrors[i]` verbatim.
    - The B1 descriptor from `CEFR_LEVEL_DESCRIPTORS` appears verbatim in the rendered generator prompt and in `EVALUATION_SYSTEM_PROMPT` (locks the DRY invariant from Requirement 2.2).
    - `canonicalSurface({ type:'cloze', sentence:'Yo HABLO españól.' as ClozeContent['sentence'], correctAnswer:'x', instructions:'x' })` returns `'yo hablo espanol.'`.
    - `tailRecentStems` returns the last 30 of an array of 32 stems.
    - `buildGenerationUserPrompt(inputs, 0, null)` contains `Topic domain: mixed`; with `'travel'` it contains `Topic domain: travel`.
  - Purpose: pin every prompt invariant before any Claude call enters the picture.
  - _Leverage: Tasks 2, 3; `@language-drill/db` `getGrammarPoint`_
  - _Requirements: 7.2_

### Layer 3 — `@language-drill/db` public surface

- [x] 5. Re-export `deterministicUuid` + `assertValidCellKey`; add `@language-drill/db` workspace dep to `packages/ai`
  - File: `packages/db/src/index.ts` (modify)
  - File: `packages/ai/package.json` (modify)
  - In `packages/db/src/index.ts`: append `export { deterministicUuid } from './lib/deterministic-uuid';` and `export { assertValidCellKey } from './lib/cell-key';`. Update the comment header at the top to note both helpers are now part of the public API surface (Phase 1 deliberately left them internal-only).
  - In `packages/ai/package.json`: add `"@language-drill/db": "workspace:*"` to `dependencies` (alphabetically after `@language-drill/shared`). Run `pnpm install` from the repo root so the symlink is created.
  - Run `pnpm typecheck --filter @language-drill/ai` and `pnpm typecheck --filter @language-drill/db` and confirm both pass.
  - Purpose: unblock Tasks 7+ from importing `deterministicUuid` through the public package boundary. Without this, Task 7 would either reach into `lib/` directly (violates package-boundary rule from design.md) or invent a workaround.
  - _Leverage: existing barrel + helpers from Phase 1_
  - _Requirements: 3.1, 5.4_

### Layer 4 — Generator core

- [x] 6. Create `generate.ts` with types, `GENERATION_MODEL`, and the three tool schemas
  - File: `packages/ai/src/generate.ts` (new)
  - Define and export: `GENERATION_MODEL = 'claude-sonnet-4-5' as const`; `GENERATION_MAX_TOKENS = 1024`; `GENERATION_TEMPERATURE = 0.7`.
  - Define and export `TOOL_NAME_BY_TYPE` (frozen `Readonly<Record<ExerciseType, string>>`) with the three names: `'submit_cloze_exercise'`, `'submit_translation_exercise'`, `'submit_vocab_recall_exercise'`. Note: Task 3 hardcoded the same three names in a private map inside `generation-prompts.ts` because of file ordering. As part of this task, refactor `generation-prompts.ts` to import `TOOL_NAME_BY_TYPE` from `./generate.js` instead. There is no circular-import risk because `generate.ts`'s module init does not depend on anything from `generation-prompts.ts` — the prompt builders are only called at runtime from `generateBatch` (Task 9).
  - Define and export the three `Anthropic.Tool` schemas (`CLOZE_GENERATION_TOOL`, `TRANSLATION_GENERATION_TOOL`, `VOCAB_RECALL_GENERATION_TOOL`) with `input_schema` matching the corresponding `ExerciseContent` shape from `@language-drill/shared` field-for-field per design Component 4.
  - Define and export `GENERATION_TOOL_BY_TYPE: Readonly<Record<ExerciseType, Anthropic.Tool>>` mapping each `ExerciseType` to its tool.
  - Define and export the type aliases: `GenerationSpec`, `ExerciseDraft`, `GenerateBatchResult` per design Component 4.
  - Export nothing else yet — parsers ship in Task 7, ID + skeleton in Task 8, the loop in Task 9.
  - Purpose: the static surface of the generator package is in place; downstream tasks fill in behavior.
  - _Leverage: existing `EVALUATION_TOOL` shape at `packages/ai/src/evaluate.ts:22-104` for the schema definition pattern; `@language-drill/shared` `ExerciseContent` discriminated union; Task 3's private TOOL_NAME map is replaced by an import_
  - _Requirements: 1.1, 2.4, 2.5, 2.6, NFR Reliability (`GENERATION_MODEL` constant)_

- [x] 7. Add per-type parsers to `generate.ts`
  - File: `packages/ai/src/generate.ts` (modify — continue from Task 6)
  - Implement and export `parseGeneratedClozeDraft(input, spec)`, `parseGeneratedTranslationDraft(input, spec)`, `parseGeneratedVocabRecallDraft(input, spec)`. Each:
    - Validates that `input` is an object and that all required fields per the corresponding tool schema are present and of the right type. Use the same throw-on-mismatch style as `parseEvaluationResult` (`evaluate.ts:128-200`).
    - Enforces the per-type extra invariants from design Component 4: cloze requires `correctAnswer.trim().length > 0` and `sentence.includes('___')`; translation requires `sourceText.length > 0`, `referenceTranslation.length > 0`, `sourceLanguage === 'EN'`, `targetLanguage === spec.language`; vocab requires `expectedWord.split(/\s+/).length === 1`.
    - Returns the typed `ClozeContent` / `TranslationContent` / `VocabRecallContent` literal (with `type` field set explicitly to the matching `ExerciseType` enum value).
  - On any validation failure, throw with a message naming the offending field. The caller (`generateBatch`) prefixes ordinal info on re-throw.
  - Purpose: every Claude tool-input is validated against the public type before becoming an `ExerciseDraft`.
  - _Leverage: `parseEvaluationResult` shape at `packages/ai/src/evaluate.ts:128-200`_
  - _Requirements: 1.3, 1.6, 1.9, 2.6_

- [x] 8. Add `exerciseDraftId`, EN/type guards, and the `generateBatch` skeleton to `generate.ts`
  - File: `packages/ai/src/generate.ts` (modify — continue from Task 7)
  - Implement and export `exerciseDraftId(spec, ordinal)` per design Component 4: join `[spec.language, spec.cefrLevel, spec.exerciseType, spec.grammarPoint.key, spec.batchSeed, String(ordinal)]` with `'|'`, hash via `deterministicUuid` imported from `@language-drill/db` (the public re-export from Task 5).
  - Implement a private helper `readUsage(response)` that reads `response.usage` and falls back to `0` for any unset field — returns a `ClaudeUsageBreakdown` (the type from `cost-model.ts`).
  - Implement and export `generateBatch(client, spec)` as the **skeleton** only — Task 9 fills in the per-iter loop body. For Task 8 the function:
    1. Top-of-function guards: throw `new Error('language EN is not a learning language for generation (resolved decision #4)')` if `spec.language === Language.EN`; throw `new Error('Unsupported exerciseType: <type>')` if `spec.exerciseType` not in `TOOL_NAME_BY_TYPE`.
    2. Build `promptInputs`; init `recentStems: string[] = []`, `seenStems = new Set<string>()`, `tokenUsage: ClaudeUsageBreakdown = ZERO_USAGE`, `drafts: ExerciseDraft[] = []`.
    3. Loop `for (let ordinal = 0; ordinal < spec.count; ordinal++) { /* TODO Task 9 */ }` — empty body.
    4. Return `{ drafts, tokenUsage }`.
  - Purpose: the function exists, its guards are tested, and the surface is callable. Task 9 swaps the loop body in without touching guards.
  - _Leverage: Tasks 1, 5, 6, 7; design Component 4_
  - _Requirements: 1.1, 1.2, 1.7, 1.8, 3.1, 3.2_

- [x] 9. Fill in the per-iter loop in `generateBatch`
  - File: `packages/ai/src/generate.ts` (modify — continue from Task 8)
  - Replace the empty loop body in `generateBatch` with the per-iter logic per design Component 4:
    - `system = buildGenerationSystemPrompt(promptInputs, tailRecentStems(recentStems))`.
    - `user = buildGenerationUserPrompt(promptInputs, ordinal, spec.topicDomain)`.
    - `tool = GENERATION_TOOL_BY_TYPE[spec.exerciseType]`.
    - Call `client.messages.create({ model: GENERATION_MODEL, max_tokens: GENERATION_MAX_TOKENS, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }], tools: [tool], tool_choice: { type: 'tool', name: tool.name }, temperature: GENERATION_TEMPERATURE })`.
    - Extract the single `tool_use` block from `response.content`. If missing or wrong tool name → throw with `Draft ordinal=${ordinal} malformed: <reason>` (Requirement 1.6).
    - Run the matching parser on `toolUseBlock.input`. On parser throw → re-throw prefixed with the same ordinal info.
    - `usage = readUsage(response)`; `tokenUsage = addUsage(tokenUsage, usage)`.
    - `surface = canonicalSurface(content)`; `inBatchDuplicate = seenStems.has(surface)`; `seenStems.add(surface)`; `recentStems.push(surface)`.
    - `drafts.push({ id: exerciseDraftId(spec, ordinal), contentJson: content, metadata: { grammarPointKey: spec.grammarPoint.key, topicDomain: spec.topicDomain, modelId: GENERATION_MODEL, inputTokens: usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens, outputTokens: usage.outputTokens, cacheCreationInputTokens: usage.cacheCreationInputTokens, cacheReadInputTokens: usage.cacheReadInputTokens, inBatchDuplicate } })`.
  - Purpose: completes the generator core. The function now produces real drafts when wired to a Claude client.
  - _Leverage: `evaluateAnswer` flow at `packages/ai/src/evaluate.ts:220-272` for the call shape; Tasks 1, 3, 6, 7, 8_
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.10, 2.7, 6.1, 6.2, 6.3, 6.4_

- [x] 10. Create `generate.test.ts`
  - File: `packages/ai/src/generate.test.ts` (new)
  - Mock `client.messages.create` with `vi.fn()` per the pattern at `evaluate.test.ts:283-337`. Provide a small fixture object per type (one valid tool input each).
  - Tests:
    - Happy path × 3 types: assert `parseGenerated*Draft` returns a value that passes the matching `is*Content` type guard from `@language-drill/shared`; assert `mockCreate` received `model: GENERATION_MODEL`, `temperature: 0.7`, `tool_choice: { type: 'tool', name: <expected> }`, exactly one tool, and a single `system` block with `cache_control: { type: 'ephemeral' }`.
    - Determinism: `exerciseDraftId(spec, 0) === exerciseDraftId(sameSpec, 0)`; `exerciseDraftId(spec, 0) !== exerciseDraftId(spec, 1)`; bumping `batchSeed` flips the IDs.
    - EN guard (Task 8 surface): `await expect(generateBatch(client, { ...spec, language: Language.EN })).rejects.toThrow(...)` and `expect(mockCreate).not.toHaveBeenCalled()`.
    - Unsupported-type guard (Task 8 surface): `generateBatch(client, { ...spec, exerciseType: 'sentence_construction' as ExerciseType })` throws before any call.
    - Malformed responses (Task 9 loop): three subcases — (a) no tool block → throws with `ordinal=0 malformed`; (b) wrong tool name → throws; (c) parser-failing input (e.g. cloze with `sentence: 'no blank here'`) → throws.
    - `recentStems` accumulation: 2-draft happy path; assert the second `mockCreate` call's `system[0].text` contains the canonical surface of the first draft's `sentence`.
    - LRU cap: 32-draft happy path; assert the 32nd call's `system[0].text` contains exactly 30 stem bullets, **not** 31 — count `'\n  - '`-prefixed lines in the rendered `recentStems` block.
    - Tool-name DRY: `expect(TOOL_NAME_BY_TYPE.cloze).toBe(CLOZE_GENERATION_TOOL.name)` (and same for the other two types).
    - Cross-file model invariant: `expect(GENERATION_MODEL).toBe('claude-sonnet-4-5')` — combined with `evaluate.test.ts:320`'s assertion against the same literal, the two tests pin both files to the same model.
    - Token aggregation: a 3-draft happy path with mock usage `{input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 50, output_tokens: 200}` returns `tokenUsage` with each field × 3.
  - Purpose: regression coverage for every load-bearing piece of the generator core.
  - _Leverage: `evaluate.test.ts` mocked-SDK pattern; Tasks 6, 7, 8, 9_
  - _Requirements: 7.1, NFR Reliability_

### Layer 5 — `@language-drill/ai` public surface

- [x] 11. Update `packages/ai/src/index.ts` barrel
  - File: `packages/ai/src/index.ts` (modify)
  - Add the exports listed in design Component 5: every public symbol from `generate.ts`, `generation-prompts.ts`, `cost-model.ts`; the `CEFR_LEVEL_DESCRIPTORS` re-export from `prompts.ts`; the type aliases (`GenerationSpec`, `ExerciseDraft`, `GenerateBatchResult`, `ClaudeUsageBreakdown`).
  - Do not remove any existing export.
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm it passes.
  - Purpose: single import surface for the CLI and any future Lambda.
  - _Leverage: existing barrel structure_
  - _Requirements: 1.1, 7.5_

### Layer 6 — CLI pure helpers

- [x] 12. Create `generate-exercises-parse-args.ts`
  - File: `packages/db/scripts/generate-exercises-parse-args.ts` (new)
  - Define and export `ParsedArgs` type per design Component 6.
  - Implement `parseGenerateArgs(argv)`:
    - Tiny inline flag parser (no third-party CLI dep). Supports `--flag value` and `--flag=value` forms; boolean flags (`--dry-run`, `--allow-prod`, `--help`) take no value.
    - On `--help`, print the help text described in NFR Usability and `process.exit(0)`. The help text SHALL include the EN exclusion note, default values for every optional flag, and one worked example.
    - Required flags: `--lang`, `--level`. Reject `--lang en` with the message specified in design Error scenario 1. Reject `--lang` not in `{es, de, tr}` (case-insensitive — uppercase the input). Reject `--level` not in `{A1, A2, B1, B2}` (case-insensitive — uppercase the input).
    - Optional flags with defaults: `--type` default `'all'`; `--grammar-point` default `null`; `--count` default `50` (range `[1, 200]`); `--topic-domain` default `null`; `--batch-seed` default `'phase-2-default'`; `--max-cost-usd` default `5` (must be > 0); `--concurrency` default `1` (range `[1, 5]`).
    - Validation: `--grammar-point` set but `--type === 'all'` → throw "you must scope --type when generating against a single grammar point".
    - When `--allow-prod` is set and `process.env.NODE_ENV !== 'production'`, emit a stderr warning ("--allow-prod ignored: not running in production") but accept the value.
    - When `--concurrency > 1`, emit a stderr warning per NFR Performance.
  - Purpose: every CLI argument is parsed, validated, and defaulted in one pure function. Testable without a process spawn.
  - _Leverage: argv handling pattern from `seed-exercises.ts:836,901` — adapt for flag parsing (no existing flag parser in the repo to mirror exactly)_
  - _Requirements: 4.1, 4.2, 4.9, NFR Performance, NFR Security, NFR Usability_

- [x] 13. Create `generate-exercises-resolve-cells.ts`
  - File: `packages/db/scripts/generate-exercises-resolve-cells.ts` (new)
  - Define and export `Cell` type per design Component 6.
  - Implement and export `resolveCells(args, curriculum)`:
    - When `args.grammarPoint` is set: look up the entry via the curriculum lookup; throw if not found ("--grammar-point '<key>' not in curriculum"); return one `Cell` for `args.type` (which Task 12 has already validated to be a concrete `ExerciseType`, never `'all'`, when `--grammar-point` is set).
    - When `args.type` is a concrete `ExerciseType`: filter curriculum to entries matching `(args.lang, args.level)`; for each, emit one `Cell` of that type. Skip entries whose `kind` is incompatible with the type — `kind: 'vocab'` entries pair only with `vocab_recall`; `kind: 'grammar'` entries pair only with `cloze` and `translation`.
    - When `args.type === 'all'`: emit the Cartesian product of matching entries × the three types, with the same kind-compatibility rule.
    - Build `cellKey = '<lang>:<level>:<type>:<grammar_point_key>'` (lowercase lang and level — matches `assertValidCellKey`'s round-1 alternation regex).
  - Throw if the resulting cell list is empty (so the caller doesn't run zero cells silently).
  - Purpose: turns CLI args into a typed list of cells the orchestrator iterates over.
  - _Leverage: `@language-drill/db` curriculum (`ALL_CURRICULA`, `getGrammarPoint`); `assertValidCellKey` from Task 5 — call it on each constructed key as a defense-in-depth check_
  - _Requirements: 4.1, 4.2, NFR Usability_

- [x] 14. Create the three Claude generation fixture files
  - File: `packages/db/scripts/__fixtures__/claude-generation/cloze.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-generation/translation.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-generation/vocab_recall.json` (new)
  - Each file SHALL contain a JSON array of 3 sample tool inputs matching the corresponding `ExerciseContent` shape:
    - `cloze.json`: 3 valid `ClozeContent`-shaped objects (one targeting `es-b1-present-subjunctive` content, one neutral, one a slightly different sentence — pick three Spanish examples for B1; the language doesn't affect schema validity).
    - `translation.json`: 3 valid `TranslationContent`-shaped objects with `sourceLanguage: 'EN'` and `targetLanguage: 'ES'`.
    - `vocab_recall.json`: 3 valid `VocabRecallContent`-shaped objects (single-token `expectedWord`).
  - Each object SHALL have `type` set to the matching `ExerciseType` enum value as a string literal.
  - Verify by hand that each object would pass the matching parser from Task 7 — write each minimum-correct example.
  - Purpose: deterministic offline drafts the mock client cycles through.
  - _Leverage: Task 7 parsers; the existing seed-exercise contentJson shapes at `packages/db/scripts/seed-exercises.ts:36-580`_
  - _Requirements: 7.4_

- [x] 15. Create `generate-exercises-mock-client.ts`
  - File: `packages/db/scripts/generate-exercises-mock-client.ts` (new)
  - Implement and export `createMockAnthropicClient()`. The returned object SHALL have a `messages.create(args)` method shaped like the Anthropic SDK's signature (it's typed as `Anthropic` for the CLI's consumption — cast through `unknown`).
  - Internal state: a per-type ordinal counter (`Record<ExerciseType, number>` initialized to 0).
  - On each `messages.create` call:
    - Read `args.tool_choice.name` to infer `ExerciseType` via reverse-lookup against `TOOL_NAME_BY_TYPE`.
    - Load the matching fixture file (cached after first read) — three fixtures per type per Task 14.
    - Pick `fixtures[counter[type] % 3]`, increment `counter[type]`.
    - Return `{ id: 'msg_mock_<counter>', type: 'message', role: 'assistant', model: GENERATION_MODEL, content: [{ type: 'tool_use', id: 'toolu_mock', name: args.tool_choice.name, input: <fixture> }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 400 } }`.
    - On the second call onward for the same client instance, set `cache_creation_input_tokens: 0, cache_read_input_tokens: 1400, input_tokens: 100` so Task 20's tests can assert the cache split is plumbed correctly.
  - Read fixtures with `fs.readFileSync` + `JSON.parse` at module scope or lazily on first call (whichever is simpler). The path is `__fixtures__/claude-generation/<type>.json` resolved relative to `import.meta.url`.
  - Purpose: lets Task 20's integration test run end-to-end without a Claude credential or network.
  - _Leverage: Task 14 fixtures; `TOOL_NAME_BY_TYPE` from Task 6_
  - _Requirements: 7.4_

### Layer 7 — CLI main + DB writes

- [x] 16. Create `generate-exercises.ts` skeleton: `main()`, env checks, prod guard, `--dry-run` printout, `isDirectRun`
  - File: `packages/db/scripts/generate-exercises.ts` (new)
  - Imports: `fileURLToPath` from `node:url`; `crypto` for `randomUUID`; `Anthropic` type from `@anthropic-ai/sdk`; `createClaudeClient` and the generator surface from `@language-drill/ai`; `createDb`, `ALL_CURRICULA`, `assertValidCellKey`, `deterministicUuid` from `@language-drill/db`; the schema tables (`exercises`, `exerciseTags`, `generationJobs`, `skillTopics`); `parseGenerateArgs` (Task 12), `resolveCells` (Task 13), `createMockAnthropicClient` (Task 15).
  - Implement `requireEnv(name)` that throws when `process.env[name]` is unset.
  - Implement `printDryRunSummary(cells, args)` that prints one line per cell with the estimated tokens (use the constants `1500` input + `400` output per draft — referenced from a single named const) and the per-cell estimated cost via `estimateCostUsd`. Final line prints total cost.
  - Implement `main(argv = process.argv.slice(2))`:
    1. `const args = parseGenerateArgs(argv);`
    2. Production guard: `if (process.env.NODE_ENV === 'production' && !args.allowProd) { console.error('Refusing to run in production. Pass --allow-prod or use the Phase 4 Lambda path.'); process.exit(1); }`
    3. `const cells = resolveCells(args, ALL_CURRICULA);`
    4. `if (args.dryRun) { printDryRunSummary(cells, args); return; }`
    5. Construct the Anthropic client: `const client = process.env.MOCK_CLAUDE === '1' ? createMockAnthropicClient() : createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));`
    6. Construct the DB client: `const db = createDb(requireEnv('DATABASE_URL'));`
    7. Stub: `for (const cell of cells) { await runOneCell(db, client, cell, args); }` — Task 17 implements `runOneCell`. For Task 16, this loop calls a stub `runOneCell` that does nothing (`return { cell, status: 'succeeded', insertedCount: 0, skippedCount: 0, tokenUsage: ZERO_USAGE, costUsd: 0 }`). Replace in Task 17.
  - Add the `isDirectRun` guard at the bottom (per `seed-exercises.ts:901`) so tests can `import { main }` without re-running.
  - Purpose: the CLI runs end-to-end in `--dry-run` mode after this task — useful sanity check. Real DB writes ship in Task 17.
  - _Leverage: `seed-exercises.ts` (script shape, env-loading, `isDirectRun` guard at line 901-907); Tasks 1, 5, 11, 12, 13, 15_
  - _Requirements: 4.1, 4.2, 4.3, 4.9, NFR Security_

- [x] 17. Add `runOneCell` to `generate-exercises.ts`
  - File: `packages/db/scripts/generate-exercises.ts` (modify — continue from Task 16)
  - Define `CellResult = { cell: Cell; jobId: string; status: 'succeeded' | 'failed' | 'skipped-cost-cap'; insertedCount: number; skippedCount: number; tokenUsage: ClaudeUsageBreakdown; costUsd: number; errorMessage?: string; durationMs: number; inBatchDuplicateCount: number; }`.
  - Implement `runOneCell(db, client, cell, args): Promise<CellResult>`:
    1. `const startedAt = Date.now();`
    2. `assertValidCellKey(cell.cellKey);` — defense-in-depth.
    3. `const skillTopicId = deterministicUuid('skill-topic:' + cell.grammarPoint.key);` and pre-check `SELECT 1 FROM skill_topics WHERE id = $skillTopicId LIMIT 1`. Throw with the suggested fix per design Error scenario 6 if missing.
    4. `const jobId = crypto.randomUUID();` and `INSERT INTO generation_jobs ...` with `id: jobId`, `cellKey: cell.cellKey`, `requestedCount: args.count`, `status: 'running'`, `trigger: 'cli'`. The defaults from the schema fill the rest.
    5. `const spec: GenerationSpec = { language: cell.language, cefrLevel: cell.cefrLevel, exerciseType: cell.exerciseType, grammarPoint: cell.grammarPoint, topicDomain: args.topicDomain, count: args.count, batchSeed: args.batchSeed };`
    6. `let drafts: ExerciseDraft[]; let tokenUsage: ClaudeUsageBreakdown;` — try/catch around `await generateBatch(client, spec)`. On catch: `UPDATE generation_jobs SET status='failed', finished_at=now(), error_message=<err.message>.slice(0, 1000) WHERE id=jobId;` and return a `CellResult` with `status: 'failed'`, `insertedCount: 0`, `skippedCount: 0`, `errorMessage: ...`. Do NOT re-throw — Task 18 picks up the result and continues to the next cell.
    7. Bulk insert into `exercises`:
       ```ts
       const insertedRows = await db.insert(exercises).values(
         drafts.map(d => ({
           id: d.id,
           type: cell.exerciseType,
           language: cell.language,
           difficulty: cell.cefrLevel,
           contentJson: d.contentJson,
           grammarPointKey: cell.grammarPoint.key,
           topicDomain: args.topicDomain,
           generationSource: 'claude-realtime' as const,
           modelId: GENERATION_MODEL,
           reviewStatus: 'auto-approved' as const,
           generatedAt: new Date(),
         }))
       ).onConflictDoNothing().returning({ id: exercises.id });
       const insertedIds = new Set(insertedRows.map(r => r.id));
       ```
    8. Bulk insert into `exercise_tags`:
       ```ts
       await db.insert(exerciseTags).values(
         drafts.map(d => ({ exerciseId: d.id, skillTopicId }))
       ).onConflictDoNothing();
       ```
    9. `const costUsd = estimateCostUsd(tokenUsage);`
    10. `UPDATE generation_jobs SET status='succeeded', finished_at=now(), produced_count=drafts.length, approved_count=drafts.length, flagged_count=0, rejected_count=0, input_tokens_used=tokenUsage.inputTokens + tokenUsage.cacheCreationInputTokens + tokenUsage.cacheReadInputTokens, output_tokens_used=tokenUsage.outputTokens, cost_usd_estimate=costUsd WHERE id=jobId;`
    11. Return `{ cell, jobId, status: 'succeeded', insertedCount: insertedIds.size, skippedCount: drafts.length - insertedIds.size, tokenUsage, costUsd, durationMs: Date.now() - startedAt, inBatchDuplicateCount: drafts.filter(d => d.metadata.inBatchDuplicate).length }`.
  - Purpose: the actual DB-write layer. Each cell is an isolated transaction-like unit; failures don't leak partial drafts.
  - _Leverage: Phase 1 schema (`exercises`, `exerciseTags`, `generationJobs`, `skillTopics`); `assertValidCellKey`; `onConflictDoNothing` pattern from `seed-exercises.ts:861`_
  - _Requirements: 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 5.6, 6.5, 8.1, 8.2, 8.3, 8.4_

### Layer 8 — CLI orchestration

- [x] 18. Add concurrency, cost-cap, and summary printer to `generate-exercises.ts`
  - File: `packages/db/scripts/generate-exercises.ts` (modify — continue from Task 17)
  - Implement an inline `pLimit(n)` (~15 LOC: a queue + counter; `n` is the concurrency). Replace the simple `for (const cell of cells)` loop from Task 16 with `await Promise.all(cells.map((cell) => limit(() => runWithCostCap(cell))));`.
  - Implement `runWithCostCap(cell): Promise<CellResult>`: closes over the running `totalCostUsd` tally; before invoking `runOneCell`, if `totalCostUsd >= args.maxCostUsd`, returns `{ cell, jobId: '', status: 'skipped-cost-cap', insertedCount: 0, skippedCount: 0, tokenUsage: ZERO_USAGE, costUsd: 0, durationMs: 0, inBatchDuplicateCount: 0 }` without making any DB call. After `runOneCell` resolves, updates `totalCostUsd += result.costUsd` (single-threaded JS — no atomic primitive needed; the comment "atomically" in design.md was conceptual).
  - Implement `printSummary(results, totalCostUsd, totalDurationMs)`:
    - One line per cell in the format from design Component 6 (e.g. `[ES B1 cloze es-b1-present-subjunctive] 50 drafts → 50 inserted, 0 skipped — 73,420 input (54,200 cached) / 19,840 output tokens — $0.27 — 2m41s — succeeded`). For `failed` rows, append `(<error message head>)`. For `skipped-cost-cap`, append `(cost cap reached)`. When `inBatchDuplicateCount > 0`, append a `[N in-batch duplicates]` segment to the summary line and emit a stderr warning per Requirement 6.4.
    - Total block at the bottom matching the design's example: cells succeeded/failed/skipped, drafts inserted, total tokens (with cached split), estimated cost, runtime.
  - Set `process.exitCode = 1` at the end of `main` when any cell failed or `totalCostUsd > args.maxCostUsd` (Requirement 4.4). SIGINT handling lands in Task 19.
  - Purpose: cell-level concurrency, the cost guardrail, and the human-readable summary. CLI is feature-complete except for SIGINT.
  - _Leverage: Tasks 12, 16, 17; design Component 6 summary format; `seed-exercises.ts:870-895` summary print style_
  - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 6.4, 6.5, NFR Performance_

- [x] 19. Add SIGINT handler to `generate-exercises.ts`
  - File: `packages/db/scripts/generate-exercises.ts` (modify — continue from Task 18)
  - Add a module-level `let aborted = false;` and at the top of `main(...)` install `process.on('SIGINT', () => { aborted = true; })`.
  - Modify `runWithCostCap` to short-circuit when `aborted === true`: before invoking `runOneCell`, if `aborted`, return `{ cell, jobId: '', status: 'skipped-cost-cap', insertedCount: 0, skippedCount: 0, tokenUsage: ZERO_USAGE, costUsd: 0, durationMs: 0, inBatchDuplicateCount: 0, errorMessage: 'Aborted by user (SIGINT)' }` (reuses the `skipped-cost-cap` status — the summary line will read "(aborted)" because `errorMessage` is set; alternatively introduce a 4th status `'skipped-aborted'` if cleaner — pick the one that requires the smaller change to `printSummary`).
  - Modify `runOneCell` to check `aborted` between the `generateBatch` resolution and the bulk insert: if `aborted` is now true, throw `new Error('Aborted by user (SIGINT)')` so the cell-level catch updates the audit row to `'failed'` with that error message. This handles the case where SIGINT arrives during a long Claude call — the SDK retries internally and resolves; the `aborted` check then prevents the partial commit.
  - At the very end of `main`, if `aborted === true`, emit `console.error('Aborted')` and `process.exit(1)`.
  - SIGINT semantics summary (single sentence in a code comment block): the cell-level isolation guarantees no partial drafts ever land — drafts are committed only after `generateBatch` resolves AND `aborted` is still false at that moment.
  - Purpose: closes design Error scenario 8 — three SIGINT timing cases (during Claude call, between drafts inside `generateBatch` is out of scope per design, between cells) all produce a clean failed-audit-row outcome.
  - _Leverage: Task 17's cell-level try/catch; Task 18's `runWithCostCap` and printSummary_
  - _Requirements: NFR Reliability_

### Layer 9 — CLI tests + script wiring

- [x] 20. Create `generate-exercises.test.ts`
  - File: `packages/db/scripts/generate-exercises.test.ts` (new)
  - **Pure planning tests** (always run — no env gating):
    - `parseGenerateArgs(['--lang','en','--level','B1'])` throws naming the EN exclusion.
    - `parseGenerateArgs(['--lang','es','--level','B1','--count','201'])` throws naming the count cap.
    - `parseGenerateArgs(['--lang','es','--level','B1','--type','cloze','--grammar-point','es-b1-present-subjunctive'])` returns `{ lang:'ES', level:'B1', type:'cloze', grammarPoint:'es-b1-present-subjunctive', count:50, batchSeed:'phase-2-default', maxCostUsd:5, concurrency:1, dryRun:false, allowProd:false, topicDomain:null }`.
    - `parseGenerateArgs(['--lang','es','--level','B1','--grammar-point','es-b1-present-subjunctive'])` throws naming the "scope --type" rule.
    - `parseGenerateArgs(['--lang','es','--level','B1','--allow-prod'])` (default `NODE_ENV` undefined) returns `allowProd: true` and emits a stderr warning (asserted via `vi.spyOn(console, 'warn')` or a captured stderr stream).
    - `resolveCells({ ..., type: 'cloze', grammarPoint: 'es-b1-present-subjunctive' }, ALL_CURRICULA)` returns one cell whose `cellKey` passes `assertValidCellKey`.
    - `resolveCells({ ..., type: 'all', grammarPoint: null }, ALL_CURRICULA)` for `(es, B1)` returns N cells where vocab umbrellas appear only with `vocab_recall` and grammar entries appear only with `cloze` and `translation` (assert by inspecting `cell.exerciseType` per `cell.grammarPoint.kind`).
    - `resolveCells` throws when `--grammar-point` is unknown.
  - **DB-touching tests** wrapped in `describe.skipIf(!process.env.TEST_DATABASE_URL)`:
    - Setup hook: connect to `process.env.TEST_DATABASE_URL`, run a transaction-rolling-back-after-each-test pattern, or simply truncate `exercises`, `exercise_tags`, `generation_jobs` for the test cell at the start of each test (the simpler choice given the small row volume).
    - Test 1: with `MOCK_CLAUDE=1` and `argv=[--lang,es,--level,B1,--type,cloze,--grammar-point,es-b1-present-subjunctive,--count,6]`, run `await main(argv)`. Assert: 6 rows in `exercises` with the columns from Requirement 8.2; 6 rows in `exercise_tags` linking to `deterministicUuid('skill-topic:es-b1-present-subjunctive')`; 1 row in `generation_jobs` with `status='succeeded'`, `produced_count=6`, `approved_count=6`, `input_tokens_used > 0`, `output_tokens_used > 0`, `cost_usd_estimate > 0`.
    - Test 2 (re-run idempotency): re-run the same command. Assert: 0 new rows in `exercises`; 0 new rows in `exercise_tags`; 1 *new* row in `generation_jobs` with `produced_count=6`, `approved_count=6` (append-only audit per Requirement 3.4 — total `generation_jobs` rows for this cell: 2).
    - Test 3 (failure path): wire the mock client to return a malformed fixture for ordinal 2 (e.g. inject a third fixture with `correctAnswer: ''` for cloze). Run `main` with count 6. Assert: 0 rows inserted into `exercises`; the corresponding `generation_jobs` row is updated to `status='failed'` with a non-null `error_message` mentioning ordinal 2.
    - Test 4 (production guard): set `process.env.NODE_ENV = 'production'`, run without `--allow-prod`. Assert `process.exit(1)` was called and no DB write happened.
  - Purpose: regression coverage for the entire CLI happy path + idempotency + failure handling.
  - _Leverage: Tasks 12–19; `seed-exercises.test.ts:115-129` for the `describe.skipIf(!process.env.TEST_DATABASE_URL)` pattern_
  - _Requirements: 7.3, 7.4, 7.5, 8.1, 8.2, 8.3_

- [x] 21. Wire `generate:exercises` into both `package.json`s
  - File: `packages/db/package.json` (modify)
  - File: `package.json` (root — modify)
  - In `packages/db/package.json`, add to `scripts`: `"generate:exercises": "npx tsx scripts/generate-exercises.ts"`. Keep alphabetical order with the existing `seed:exercises` line.
  - In root `package.json`, add to `scripts`: `"generate:exercises": "dotenv -e .env -- pnpm --filter @language-drill/db generate:exercises"`. Place it after `db:seed:exercises` for symmetry.
  - Verify with `pnpm generate:exercises --help` — the help text from Task 12 SHALL print without contacting Claude or the DB.
  - Purpose: the developer-facing knob is wired up.
  - _Leverage: existing `seed:exercises` / `db:seed:exercises` pair at root `package.json:13` and `packages/db/package.json:11`_
  - _Requirements: 4.1, 4.9_

### Layer 10 — Verification

- [x] 22. Run pre-push checks and capture a real-Claude smoke test in the PR description
  - **Manual step** — not automated in this phase per design Testing Strategy.
  - Run `pnpm lint && pnpm typecheck && pnpm test` from the repo root; all three SHALL pass with no warnings.
  - Run `MOCK_CLAUDE=1 TEST_DATABASE_URL=<dev branch URL> pnpm test --filter @language-drill/db -t "generate-exercises"` and confirm the DB-touching tests pass.
  - Run one real Claude call against the dev branch: `pnpm generate:exercises --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 3` (with a real `ANTHROPIC_API_KEY` and `DATABASE_URL` pointing at the dev Neon branch). Confirm:
    - The CLI prints the per-cell summary line within ~30s for 3 drafts.
    - The cache-creation tokens on the first draft are non-zero; cache-read tokens on draft 2 are non-zero (proves cache caching works).
    - The `generation_jobs` row's `cost_usd_estimate` is plausible (~$0.01–0.02 for 3 drafts).
    - `psql` shows 3 rows in `exercises` with `generation_source='claude-realtime'`, `model_id='claude-sonnet-4-5'`, `review_status='auto-approved'`, `grammar_point_key='es-b1-present-subjunctive'`.
    - `GET /exercises?language=ES&difficulty=B1` from the local API (with the dev DB pointed at) returns one of the inserted exercises.
  - **Paste the CLI summary output, the `generation_jobs` row, and a sample `exercises` row JSON into the PR description before requesting review.** Reviewers reject the PR if any of the three is missing.
  - Purpose: closes the design's mandatory-manual-step gap and proves the generator end-to-end before merge to main.
  - _Leverage: Tasks 1–21 (all prior tasks must be merged or staged in the same PR); existing `pnpm db:migrate` + Phase 1's seed_
  - _Requirements: 7.5, NFR Performance, design Testing Strategy §Manual verification_
