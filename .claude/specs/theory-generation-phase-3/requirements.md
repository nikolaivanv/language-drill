# Requirements Document — theory-generation-phase-3

## Introduction

Phase 3 of theory-generation closes the quality loop. Today (post-Phase 2) every theory page that Claude generates is written to `theory_topics` with `review_status = 'auto-approved'` — there is no second-pass check, no flagged queue, and no human gate. That's acceptable for a smoke test but unacceptable for production: a single wrong rule in a theory page teaches a learner the wrong thing, and the cost of an undetected bad page is higher than the cost of a bad exercise (one bad item in a 50-item pool dilutes itself; one bad theory page is the canonical reference for that topic).

Phase 3 adds:

1. **A validator pass.** A second Claude call grades the draft against five quality dimensions specific to theory (factual accuracy, level match, section completeness, on-target examples, cultural neutrality).
2. **Stricter routing than exercises.** Factual errors are a hard reject. Cultural issues are a hard reject. Section gaps flag. Low quality scores reject or flag based on thresholds.
3. **A human review CLI** (`pnpm review:flagged-theory`) that walks flagged pages one row at a time, renders the topic in the terminal, and accepts `[a]pprove / [r]eject / [s]kip / [q]uit` keystrokes.
4. **Wiring into `runOneTheoryCell`** — the orchestrator stops blindly writing `auto-approved` and instead routes every draft through the validator + router before INSERTing the row with the correct `review_status` + `flagged_reasons`.

Phase 3 does **not** touch CDK, Lambda, EventBridge, or the panel. The validator runs in the same Node process as the generator (CLI + future Lambda). The flagged queue is invisible to learners because the panel's lookup predicate already filters to `review_status IN ('auto-approved', 'manual-approved')` — flagged rows simply never appear in the panel until a reviewer approves them.

**Intentionally deferred:** the plan's §3.3 `[e]dit` branch (round-trip a flagged row's JSON through `$EDITOR` and re-validate against the schema) is **not** part of Phase 3. The exercise-side review CLI doesn't have it either, and keymap parity (a/r/s/q) between the two reviewers is more valuable than the inline-edit feature. A flagged row that's salvageable with an edit is rejected in Phase 3 and re-generated next batch; the edit branch can be reintroduced in a later phase if review throughput demands it.

## Alignment with Product Vision

`product.md` positions the app for the **intermediate plateau** — learners who can't tolerate misinformation because they've moved past beginner content and are trying to internalize precise rules. A wrong theory page on the subjunctive isn't a minor annoyance; it actively corrupts the user's mental model of when to use it. The validator + reviewer gate exists to make sure that doesn't happen.

`tech.md` §7 ("Content & AI Strategy") commits to pre-generated content as the cost-control mechanism. The validator is the *quality-control* counterpart: it lets us scale ES/DE/TR theory coverage from three hand-authored pages to ~240 generated pages without dropping the editorial bar. Same model (`claude-sonnet-4-5`), same caching pattern, same Secrets Manager wiring — additive to the existing AI stack, no new dependencies.

`docs/theory-generation-plan.md` §4 names Phase 3 as the gate between dev-time generation (Phase 2, already shipped) and productionization (Phase 4). Without it, a Phase 4 Lambda would queue and write bad pages on a weekly cron with no escape hatch.

## Requirements

### Requirement 1 — Validator core (`packages/ai/src/theory-validate.ts`)

**User Story:** As an operator running theory generation, I want every Claude-generated theory page to be reviewed by a second Claude call before it lands as approved content, so that factually wrong or off-level pages never reach learners.

#### Acceptance Criteria

