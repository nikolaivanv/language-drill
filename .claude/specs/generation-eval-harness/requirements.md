# Requirements Document

## Introduction

`pnpm eval` (`packages/ai/scripts/eval-run.ts`) is the project's only quantitative pre-merge prompt gate, but it exercises **only the answer-evaluation prompt**: it feeds a `--candidate` body to `evaluateAnswer` as a `systemPromptOverride` and scores the result against captured `EvaluateAnswerInput` baselines. Pointing it at a **generation-prompt** change measures a prompt that change does not touch — the diff is noise, and every dataset item still bills the Anthropic key. The `generation-quality-improvements` spec nonetheless named `pnpm eval` as the gate for its generation-prompt guardrails (a documentation bug — that capability does not exist), so generation-prompt PRs ship today with no pre-merge quality signal and a runbook that sends operators to spend budget on a zero-signal run.

This feature adds a **generation-quality eval harness** — `pnpm eval:gen` — that runs an OLD-vs-NEW comparison over a dataset of *cells* (`language, cefrLevel, exerciseType, grammarPointKey`): for each cell it builds the generation system + user prompts from each prompt source, generates N drafts with each, scores every draft with the existing validator, and reports the **approval-rate, rejection-reason, and flag-tag distribution deltas** between the two prompt versions, writing a JSON summary the same way `eval-run.ts` does. It mirrors `eval-run.ts`'s structure (port-style dependency injection, production guard, `file:` / `langfuse:` source resolution, pure diff layer, JSON + markdown output) so the two harnesses are operationally and stylistically consistent.

This closes the `docs/tech-debt.md` item "No generation-quality eval harness (`pnpm eval` only covers the evaluation prompt)".

## Alignment with Product Vision

The product's content strategy (CLAUDE.md "Content Strategy", `tech.md` §7) is a **pre-generated exercise pool** produced by a background Lambda calling Claude, gated by an LLM validator. Generation-prompt quality is therefore a direct cost-and-quality lever: a bad prompt re-sweeps the pool at real expense (the PR #227 baseline run cost ~$30.80) and degrades every learner's exercises, while the project's stated quality bar is "portfolio-quality". The harness gives generation-prompt changes the same pre-merge, quantitative, budget-bounded quality gate that answer-evaluation changes already have via `pnpm eval`, supporting the "cost-controlled, AI-heavy" architecture constraint without adding a new runtime dependency.

## Requirements

### Requirement 1 — Generation prompt-source resolution

**User Story:** As an operator validating a generation-prompt change, I want to point the harness at two prompt sources (baseline and candidate), so that I can compare the live/production generation prompt against my proposed edit.

#### Acceptance Criteria

1. WHEN the harness resolves a prompt source of the form `file:<path>` THEN it SHALL read the file contents as the generation **system-prompt template body** (a `{{var}}`-bearing template, not a fully-rendered prompt).
2. WHEN the harness resolves a prompt source of the form `langfuse:<name>@<label>` THEN it SHALL fetch that prompt's body via the injected Langfuse client (mirroring `eval-run.ts`'s `resolveCandidate`), defaulting the label to `candidate` when `@<label>` is omitted.
3. WHEN the harness resolves the literal source `repo` THEN it SHALL use the in-repo `GENERATION_SYSTEM_PROMPT_TEMPLATE` constant as the template body, so a baseline can be taken from the committed fallback without a Langfuse round-trip.
4. IF a prompt source uses an unsupported prefix OR a `langfuse:` source has an empty name THEN the harness SHALL throw a descriptive error before any Claude call is made.
5. WHEN both `--baseline` and `--candidate` sources are resolved THEN the harness SHALL record each source's raw argv string and a content hash (`sha8`) in the run summary so dashboards and re-runs can pivot on prompt identity.

### Requirement 2 — Generation injection seam (`systemPromptOverride`)

