# Requirements Document

## Introduction

This spec implements **Phase 2 — Generator core + CLI** from `docs/exercise-generation-plan.md`. Phase 1 shipped the data foundation: a typed grammar curriculum (`packages/db/src/curriculum/`), eight new metadata columns on `exercises`, the `generation_jobs` audit table, the partial pool-lookup index, and a curriculum-driven seed of `skill_topics` + `exercise_tags`. The pool today still has only the 36 hand-authored seeds — no AI-generated exercises exist.

Phase 2 turns the data foundation into a working generator. After this phase, a developer can run a single command from their laptop:

```
pnpm generate:exercises --lang es --level B1 --type cloze \
  --grammar-point es-b1-present-subjunctive --count 50
```

…and the pool gains 50 deterministic, idempotent, Claude-generated cloze exercises tagged to that grammar point. The generator core is shaped so Phase 4 (Lambda + SQS + EventBridge) can wrap it without changes to the core.

Per resolved decision #1 in the plan, the generator uses the same `claude-sonnet-4-5` model the evaluator uses today (`packages/ai/src/evaluate.ts:207`) so calibration stays consistent. CLAUDE.md still names `claude-sonnet-4-6` as the project-wide LLM choice; the divergence is intentional for round 1 — when the evaluator is bumped to `4-6`, the generator's `GENERATION_MODEL` constant moves with it in the same PR. Per resolved decision #2, only EN→target translation is supported in round 1 (L2→EN is deferred). Per resolved decision #3, the generator does not vary prompts by topic domain; the `topic_domain` column is provisioned in Phase 1 and the CLI surfaces a `--topic-domain` flag whose value is **recorded** on inserted rows for forward-compatibility with Phase 5/6 filtering, but the prompts themselves are domain-agnostic. Per resolved decision #4, EN is dropped from the generator's input — `--lang en` is rejected at the CLI boundary.

### Files added or modified by this phase

```
packages/ai/src/generate.ts                    (new)  — generator core, types, deterministic ID, tools
packages/ai/src/generation-prompts.ts          (new)  — system prompt template + CEFR descriptors
packages/ai/src/cost-model.ts                  (new)  — Sonnet 4.5 list-price constants
packages/ai/src/index.ts                       (mod)  — re-export new symbols
packages/ai/src/prompts.ts                     (mod)  — extract CEFR descriptors into a shared constant
packages/ai/src/generate.test.ts               (new)
packages/ai/src/generation-prompts.test.ts     (new)
packages/db/src/index.ts                       (mod)  — re-export `deterministicUuid`
packages/db/scripts/generate-exercises.ts      (new)  — CLI driver
packages/db/scripts/generate-exercises.test.ts (new)
packages/db/scripts/__fixtures__/claude-generation/{cloze,translation,vocab_recall}.json (new)
packages/db/package.json                       (mod)  — add `generate:exercises` script
package.json                                   (mod)  — add `generate:exercises` root alias
```

### Out of scope (this phase)

The following are explicitly deferred to later phases of the exercise-generation plan and SHALL NOT be implemented here:

