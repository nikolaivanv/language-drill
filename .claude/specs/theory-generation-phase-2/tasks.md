# Implementation Plan

## Task Overview

Phase 2 ships in five thin layers, each independently testable:

1. **Generator core** (Tasks 1–7) — `packages/ai/src/theory-generate.ts` + `theory-prompts.ts` + tests + barrel re-exports. The Claude-touching side of the phase.
2. **Orchestrator + cell enumeration** (Tasks 8–12) — `packages/db/src/theory-generation/cells.ts` + `run-one-cell.ts` + tests + barrel updates. Glues the generator to the DB.
3. **`pLimit` extraction** (Task 13) — moves the existing inline `pLimit` from `generate-exercises.ts` into `packages/db/scripts/p-limit.ts` so both CLIs share one implementation. Pure refactor; no behavior change.
4. **CLI + helpers + fixtures** (Tasks 14–22) — argument parser, cell resolver, mock client, fixtures, the `main` driver, summary printer, package.json wiring, integration test.
5. **Verification** (Task 23) — the repo-root `pnpm lint && pnpm typecheck && pnpm test` gate.

The phase ships only after Task 23 is green. Phase 3 (validator + routing) and Phase 4 (Lambda + scheduler) are downstream and deliberately absent here. After Task 23 the operator can run `pnpm generate:theory --lang es --grammar-point <real ES B1 key>` and produce one `theory_topics` row with `review_status='auto-approved'` plus a `theory_generation_jobs` audit row — this is the Phase 2 contract.

## Steering Document Compliance