1. WHEN a `TheoryDraft` and its `TheoryGenerationSpec` are passed to `validateTheoryDraft(client, draft, spec)` THEN the function SHALL call `client.messages.create` with `model = VALIDATION_MODEL` (the same `claude-sonnet-4-5` constant the exercise validator and generator pin), `tool_choice = { type: 'tool', name: THEORY_VALIDATION_TOOL_NAME }`, and `temperature = 0.0`.
2. WHEN the validator builds its system prompt THEN the system message SHALL carry `cache_control: { type: 'ephemeral' }` and SHALL be `spec`-derived only (no per-draft fields), so that two validator calls within the same cell hit the prompt cache on the second call.
3. WHEN Claude's response contains a `tool_use` block named `submit_theory_validation_result` THEN the validator SHALL parse the block's `input` via `parseTheoryValidationResult` and SHALL return `{ result: TheoryValidationResult, tokenUsage: ClaudeUsageBreakdown }`.
4. IF Claude's response contains no `tool_use` block, the wrong tool name, or a block whose `input` fails schema parsing THEN `validateTheoryDraft` SHALL throw an `Error` whose message names the missing/invalid field (matching the field-level format already used by `parseGeneratedClozeDraft`).
5. WHEN the tool schema is defined THEN `THEORY_VALIDATION_TOOL` SHALL declare exactly six required properties: `qualityScore` (number 0–1), `factualErrors` (array of strings), `levelMismatch` (boolean), `sectionsIncomplete` (array of strings — names of required sections that are missing or thin), `examplesUseGrammarPoint` (boolean), `culturalIssues` (array of strings), and `flaggedReasons` (array of strings — free-text reviewer hints).
6. WHEN `THEORY_VALIDATION_MODEL` is exported THEN a unit test SHALL assert it equals `GENERATION_MODEL` (the shared constant from `generate.ts`), preventing the generator and validator from drifting onto different model ids.

### Requirement 2 — Validator system prompt (`packages/ai/src/theory-validation-prompts.ts`)

**User Story:** As an operator, I want the validator's system prompt to encode the exact theory-specific quality dimensions and the routing rules, so that Claude's scores are self-consistent with the router's decisions.

#### Acceptance Criteria

1. WHEN `buildTheoryValidationSystemPrompt(spec)` is called THEN it SHALL return a string that contains, in order: a role line ("strict reviewer of language reference material…"), the grammar point context (`name`, `description`, `examplesPositive`, `commonErrors`), the CEFR level descriptor for the spec's level, the six required theory sections in the order the generator produces them, a "Routing implication" block restating the rules from Requirement 3 in plain English, and a "use the tool — no plain text" closing directive.
2. WHEN two calls to `buildTheoryValidationSystemPrompt` receive equal `spec` values THEN their return strings SHALL be byte-identical (this is what makes ephemeral cache hits possible).
3. WHEN `buildTheoryValidationUserPrompt(draft, spec)` is called THEN it SHALL embed the draft's `contentJson` as JSON (pretty-printed at 2-space indent so Claude can read it section-by-section) and SHALL append a one-line directive identifying the grammar-point key and CEFR level for this specific page.
4. WHEN the system prompt is constructed THEN it SHALL NOT include any draft-specific content — all per-draft data flows through the user prompt only.
5. WHEN the "Routing implication" block renders the numeric thresholds (0.5 and 0.7) THEN it SHALL interpolate the values from `THEORY_VALIDATION_THRESHOLDS.flagQualityFloor` / `approveQualityFloor` (imported from `packages/db/src/theory-generation/routing.ts`) rather than hard-typing the literals. The same prompt-as-truth pattern as `validation-prompts.ts` — if a future tuning round bumps the thresholds, the prompt updates automatically.

### Requirement 3 — Theory router (`packages/db/src/theory-generation/routing.ts`)

**User Story:** As an operator, I want a pure deterministic mapping from a `TheoryValidationResult` to a `(reviewStatus, flaggedReasons)` pair, so that the routing decision is testable in isolation and can never drift between the CLI and a future Lambda.

#### Acceptance Criteria