- **Validation pass** — the second Claude call in `packages/ai/src/validate.ts`, the routing rules that set `review_status` to `'flagged'` / `'rejected'`, and the validator's `quality_score` writes are Phase 3. Phase 2 inserts every successful draft as `review_status = 'auto-approved'` so reviewers can see end-to-end behavior; Phase 3 tightens this gate.
- **Across-batch surface dedup** — the `_dedupKey` JSON field, the `exercises_dedup_idx` UNIQUE partial index, and the retry-up-to-3× per slot logic are Phase 3. Phase 2 ships *within-batch* dedup only (the `recentStems` list grown during a single run).
- **Lambda + SQS + EventBridge** — Phase 4. Phase 2's CLI is the only trigger.
- **Anthropic Messages Batches API** — Phase 4.2 introduces the batch path. Phase 2 uses the standard `client.messages.create` endpoint exclusively.
- **Pool-depth API and admin dashboard** — Phase 5.
- **New exercise types** (sentence construction, error correction, etc.) — Phase 6. Phase 2 supports only `cloze`, `translation`, and `vocab_recall` — the three already shipped.
- **Domain-aware generation** — `topic_domain` is provisioned in the schema and exposed as an optional CLI flag, but the generator does not vary prompts by domain in this phase. The flag is recorded on inserted rows for future filtering.
- **L2→EN translation** — only EN→target is supported (resolved decision #2). The generator's translation path hard-codes `sourceLanguage: 'EN'` and `targetLanguage: spec.language`.
- **Vocab generation against frequency lists** — vocab-recall generation in Phase 2 uses the existing `kind: 'vocab'` umbrella entries from the curriculum (one per (language, level)), producing exercises whose target words are themed by the umbrella's description. Frequency-band-driven generation with explicit word lists ships in Phase 6 alongside the personal word bank.
- **EN curriculum module** — `packages/db/src/curriculum/en.ts` is intentionally absent (Phase 1 resolved decision #4); the CLI rejects `--lang en`.

## Alignment with Product Vision

The product is positioned (`product.md` §2) as **"what you do between italki sessions"** — a practice app for intermediate learners stuck at the plateau. That positioning depends on a *constantly available pool* of CEFR-calibrated exercises targeting specific grammar points. Phase 1 made the pool addressable; Phase 2 is what fills it.

This phase delivers on three load-bearing pieces of the product vision and tech strategy:

- **Pre-generated content reuse** (`tech.md` §7, `docs/exercise-strategy.md` §"Pre-generated pool — default for all exercise types"). Round-1 target is ~50 exercises per `(language, CEFR level, exercise type, grammar point)` cell; the cost backbone of the app is that generation happens *once*, not per user. This phase ships the producer that creates that reusable content.
- **Honest skill-based progress** (`product.md` §2.2). Generated exercises are tagged to a single grammar point at a specific CEFR level, so mastery updates from `EvaluationResult` flow into the same Bayesian model the seed exercises already participate in (`docs/progress-tracking.md` §"Layer 3"). No new progress plumbing — the generator slots into an existing pipeline.
- **Cost-controlled generation** (`tech.md` §7, plan §1.5). Every CLI run records a `generation_jobs` row with token counts and a USD estimate; an explicit `--max-cost-usd` cap aborts runs that would exceed it. Prompt caching (`cache_control: ephemeral`) on the system prompt + curriculum-row context makes 50-draft batches affordable; the strategy doc's ~80% cache-hit savings are realized.

## Requirements

### Requirement 1 — Generator core API in `packages/ai`

**User Story:** As a future caller (CLI in this phase, Lambda in Phase 4), I want a single typed function `generateBatch(client, spec)` that produces N validated drafts for one cell, so that triggers don't need to know about prompt construction, tool schemas, or model selection.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/ai/src/generate.ts` SHALL export a function with the signature `generateBatch(client: Anthropic, spec: GenerationSpec): Promise<GenerateBatchResult>` and SHALL re-export it through `packages/ai/src/index.ts` alongside the existing evaluator exports.
2. WHEN `generateBatch` is called with a `GenerationSpec` THEN it SHALL produce exactly `spec.count` `ExerciseDraft` items in the result on success, in deterministic order (ordinal 0 first, ordinal `count - 1` last).
3. WHEN `generateBatch` returns THEN every `ExerciseDraft.contentJson` SHALL be a valid value of the `ExerciseContent` discriminated union from `@language-drill/shared` for the requested `spec.exerciseType` — i.e. parses without throwing through the type guard `is{Cloze,Translation,VocabRecall}Content`.
4. WHEN `generateBatch` returns THEN every `ExerciseDraft.id` SHALL be a deterministic UUID derived from `(spec.language, spec.cefrLevel, spec.exerciseType, spec.grammarPoint.key, spec.batchSeed, ordinal)` — re-running with the same `spec` SHALL produce the same `id` for each ordinal.
5. WHEN `generateBatch` returns THEN every `ExerciseDraft.metadata` SHALL include `grammarPointKey: spec.grammarPoint.key`, `modelId` matching the model constant the function called Claude with, `inputTokens` ≥ 0, `outputTokens` ≥ 0, and `topicDomain` mirroring `spec.topicDomain` (or `null` when unset).
6. WHEN any of Claude's draft responses is malformed (no tool-use block, wrong tool name, schema-invalid input) THEN `generateBatch` SHALL throw an error whose message identifies the offending ordinal and the reason; partial results SHALL NOT be returned silently.
7. WHEN `generateBatch` is called with `spec.exerciseType` that is not one of `cloze | translation | vocab_recall` THEN it SHALL throw at the call boundary before any Claude request is sent. The error SHALL name the unsupported type. (This is the seam Phase 6 widens.)
8. WHEN `generateBatch` is called with `spec.language === 'EN'` (i.e. caller bypassed the CLI guard) THEN it SHALL throw before any Claude request is sent — EN is not a learning language for generation per resolved decision #4.
9. WHEN `generateBatch` is called with `spec.exerciseType === 'translation'` THEN the resulting `TranslationContent.sourceLanguage` SHALL be `'EN'` and `TranslationContent.targetLanguage` SHALL equal `spec.language` (resolved decision #2).
10. WHEN `generateBatch` returns THEN the returned `tokenUsage` aggregate SHALL equal the sum of `metadata.inputTokens` and `metadata.outputTokens` across all drafts plus any non-final-call usage observed during retries — accurate to the token count reported by the SDK.

### Requirement 2 — Per-type generation tool schemas and prompts

**User Story:** As the generator, I want one tool schema and one prompt builder per supported exercise type, mirroring the structure of `evaluate.ts` + `prompts.ts`, so that adding a new type in Phase 6 is a localized change to a small number of files.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/ai/src/generation-prompts.ts` SHALL export a `GENERATION_SYSTEM_PROMPT_TEMPLATE` string and a `buildGenerationSystemPrompt(spec, recentStems)` function that interpolates the template with the spec's grammar point, language, level, and the in-batch `recentStems` array. The function SHALL produce a string identical for two calls with the same `(spec, recentStems)` inputs (pure).
2. WHEN the system prompt is built for a non-empty `spec.grammarPoint` THEN the prompt SHALL include the curriculum entry's `name`, `description`, the full `examplesPositive` array, the full `commonErrors` array, and the full set of CEFR level descriptors. The descriptors SHALL live in a single shared constant `CEFR_LEVEL_DESCRIPTORS` exported from `packages/ai/src/prompts.ts`. As part of this phase, the corresponding paragraph in `EVALUATION_SYSTEM_PROMPT` SHALL be refactored to interpolate the same constant — there SHALL be exactly one source of truth for the descriptors, consumed by both the evaluator system prompt and the generator system prompt (this is the "DRY same descriptors" intent of plan §2.2 line 257).
3. WHEN the system prompt is built THEN it SHALL include explicit hard constraints: "the correct answer must be uniquely correct in the given context", "vocabulary outside CEFR \<level\> is forbidden unless the exercise explicitly tests it", and "do not produce an exercise that resembles any of these existing stems: \<recentStems\>". `recentStems` SHALL be rendered as a bullet list when non-empty, and as the literal string "(none yet)" when empty.
4. WHEN the codebase is built THEN `packages/ai/src/generate.ts` SHALL export one tool schema per supported `ExerciseType`: `CLOZE_GENERATION_TOOL`, `TRANSLATION_GENERATION_TOOL`, `VOCAB_RECALL_GENERATION_TOOL`. Each tool's `input_schema` SHALL match the corresponding `ExerciseContent` shape from `@language-drill/shared` field-for-field (required fields, types, enums where applicable). Tool name SHALL be `submit_<type>_exercise` (e.g. `submit_cloze_exercise`).
5. WHEN the generator dispatches a draft request for type T THEN it SHALL set `tool_choice: { type: 'tool', name: '<the matching tool name>' }`, supply only that one tool, and use temperature `0.7` (vs. the evaluator's `0`) — generation needs surface diversity, evaluation does not.
6. WHEN the generator parses a Claude response for a draft THEN it SHALL call `parseGeneratedDraft<T>(toolUseBlock, spec)` (one parser per type, exported alongside the tools) which validates the tool input against the corresponding `ExerciseContent` shape and either returns a typed `ExerciseContent` or throws with a field-level error message. The parser SHALL also enforce per-type invariants: cloze answers are non-empty strings; translations have `sourceText.length > 0` and `referenceTranslation.length > 0`; vocab `expectedWord` is a single token (no whitespace).
7. WHEN the system prompt is built THEN the result SHALL be passed to `client.messages.create` as a single `system` block with `cache_control: { type: 'ephemeral' }` — matching the cache pattern in `evaluate.ts:231–237`. This is what makes 50-draft batches affordable.

### Requirement 3 — Deterministic ID derivation and idempotency

**User Story:** As an operator re-running a batch (because the previous run failed midway, or because the seed was bumped), I want re-running the same `GenerationSpec` to be a database no-op, so that retries are safe and "give me 50 more" requires explicitly bumping the seed.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/ai/src/generate.ts` SHALL export `exerciseDraftId(spec: GenerationSpec, ordinal: number): string` that returns a deterministic UUID derived from joining `[spec.language, spec.cefrLevel, spec.exerciseType, spec.grammarPoint.key, spec.batchSeed, String(ordinal)]` with `'|'` and hashing with the existing `deterministicUuid` helper from `@language-drill/db/lib/deterministic-uuid` (re-exported through `@language-drill/db`'s package barrel as part of this phase — Phase 1 left it internal-only).
2. WHEN two `generateBatch` runs are issued with identical `GenerationSpec` (including the same `batchSeed`) THEN the produced IDs SHALL match across runs ordinal-by-ordinal.
3. WHEN the CLI inserts produced drafts into `exercises` THEN it SHALL use `INSERT ... ON CONFLICT DO NOTHING` keyed on `id` so re-runs add zero duplicate rows. The CLI's summary output SHALL distinguish *inserted* from *skipped (already present)* counts per cell.
4. WHEN the CLI is invoked twice in a row with the same arguments THEN the second invocation SHALL produce zero new `exercises` rows. The audit table is append-only — the second invocation SHALL still insert a fresh `generation_jobs` row whose final state is `'succeeded'` with `produced_count = spec.count` but `inserted_into_exercises = 0` reflected in the CLI summary's "skipped (already present)" count. (`generation_jobs` does not store this delta as a column in Phase 2; it is shown in the CLI summary and derivable from the deterministic IDs. Adding a column would be a second migration and is deferred.)
5. WHEN the operator wants to add 50 more drafts to a cell that already has 50 THEN the explicit lever SHALL be `--batch-seed <new-value>`. The CLI SHALL document this in its `--help` output. The default `batchSeed` when the flag is omitted SHALL be the literal string `'phase-2-default'` so the first run is reproducible without flag soup.

### Requirement 4 — CLI driver

**User Story:** As a developer filling the pool from my laptop, I want a single `pnpm generate:exercises` command that takes either a single cell or a whole `(language, level)` slice, runs the generator, inserts the drafts, and prints a summary, so that I have day-one access to the generator without standing up Lambda.

#### Acceptance Criteria

1. WHEN `pnpm generate:exercises` is invoked from the repo root THEN it SHALL run `npx tsx packages/db/scripts/generate-exercises.ts` (registered as `pnpm --filter @language-drill/db generate:exercises`) and SHALL accept the following flags via a small inline argument parser (no third-party CLI library):
   - `--lang <ES|DE|TR>` (required; rejects `EN`)
   - `--level <A1|A2|B1|B2>` (required)
   - `--type <cloze|translation|vocab_recall>` (optional; when omitted, runs all three types)
   - `--grammar-point <key>` (optional; when omitted, runs all curriculum cells matching `--lang` and `--level` filters)
   - `--count <int>` (optional; default 50, max 200)
   - `--topic-domain <everyday|academic|professional|travel>` (optional; recorded on inserted rows but not used in prompts)
   - `--batch-seed <string>` (optional; default `'phase-2-default'`)
   - `--max-cost-usd <number>` (optional; default 5)
   - `--concurrency <int>` (optional; default 1; max 5)
   - `--dry-run` (boolean flag)
   - `--allow-prod` (boolean flag, gates the production-environment guard in NFR Security)
2. WHEN the CLI receives `--lang EN` THEN it SHALL print an error explaining EN is source-only (resolved decision #4) and exit non-zero before contacting Claude or the DB.
3. WHEN the CLI is invoked in `--dry-run` mode THEN it SHALL print the resolved cell list, the per-cell estimated token cost (computed from the prompt size + `count` × an empirical per-draft constant defined in code, e.g. `1500` input tokens / `400` output tokens), the total estimated USD spend, and SHALL NOT contact Claude or write to the DB.
4. WHEN the CLI's running estimated spend exceeds `--max-cost-usd` after a cell completes THEN the script SHALL stop processing further cells, print the cells skipped, and exit non-zero. Cells that already succeeded SHALL remain in the DB; the corresponding `generation_jobs` rows SHALL be marked `'succeeded'`.
5. WHEN the CLI processes a cell THEN it SHALL: open a `generation_jobs` row in `'running'` state with `trigger='cli'` and the cell key, call `generateBatch`, batch-insert the produced drafts (one multi-row `INSERT ... ON CONFLICT DO NOTHING`), insert the matching `exercise_tags` rows, then update the `generation_jobs` row to `'succeeded'` with the produced/approved/flagged/rejected counts and token totals.
6. WHEN the CLI processes a cell and `generateBatch` throws THEN it SHALL update the `generation_jobs` row to `'failed'` with `error_message` set to the error's message, then move on to the next cell. Phase 2 does not expose an "abort on first failure" flag — a single bad cell does not halt a whole-language run; the failed row in `generation_jobs` is the operator's signal to investigate.
7. WHEN the CLI completes all cells (success or partial failure) THEN it SHALL print a summary table with one row per cell: cell key, drafts requested, drafts inserted, drafts skipped (already present), input tokens, output tokens, estimated USD, status. The final line SHALL print total drafts inserted, total tokens, total USD, and any failed cells.
8. WHEN the CLI runs cells with `--concurrency > 1` THEN it SHALL process up to that many cells in parallel using a simple `p-limit`-style pattern implemented inline (no new dep). Drafts within a single cell SHALL still run via the generator's own internal sequencing — the concurrency flag is *cell-level*, not draft-level. This protects the org-tier rate limit (resolved decision #6).
9. WHEN the CLI reads `DATABASE_URL` and `ANTHROPIC_API_KEY` THEN it SHALL fail fast at startup if either is missing, with a clear error naming which env var is unset (mirroring `seed-exercises.ts`'s startup check). The CLI SHALL be wired to load `.env` via the existing `dotenv-cli` invocation pattern in the root `package.json` so `pnpm generate:exercises` works without an explicit `dotenv` prefix.

### Requirement 5 — `generation_jobs` writes

**User Story:** As an operator, I want every CLI run to leave a complete audit trail in `generation_jobs` so I can answer "how much have we spent this week" by querying the DB rather than re-reading shell output.

#### Acceptance Criteria

1. WHEN the CLI starts processing a cell THEN it SHALL `INSERT` one row in `generation_jobs` with: a freshly-generated `id` (this row's PK; **not** the deterministic exercise IDs); `cell_key` formatted as `<lang>:<level>:<type>:<grammar_point_key>` (validated via the existing `assertValidCellKey` helper at `packages/db/src/lib/cell-key.ts`); `requested_count = spec.count`; `status = 'running'`; `started_at` defaulted to `now()`; `trigger = 'cli'`; all token, count, and cost fields left at their defaults.
2. WHEN the CLI finishes processing a cell successfully THEN it SHALL `UPDATE` the matching `generation_jobs` row to set: `status = 'succeeded'`, `finished_at = now()`, `produced_count` (drafts returned by `generateBatch`), `approved_count = produced_count` (no validator yet — every produced draft is auto-approved per Phase 3 deferral), `flagged_count = 0`, `rejected_count = 0`, `input_tokens_used`, `output_tokens_used`, and `cost_usd_estimate` rounded to four decimal places.
3. WHEN the CLI fails to process a cell THEN it SHALL `UPDATE` the matching `generation_jobs` row to set: `status = 'failed'`, `finished_at = now()`, `error_message` (truncated to 1000 chars). Any token counts observed before the failure SHALL be written; counts that were never observed SHALL remain NULL.
4. WHEN the CLI's `assertValidCellKey` throws on a malformed cell key THEN this SHALL fail at the CLI argument-parsing boundary (before the DB INSERT), naming the offending key. This guards against a typo-driven bad row landing in the audit table.
5. WHEN the operator queries `SELECT cell_key, MAX(started_at) FROM generation_jobs WHERE status='succeeded' GROUP BY cell_key` THEN it SHALL return the most recent successful refill timestamp per cell — the question Phase 4.3's scheduler will read against. (No code change here — just an asserted query shape.)
6. WHEN the cost estimate is computed THEN it SHALL be derived from `input_tokens_used * INPUT_USD_PER_TOKEN + output_tokens_used * OUTPUT_USD_PER_TOKEN` using constants exported from `packages/ai/src/cost-model.ts` (new file). The constants SHALL match Sonnet 4.5 list pricing as of the phase-2 implementation date and SHALL be commented with the source URL and the date the prices were copied — so the next person bumping models knows where to look.

### Requirement 6 — Within-batch dedup via `recentStems`

**User Story:** As an operator running 50 drafts for one cell, I want the generator to naturally avoid producing the same sentence stem twice in a single run, so that I don't have to deduplicate manually before inserting.

#### Acceptance Criteria

1. WHEN `generateBatch` produces draft N (1-indexed) THEN the system prompt for draft N+1 SHALL include a `recentStems` array containing the canonical surface of every previously-produced draft in the same run — cloze sentence stem (the full `sentence` field), translation `sourceText`, or vocab `expectedWord` — depending on `exerciseType`.
2. WHEN the canonical-surface helper is called for a draft THEN it SHALL lowercase the input and strip diacritics with `String.prototype.normalize('NFKD').replace(/\p{Diacritic}+/gu, '')`. The same helper is used to format the `recentStems` list for the prompt and is exported for Phase 3 to reuse for across-batch dedup.
3. WHEN `recentStems.length > 30` THEN the prompt SHALL include only the last 30 stems (LRU tail). This keeps the prompt size bounded — the cap `MAX_RECENT_STEMS_IN_PROMPT = 30` SHALL be a named constant in `generation-prompts.ts`.
4. WHEN the generator finishes a batch and two drafts share the same canonical surface (Claude ignored the constraint — it happens) THEN the second draft SHALL still be returned, but the corresponding `ExerciseDraft.metadata` SHALL set `inBatchDuplicate: true`. The CLI SHALL log a per-cell warning when any drafts are flagged this way; the count SHALL appear in the per-cell summary line.
5. WHEN the CLI inserts drafts THEN it SHALL still attempt to insert drafts whose `metadata.inBatchDuplicate === true` (Phase 3's UNIQUE index will reject them post-validator; Phase 2 lets them through with a logged warning so operators can see what's happening). The flag lives on the in-memory `ExerciseDraft.metadata` object only — it SHALL NOT be written to any column on `exercises` (no `flagged_reasons` write either, since Req 8.2 requires `flagged_reasons` is NULL for Phase 2 inserts). The `produced_count` in `generation_jobs` includes them; `approved_count` also includes them in Phase 2.

### Requirement 7 — Tests

**User Story:** As a maintainer, I want every load-bearing piece of the generator covered by tests at the appropriate level so subsequent phases can refactor without silently breaking behavior.

#### Acceptance Criteria

1. WHEN `pnpm test --filter @language-drill/ai` is run THEN there SHALL be a unit-test file `packages/ai/src/generate.test.ts` that mocks the Anthropic SDK using the same pattern as `evaluate.test.ts` (a `vi.fn()`-backed `messages.create`). The tests SHALL cover, at minimum: (a) one happy-path test per `ExerciseType` asserting the generated `contentJson` parses through the matching type guard; (b) deterministic ID derivation across two runs with identical specs; (c) the EN-language guard (Req 1.8); (d) the malformed-response error path (no tool block, wrong tool name, schema-invalid input — Req 1.6); (e) `recentStems` accumulates across drafts (assert the second draft's request mentions the first draft's surface); (f) the LRU cap on `recentStems` (Req 6.3).
2. WHEN `pnpm test --filter @language-drill/ai` is run THEN there SHALL be a unit-test file `packages/ai/src/generation-prompts.test.ts` covering: prompt determinism (same `(spec, recentStems)` → identical string); the "(none yet)" fallback when `recentStems` is empty; that the prompt contains the grammar point's name, description, `examplesPositive`, and `commonErrors` verbatim; that the level descriptors come from the shared constant (asserted by checking the constant's contents appear in the rendered prompt).
3. WHEN `pnpm test --filter @language-drill/db` is run THEN there SHALL be an integration-style test `packages/db/scripts/generate-exercises.test.ts` that runs the CLI's main function against an **in-process mocked Anthropic client** (selected by setting `MOCK_CLAUDE=1`) and a **temporary Postgres database via the existing `createDb` factory** if `TEST_DATABASE_URL` is set; otherwise the test SHALL fall back to asserting the CLI's pure planning outputs (cell-list resolution, cost estimate) without DB writes. The test file SHALL be marked with a `describe.skipIf(!process.env.TEST_DATABASE_URL)` for the DB-touching cases so the suite passes locally with neither var set, mirroring how `seed-exercises.test.ts` already handles its planning vs. DB-touching split.
4. WHEN `MOCK_CLAUDE=1` is set in the environment THEN the CLI's Claude client construction SHALL substitute a fixture-driven mock that returns canned tool-use blocks parameterized by `(type, ordinal)` — so the CLI runs end-to-end without a network call and without an API key. `MOCK_CLAUDE` is the **only** trigger for the mock — there is no `--mock-claude` CLI flag (keeps the test surface to one knob). The fixture set SHALL live under `packages/db/scripts/__fixtures__/claude-generation/` with one JSON file per type (`cloze.json`, `translation.json`, `vocab_recall.json`) containing 3 sample drafts each. The mock SHALL cycle through the fixtures by ordinal modulo 3, so a count of 50 produces deterministic-but-varied output.
5. WHEN `pnpm typecheck` is run from the repo root THEN it SHALL pass: the new `GenerationSpec` and `ExerciseDraft` types SHALL be re-exported through `@language-drill/ai` and consumed by the CLI without `any` in either codebase.

### Requirement 8 — Read-path compatibility

**User Story:** As a session-creating user, I want the new generator-produced exercises to be visible to the existing pool-discovery routes the moment they're inserted, so that Phase 2's first successful CLI run is immediately observable in the live API.

#### Acceptance Criteria

1. WHEN the CLI inserts drafts with `review_status = 'auto-approved'` (the default) THEN they SHALL be returned by `GET /exercises?language=…&difficulty=…` and SHALL be eligible for `POST /sessions` without any code change to those routes — the partial pool-lookup index from Phase 1 covers them.
2. WHEN the CLI inserts drafts THEN every inserted exercise row SHALL satisfy: `language ∈ { ES, DE, TR }`, `difficulty ∈ { A1, A2, B1, B2 }`, `type ∈ { cloze, translation, vocab_recall }`, `grammar_point_key` is non-NULL and resolves via `getGrammarPoint`, `generation_source = 'claude-realtime'` (the literal string — `'claude-realtime'` for the CLI path; `'claude-batch'` is reserved for Phase 4.2's Batches API path and SHALL NOT be written by the CLI), `model_id = GENERATION_MODEL` (the constant defined in `packages/ai/src/generate.ts` and asserted equal to the value `evaluate.ts` uses), `generated_at = now()` at insert time, `review_status = 'auto-approved'`, `quality_score` is NULL (validator deferred), `flagged_reasons` is NULL, `topic_domain` matches `--topic-domain` (or NULL when unset — Phase 1 already provisions this column; Phase 2's CLI is the first writer, but only as forward-recording, prompts remain domain-agnostic per resolved decision #3 — see introduction), `audio_s3_key` is NULL (audio is Phase 2 of the *strategy* doc, not Phase 2 of the *generation* plan).
3. WHEN the CLI also inserts the matching `exercise_tags` row(s) THEN the tag SHALL link to the `skill_topics` row whose `id` is `deterministicUuid('skill-topic:' + spec.grammarPoint.key)` — same derivation Phase 1 used. Re-running the CLI SHALL not produce duplicate tag rows (existing PK `(exerciseId, skillTopicId)` enforces this).
4. IF a draft references a `grammar_point_key` whose `skill_topics` row does not exist (e.g. operator generated against a curriculum entry that hasn't been seeded yet) THEN the CLI SHALL fail loudly with an error naming the missing skill-topic row and the suggested fix (`pnpm db:seed:exercises`). It SHALL NOT silently skip the `exercise_tags` insert.

## Non-Functional Requirements

### Performance

- A single 50-draft cloze cell SHALL complete in under 3 minutes against `claude-sonnet-4-5` on a developer laptop (~3.6s/draft including network round-trip is the empirical target; faster with caching). The CLI's per-cell timing SHALL appear in the summary line so regressions are visible.
- Prompt caching SHALL be configured so the system prompt's first call is the only billed-at-full-price call in a cell. The CLI SHALL accumulate `cache_creation_input_tokens` and `cache_read_input_tokens` from the SDK's `usage` object as **separate** in-memory tallies, surface both numbers in the per-cell stdout summary line (e.g. `73,420 input (54,200 cached) / 19,840 output`), and apply Sonnet 4.5's cache-read price (10% of base) and cache-write price (125% of base) when computing the per-cell `cost_usd_estimate`. The `input_tokens_used` column on `generation_jobs` SHALL store `non_cached_input + cache_creation_input + cache_read_input` (the total across categories, so summing token columns over time gives total volume). The split is therefore *observable in the CLI summary for the cache-rate signal* and *summed for the persistent token total* — neither is dropped. Adding cache-token columns to `generation_jobs` is deferred to avoid a second migration in this phase.
- `--concurrency` defaults to 1 because the org-tier rate limit is shared with the live evaluator (resolved decision #6). Operators can opt up to 5 for an overnight whole-language run; the CLI SHALL warn at startup when concurrency > 1 ("you are competing with the live evaluator's rate-limit budget — consider running off-hours").

### Reliability

- The CLI SHALL be safe to interrupt with Ctrl+C: in-flight Claude calls are awaited (the SDK retries internally for transient errors), the running `generation_jobs` row is marked `'failed'` with `error_message = 'Aborted by user (SIGINT)'`, then the process exits non-zero. No partial drafts are inserted from an aborted cell — drafts are inserted only after `generateBatch` resolves successfully for that cell.
- The CLI SHALL be safe to re-run after any failure: the deterministic IDs from Requirement 3 mean drafts already inserted are preserved, and the failed `generation_jobs` row is left in place as historical evidence (the next run inserts a new audit row, never amends the failed one).
- Generation SHALL use the same model as evaluation (`claude-sonnet-4-5`), exposed as a single `GENERATION_MODEL` constant in `packages/ai/src/generate.ts`. Updating the model is a one-line change. The constant SHALL be referenced from the `model_id` column written to `exercises` (Req 8.2) — these two values SHALL never be allowed to drift, enforced via test (Req 7.1.a asserts `metadata.modelId === GENERATION_MODEL`).

### Security

- The CLI SHALL refuse to run when `NODE_ENV === 'production'` unless an explicit `--allow-prod` flag is passed. Production generation runs through the Phase 4 Lambda path; bare CLI on prod is a foot-gun (an operator's laptop key, an operator's machine, an operator's mistake). The error message SHALL link to the Phase 4 Lambda invocation pattern.
- The Anthropic API key SHALL be read from `process.env.ANTHROPIC_API_KEY` only — never from a flag or stdin. This matches the existing convention in `infra/lambda/src/db.ts` and prevents the key from appearing in shell history.
- The CLI SHALL not log the API key, the raw Claude responses (which can echo the prompt and partial PII-like sample sentences), or the full prompt text. Log lines that mention prompts SHALL show only the first 80 chars + ellipsis of the user message — enough to debug, not enough to dump the cache.

### Usability (developer-facing)

- `pnpm generate:exercises --help` SHALL print the full flag list with one-line descriptions, the EN exclusion note, the `--max-cost-usd` default, and one worked example: `pnpm generate:exercises --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 50`.
- The CLI's per-cell log line SHALL be a single readable row of the form: `[ES B1 cloze es-b1-present-subjunctive] 50 drafts → 50 inserted, 0 skipped — 73,420 input / 19,840 output tokens — $0.27 — 2m41s — succeeded`. Failed cells use `failed (<error message head>)` in the same slot. Color and verbosity match the existing `seed-exercises.ts` style — no flags for verbosity in this phase.
- Curriculum entries with `kind: 'vocab'` (the umbrella entries from Phase 1) SHALL be supported by the vocab-recall generator: the generator SHALL prompt for vocabulary themed by the umbrella's `description`, producing a target word that fits the band. When Phase 6 ships frequency-list-driven vocab generation, this code path is replaced; in Phase 2 the umbrellas are sufficient because the existing 9 hand-authored vocab seeds and the per-cell pool of ≥ 50 generated drafts give enough coverage to test the pipeline end-to-end.