**User Story:** As the harness author, I want to drive `generateBatch` with an explicit system-prompt body, so that I can generate drafts under an arbitrary candidate prompt without mutating the live Langfuse prompt or relying on the module-scope prompt cache.

> **New work, not an existing capability.** `GenerationSpec` (`packages/ai/src/generate.ts:233`) has no `systemPromptOverride` field today, and `generateOneDraft` always builds the system prompt internally via `buildGenerationSystemPrompt`. This requirement adds an optional field to `GenerationSpec` plus a branch in `generateOneDraft`/`generateBatch`.

#### Acceptance Criteria

1. WHEN `generateBatch` is called with `spec.systemPromptOverride` set THEN `generateOneDraft` SHALL use that body verbatim as the cached system block — still wrapped with the same `cache_control: { type: 'ephemeral' }` it uses today, so per-cell N-draft generation keeps the prompt-prefix cache benefit — and SHALL NOT call `buildGenerationSystemPrompt` (no Langfuse fetch).
2. WHEN `generateBatch` is called WITHOUT a `systemPromptOverride` THEN its behavior SHALL be byte-identical to today's (Langfuse fetch with in-repo fallback) — the seam is additive and back-compatible, and the existing `generate.test.ts` suite SHALL continue to pass unchanged.
3. WHEN the harness renders a candidate template for a given cell THEN it SHALL produce the override body via `applyTemplate(templateBody, computeGenerationPromptVars(inputs, []))` — `recentStems` is passed as `[]` to match production, where `generateOneDraft` already feeds `buildGenerationSystemPrompt(promptInputs, [])` an empty array (intra-batch diversity feedback was dropped when generation was parallelized) — so the rendered bytes match what the production builder produces for the same cell.
4. IF a candidate template references a `{{var}}` not present in the computed var map THEN the render SHALL surface the unresolved placeholder (not silently drop it) so prompt-source mistakes are caught.

### Requirement 3 — Cell dataset

**User Story:** As an operator, I want a dataset of generation cells distinct from the answer-submission datasets, so that the harness runs against representative `(language, cefrLevel, exerciseType, grammarPointKey)` combinations including failure-prone ones.

#### Acceptance Criteria