1. WHEN `routeTheoryValidationResult(result)` is called THEN it SHALL return a `TheoryRoutingDecision = { reviewStatus, flaggedReasons }` where `reviewStatus` is one of `'auto-approved' | 'flagged' | 'rejected'`.
2. WHEN `result.factualErrors.length > 0` THEN the function SHALL return `{ reviewStatus: 'rejected', flaggedReasons: [...factualErrors] }` regardless of other fields (factual errors are stricter than the exercise validator because a wrong rule has a higher cost).
3. WHEN `result.culturalIssues.length > 0` (and Criterion 2 did not already match) THEN the function SHALL return `{ reviewStatus: 'rejected', flaggedReasons: [...culturalIssues] }`.
4. WHEN `result.qualityScore < THEORY_VALIDATION_THRESHOLDS.flagQualityFloor` (0.5) AND neither Criterion 2 nor 3 has matched THEN the function SHALL return `{ reviewStatus: 'rejected', flaggedReasons: ['low quality score (<0.5)', ...result.flaggedReasons] }`. (Matches the exercise router's reason ordering at `packages/db/src/generation/routing.ts:84–86`; deliberately tighter than the plan's §3.2 sketch, which omits the synthetic header.)
5. WHEN none of the reject conditions hold AND `result.qualityScore >= THEORY_VALIDATION_THRESHOLDS.approveQualityFloor` (0.7) AND `result.levelMismatch === false` AND `result.sectionsIncomplete.length === 0` AND `result.examplesUseGrammarPoint === true` THEN the function SHALL return `{ reviewStatus: 'auto-approved', flaggedReasons: [] }`.
6. WHEN any flag condition holds (quality in [0.5, 0.7), level mismatch, sections incomplete, examples off-target) THEN the function SHALL return `{ reviewStatus: 'flagged', flaggedReasons: [...] }` where the reasons are appended in this fixed order: low-score-band string, `'level mismatch'`, every entry of `sectionsIncomplete` (prefixed with `'incomplete section: '`), `'examples off-target'`, then every entry of `result.flaggedReasons`. **This consolidates the plan's §3.2 early-return chain into a single accumulating pass** — every failing condition contributes one reason, so a row that's both off-level AND has incomplete sections surfaces both reasons in the reviewer's terminal. Order is deterministic to keep snapshot tests stable.
7. WHEN the function returns THEN the result SHALL be observably pure — no I/O, no Claude calls, no DB access — and SHALL be unit-testable with hand-built `TheoryValidationResult` literals.
8. WHEN `'manual-approved'` is considered as an output THEN the function SHALL NEVER return it (manual-approved is set only by the review CLI's UPDATE path, mirroring the exercise side).

### Requirement 4 — Wire validator into `runOneTheoryCell`

**User Story:** As an operator, I want the per-cell orchestrator to validate every draft before INSERTing it, so that the production write path produces `auto-approved`, `flagged`, or `rejected` rows according to the router's decision instead of blindly writing `auto-approved`.

#### Acceptance Criteria

1. WHEN `runOneTheoryCell` finishes generation (a non-null `draft` from `generateTheoryTopic`) THEN it SHALL call `validateTheoryDraft(client, draft, spec)` before any INSERT into `theory_topics`.
2. WHEN the validator returns THEN the orchestrator SHALL call `routeTheoryValidationResult(result)` and SHALL accumulate the validator's `tokenUsage` into the cell's total via `addUsage`.
3. WHEN the router returns `reviewStatus = 'rejected'` THEN the orchestrator SHALL NOT INSERT into `theory_topics`, SHALL close the audit row with `status = 'succeeded'`, `approved = false`, `flagged = false`, `rejected = true`, `quality_score = result.qualityScore`, and SHALL return a `TheoryCellResult` with `status: 'succeeded'`, `insertedCount = 0`, `skippedCount = 0`. **No new variant on the existing `TheoryCellResult.status` union** (it stays `'succeeded' | 'failed' | 'skipped-cost-cap'`); rejected is a *successful run* whose *outcome* is "validator vetoed". The rejected-vs-dedup-skip distinction is carried on the audit row's `rejected` boolean, not on the result's status — both have `insertedCount = 0`, but a dedup skip has `skippedCount = 1` and a rejection has `skippedCount = 0`.
4. WHEN the router returns `reviewStatus = 'flagged'` THEN the orchestrator SHALL INSERT the row with `review_status = 'flagged'`, `quality_score = result.qualityScore`, `flagged_reasons = result.flaggedReasons`, SHALL close the audit row with `approved = false`, `flagged = true`, `rejected = false`, and SHALL return `insertedCount = 1` (the row exists in the DB but is invisible to the panel — see Phase 5's lookup predicate).
5. WHEN the router returns `reviewStatus = 'auto-approved'` THEN the orchestrator SHALL INSERT the row with `review_status = 'auto-approved'`, `quality_score = result.qualityScore`, `flagged_reasons = null`, SHALL close the audit row with `approved = true`, `flagged = false`, `rejected = false`, and SHALL return `insertedCount = 1`.
6. IF the validator call throws (network error, malformed Claude response, etc.) THEN `runOneTheoryCell` SHALL close the audit row as `status = 'failed'` with the truncated error message (≤1000 chars, same `ERROR_MESSAGE_MAX_LENGTH` ceiling), SHALL preserve the *generator's* `tokenUsage` in the audit row (we already paid for those tokens), and SHALL return a `failed` `TheoryCellResult` — no theory_topics row is written on validator failure.
7. WHEN the partial unique index on `theory_topics_pool_lookup_idx` rejects an INSERT (cell already has an approved row) AND the router decided `auto-approved` THEN the orchestrator SHALL behave exactly as Phase 2 does today: `status = 'succeeded'`, `insertedCount = 0`, `skippedCount = 1`, with the "cell already filled" message.
8. WHEN the SIGINT-handling pattern from Phase 2 is preserved THEN the orchestrator SHALL recheck `signal?.aborted` immediately before the validator call (so a user who interrupts after generation but before validation doesn't pay for the validator call) AND immediately after, with both cases returning `failClosed` carrying the partial token usage.

### Requirement 5 — Review CLI (`packages/db/scripts/review-flagged-theory.ts`)

**User Story:** As an operator reviewing flagged content, I want a `pnpm review:flagged-theory` command that walks flagged theory pages one at a time and lets me approve, reject, or skip each one with a single keystroke, so that I can clear the flagged queue without writing SQL by hand.

#### Acceptance Criteria

1. WHEN the operator runs `pnpm review:flagged-theory --lang es` THEN the CLI SHALL exit 0 immediately if no rows match `review_status = 'flagged' AND language = 'ES'` and SHALL print `No flagged theory pages match the filter.`.
2. WHEN flagged rows exist THEN the CLI SHALL select up to `args.limit` (default 25, override via `--limit N`) rows ordered by `generated_at ASC`, print each one in turn, and prompt `[a]pprove / [r]eject / [s]kip / [q]uit ` after each.
3. WHEN the operator presses `a` THEN the CLI SHALL `UPDATE theory_topics SET review_status = 'manual-approved', flagged_reasons = NULL WHERE id = $1 AND review_status = 'flagged'`. If the UPDATE collides with the partial unique index (another approved row already occupies the `(language, grammar_point_key)` cell — the same edge case the exercise side handles via `isUniqueViolation`) THEN the CLI SHALL demote to `rejected` instead and print a one-line warning.
4. WHEN the operator presses `r` THEN the CLI SHALL `UPDATE theory_topics SET review_status = 'rejected' WHERE id = $1 AND review_status = 'flagged'`. `flagged_reasons` SHALL be preserved so the audit trail survives.
5. WHEN the operator presses `s` THEN the CLI SHALL leave the row untouched and advance to the next row.
6. WHEN the operator presses `q` (or Ctrl-C) THEN the CLI SHALL exit gracefully — TTY raw mode restored, stdin paused, DB pool closed.
7. WHEN each flagged row is rendered THEN the output SHALL include: a header line with id-prefix + `lang/level/grammar-point-key` + `qualityScore`; the rendered topic as plain text (a `theoryTopicJsonToText` helper at `packages/db/scripts/theory-json-to-text.ts` that walks `TheoryTopicJson` → indented section/paragraph/example dump — no styling, no React); and a bullet list of `flagged_reasons`. The helper lives next to the CLI rather than in `packages/shared/` because plain-text rendering is a CLI concern (the web renderer is JSX-based; sharing the helper would create a one-consumer abstraction).
8. WHEN the slice predicate is built THEN supported filters SHALL include `--lang` (required, one of `es | de | tr`), optional `--level` (one of `a1 | a2 | b1 | b2`), optional `--grammar-point KEY`, and optional `--limit N`. The argument parser SHALL reject `--lang en` with a clear error (theory pages are about the L2; English is the metalanguage).
9. WHEN a write completes (approve, reject, demote) THEN the CLI SHALL print a one-line confirmation (`✓ approved <id-prefix>`, `✗ rejected <id-prefix>`, `↓ demoted <id-prefix> (another approved row already in cell)`) before advancing to the next prompt.
10. WHEN the slice is exhausted THEN the CLI SHALL print a summary: `Reviewed N rows: A approved, B rejected, C skipped, D demoted. R flagged remain in this slice — re-run to continue.` where `R` is `countFlagged - (approved + rejected + demoted)`.

### Requirement 6 — Pre-push parity

**User Story:** As a developer, I want Phase 3's additions to satisfy the same pre-push bar the rest of the repo does, so that `pnpm lint && pnpm typecheck && pnpm test` stays green at every commit.

#### Acceptance Criteria

1. WHEN `pnpm lint` runs THEN every new file under `packages/ai/src/`, `packages/db/src/theory-generation/`, and `packages/db/scripts/` SHALL pass with zero ESLint warnings.
2. WHEN `pnpm typecheck` runs THEN every public export from `packages/ai/src/theory-validate.ts`, `packages/db/src/theory-generation/routing.ts`, and `packages/db/scripts/review-flagged-theory.ts` SHALL be fully typed without `any` (matching the convention established by the exercise-side mirrors).
3. WHEN `pnpm test` runs THEN new Vitest files SHALL accompany every new module: `theory-validate.test.ts`, `theory-validation-prompts.test.ts`, `routing.test.ts` (next to `theory-generation/routing.ts`), `review-flagged-theory-parse-args.test.ts`, `review-flagged-theory.test.ts`, and `run-one-cell.test.ts` (updated, not new — the existing Phase 2 file gains cases for the three router branches and the validator-failure path).
4. WHEN any test invokes Claude THEN it SHALL use a mocked Anthropic client (the project does not call live Claude from tests — `MOCK_CLAUDE=1` fixture pattern, mirroring Phase 2's `generate-theory-mock-client.ts`).

## Non-Functional Requirements

### Performance

- The validator adds **one Claude round-trip per cell** (~5 seconds at p50). End-to-end cell duration grows from ~12s (generation only) to ~17s — acceptable for batch generation, irrelevant for the CLI's single-cell debug flow.
- The validator's system prompt is cache-keyed on `(language, grammarPointKey, cefrLevel)`. A run that touches N cells therefore writes N cache entries on the first pass and reads them on every subsequent draft validation within a cell — but since theory generates one draft per cell, the cache hit rate is effectively zero. **Caching is set up anyway** for forward-compat with a hypothetical multi-draft-per-cell mode and to match the exercise validator's pattern (zero-cost to set up, free upside if the assumption ever changes).
- The router (`routeTheoryValidationResult`) SHALL execute in <100µs — it is a pure function over a small struct and SHALL NOT call into the DB, the network, or any I/O.

### Security

- The validator inherits the same secret resolution path as the generator: `ANTHROPIC_API_KEY` from `.env` locally, from AWS Secrets Manager in the (future) Lambda. No new secrets, no new IAM surface.
- The review CLI requires the same `DATABASE_URL` the rest of `packages/db/scripts/` uses. The CLI SHALL refuse to run if `DATABASE_URL` resolves to a production-prefixed connection string AND `--allow-prod` is not passed — mirroring the existing guard in `generate-exercises.ts` so a reviewer can't accidentally rewrite production rows from their laptop.
- The CLI SHALL NOT log raw `contentJson` to disk or to a long-lived telemetry sink; rendered output goes to stdout only.

### Reliability

- The validator-failure path (Requirement 4.6) ensures a single bad validation never poisons a multi-cell batch — the cell fails, the batch continues, the operator sees the cell in `theory_generation_jobs.error_message` and can re-run that cell deterministically (same `jobId` derivation as Phase 2, so a re-run is a no-op when the prior run succeeded).
- The review CLI's UPDATE statements all carry `AND review_status = 'flagged'` so a concurrent state change (another reviewer, a future Lambda) cannot cause a lost-update bug — the second writer's UPDATE matches zero rows and the CLI surfaces that as "skipped — already resolved by another writer".
- Validator output is non-deterministic by nature (LLM), but the *parser* SHALL be deterministic: given a fixed Claude response, `parseTheoryValidationResult` SHALL produce the same `TheoryValidationResult` or the same error message on every run.

### Usability

- The reviewer's single-keystroke flow (`a / r / s / q`) is the same as `review-flagged.ts`. Operators reviewing both exercises and theory in the same session SHALL NOT need to learn a second keymap.
- The plain-text rendering of `TheoryTopicJson` in the terminal SHALL be readable without a markdown renderer — section titles on their own line, paragraphs wrapped to 80 columns, examples indented two spaces under each section.
- The validator's `flaggedReasons` strings are surfaced verbatim in the CLI's bullet list. The validator prompt is therefore explicit that flagged-reasons strings SHALL be human-readable English sentences, not opaque tokens.
