# Implementation Plan

## Task Overview
Build `pnpm eval:gen` — a generation-quality eval harness in `packages/ai/scripts/`, mirroring `eval-run.ts`. Work proceeds bottom-up: first the two enabling seams (a `@language-drill/db` barrel re-export and the `systemPromptOverride` field on `GenerationSpec`), then the harness modules (resolver → loader → arm executor → orchestrator → diff → render → CLI), each followed by its unit tests, then the export script, package wiring, and documentation. Tests use the `eval-run.test.ts` injectable-port pattern — no live Anthropic/Langfuse/DB.

## Steering Document Compliance
- Files live in `packages/ai/scripts/` next to `eval-run.ts` (structure.md: scripts belong in their package's `scripts/`). The harness composes existing exports; the only new public surface is one db barrel re-export.
- Pre-push gate per CLAUDE.md: `pnpm lint && pnpm typecheck && pnpm test` must pass; tests are added to the module's own test file, not orphaned files.

## Atomic Task Requirements
Each task touches 1–3 files, is completable in 15–30 min, has a single testable outcome, names exact files, and references requirements + code to leverage.

## Tasks

- [x] 1. Re-export `routeValidationResult` from the `@language-drill/db` barrel
  - Files: `packages/db/src/generation/index.ts`, `packages/db/src/index.ts`
  - Add `export { routeValidationResult, type ReviewStatus, type RoutingDecision } from './routing'` to the generation barrel, surfaced through the package barrel (currently `routing.ts` is deliberately internal).
  - Purpose: make routing importable from `packages/ai/scripts/` without a deep cross-package path.
  - _Leverage: packages/db/src/generation/routing.ts, packages/db/src/index.ts_
  - _Requirements: 4.2 (Architecture/Dependencies NFR)_

- [x] 2. Add `systemPromptOverride` field to `GenerationSpec`
  - File: `packages/ai/src/generate.ts` (type at ~line 233)
  - Add optional `systemPromptOverride?: string` with a JSDoc note that it bypasses the Langfuse fetch (eval-harness use).
  - Purpose: type-level seam for prompt injection.
  - _Leverage: packages/ai/src/generate.ts (GenerationSpec)_
  - _Requirements: 2.1, 2.2_

- [x] 3. Honor `systemPromptOverride` in `generateOneDraft`
  - File: `packages/ai/src/generate.ts` (`generateOneDraft`, ~line 606)
  - Change the system-text line to `const systemText = spec.systemPromptOverride ?? await buildGenerationSystemPrompt(promptInputs, []);` — keep the `cache_control: { type: 'ephemeral' }` block unchanged.
  - Purpose: use the override verbatim when present; no-override path byte-identical.
  - _Leverage: packages/ai/src/generate.ts (generateOneDraft)_
  - _Requirements: 2.1, 2.2_

- [x] 4. Add seam regression test for `systemPromptOverride`
  - File: `packages/ai/src/generate.test.ts`
  - Add a case mocking `client.messages.create` that asserts: (a) with `systemPromptOverride` set, the request's `system[0].text` equals the override verbatim and `buildGenerationSystemPrompt` is NOT called (spy/mock); (b) without it, behavior is unchanged.
  - Purpose: lock the seam contract and non-breakage.
  - _Leverage: packages/ai/src/generate.test.ts (existing generateOneDraft/generateBatch tests)_
  - _Requirements: 2.1, 2.2_

- [x] 5. Create harness data-model types
  - File: `packages/ai/scripts/eval-gen-run.ts` (new)
  - Define `CellDescriptor`, `DraftBucket`, `DraftOutcome`, `ArmResult`, `ArmStats`, `GenEvalSummary`, and the runner's args type (per design Data Models). No logic yet.
  - Purpose: establish the typed contracts every later task builds on.
  - _Leverage: packages/ai/scripts/eval-run.ts (type-organization style), @language-drill/shared (Language, CefrLevel, ExerciseType, GrammarPoint)_
  - _Requirements: 4.1, 5.1–5.4_

- [x] 6. Implement `resolveGenerationPromptSource` + `renderSystemPrompt`
  - File: `packages/ai/scripts/eval-gen-run.ts`
  - `resolveGenerationPromptSource(source, langfuse)` handles `file:`, `langfuse:<name>@<label>` (label default `candidate`), and literal `repo` (→ `GENERATION_SYSTEM_PROMPT_TEMPLATE`); throws on bad prefix/empty name; returns `{ templateBody, source, sha }`. `renderSystemPrompt(templateBody, inputs)` calls `applyTemplate(body, computeGenerationPromptVars(inputs, []))` and throws on `missingVars`.
  - Purpose: turn argv into a per-cell system prompt body.
  - _Leverage: packages/ai/scripts/eval-run.ts (resolveCandidate, LangfusePromptFetcher), packages/ai/src/generation-prompts.ts (GENERATION_SYSTEM_PROMPT_TEMPLATE via barrel; computeGenerationPromptVars via ../src/generation-prompts.js), packages/ai/src/prompts-registry.ts (applyTemplate, sha8)_
  - _Requirements: 1.1–1.5, 2.3, 2.4_

- [x] 7. Implement `loadCellDataset` + `resolveCell`
  - File: `packages/ai/scripts/eval-gen-run.ts`
  - `loadCellDataset(raw)` parses/validates an array of `CellDescriptor`. `resolveCell(descriptor)` returns `{ cell, grammarPoint }` or `{ cellKey, error }` for: malformed shape, unknown `grammarPointKey` (`getGrammarPoint` → undefined), or `language === EN`.
  - Purpose: dataset ingestion with per-cell error isolation (no crash).
  - _Leverage: @language-drill/db (getGrammarPoint, buildCellKey), @language-drill/shared (Language)_
  - _Requirements: 3.1, 3.2, 4.6_

- [x] 8. Implement the arm-executor port + `makeRealArmExecutor`
  - File: `packages/ai/scripts/eval-gen-run.ts`
  - Define `GenCellArmExecutor` port type. `makeRealArmExecutor(client)` builds a `GenerationSpec` (`count = draftsPerCell`, `systemPromptOverride`, `topicDomain: null`, `batchSeed`), calls `generateBatch`, then `validateDraft` per draft → classify on `result` via `routeValidationResult` into buckets; malformed drafts → `parser-failure` bucket; fold every `tokenUsage` and `GenerateBatchResult.tokenUsage` via `addUsage`.
  - Purpose: the real per-arm Claude execution, isolated behind a port for tests.
  - _Leverage: packages/ai/src/generate.ts (generateBatch, GenerationSpec), packages/ai/src/validate.ts (validateDraft), @language-drill/db (routeValidationResult), packages/ai/src/cost-model.ts (addUsage, ZERO_USAGE)_
  - _Requirements: 4.1–4.4_

- [x] 9. Implement `runGenEval` orchestrator
  - File: `packages/ai/scripts/eval-gen-run.ts`
  - Loop resolved cells (respect `--limit`); per cell run baseline then candidate arm via the injected executor; accumulate per-cell `ArmResult`s; wrap each cell in try/catch → record `{ cellKey, error }` and continue; after both arms, check `--max-cost-usd` against accumulated `estimateCostUsd` and stop (set `costCapped`) at the cell boundary.
  - Purpose: deterministic, fault-isolated, cost-bounded orchestration.
  - _Leverage: packages/ai/scripts/eval-run.ts (runEvalRun structure), packages/ai/src/cost-model.ts (estimateCostUsd, addUsage)_
  - _Requirements: 4.5, 4.6, 6.2_

- [x] 10. Implement `computeGenDiff` (pure)
  - File: `packages/ai/scripts/eval-gen-run.ts`
  - Roll accumulated per-cell arm results into `GenEvalSummary`: per-arm `ArmStats` (bucket totals, `approvalRate = autoApproved/total`, `rejectionReasonCounts`, `flagTagCounts` incl. `parser-failure` key, `costUsd`), `approvalRateDelta`, `reasonDeltas`/`flagDeltas` (`{baseline, candidate}` per key), `costUsd {baseline, candidate}`, `errors`, `perCell`.
  - Purpose: decision-grade, byte-assertable summary; no I/O.
  - _Leverage: packages/ai/scripts/eval-run.ts (computeDiff shape), packages/ai/src/cost-model.ts (estimateCostUsd)_
  - _Requirements: 5.1–5.4_

- [x] 11. Implement `renderMarkdownSummary` + JSON write wiring
  - File: `packages/ai/scripts/eval-gen-run.ts`
  - `renderMarkdownSummary(summary)` prints header (run name, both sources+sha, dataset, started, cell/draft counts, `costCapped`), an approval-rate table (baseline | candidate | Δ), reason/flag delta rows, a cost row, and an errors section — excluding `perCell`. Wire `writeSummaryJson(summary, EVAL_RUNS_DIR)` (imported from `./eval-run.js`).
  - Purpose: human stdout + machine JSON output.
  - _Leverage: packages/ai/scripts/eval-run.ts (renderMarkdownSummary, writeSummaryJson, EVAL_RUNS_DIR)_
  - _Requirements: 5.5, 5.6_

- [x] 12. Implement CLI argv parser + `main()` + guards
  - File: `packages/ai/scripts/eval-gen-run.ts`
  - `parseEvalGenArgs` for `--baseline --candidate --dataset-file --drafts-per-cell(=5,1..200) --limit --run-name --allow-prod --max-cost-usd --help`; throw a usage error when `--dataset-file` is absent (Req 3.4). `main()`: `assertNotProdWithoutAllow`, `ANTHROPIC_API_KEY` check, resolve both sources, load dataset, `runGenEval` with `makeRealArmExecutor`, `computeGenDiff`, print markdown, `writeSummaryJson`, exit 1 if `errors.length>0 || costCapped`. Guard `main` behind the exact `isMain` pattern from eval-run.ts: `fileURLToPath(import.meta.url) === process.argv[1]` (NOT a raw `import.meta.url` compare — a `file://` URL never equals a path).
  - Purpose: runnable CLI entrypoint.
  - _Leverage: packages/ai/scripts/eval-run.ts (parseEvalRunArgs, assertNotProdWithoutAllow, deriveRunName, isMain/main pattern at line 1009), packages/ai/src/index.ts (createClaudeClient, getLangfuse)_
  - _Requirements: 6.1, 6.3, 6.5, 3.4_

- [x] 13. Add smoke cell-dataset fixture
  - File: `packages/ai/scripts/fixtures/cells-smoke.json`
  - A small (3–5) hand-curated array of valid `CellDescriptor`s drawn from real curriculum keys (verify each with `getGrammarPoint`), covering TR + ES and cloze + vocab_recall.
  - Purpose: unblock manual smoke runs and dataset-loader tests without the export.
  - _Leverage: packages/db/src/curriculum/{tr,es}.ts (real grammarPointKeys)_
  - _Requirements: 3.4_

- [x] 14. Test the resolver + render
  - File: `packages/ai/scripts/eval-gen-run.test.ts` (new)
  - Cases: `file:`/`langfuse:`/`repo` resolution; default label; unsupported prefix and empty name throw; `renderSystemPrompt` throws when a `{{var}}` is missing and succeeds on the real template.
  - Purpose: lock source resolution + render contracts.
  - _Leverage: packages/ai/scripts/eval-run.test.ts (resolveCandidate test patterns)_
  - _Requirements: 1.1–1.5, 2.3, 2.4_

- [x] 15. Test the cell loader
  - File: `packages/ai/scripts/eval-gen-run.test.ts`
  - Cases: valid descriptors resolve; malformed shape, unknown key, and EN each produce a per-cell error without throwing.
  - Purpose: verify dataset ingestion + error isolation.
  - _Leverage: packages/ai/scripts/eval-gen-run.test.ts (fixtures), packages/db (getGrammarPoint)_
  - _Requirements: 3.1, 3.2, 4.6_

- [x] 16. Test the orchestrator with a stub executor
  - File: `packages/ai/scripts/eval-gen-run.test.ts`
  - Inject a stub `GenCellArmExecutor`: assert both arms run per cell; a cell whose executor throws is recorded in `errors` while others complete; `--max-cost-usd` stops at a cell boundary leaving a coherent partial summary (no half-compared cell); `--limit` caps cells. Also assert `parseEvalGenArgs` throws a usage error when `--dataset-file` is omitted (Req 3.4).
  - Purpose: verify fault isolation + cost-cap boundary semantics + the no-dataset guard.
  - _Leverage: packages/ai/scripts/eval-run.test.ts (runEvalRun orchestration cases (a)/(c)/(limit), parseEvalRunArgs missing-arg cases)_
  - _Requirements: 4.5, 4.6, 6.2, 3.4_

- [x] 17. Test draft classification with mocked generate+validate
  - File: `packages/ai/scripts/eval-gen-run.test.ts`
  - `vi.mock('@language-drill/ai')` for `generateBatch`/`validateDraft` (spread `...actual` so `routeValidationResult` path and helpers stay real): assert drafts route to `auto-approved`/`flagged`/`rejected` via real `routeValidationResult`; malformed drafts → `parser-failure`; token usage (incl. malformed) folded into the arm cost.
  - Purpose: verify the real arm executor's classification + cost folding.
  - _Leverage: packages/db/src/generation/validate-and-insert.test.ts (vi.mock @language-drill/ai pattern), packages/db/src/generation/routing.ts (routeValidationResult)_
  - _Requirements: 4.1–4.4_

- [x] 18. Test `computeGenDiff` + `renderMarkdownSummary`
  - File: `packages/ai/scripts/eval-gen-run.test.ts`
  - Pure-function cases: `approvalRateDelta`, reason/flag deltas, and per-arm cost computed exactly from a fixture run result; markdown contains the documented headers/rows, errors section, and costCapped note.
  - Purpose: lock the decision-grade output.
  - _Leverage: packages/ai/scripts/eval-run.test.ts (computeDiff + renderMarkdownSummary cases)_
  - _Requirements: 5.1–5.6_

- [x] 19. Implement the cell-dataset export script
  - File: `packages/ai/scripts/eval-gen-export.ts` (new)
  - `parseArgs` for `--sample --out [--language --cefr --allow-prod]`; query `generationJobs` grouped by `cellKey`, derive an approval rate (confirm columns against the `generationJobs` Drizzle schema), sort ascending (failure-prone first), take `--sample`, map cellKeys → `CellDescriptor`s, write JSON. Guard behind `isMain`.
  - Purpose: produce real failure-prone datasets (runner already works via the fixture).
  - _Leverage: packages/ai/scripts/eval-export.ts (createDb + parseArgs + write pattern), packages/db (generationJobs, createDb)_
  - _Requirements: 3.3_

- [x] 20. Wire `pnpm` scripts
  - Files: `packages/ai/package.json`, root `package.json`
  - In `packages/ai/package.json` add `"eval:gen": "tsx scripts/eval-gen-run.ts"` and `"eval:gen:export": "tsx scripts/eval-gen-export.ts"` beside `eval` / `eval:export`. In the root `package.json` (which has eval passthroughs at lines 24–25) add matching passthroughs that mirror the existing `dotenv -e .env -- pnpm --filter @language-drill/ai eval …` wrapper — NOT a bare `tsx` invocation.
  - Purpose: expose the harness as documented commands with the same env-loading as `eval`.
  - _Leverage: packages/ai/package.json (existing eval/eval:export scripts), package.json (root eval passthroughs, lines 24–25)_
  - _Requirements: 6.4_

- [x] 21. Correct the `generation-quality-improvements` spec references
  - Files: `.claude/specs/generation-quality-improvements/design.md`, `requirements.md`, `tasks.md`
  - Replace each "`pnpm eval`" generation-gate reference with `pnpm eval:gen`, noting it is the real generation gate (not the answer-evaluation harness).
  - Purpose: close the documentation bug that named a non-existent gate.
  - _Leverage: docs/tech-debt.md (entry describing the mis-reference)_
  - _Requirements: 7.1_

- [x] 22. Document the harness in CLAUDE.md and resolve the tech-debt entry
  - Files: `CLAUDE.md`, `docs/tech-debt.md`
  - Add `pnpm eval:gen` / `pnpm eval:gen:export` rows to the CLAUDE.md command table; mark the "No generation-quality eval harness" tech-debt entry resolved with a Resolution section referencing the new script + commit.
  - Purpose: discoverability + close the tech-debt loop.
  - _Leverage: CLAUDE.md (command table), docs/tech-debt.md (the entry)_
  - _Requirements: 7.2, 7.3_

- [x] 23. Full pre-push verification
  - Files: none (run only)
  - Run `pnpm --filter @language-drill/ai test`, then repo-root `pnpm lint && pnpm typecheck && pnpm test`; confirm the new suite passes and the existing `eval-run`/`generate` suites are unchanged-green. Fix any fallout.
  - Purpose: satisfy the CLAUDE.md pre-push gate before PR.
  - _Leverage: CLAUDE.md (Pre-Push Checks)_
  - _Requirements: all_