- **Anthropic Claude API + tool use + `cache_control: ephemeral`** (`tech.md` §"AI / GenAI"): Tasks 1–4 follow the exact pattern `evaluate.ts` and `generateBatch` established — `client.messages.create` with one cached system block, `tool_choice` forced-call against a strict `input_schema`.
- **`claude-sonnet-4-5` model pinning** (`tech.md` §"AI / GenAI", resolved decision #2): Task 1 aliases `THEORY_GENERATION_MODEL = GENERATION_MODEL`; Task 7 adds the cross-file equality assertion so bumping one generator without the other fails CI.
- **Drizzle + JSONB + typed reads/writes** (`tech.md` §"Database"): Task 10 imports `theoryTopics` and `theoryGenerationJobs` from `@language-drill/db` (already typed `$type<TheoryTopicJson>()` from Phase 1). No casts at INSERT.
- **Co-located tests** (`CLAUDE.md` §Testing): every test file sits next to the module it tests. No orphan test directories.
- **Pre-push gate** (`CLAUDE.md` §Pre-Push Checks): Task 23 runs the three repo-root commands; Phase 2 ships only when green.
- **No new dependencies** (`CLAUDE.md` §"Package Management"): Phase 2 introduces zero npm packages. Anthropic SDK, Drizzle, Vitest are unchanged.
- **Package boundaries** (`tech.md` §"Monorepo Structure"): `packages/ai` owns generator + prompts + tool schema; `packages/db/src/theory-generation/` owns orchestrator + cell builder; `packages/db/scripts/` owns the CLI surface. No new cross-package edges.

## Atomic Task Requirements

Each task below touches ≤ 3 files, fits in 15–30 minutes for an experienced developer, and has a single testable outcome. Tasks 4, 7, and 11 are at the upper end of the box because they compose substantial generator/orchestrator/test logic; they remain single-purpose and reviewable against the design's component definitions. The CLI driver is deliberately split into Tasks 20a (helpers) and 20b (main + cost cap + exit codes) so each sub-task fits cleanly inside the time-box.

## Tasks

### Layer 1 — Generator core (`packages/ai`)

- [x] 1. Create `packages/ai/src/theory-generate.ts` with constants, types, and ID helpers
  - File: `packages/ai/src/theory-generate.ts` (new)
  - Imports: `Anthropic` SDK type; `Language`, `LearningLanguage`, `CurriculumCefrLevel`, `GrammarPoint`, `TheoryTopicJson`, `deterministicUuid` from `@language-drill/shared`; `GENERATION_MODEL` from `./generate`; `ClaudeUsageBreakdown` from `./cost-model`.
  - Export constants: `THEORY_TOOL_NAME = 'submit_theory_topic' as const`; `THEORY_GENERATION_MODEL = GENERATION_MODEL`; `THEORY_GENERATION_TEMPERATURE = 0.4 as const`; `THEORY_GENERATION_MAX_TOKENS = 8192 as const`.
  - Export types: `TheoryGenerationSpec { language: Exclude<Language, Language.EN>; cefrLevel: CurriculumCefrLevel; grammarPoint: GrammarPoint; batchSeed: string }`; `TheoryDraft { id: string; topicId: string; contentJson: TheoryTopicJson; metadata: { grammarPointKey, modelId, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } }`; `TheoryGenerateResult { draft: TheoryDraft; tokenUsage: ClaudeUsageBreakdown }`.
  - Export `theoryDraftId(spec)` returning `deterministicUuid([spec.language, spec.grammarPoint.key, spec.batchSeed].join('|'))`. No ordinal — theory is one page per cell (Req 3.1).
  - Export `deriveTheoryTopicId(grammarPointKey)`: validate against `/^(es|de|tr)-(a1|a2|b1|b2)-[a-z0-9-]+$/`; throw `Error('Invalid grammar point key for topic-id derivation: <key>')` on mismatch; otherwise return `grammarPointKey.replace(/^[a-z]{2}-/, '')` (Req 3.2–3.3).
  - Add a JSDoc block at the top of the file documenting the model pinning, the temperature choice vs exercise generation (0.4 vs 0.7), and the deferred-to-Phase-3 validator path.
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm zero errors.
  - Purpose: pin the public surface at the type level so subsequent tasks compile against a stable contract.
  - _Leverage: `packages/ai/src/generate.ts:37-260` (constants + types pattern); `packages/shared/src/deterministic-uuid.ts` (hash function)_
  - _Requirements: 1.1, 1.2, 1.9, 3.1, 3.2, 3.3_

- [x] 2. Add `THEORY_GENERATION_TOOL` JSON Schema to `theory-generate.ts`
  - File: `packages/ai/src/theory-generate.ts` (modify — continue from Task 1)
  - Add `export const THEORY_GENERATION_TOOL: Anthropic.Tool` with `name: THEORY_TOOL_NAME`, `description` per design Component 2, and `input_schema` mirroring `TheoryTopicJson` field-for-field.
  - Top-level shape: `type: 'object'`, `properties: { id, title, subtitle, cefr, sections }`, `required: ['id', 'title', 'subtitle', 'cefr', 'sections']`, `$defs` table for recursive types.
  - `$defs.section`: object with required `id`, `title`, `body`; `body` is array `minItems: 1` of `$ref: '#/$defs/block'`.
  - `$defs.block`: `oneOf` over `blockParagraph | blockCallout | blockExample | blockList | blockConjugationTable`, each with `kind: { const: '<value>' }` and the block-specific required fields per Phase 1 taxonomy.
  - `$defs.blockParagraph`: `{ kind: 'paragraph', text: array minItems 1 of inline }`. `$defs.blockCallout`: `{ kind: 'callout', variant?: enum['default','warn'], children: array minItems 1 of block }`. `$defs.blockExample`: `{ kind: 'example', target: array minItems 1 of inline, en: string minLength 1, note?: array minItems 1 of inline }`. `$defs.blockList`: `{ kind: 'list', items: array minItems 1 of (array minItems 1 of block) }`. `$defs.blockConjugationTable`: `{ kind: 'conjugation-table', head: array minItems 1 of string, rows: array minItems 1 of (array of string) }`.
  - `$defs.inline`: `oneOf` over `inlineText | inlineStrong | inlineEm | inlineHilite | inlineMono`. `$defs.inlineText`: `{ kind: 'text', text: string minLength 1 }`. The four wrapper variants share the wrapper shape with their respective `kind` const: `{ kind: '<strong|em|hilite|mono>', children: array minItems 1 of inline }`. Each wrapper variant is fully written out (no `// same shape` placeholders left for runtime).
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm the schema compiles against `Anthropic.Tool['input_schema']`.
  - Purpose: the schema is the prompt-time hint Claude validates its tool output against; the parser (Phase 1) is the gate. Both must align with the Phase 1 taxonomy.
  - _Leverage: `packages/shared/src/theory.ts` (the type taxonomy this schema mirrors); `packages/ai/src/generate.ts:71-209` (per-type tool-schema pattern)_
  - _Requirements: 2.1, 2.2_

- [x] 3. Create `packages/ai/src/theory-prompts.ts` with system + user prompt builders
  - File: `packages/ai/src/theory-prompts.ts` (new)
  - Imports: `Language`, `LANGUAGE_NAMES`, `CurriculumCefrLevel`, `GrammarPoint` from `@language-drill/shared`; `THEORY_TOOL_NAME` from `./theory-generate.js`.
  - Export type `TheoryPromptInputs { language: Exclude<Language, Language.EN>; cefrLevel: CurriculumCefrLevel; grammarPoint: GrammarPoint }`.
  - Export `buildTheorySystemPrompt(inputs)` returning a deterministic multi-line string per design Component 3's layout: role declaration with `LANGUAGE_NAMES[language]` and `cefrLevel`; `## Grammar point context` block carrying `grammarPoint.description`; `## Positive examples` bulleted list from `grammarPoint.examplesPositive`; `## Common learner errors` bulleted list from `grammarPoint.commonErrors`; `## Required sections (in this order)` numbered list naming exactly `what is it?`, `when to use it`, `formation`, `examples in context`, `common pitfalls`; `## Voice` block ("Editorial. Concise. Lowercase headings. Treat the reader as an adult. No padding, no encouragement, no emojis."); `## Output format` block instructing the model to call the `{{THEORY_TOOL_NAME}}` tool exactly once with the structured topic and using the inline-node union instead of HTML/markdown.
  - Export `buildTheoryUserPrompt(inputs)` returning `\`Produce the theory page for ${inputs.grammarPoint.name} (${inputs.grammarPoint.key}) at CEFR ${inputs.cefrLevel}.\``.
  - Add a JSDoc block at the top noting the import cycle with `theory-generate.ts` (ESM resolves it; same pattern as `generation-prompts.ts:21-25`).
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm zero errors.
  - Purpose: separate the prompt text (which changes when voice or required sections change) from the function that calls Claude. Phase 5+ may extend the prompt without touching the generator.
  - _Leverage: `packages/ai/src/generation-prompts.ts:78-119` (system prompt assembly pattern)_
  - _Requirements: 2.3, 2.4_

- [x] 4. Add `generateTheoryTopic` async function to `theory-generate.ts`
  - File: `packages/ai/src/theory-generate.ts` (modify — continue from Task 2)
  - Add internal `readUsage(response: Anthropic.Message): ClaudeUsageBreakdown` helper — mirror of `generate.ts:495-503`, returns `{ inputTokens, cacheCreationInputTokens, cacheReadInputTokens, outputTokens }` with `?? 0` defaults on each field.
  - Import `buildTheorySystemPrompt`, `buildTheoryUserPrompt`, `TheoryPromptInputs` from `./theory-prompts.js`; import `parseTheoryTopicJson` from `@language-drill/shared`.
  - Export `async function generateTheoryTopic(client: Anthropic, spec: TheoryGenerationSpec): Promise<TheoryGenerateResult>`:
    1. Top guards: `if ((spec.language as Language) === Language.EN) throw new Error('language EN is not a learning language for theory generation (resolved decision #5)')`; `if (spec.grammarPoint.kind !== 'grammar') throw new Error(\`Theory generator: grammarPoint kind '\${spec.grammarPoint.kind}' is not supported in round 1 (resolved decision #6); got '\${spec.grammarPoint.kind}' on '\${spec.grammarPoint.key}'\`)`.
    2. Build `systemText` and `userText` from the prompt builders.
    3. Call `client.messages.create({ model: GENERATION_MODEL, max_tokens: THEORY_GENERATION_MAX_TOKENS, system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: userText }], tools: [THEORY_GENERATION_TOOL], tool_choice: { type: 'tool', name: THEORY_TOOL_NAME }, temperature: THEORY_GENERATION_TEMPERATURE })`.
    4. Find the `tool_use` block in `response.content`. If none, throw `\`Theory draft malformed: no tool_use block returned (stop_reason=\${response.stop_reason})\``. If `name !== THEORY_TOOL_NAME`, throw `\`Theory draft malformed: expected tool '\${THEORY_TOOL_NAME}', got '\${toolUseBlock.name}'\``.
    5. Try `parseTheoryTopicJson(toolUseBlock.input)`; on throw, re-throw with `\`Theory draft malformed: \${parser message}\``.
    6. `const usage = readUsage(response)`. Build and return `{ draft: { id: theoryDraftId(spec), topicId: deriveTheoryTopicId(spec.grammarPoint.key), contentJson, metadata: { grammarPointKey: spec.grammarPoint.key, modelId: GENERATION_MODEL, inputTokens: usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens, outputTokens: usage.outputTokens, cacheCreationInputTokens: usage.cacheCreationInputTokens, cacheReadInputTokens: usage.cacheReadInputTokens } }, tokenUsage: usage }`.
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm zero errors.
  - Purpose: the single function that talks to Claude on theory's behalf. Every downstream caller goes through this.
  - _Leverage: `packages/ai/src/generate.ts:510-619` (generateBatch pattern; per-call structure)_
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 5. Re-export the theory generator from `packages/ai/src/index.ts`
  - File: `packages/ai/src/index.ts` (modify)
  - Append a block re-exporting the new symbols: `THEORY_TOOL_NAME, THEORY_GENERATION_MODEL, THEORY_GENERATION_TEMPERATURE, THEORY_GENERATION_MAX_TOKENS, THEORY_GENERATION_TOOL, generateTheoryTopic, theoryDraftId, deriveTheoryTopicId` from `./theory-generate.js`; `type TheoryGenerationSpec, TheoryDraft, TheoryGenerateResult` from `./theory-generate.js`; `buildTheorySystemPrompt, buildTheoryUserPrompt` from `./theory-prompts.js`; `type TheoryPromptInputs` from `./theory-prompts.js`.
  - Place the new block after the existing validator re-export block (the file's structure already groups by feature).
  - Run `pnpm typecheck --filter @language-drill/ai` and confirm the barrel resolves.
  - Purpose: downstream packages (`@language-drill/db`'s orchestrator + CLI) import via the barrel; this task pins the public surface.
  - _Leverage: existing barrel pattern at `packages/ai/src/index.ts:31-59` (the exercise generator's re-export block)_
  - _Requirements: 1.9_

- [x] 6. Create `packages/ai/src/theory-prompts.test.ts` with golden tests
  - File: `packages/ai/src/theory-prompts.test.ts` (new)
  - Imports: `describe, it, expect` from `vitest`; `buildTheorySystemPrompt, buildTheoryUserPrompt` from `./theory-prompts`; `Language` from `@language-drill/shared`; `esCurriculum` from `@language-drill/db`.
  - Test data setup: find one `kind: 'grammar'` entry from `esCurriculum` (e.g. `const entry = esCurriculum.find(e => e.kind === 'grammar')!`); store in `const TEST_INPUT: TheoryPromptInputs = { language: Language.ES, cefrLevel: entry.cefrLevel, grammarPoint: entry }`.
  - Determinism test: `expect(buildTheorySystemPrompt(TEST_INPUT)).toBe(buildTheorySystemPrompt(TEST_INPUT))`. Same for the user prompt.
  - Substring presence tests (system prompt): assert it includes `entry.description`; iterate over `entry.examplesPositive` and assert each appears as a substring; same for `entry.commonErrors`.
  - Section-order test: extract the system prompt's `## Required sections` block via regex; assert the order is `what is it?` → `when to use it` → `formation` → `examples in context` → `common pitfalls` (e.g. `expect(prompt.indexOf('what is it?')).toBeLessThan(prompt.indexOf('when to use it'))` chained for each pair).
  - Voice + output-format test: assert the system prompt contains `'Editorial. Concise. Lowercase headings.'` and `'submit_theory_topic'` and `'No padding, no encouragement, no emojis.'`.
  - User prompt test: assert `buildTheoryUserPrompt(TEST_INPUT)` equals the exact templated string with `entry.name`, `entry.key`, and `entry.cefrLevel`.
  - Run `pnpm test --filter @language-drill/ai -t theory-prompts` and confirm all tests pass.
  - Purpose: the prompt is the most likely place for accidental drift between generator versions; this test fails on any non-deterministic rewrite or section-order change.
  - _Leverage: existing test pattern in `packages/ai/src/generation-prompts.test.ts` (the exercise prompt's tests)_
  - _Requirements: 2.5, 2.6, 8.4_

- [x] 7. Create `packages/ai/src/theory-generate.test.ts` with generator unit tests
  - File: `packages/ai/src/theory-generate.test.ts` (new)
  - Setup: a `makeStubClient(toolUseInput: unknown, opts?: { stopReason?: string; toolName?: string; usage?: Partial<Anthropic.Usage> })` helper that returns a partial Anthropic mock whose `messages.create` resolves to `{ content: [{ type: 'tool_use', name: opts?.toolName ?? THEORY_TOOL_NAME, input: toolUseInput, id: 'toolu_test' }], usage: { input_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 800, ...opts?.usage }, stop_reason: opts?.stopReason ?? 'tool_use', id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', stop_sequence: null }`. Cast through `as unknown as Anthropic`.
  - Test data: load Phase 1's `subjunctive.json` via `JSON.parse(readFileSync(path.join(__dirname, '../../db/scripts/__fixtures__/theory-json/subjunctive.json'), 'utf-8'))` (use `import.meta.url` + `fileURLToPath` to derive `__dirname` per ESM convention). Use `esCurriculum` from `@language-drill/db` to find a `kind: 'grammar'` ES entry; build a `spec: TheoryGenerationSpec` from it.
  - Happy-path test (Req 8.1.a): call `generateTheoryTopic(client, spec)`. Assert `draft.id === theoryDraftId(spec)`, `draft.topicId === deriveTheoryTopicId(spec.grammarPoint.key)`, `draft.metadata.modelId === GENERATION_MODEL`, `expect(draft.contentJson).toEqual(JSON.parse(subjunctiveFixture))`, `draft.metadata.inputTokens === 1500`, `draft.metadata.outputTokens === 800`.
  - Determinism test (Req 8.1.b): `for (let i = 0; i < 100; i++) expect(theoryDraftId(spec)).toBe(theoryDraftId(spec))`.
  - Distinct-input test (Req 8.1.c): assert `theoryDraftId({...spec, batchSeed: 'a'}) !== theoryDraftId({...spec, batchSeed: 'b'})`.
  - `deriveTheoryTopicId` round-trips (Req 8.1.d): `'es-b1-x' → 'b1-x'`, `'de-a2-x' → 'a2-x'`, `'tr-b2-x' → 'b2-x'`.
  - `deriveTheoryTopicId` reject (Req 8.1.e): `'invalid-key'`, `'es-c1-x'` (c1 not in regex), `''`, `'fr-b1-x'` all throw with the `'Invalid grammar point key'` message.
  - EN reject (Req 8.1.g): build `spec` with `language` cast through `as unknown as Language.ES` then mutated to `Language.EN`; assert `generateTheoryTopic` throws containing `resolved decision #5`.
  - Vocab reject (Req 8.1.f): build `spec` with a `kind: 'vocab'` grammar point (synthetic, since `esCurriculum`'s `kind: 'vocab'` umbrella may not exist after the 2026-05-10 reduction noted in `packages/db/src/curriculum/index.ts:36-38`); assert throws containing `resolved decision #6`.
  - No tool_use block (Req 8.1.h): build a stub whose `messages.create` returns `{ content: [{ type: 'text', text: '...' }], usage: {...}, stop_reason: 'max_tokens', id: 'msg_test', ... }`; assert throws `\`Theory draft malformed: no tool_use block returned (stop_reason=max_tokens)\``.
  - Wrong tool name (Req 8.1.i): build a stub with `toolName: 'submit_other_thing'`; assert throws containing `'expected tool \\'submit_theory_topic\\', got \\'submit_other_thing\\''`.
  - Parser failure (Req 8.1.j): pass a malformed input (`{ id: 'x' }` missing required fields); assert throws with `/^Theory draft malformed: Invalid/` and the parser's path-prefixed message in the body (e.g. `/Invalid title.*must be present/`).
  - Model pin (Req 8.3): `expect(THEORY_GENERATION_MODEL).toBe(GENERATION_MODEL); expect(THEORY_GENERATION_MODEL).toBe('claude-sonnet-4-5')`.
  - Schema shape (Req 8.2): walk `THEORY_GENERATION_TOOL.input_schema`'s `$defs`. Assert the top-level `required` array equals `['id', 'title', 'subtitle', 'cefr', 'sections']`. Assert `$defs.block.oneOf.length === 5` and each arm's `properties.kind.const` is one of `paragraph|callout|example|list|conjugation-table`. Assert `$defs.inline.oneOf.length === 5` and each arm's `properties.kind.const` is one of `text|strong|em|hilite|mono`. Assert `$defs.blockExample.required` includes `kind`, `target`, `en` but NOT `note`. Hand-written walk; no `ajv` dependency.
  - Run `pnpm test --filter @language-drill/ai -t theory-generate` and confirm all tests pass.
  - Purpose: lock every reject path AND the happy path. The schema-shape test catches Phase 1 / Phase 2 taxonomy drift.
  - _Leverage: existing test pattern in `packages/ai/src/generate.test.ts`; `packages/db/scripts/__fixtures__/theory-json/subjunctive.json` (Phase 1 fixture)_
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.1, 3.2, 3.3, 8.1, 8.2, 8.3_

### Layer 2 — Orchestrator + cell enumeration (`packages/db/src/theory-generation/`)

- [x] 8. Create `packages/db/src/theory-generation/cells.ts` with `TheoryCell` + enumerator
  - File: `packages/db/src/theory-generation/cells.ts` (new)
  - Imports: `LearningLanguage` from `@language-drill/shared`; `CurriculumCefrLevel`, `GrammarPoint` from `../curriculum`; `buildTheoryCellKey` from `../lib/theory-cell-key`; `ROUND_1_CEFR_LEVELS` from `../generation/cells`.
  - Export type `TheoryCell { language: LearningLanguage; cefrLevel: CurriculumCefrLevel; grammarPoint: GrammarPoint; cellKey: string }`. No `exerciseType` field — theory has no per-type fan-out (Req 5.1).
  - Export `THEORY_ROUND_1_CEFR_LEVELS = ROUND_1_CEFR_LEVELS` (Req 5.4).
  - Export `enumerateTheoryCells(curriculum: readonly GrammarPoint[]): TheoryCell[]`: iterate `curriculum`; for entries with `kind === 'grammar'` (Req 5.2), construct `cellKey` via `buildTheoryCellKey({ language: entry.language, cefrLevel: entry.cefrLevel, grammarPointKey: entry.key })`; push `{ language, cefrLevel, grammarPoint: entry, cellKey }`. Skip vocab umbrellas silently. Return order matches input.
  - Add a JSDoc block documenting that vocab umbrellas are silently filtered out per resolved decision #6, and that the round-1 level scope is shared with the exercise generator via the re-export.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the single canonical cell builder. Phase 4's scheduler imports from here.
  - _Leverage: `packages/db/src/generation/cells.ts:74-97` (structural mirror)_
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 9. Create `packages/db/src/theory-generation/cells.test.ts`
  - File: `packages/db/src/theory-generation/cells.test.ts` (new)
  - Imports: `describe, it, expect` from `vitest`; `enumerateTheoryCells, THEORY_ROUND_1_CEFR_LEVELS, type TheoryCell` from `./cells`; `ALL_CURRICULA` from `../curriculum`; `assertValidTheoryCellKey` from `../lib/theory-cell-key`.
  - Test 1 (`enumerateTheoryCells` vs live curriculum): compute the count of `kind === 'grammar'` entries in `ALL_CURRICULA` (`const grammarCount = ALL_CURRICULA.filter(e => e.kind === 'grammar').length`). Assert `enumerateTheoryCells(ALL_CURRICULA).length === grammarCount`.
  - Test 2 (vocab filter): assert no returned cell's `grammarPoint.kind === 'vocab'`.
  - Test 3 (cell-key shape): iterate every returned cell; assert `assertValidTheoryCellKey(cell.cellKey)` does not throw for any.
  - Test 4 (synthetic input): build a 4-entry array — 2 with `kind: 'grammar'`, 2 with `kind: 'vocab'`, using minimal `GrammarPoint` shapes (or cast through `as GrammarPoint`). Assert `enumerateTheoryCells(synthetic).length === 2`.
  - Test 5 (level-scope pin): `expect(THEORY_ROUND_1_CEFR_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2'])`.
  - Run `pnpm test --filter @language-drill/db -t cells` and confirm all tests pass.
  - Purpose: prove the vocab filter, the cell-key invariant, and the level-scope re-export.
  - _Leverage: existing test pattern in `packages/db/src/generation/cells.test.ts`_
  - _Requirements: 5.5, 8.6_

- [x] 10. Create `packages/db/src/theory-generation/run-one-cell.ts` with `runOneTheoryCell` orchestrator
  - File: `packages/db/src/theory-generation/run-one-cell.ts` (new)
  - Imports: `Anthropic` SDK type; `generateTheoryTopic, GENERATION_MODEL, estimateCostUsd, ZERO_USAGE, type ClaudeUsageBreakdown, type TheoryGenerationSpec` from `@language-drill/ai`; `eq` from `drizzle-orm`; `Db` from `../client`; `assertValidTheoryCellKey` from `../lib/theory-cell-key`; `theoryTopics, theoryGenerationJobs` from `../schema/index`; `TheoryCell` from `./cells`.
  - Constants: `const ERROR_MESSAGE_MAX_LENGTH = 1000;`.
  - Export types: `RunOneTheoryCellInput { db: Db; client: Anthropic; cell: TheoryCell; args: { batchSeed: string; maxCostUsd: number }; jobId: string; trigger: 'cli' | 'scheduled' | 'admin'; signal?: AbortSignal }`; `TheoryCellResult { cell: TheoryCell; jobId: string; status: 'succeeded' | 'failed' | 'skipped-cost-cap'; insertedCount: 0 | 1; skippedCount: 0 | 1; tokenUsage: ClaudeUsageBreakdown; costUsd: number; durationMs: number; errorMessage?: string }`.
  - Internal `failClosed(opts: { cell, jobId, tokenUsage, durationMs, errorMessage, auditRowExists, db }): Promise<TheoryCellResult>` — mirror of `packages/db/src/generation/run-one-cell.ts:501-537`. If `auditRowExists`, UPDATE the audit row with `status: 'failed'`, `finishedAt: now`, `errorMessage: truncated to ERROR_MESSAGE_MAX_LENGTH`. Return `TheoryCellResult` with `status: 'failed'`, `insertedCount: 0`, `skippedCount: 0`, populated `tokenUsage`, `costUsd: estimateCostUsd(tokenUsage)`, `durationMs`, `errorMessage: truncated`.
  - Export `async function runOneTheoryCell(input): Promise<TheoryCellResult>`:
    1. Destructure `{ db, client, cell, args, jobId, trigger, signal }`. `const startedAt = Date.now();`
    2. SIGINT precheck: if `signal?.aborted`, return `failClosed({ ..., errorMessage: 'Aborted by user (SIGINT)', auditRowExists: false })`.
    3. `try { assertValidTheoryCellKey(cell.cellKey); } catch (err) { return failClosed({ ..., errorMessage: err.message, auditRowExists: false }) }`.
    4. INSERT audit row: wrap in `try { await db.insert(theoryGenerationJobs).values({ id: jobId, cellKey: cell.cellKey, status: 'running', trigger }); } catch { return failClosed({ ..., errorMessage: 'Audit row id collision (job already ran)', auditRowExists: false }) }` (the catch fires on PK violation).
    5. Build `spec: TheoryGenerationSpec = { language: cell.language, cefrLevel: cell.cefrLevel, grammarPoint: cell.grammarPoint, batchSeed: args.batchSeed }`. `let tokenUsage: ClaudeUsageBreakdown = ZERO_USAGE;`
    6. SIGINT recheck. Call `generateTheoryTopic(client, spec)` inside `try/catch`. On throw: capture the message; call `failClosed({ ..., tokenUsage: ZERO_USAGE, auditRowExists: true, errorMessage: thrown.message, ... })`. On success: assign `tokenUsage = result.tokenUsage`; store `draft = result.draft`. SIGINT recheck after success.
    7. `const generatedAt = new Date();`. INSERT into `theoryTopics`: values `{ id: draft.id, language: cell.language, grammarPointKey: cell.grammarPoint.key, topicId: draft.topicId, cefrLevel: cell.cefrLevel, contentJson: draft.contentJson, generationSource: 'claude-realtime', modelId: GENERATION_MODEL, reviewStatus: 'auto-approved', qualityScore: null, flaggedReasons: null, generatedAt }`. Use `.onConflictDoNothing().returning({ id: theoryTopics.id })`.
    8. `const costUsd = estimateCostUsd(tokenUsage); const inputTokensUsed = tokenUsage.inputTokens + tokenUsage.cacheCreationInputTokens + tokenUsage.cacheReadInputTokens;`
    9. If `inserted.length === 0` (dedup skip): `insertedCount = 0; skippedCount = 1`. Audit-close UPDATE with `status: 'succeeded'`, `finishedAt: new Date()`, `approved: false`, `flagged: false`, `rejected: false`, `inputTokensUsed`, `outputTokensUsed: tokenUsage.outputTokens`, `costUsdEstimate: costUsd.toFixed(4)`, `errorMessage: 'cell already filled (partial index collision)'`. Return `TheoryCellResult` with `status: 'succeeded'`, `insertedCount`, `skippedCount`, `tokenUsage`, `costUsd`, `durationMs: Date.now() - startedAt`, `errorMessage: 'cell already filled (partial index collision)'`.
    10. Else (success): `insertedCount = 1; skippedCount = 0`. Audit-close UPDATE with `status: 'succeeded'`, `approved: true`, `flagged: false`, `rejected: false`, plus the same token/cost columns. Return `TheoryCellResult` with `status: 'succeeded'`, counts, timing.
  - Wrap steps 6–10 in an outer `try/catch` so any unexpected throw still produces a `failClosed` result with `auditRowExists: true`.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the testable orchestrator. CLI and Phase 4 Lambda both call this.
  - _Leverage: `packages/db/src/generation/run-one-cell.ts:316-537` (structural mirror; trim the per-ordinal loop, the validator branch, and the dedup-retry helper)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

- [x] 11. Create `packages/db/src/theory-generation/run-one-cell.test.ts` (TEST_DATABASE_URL-gated)
  - File: `packages/db/src/theory-generation/run-one-cell.test.ts` (new)
  - Top-level `describe.skipIf(!process.env.TEST_DATABASE_URL)` wraps the DB-touching block (matches `seed-exercises.test.ts`).
  - Imports: `describe, it, expect, beforeEach, afterEach, vi` from `vitest`; `randomUUID` from `node:crypto`; `eq` from `drizzle-orm`; `createDb, theoryTopics, theoryGenerationJobs, buildTheoryCellKey` from `@language-drill/db`; `runOneTheoryCell, type TheoryCell` from `./run-one-cell`; `THEORY_TOOL_NAME` from `@language-drill/ai`.
  - Setup: `const db = createDb(process.env.TEST_DATABASE_URL!);`. Build a local inline mock client that returns Phase 1's `subjunctive.json` fixture as the tool_use input. (`createTheoryMockClient` from Task 19 lands later in the sequence; Task 11 owns its own inline mock so the orchestrator tests don't depend on a not-yet-written script. The inline shape is tiny — see the per-test stubs.)
  - Test-fixture cleanup: `const TEST_KEY_PREFIX = 'es-b1-test-rotc-';` (run-one-test-cell). `afterEach` DELETE FROM theory_topics WHERE grammar_point_key LIKE TEST_KEY_PREFIX || '%'; DELETE FROM theory_generation_jobs WHERE cell_key LIKE '%' || TEST_KEY_PREFIX || '%'.
  - Helper: `function buildTestCell(suffix = randomUUID().slice(0, 8)): TheoryCell` returning a cell with a synthetic grammar point: `{ key: \`\${TEST_KEY_PREFIX}\${suffix}\`, kind: 'grammar', name: 'test', description: 'd', cefrLevel: 'B1', language: 'ES', examplesPositive: ['a','b'], examplesNegative: ['*c'], commonErrors: ['e'] }`. Use `buildTheoryCellKey` for `cellKey`. Note: the synthetic key bypasses curriculum invariants (the key won't match the curriculum), so `runOneTheoryCell` must succeed without consulting `ALL_CURRICULA` — verify the orchestrator does NOT validate the key against the curriculum.
  - Happy path test (Req 8.5.a): build a fresh cell; call `runOneTheoryCell({ db, client: mockClient(), cell, args: { batchSeed: 'test', maxCostUsd: 1.0 }, jobId: randomUUID(), trigger: 'cli' })`. Assert returned `status: 'succeeded'`, `insertedCount: 1`, `skippedCount: 0`. Query `theory_topics` by `grammar_point_key === cell.grammarPoint.key`; assert one row with `review_status='auto-approved'`, `model_id='claude-sonnet-4-5'`, `generation_source='claude-realtime'`. Query `theory_generation_jobs` by `cellKey`; assert one audit row with `status='succeeded'`, `approved=true`, `flagged=false`, `rejected=false`, `input_tokens_used > 0`, `output_tokens_used > 0`, `cost_usd_estimate > 0`.
  - Dedup-skip test (Req 8.5.b): run the same cell twice with distinct jobIds. Second result asserts `status: 'succeeded'`, `insertedCount: 0`, `skippedCount: 1`, `errorMessage` containing `'cell already filled'`. Query `theory_generation_jobs` for the second jobId and assert `approved=false`, `error_message` matches.
  - Audit-row-ID collision test (Req 8.5.c): call `runOneTheoryCell` with a fixed `jobId` once successfully; call again with the SAME `jobId` on a DIFFERENT cell (so the topics-pool collision wouldn't apply). Use `vi.spyOn` on the mock client's `messages.create`. Assert second result `status: 'failed'`, `errorMessage` containing `'Audit row id collision'`. Assert spy was called exactly 1 time across both invocations.
  - Claude failure path test (Req 8.5.d): build an in-memory mock client whose `messages.create` returns a `tool_use` block with malformed input (e.g. `{ sections: [] }` — empty sections fail Phase 1's parser). Build a fresh cell. Call `runOneTheoryCell`. Assert `status: 'failed'`, `errorMessage` starts with `'Theory draft malformed: Invalid sections'`. Audit row `status='failed'`.
  - SIGINT path test (Req 8.5.e): `const ac = new AbortController(); ac.abort();`. Pass `signal: ac.signal`. Spy on `messages.create`. Assert returned `status: 'failed'`, `errorMessage: 'Aborted by user (SIGINT)'`. Assert spy was NOT called (call count 0).
  - Run `pnpm test --filter @language-drill/db -t run-one-cell` and confirm all tests pass (or skip if `TEST_DATABASE_URL` is unset).
  - Purpose: prove the orchestrator's five terminal paths against a real Postgres.
  - _Leverage: `packages/db/src/generation/run-one-cell.test.ts` (existing structural pattern); `packages/db/scripts/seed-exercises.test.ts` (`describe.skipIf` pattern)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 8.5_

- [x] 12. Create `packages/db/src/theory-generation/index.ts` barrel and re-export from `@language-drill/db`
  - File: `packages/db/src/theory-generation/index.ts` (new)
  - File: `packages/db/src/index.ts` (modify)
  - In `theory-generation/index.ts`: `export { enumerateTheoryCells, THEORY_ROUND_1_CEFR_LEVELS, type TheoryCell } from './cells'; export { runOneTheoryCell, type RunOneTheoryCellInput, type TheoryCellResult } from './run-one-cell';`. Add a JSDoc block at the top documenting that this is the Phase 2 theory-generation surface, mirroring the existing `./generation/index.ts`.
  - In `packages/db/src/index.ts`: append `export * from './theory-generation';` immediately after the existing `export * from './generation';` line (line 68 in the current file).
  - Run `pnpm typecheck --filter @language-drill/db` and confirm the barrel resolves; the CLI in Task 20 will import via this barrel.
  - Purpose: single canonical entry point for the theory orchestrator + cell builder. Phase 4's Lambda imports the same way.
  - _Leverage: `packages/db/src/generation/index.ts` (existing pattern)_
  - _Requirements: 4.10_

### Layer 3 — `pLimit` extraction

- [x] 13. Extract `pLimit` from `generate-exercises.ts` into `packages/db/scripts/p-limit.ts`
  - File: `packages/db/scripts/p-limit.ts` (new)
  - File: `packages/db/scripts/generate-exercises.ts` (modify)
  - In `p-limit.ts`: copy the `type LimitFn` and the `export function pLimit(concurrency: number): LimitFn` declaration verbatim from `generate-exercises.ts:108-135`. Export both. Add a short JSDoc block: `/** Tiny inline concurrency limiter shared by `generate-exercises.ts` and `generate-theory.ts`. Avoids a third-party dep. */`.
  - In `generate-exercises.ts`: delete the inline `pLimit` declaration (and any locally-defined `LimitFn` type). Add `import { pLimit, type LimitFn } from './p-limit';` to the import block at the top.
  - If `pLimit` was previously re-exported (the existing code at line 110 uses `export function pLimit`), add `export { pLimit, type LimitFn } from './p-limit';` so existing test imports (`import { pLimit } from './generate-exercises'`) keep resolving.
  - Run `pnpm typecheck` from the repo root and confirm zero new errors.
  - Run `pnpm test --filter @language-drill/db` and confirm the existing exercise CLI tests still pass (the refactor is byte-identical behaviorally).
  - Purpose: avoid two `pLimit` implementations diverging; Task 20's CLI imports from the new location.
  - _Leverage: existing inline declaration at `packages/db/scripts/generate-exercises.ts:108-135`_
  - _Requirements: 6.8 (helper extraction)_

### Layer 4 — CLI + helpers + fixtures

- [x] 14. Create `packages/db/scripts/generate-theory-parse-args.ts`
  - File: `packages/db/scripts/generate-theory-parse-args.ts` (new)
  - Imports: `LearningLanguage` from `@language-drill/shared`; `type CurriculumCefrLevel` from `../src/curriculum`; `collectRawFlags, requireString` from `./parse-args-common`.
  - Export type `ParsedTheoryArgs { lang: LearningLanguage; level: CurriculumCefrLevel | 'all'; grammarPoint: string | null; batchSeed: string; maxCostUsd: number; concurrency: number; dryRun: boolean; allowProd: boolean }`.
  - Constants: `const LEARNING_LANGUAGES: ReadonlySet<string> = new Set(['ES', 'DE', 'TR']);`, `const CURRICULUM_LEVELS: ReadonlySet<string> = new Set(['A1', 'A2', 'B1', 'B2']);`, `const DEFAULT_BATCH_SEED = 'theory-v1';`, `const DEFAULT_MAX_COST_USD = 1.0;`, `const DEFAULT_CONCURRENCY = 1;`, `const MIN_CONCURRENCY = 1;`, `const MAX_CONCURRENCY = 5;`.
  - HELP_TEXT constant: a multi-line template listing every flag (`--lang`, `--level`, `--grammar-point`, `--batch-seed`, `--max-cost-usd`, `--concurrency`, `--dry-run`, `--allow-prod`, `--help`), their ranges/defaults, env vars required (`ANTHROPIC_API_KEY`, `DATABASE_URL`; `MOCK_CLAUDE=1` honored), and one example invocation (`pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive`).
  - Export `parseTheoryGenerateArgs(argv: readonly string[]): ParsedTheoryArgs`:
    1. If `argv.includes('--help')`, print HELP_TEXT, `process.exit(0)`.
    2. `const raw = collectRawFlags(argv);`
    3. Parse `lang`: `const langRaw = requireString(raw, 'lang').toUpperCase()`. If `langRaw === 'EN'`, throw `'--lang en is not a learning language for theory generation (resolved decision #5). Use es | de | tr.'`. Validate against `LEARNING_LANGUAGES`; throw on miss. Cast to `LearningLanguage`.
    4. Parse `level`: `const levelRawValue = raw.get('level');`. If undefined, `level = 'all'`. Else `const levelRaw = levelRawValue.toUpperCase()`; if `levelRaw === 'ALL'`, level is `'all'`; else validate against `CURRICULUM_LEVELS`; throw on miss; cast to `CurriculumCefrLevel`.
    5. Parse `grammarPoint`: `raw.get('grammar-point') ?? null`.
    6. Parse `batchSeed`: `raw.get('batch-seed') ?? DEFAULT_BATCH_SEED`.
    7. Parse `maxCostUsd`: `const rawMax = raw.get('max-cost-usd')`. If undefined, `DEFAULT_MAX_COST_USD`. Else `parseFloat`; require finite AND `> 0`; throw with the bad value otherwise.
    8. Parse `concurrency`: similar; `parseInt(raw, 10)`; require in `[MIN_CONCURRENCY, MAX_CONCURRENCY]`.
    9. Parse `dryRun`: `raw.get('dry-run') === 'true'`.
    10. Parse `allowProd`: `raw.get('allow-prod') === 'true'`. If `allowProd && process.env['NODE_ENV'] !== 'production'`, `process.stderr.write('--allow-prod ignored: not running in production\n')`.
    11. Return `ParsedTheoryArgs`.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: pure-function parser unit-tested without subprocess spawn.
  - _Leverage: `packages/db/scripts/generate-exercises-parse-args.ts:104-184` (structural mirror; drop `--type`, `--count`, `--queue`, `--topic-domain` branches)_
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 15. Create `packages/db/scripts/generate-theory-parse-args.test.ts`
  - File: `packages/db/scripts/generate-theory-parse-args.test.ts` (new)
  - Imports: `describe, it, expect, vi, beforeEach, afterEach` from `vitest`; `parseTheoryGenerateArgs` from `./generate-theory-parse-args`.
  - Test cases:
    - Defaults: `parseTheoryGenerateArgs(['--lang', 'es'])` returns `{ lang: 'ES', level: 'all', grammarPoint: null, batchSeed: 'theory-v1', maxCostUsd: 1.0, concurrency: 1, dryRun: false, allowProd: false }`.
    - EN reject: `expect(() => parseTheoryGenerateArgs(['--lang', 'en'])).toThrow(/--lang en is not a learning language for theory generation.*resolved decision #5/)`.
    - Missing required `--lang`: `expect(() => parseTheoryGenerateArgs([])).toThrow(/lang/)`.
    - Invalid level: `parseTheoryGenerateArgs(['--lang', 'es', '--level', 'C1'])` throws.
    - Level lowercase normalized: `parseTheoryGenerateArgs(['--lang', 'es', '--level', 'b1'])` returns `level: 'B1'`.
    - Level 'all' allowed explicitly: `parseTheoryGenerateArgs(['--lang', 'es', '--level', 'all'])` returns `level: 'all'`.
    - Invalid concurrency: 0, 6, 'abc' all throw.
    - Invalid max-cost: 0, -1, 'abc' all throw.
    - Custom batch-seed: `parseTheoryGenerateArgs(['--lang', 'es', '--batch-seed', 'theory-v2'])` returns `batchSeed: 'theory-v2'`.
    - Grammar-point passthrough: `parseTheoryGenerateArgs(['--lang', 'es', '--grammar-point', 'es-b1-x'])` returns `grammarPoint: 'es-b1-x'`.
    - `--allow-prod` warning when not in production: spy on `process.stderr.write` via `vi.spyOn`. `beforeEach` ensures `process.env.NODE_ENV !== 'production'` (delete or set to `'test'`). Call `parseTheoryGenerateArgs(['--lang', 'es', '--allow-prod=true'])` (or however `collectRawFlags` encodes the flag — match the exercise CLI's expected format). Assert the warning was emitted exactly once and the returned `allowProd === true`. `afterEach` restores the spy.
  - Run `pnpm test --filter @language-drill/db -t generate-theory-parse-args` and confirm all tests pass.
  - Purpose: pin the argv contract.
  - _Leverage: existing test pattern in `packages/db/scripts/parse-args-common.test.ts` (the shared helper's tests) or the exercise parse-args test if present_
  - _Requirements: 6.2, 6.3, 8.7_

- [x] 16. Create `packages/db/scripts/generate-theory-resolve-cells.ts`
  - File: `packages/db/scripts/generate-theory-resolve-cells.ts` (new)
  - Imports: `type GrammarPoint` from `../src/curriculum`; `enumerateTheoryCells, type TheoryCell` from `../src/theory-generation/cells`; `type ParsedTheoryArgs` from `./generate-theory-parse-args`.
  - Re-export `type TheoryCell` so callers (`generate-theory.ts`) can import from this module.
  - Export `resolveTheoryCells(args: ParsedTheoryArgs, curriculum: readonly GrammarPoint[]): TheoryCell[]`:
    1. `const universe = enumerateTheoryCells(curriculum);`
    2. If `args.grammarPoint !== null`: find the curriculum `entry` with that key. Throw `\`--grammar-point '\${args.grammarPoint}' not in curriculum\`` if missing. Throw `\`--grammar-point '\${args.grammarPoint}' is for language \${entry.language}, not --lang \${args.lang}\`` if mismatch. If `args.level !== 'all'` and `entry.cefrLevel !== args.level`, throw `\`--grammar-point '\${args.grammarPoint}' is at CEFR \${entry.cefrLevel}, not --level \${args.level}\``. If `entry.kind === 'vocab'`, throw `\`--grammar-point '\${args.grammarPoint}' is a vocab umbrella (kind 'vocab'); theory generation supports only grammar points in round 1 (resolved decision #6)\``. Find the cell in `universe` whose `grammarPoint.key === args.grammarPoint`. (The cell will exist because `entry.kind === 'grammar'` passed the vocab check.) Return `[cell]`.
    3. Else: `const matched = universe.filter(c => c.language === args.lang && (args.level === 'all' || c.cefrLevel === args.level));`. If `matched.length === 0`, throw `\`no cells resolved for --lang \${args.lang} --level \${args.level}\`` (append `\` --grammar-point \${args.grammarPoint}\`` if present, though that branch is already handled in step 2). Return `matched`.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: pure cell resolver; testable without DB or Claude.
  - _Leverage: `packages/db/scripts/generate-exercises-resolve-cells.ts:46-112` (structural mirror; drop the per-`--type` cross-product)_
  - _Requirements: 6.4, 6.5, 6.6_

- [x] 17. Create `packages/db/scripts/generate-theory-resolve-cells.test.ts`
  - File: `packages/db/scripts/generate-theory-resolve-cells.test.ts` (new)
  - Imports: `describe, it, expect} from 'vitest'; `resolveTheoryCells` from `./generate-theory-resolve-cells`; `ALL_CURRICULA, esCurriculum` from `../src/curriculum`.
  - Setup: `const esGrammarEntry = esCurriculum.find(e => e.kind === 'grammar')!;` (test fails fast if no grammar entries exist). Store `esGrammarEntry.key`, `esGrammarEntry.cefrLevel`.
  - Helper: `const baseArgs = { batchSeed: 'theory-v1', maxCostUsd: 1.0, concurrency: 1, dryRun: false, allowProd: false };` (the fields NOT under test).
  - Test 1: `resolveTheoryCells({ ...baseArgs, lang: 'ES', level: 'all', grammarPoint: null }, ALL_CURRICULA)`. Assert every cell has `language === 'ES'` and `grammarPoint.kind === 'grammar'`. Assert length matches `ALL_CURRICULA.filter(e => e.language === 'ES' && e.kind === 'grammar').length`.
  - Test 2: `resolveTheoryCells({ ...baseArgs, lang: 'ES', level: 'B1', grammarPoint: null }, ALL_CURRICULA)`. Assert every cell has `cefrLevel === 'B1'`.
  - Test 3 (single grammar point happy path): `resolveTheoryCells({ ...baseArgs, lang: 'ES', level: esGrammarEntry.cefrLevel, grammarPoint: esGrammarEntry.key }, ALL_CURRICULA)`. Assert returned array has exactly one cell with `grammarPoint.key === esGrammarEntry.key`.
  - Test 4 (vocab umbrella reject): `const vocabEntry = ALL_CURRICULA.find(e => e.kind === 'vocab')`. Use `it.skipIf(!vocabEntry)` to skip when none exist. Otherwise assert `expect(() => resolveTheoryCells({ ...baseArgs, lang: vocabEntry.language as LearningLanguage, level: 'all', grammarPoint: vocabEntry.key }, ALL_CURRICULA)).toThrow(/is a vocab umbrella.*resolved decision #6/)`.
  - Test 5 (language mismatch): `expect(() => resolveTheoryCells({ ...baseArgs, lang: 'DE', level: 'all', grammarPoint: esGrammarEntry.key }, ALL_CURRICULA)).toThrow(/not --lang DE/)`.
  - Test 6 (level mismatch): pick `wrongLevel = esGrammarEntry.cefrLevel === 'B1' ? 'A1' : 'B1'`. Assert `expect(() => resolveTheoryCells({ ...baseArgs, lang: 'ES', level: wrongLevel, grammarPoint: esGrammarEntry.key }, ALL_CURRICULA)).toThrow(/not --level/)`.
  - Test 7 (grammar-point not in curriculum): `expect(() => resolveTheoryCells({ ...baseArgs, lang: 'ES', level: 'all', grammarPoint: 'es-b1-bogus-not-in-curriculum' }, ALL_CURRICULA)).toThrow(/not in curriculum/)`.
  - Test 8 (no resolved cells): pick a `(lang, level)` combo that has zero curriculum entries by inspecting `ALL_CURRICULA`. If none, use `lang: 'DE', level: 'A1'` and skip if DE A1 has grammar entries. Otherwise assert `expect(() => resolveTheoryCells(...)).toThrow(/no cells resolved/)`.
  - Run `pnpm test --filter @language-drill/db -t generate-theory-resolve-cells` and confirm all tests pass.
  - Purpose: lock the resolver's branches.
  - _Leverage: existing test pattern in `packages/db/scripts/generate-exercises-resolve-cells.test.ts` (if present)_
  - _Requirements: 6.4, 6.5, 6.6, 8.8_

- [x] 18. Create generator-side JSON fixtures
  - File: `packages/db/scripts/__fixtures__/claude-theory-generation/subjunctive.json` (new)
  - File: `packages/db/scripts/__fixtures__/claude-theory-generation/minimal.json` (new)
  - Copy the contents of Phase 1's `packages/db/scripts/__fixtures__/theory-json/subjunctive.json` into the new `claude-theory-generation/subjunctive.json` byte-for-byte (`cp` or read+write through Read+Write tools).
  - Copy Phase 1's `theory-json/minimal.json` into `claude-theory-generation/minimal.json` byte-for-byte.
  - Verify by adding a one-shot check in the mock client's test (Task 19's test, or as a side-effect of Task 21's integration test): on construction, `createTheoryMockClient` reads the fixtures; if either fails `parseTheoryTopicJson`, Tasks 11/21 fail loudly. No standalone validation script needed.
  - Purpose: the mock client (Task 19) cycles these for `MOCK_CLAUDE=1` runs. The path `claude-theory-generation` is discoverable for readers searching the codebase.
  - _Leverage: `packages/db/scripts/__fixtures__/theory-json/{subjunctive,minimal}.json` (Phase 1 source-of-truth — duplicate is intentional per design)_
  - _Requirements: 7.2_

- [x] 19. Create `packages/db/scripts/generate-theory-mock-client.ts`
  - File: `packages/db/scripts/generate-theory-mock-client.ts` (new)
  - Imports: `readFileSync, readdirSync` from `node:fs`; `join` from `node:path`; `fileURLToPath` from `node:url`; `type Anthropic` from `@anthropic-ai/sdk`; `THEORY_TOOL_NAME` from `@language-drill/ai`.
  - Internal `defaultFixturesDir(): string { return fileURLToPath(new URL('./__fixtures__/claude-theory-generation/', import.meta.url)); }`.
  - Internal `loadFixtures(dir: string): unknown[]`: `readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')))`. Throw if the result is empty (fail loudly so misconfigured fixture dirs surface).
  - Export `createTheoryMockClient(): Anthropic`:
    1. Resolve `const dir = process.env['MOCK_THEORY_FIXTURES_DIR'] ?? defaultFixturesDir();`.
    2. Closure state: `let fixtures: unknown[] | null = null; let callCount = 0;` (fixtures loaded lazily on first call so `MOCK_THEORY_FIXTURES_DIR` can be set after construction in tests).
    3. Closure function `messagesCreate(request: Anthropic.MessageCreateParams)`:
       - If `fixtures === null`, `fixtures = loadFixtures(dir);`.
       - Read `toolName = (request.tool_choice as { type: 'tool'; name: string } | undefined)?.name`.
       - If `toolName !== THEORY_TOOL_NAME`, throw `\`createTheoryMockClient: unexpected tool name \${toolName}\``.
       - `const fixture = fixtures[callCount % fixtures.length]; callCount += 1;`
       - Token modeling: `const isFirst = callCount === 1; const usage = isFirst ? { input_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2500 } : { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 2900, output_tokens: 2500 };`
       - Return `{ id: 'msg_mock', type: 'message' as const, role: 'assistant' as const, model: 'claude-sonnet-4-5', content: [{ type: 'tool_use' as const, id: 'toolu_mock', name: THEORY_TOOL_NAME, input: fixture as Record<string, unknown> }], stop_reason: 'tool_use', stop_sequence: null, usage }`.
    4. Return `{ messages: { create: messagesCreate } } as unknown as Anthropic`.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: lets the CLI integration test (Task 21) run without Claude credentials. The optional override env var supports the orchestrator test's malformed-fixture branch.
  - _Leverage: `packages/db/scripts/generate-exercises-mock-client.ts` (structural mirror; drop per-`ExerciseType` fixture map + validator branch)_
  - _Requirements: 7.1, 7.3, 7.4, 7.5_

- [x] 20a. Create `packages/db/scripts/generate-theory.ts` skeleton with summary helpers
  - File: `packages/db/scripts/generate-theory.ts` (new)
  - Imports: `type Anthropic` from `@anthropic-ai/sdk`; `ZERO_USAGE, addUsage, estimateCostUsd, type ClaudeUsageBreakdown` from `@language-drill/ai`; `type TheoryCellResult, type TheoryCell` from `@language-drill/db`; `type ParsedTheoryArgs` from `./generate-theory-parse-args`. (Defer the imports the main function needs — `randomUUID`, `fileURLToPath`, `createClaudeClient`, `createDb`, `ALL_CURRICULA`, `runOneTheoryCell`, `requireEnv`, `parseTheoryGenerateArgs`, `resolveTheoryCells`, `pLimit`, `createTheoryMockClient` — to Task 20b so this file compiles before `main` lands.)
  - Constants: `const DRY_RUN_INPUT_TOKENS_PER_CELL = 5000; const DRY_RUN_OUTPUT_TOKENS_PER_CELL = 3000; const ERROR_MESSAGE_HEAD_LENGTH = 80;`.
  - Export `printDryRunSummary(cells: readonly TheoryCell[], args: ParsedTheoryArgs): void`: build a per-cell `ClaudeUsageBreakdown = { inputTokens: 5000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 3000 }`; `const perCellCost = estimateCostUsd(perCellUsage);`. Print one line per cell: `[<lang> <level> <key>] ~5,000 input / ~3,000 output tokens — ~$<perCellCost>`. Print `Total estimated cost: ~$<perCellCost * cells.length> (cap: $<args.maxCostUsd>)`. Use `process.stdout.write` (not `console.log`) so tests can capture cleanly.
  - Export `formatDuration(ms: number): string`: identical implementation to `generate-exercises.ts:141-149` (`hours/minutes/seconds` split, returns e.g. `1h2m3s`, `4m5s`, or `6s`).
  - Export `formatTheoryCellLine(result: TheoryCellResult): string`: per-cell line per Req 6.11. Compute `const inputTotal = result.tokenUsage.inputTokens + result.tokenUsage.cacheCreationInputTokens + result.tokenUsage.cacheReadInputTokens; const cached = result.tokenUsage.cacheReadInputTokens; const output = result.tokenUsage.outputTokens; const total = result.insertedCount + result.skippedCount;`. Build: `\`[\${result.cell.language} \${result.cell.cefrLevel} \${result.cell.grammarPoint.key}] \${result.insertedCount}/\${total} inserted (\${result.skippedCount} skipped) — \${inputTotal.toLocaleString('en-US')} input (\${cached.toLocaleString('en-US')} cached) / \${output.toLocaleString('en-US')} output tokens — $\${result.costUsd.toFixed(4)} — \${formatDuration(result.durationMs)} — \${result.status}\``. Append `\` (\${result.errorMessage.slice(0, ERROR_MESSAGE_HEAD_LENGTH)})\`` when `result.errorMessage` is set.
  - Export `printTheorySummary(results: readonly TheoryCellResult[], totalCostUsd: number, totalDurationMs: number): void`: write each `formatTheoryCellLine` followed by `\n` via `process.stdout.write`. Then totals block: count cells where `status === 'succeeded' | 'failed' | 'skipped-cost-cap'`; print `\n═══ Total ═══\n`, `Cells: <N> (<X> succeeded, <Y> failed, <Z> skipped)\n`, `Topics inserted: <sum of insertedCount>\n`, `Total input tokens: <sum> (cached: <sum>)\n`, `Total output tokens: <sum>\n`, `Estimated cost: $<totalCostUsd.toFixed(4)>\n`, `Total runtime: <formatDuration(totalDurationMs)>\n`. Use `addUsage` (or a manual reduce) to fold every result's `tokenUsage`.
  - Add a JSDoc block at the top of the file naming Phase 2's scope (CLI driver mirroring the exercise CLI; no `--queue` branch; no validation-breakdown columns).
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the four helpers are pure functions Task 20b's `main` composes. Splitting them out keeps the time-box reasonable and lets `printTheorySummary` be unit-testable in isolation if needed.
  - _Leverage: `packages/db/scripts/generate-exercises.ts:141-256` (structural mirror; drop the per-type breakdown columns)_
  - _Requirements: 6.7, 6.11_

- [x] 20b. Add `main` + `runWithCostCap` + exit-code wiring to `generate-theory.ts`
  - File: `packages/db/scripts/generate-theory.ts` (modify — continue from Task 20a)
  - Add imports: `randomUUID` from `node:crypto`; `fileURLToPath` from `node:url`; `createClaudeClient` from `@language-drill/ai`; `createDb, ALL_CURRICULA, runOneTheoryCell, requireEnv` from `@language-drill/db`; `parseTheoryGenerateArgs` from `./generate-theory-parse-args`; `resolveTheoryCells` from `./generate-theory-resolve-cells`; `pLimit` from `./p-limit`; `createTheoryMockClient` from `./generate-theory-mock-client`.
  - Export `async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void>`:
    1. `const args = parseTheoryGenerateArgs(argv);`
    2. Prod guard: `if (process.env['NODE_ENV'] === 'production' && !args.allowProd) { console.error('Refusing to run in production. Pass --allow-prod or use the Phase 4 Lambda path.'); process.exit(1); }`.
    3. Bridge SIGINT: `const abortController = new AbortController(); process.on('SIGINT', () => abortController.abort()); const signal = abortController.signal;`
    4. `const cells = resolveTheoryCells(args, ALL_CURRICULA);`
    5. If `args.dryRun`: `printDryRunSummary(cells, args); return;`
    6. `const client: Anthropic = process.env['MOCK_CLAUDE'] === '1' ? createTheoryMockClient() : createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));`
    7. `const db = createDb(requireEnv('DATABASE_URL'));`
    8. `const limit = pLimit(args.concurrency); let totalCostUsd = 0; const startedAt = Date.now();`
    9. Define `runWithCostCap = async (cell: TheoryCell): Promise<TheoryCellResult> => { ... }`:
       - If `signal.aborted` return `{ cell, jobId: '', status: 'skipped-cost-cap', insertedCount: 0, skippedCount: 0, tokenUsage: ZERO_USAGE, costUsd: 0, errorMessage: 'Aborted by user (SIGINT)', durationMs: 0 }`.
       - If `totalCostUsd >= args.maxCostUsd` return the same shape without `errorMessage`.
       - Otherwise `const result = await runOneTheoryCell({ db, client, cell, args: { batchSeed: args.batchSeed, maxCostUsd: args.maxCostUsd }, jobId: randomUUID(), trigger: 'cli', signal }); totalCostUsd += result.costUsd; return result;`.
    10. `const results = await Promise.all(cells.map(cell => limit(() => runWithCostCap(cell))));`
    11. `printTheorySummary(results, totalCostUsd, Date.now() - startedAt);`
    12. Exit codes: `if (signal.aborted) { console.error('Aborted'); process.exit(1); }`. `if (results.some(r => r.status === 'failed') || totalCostUsd > args.maxCostUsd) { process.exitCode = 1; }`.
  - Direct-run guard at the bottom of the file: `const isDirectRun = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url); if (isDirectRun) { main().catch(err => { console.error('generate-theory failed:', err); process.exit(1); }); }`.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm zero errors.
  - Purpose: the user-facing CLI entry. Phase 4's Lambda replaces this with a SQS-message handler that calls the same `runOneTheoryCell`.
  - _Leverage: `packages/db/scripts/generate-exercises.ts:262-420` (structural mirror; drop the `--queue` branch via `mainQueue` — Phase 2 has no queue path)_
  - _Requirements: 6.1, 6.8, 6.9, 6.10, 6.12, 6.13_

- [x] 21. Create `packages/db/scripts/generate-theory.test.ts` (CLI integration test)
  - File: `packages/db/scripts/generate-theory.test.ts` (new)
  - Top-level `describe.skipIf(!process.env.TEST_DATABASE_URL)` wraps the DB-touching block.
  - Imports: `describe, it, expect, beforeEach, afterEach, vi` from `vitest`; `and, eq, like` from `drizzle-orm`; `createDb, theoryTopics, theoryGenerationJobs, ALL_CURRICULA` from `@language-drill/db`; `main` from `./generate-theory`.
  - Setup: `const db = createDb(process.env.TEST_DATABASE_URL!);`. Pick a real ES `kind: 'grammar'` entry from `ALL_CURRICULA` (`const testEntry = ALL_CURRICULA.find(e => e.language === 'ES' && e.kind === 'grammar')!`). Capture its `key` and `cefrLevel`.
  - `beforeEach`: set `process.env['MOCK_CLAUDE'] = '1'`. Save and `delete process.env['NODE_ENV']` (or set to `'test'`). Spy on `process.stdout.write` and `process.stderr.write` to capture output. Set `process.exitCode = undefined`.
  - `afterEach`: restore env vars, restore spies. Clean up rows: `await db.delete(theoryTopics).where(eq(theoryTopics.grammarPointKey, testEntry.key)); await db.delete(theoryGenerationJobs).where(like(theoryGenerationJobs.cellKey, '%' + testEntry.key));`
  - Test 1 (happy path): `await main(['--lang', 'es', '--level', testEntry.cefrLevel, '--grammar-point', testEntry.key])`. Assert captured stdout includes the cell key and `inserted` AND `Total runtime:`. Assert `process.exitCode` is undefined or 0. Query `theory_topics` and assert one row with `review_status === 'auto-approved'`, `model_id === 'claude-sonnet-4-5'`, `generation_source === 'claude-realtime'`. Query `theory_generation_jobs` and assert one row with `status === 'succeeded'`, `approved === true`, `flagged === false`, `rejected === false`, `input_tokens_used > 0`, `cost_usd_estimate > 0`.
  - Test 2 (skip path): run Test 1's `main` invocation; then run a second time with the same args. Assert second run's stdout shows `0/1 inserted (1 skipped)` (or similar) and contains `cell already filled` somewhere. Query `theory_generation_jobs` for the cell and assert TWO rows; the second has `approved === false`, `error_message` containing `'cell already filled'`.
  - Test 3 (dry run): `await main(['--lang', 'es', '--level', testEntry.cefrLevel, '--grammar-point', testEntry.key, '--dry-run=true'])`. Assert stdout contains `~5,000 input` AND `Total estimated cost`. Query `theory_topics` for the cell and assert zero rows inserted.
  - Run `pnpm test --filter @language-drill/db -t generate-theory.test` and confirm all tests pass (or skip if `TEST_DATABASE_URL` is unset).
  - Purpose: end-to-end proof that the CLI's argv → `runOneTheoryCell` → DB pipeline works against a real Postgres.
  - _Leverage: `packages/db/scripts/generate-exercises.test.ts` (structural mirror)_
  - _Requirements: 6.1, 6.7, 6.8, 6.11, 6.12, 8.9_

- [x] 22. Wire up `package.json` scripts
  - File: `packages/db/package.json` (modify)
  - File: `package.json` (modify — repo root)
  - In `packages/db/package.json`: under `scripts`, add `"generate:theory": "npx tsx scripts/generate-theory.ts"` immediately after the existing `"generate:exercises"` line (matches the feature ordering).
  - In root `package.json`: under `scripts`, add `"generate:theory": "dotenv -e .env -- pnpm --filter @language-drill/db generate:theory"` immediately after the existing `"generate:exercises"` line.
  - Verify `pnpm generate:theory --help` runs successfully from the repo root, prints the help text, and exits 0.
  - Purpose: complete the operator-facing surface.
  - _Leverage: existing `generate:exercises` script wiring in `package.json` and `packages/db/package.json`_
  - _Requirements: 6.14_

### Layer 5 — Verification

- [x] 23. Pre-push checks — `pnpm lint && pnpm typecheck && pnpm test` from repo root
  - No new files — this is the project-wide pre-push gate per `CLAUDE.md` §Pre-Push Checks.
  - Run the three commands sequentially from the repo root. Confirm all three exit zero.
  - If `pnpm lint` flags formatting on any file from this phase, fix in place and re-run.
  - If `pnpm typecheck` surfaces a cross-package issue (e.g. a deep import slipped past the package barrel), revisit the relevant earlier task.
  - If `pnpm test` shows any failures, fix in the relevant test file and re-run.
  - The TEST_DATABASE_URL-gated tests (Tasks 11, 21) may skip if `TEST_DATABASE_URL` is unset locally; the CI pipeline runs with it set per `.github/workflows/`.
  - Purpose: the one mandatory pre-merge gate. Phase 2 ships only when this is green.
  - _Leverage: existing CI gate at `.github/workflows/deploy.yml`_
  - _Requirements: 8.10, 8.11, 8.12, NFR Reliability, NFR Maintainability_