1. WHEN the harness loads a cell dataset from a JSON file (`--dataset-file <path>`) THEN it SHALL accept a list of cell descriptors `{ language, cefrLevel, exerciseType, grammarPointKey }` and SHALL validate each descriptor's shape, recording a per-cell error (not crashing) for any malformed entry.
2. WHEN the harness resolves each cell descriptor THEN it SHALL look up the full `GrammarPoint` via `getGrammarPoint(grammarPointKey)` (from `@language-drill/db`'s curriculum) and SHALL record a per-cell error for any key absent from the curriculum.
3. WHEN an export command (`pnpm eval:gen:export`) samples cells from `generation_jobs` THEN it SHALL be able to **over-sample failure-prone cells** (those with the lowest historical approval rate first) and write a cell-dataset JSON file consumable by the runner. The exact `generation_jobs` columns used to rank cells (e.g. a derived approval rate from `rejection_reason_counts` / insert counts vs. attempt counts, keyed by `cellKey`) are an **open question for the design phase** — the runner does not depend on the export, so a hand-curated dataset file satisfies the rest of the spec if the schema cannot support ranking cheaply.
4. IF no `--dataset-file` is supplied AND no export is requested THEN the harness SHALL exit with a usage error rather than running against an empty dataset.

### Requirement 4 — OLD-vs-NEW generation + validation runner

**User Story:** As an operator, I want each cell run through both prompt versions, generating N drafts each and validating every draft, so that I get a like-for-like quality comparison.

#### Acceptance Criteria

1. WHEN the runner processes a cell THEN for EACH of the two prompt sources it SHALL build a `GenerationSpec` (with the rendered `systemPromptOverride` and `count = --drafts-per-cell`), call `generateBatch` to produce N drafts, then call `validateDraft` on every produced draft. `--drafts-per-cell` SHALL default to a small value (proposed 5) and SHALL be bounded by `GenerationSpec.count`'s valid range (1..200).
2. WHEN a draft is validated THEN the runner SHALL route the `ValidationResult` through `routeValidationResult` (from `@language-drill/db`) to obtain `(reviewStatus, flaggedReasons)` and SHALL classify the draft into exactly one of: **approved** (`reviewStatus === 'auto-approved'`), **flagged**, or **rejected**. The validator system prompt is **held constant** across both arms — `validateDraft` builds it from `spec` internally and the harness does not override it, so the validator is a fixed yardstick and only the generation prompt varies.
3. WHEN the runner records outcomes THEN it SHALL NOT insert into the `exercises` table or perform any DB write — scoring is in-memory only (the harness measures prompt quality, it does not populate the pool).
4. WHEN `generateBatch` returns malformed drafts (parser failures) for a cell/source THEN the runner SHALL count them as a **distinct `parser-failure` outcome bucket** (separate from validator `rejected`, since a malformed draft never reaches `validateDraft` and has no `ValidationResult`), count them as non-approved, and fold their token usage into the cost total rather than discarding it.
5. WHEN per-cell execution is injected via a port (test executor) THEN the runner orchestration SHALL be exercised without spinning up Anthropic, Langfuse, or a DB, mirroring `eval-run.ts`'s `EvalRunItemExecutor` pattern.
6. IF a cell's generation or validation throws THEN the runner SHALL record a per-cell error and continue to the next cell (no early termination of the whole run).

### Requirement 5 — Generation-focused diff and summary

**User Story:** As an operator, I want a summary that reports the metrics that matter for generation — approval rate and reason/flag distributions — rather than the per-dimension score deltas the evaluation harness computes, so that I can judge whether a candidate prompt is a regression.

#### Acceptance Criteria

1. WHEN the run completes THEN the diff layer SHALL compute, per prompt source, the **approval rate** = `auto-approved` drafts ÷ total drafts (flagged, rejected, and `parser-failure` all count as non-approved — matching the post-merge observational metric, e.g. the 35.6% approved #227 TR baseline) and SHALL report the candidate-minus-baseline approval-rate delta.
2. WHEN the run completes THEN the diff layer SHALL compute the **rejection-reason distribution** and **flag-tag distribution** for each source (counts keyed by the canonical routed reason strings from `routeValidationResult`, plus the synthetic `parser-failure` key for malformed drafts) and SHALL report the per-key candidate-vs-baseline counts.
3. WHEN the run completes THEN the diff layer SHALL compute total and per-source **USD cost** (via `estimateCostUsd` over folded token usage) so the operator sees the budget spent.
4. WHEN the summary is produced THEN the diff function SHALL be **pure** (no I/O), accept the accumulated run result, and return a typed summary object — mirroring `computeDiff`.
5. WHEN the summary is rendered THEN the harness SHALL print a markdown table to stdout (without the per-cell dump) AND write the full summary including per-cell detail to `./eval-runs/<runName>.json` via a `writeSummaryJson`-style writer.
6. IF any cell produced an error THEN the summary SHALL include an errors section listing the offending cell keys and the CLI SHALL exit non-zero.

### Requirement 6 — Guard rails and CLI wiring

**User Story:** As an operator, I want the same safety rails as `pnpm eval` plus a hard cost cap, so that the harness — which spends ~N× more than answer-eval — cannot accidentally run against prod or overspend.

#### Acceptance Criteria

1. WHEN `LANGFUSE_ENV=prod` AND `--allow-prod` is not set THEN the harness SHALL refuse to run before any Claude call (reusing `eval-run.ts`'s `assertNotProdWithoutAllow` predicate).
2. WHEN `--max-cost-usd <n>` is set AND the accumulated estimated cost reaches or exceeds `<n>` THEN the harness SHALL stop dispatching further cells, mark the run as cost-capped in the summary, and still emit the partial summary. The cap SHALL be checked at **cell boundaries** (after BOTH the baseline and candidate arms of a cell complete) so a partial summary never contains a half-compared cell — every cell in the summary has both arms or neither.
3. WHEN the harness is invoked without `ANTHROPIC_API_KEY` THEN the CLI SHALL exit with a clear error (Claude budget is required) before processing cells.
4. WHEN the CLI is wired THEN `package.json` SHALL expose `pnpm eval:gen` (runner) and `pnpm eval:gen:export` (cell-dataset export) root/package scripts, alongside the existing `eval` / `eval:export`.
5. WHEN `--run-name` is omitted THEN the harness SHALL derive a stable, date-coded run name from the candidate prompt hash (mirroring `deriveRunName`).

### Requirement 7 — Documentation correction

**User Story:** As a future spec author, I want every doc that calls a generation gate to point at this harness, so that nobody is sent to spend budget on the zero-signal `pnpm eval`.

#### Acceptance Criteria

1. WHEN the harness lands THEN the `generation-quality-improvements` spec (`design.md` Testing Strategy, `requirements.md`, `tasks.md`) SHALL be updated to reference `pnpm eval:gen` as the generation gate instead of `pnpm eval`.
2. WHEN the harness lands THEN CLAUDE.md's command table SHALL document `pnpm eval:gen` and `pnpm eval:gen:export`.
3. WHEN the harness lands THEN the `docs/tech-debt.md` entry "No generation-quality eval harness" SHALL be marked resolved with a Resolution section referencing the new script.

## Non-Functional Requirements

### Architecture / Dependencies
- The harness depends on **both** `@language-drill/ai` (`generateBatch`, `validateDraft`, `buildGenerationUserPrompt`, `computeGenerationPromptVars`, `GENERATION_SYSTEM_PROMPT_TEMPLATE`, `applyTemplate`, `estimateCostUsd`, `sha8`, `getLangfuse`) and `@language-drill/db` (`routeValidationResult`, `getGrammarPoint`, and — for export only — `generation_jobs` access). The design phase MUST choose a harness location that permits this: `packages/ai/scripts/` already has `@language-drill/db` as a workspace dependency (it is used by `eval-export.ts`), so co-locating with `eval-run.ts` is feasible and is the proposed default; relocating or duplicating `routeValidationResult` are alternatives to weigh.
- The harness SHALL NOT introduce a new third-party runtime dependency; it composes existing package exports only.

### Performance / Cost
- The harness SHALL bound spend with `--max-cost-usd` and SHALL support `--drafts-per-cell` and a cell `--limit` so an operator can run a cheap smoke pass (e.g. 3 cells × 3 drafts) before a full run.
- Generation + validation per cell MAY run concurrently with a small cap, but concurrency is NOT required for the first version; correctness and cost accounting take priority over wall-clock.

### Reliability
- A single cell's failure (generation error, validation error, parser failure, unknown grammar-point key, malformed descriptor) SHALL NOT abort the run — it is recorded and the run continues, matching `eval-run.ts`'s per-item error isolation.
- Token usage from malformed/aborted Claude calls SHALL still be counted toward the cost total so budget accounting never understates billed cost.

### Security
- The harness SHALL never write to the `exercises` table or any production data store; it is read-only against the DB (curriculum lookup, optional `generation_jobs` sampling for export) and write-only to `./eval-runs/`.
- The production guard SHALL gate Langfuse-prod usage exactly as `eval-run.ts` does.

### Usability / Testability
- The runner orchestrator, prompt-source resolver, diff layer, and summary writer SHALL be exported and individually unit-testable with injected ports (no live Anthropic/Langfuse/DB), mirroring `eval-run.test.ts`.
- The diff and render layers SHALL be pure functions so their output can be asserted byte-for-byte in tests.
