# Implementation Plan

## Task Overview

Implements the eight design components as atomic, file-scoped tasks grouped into phases that mirror
coordinated commits. Sequencing respects dependencies: shared types + migration first (everything
else builds on them), then the generation-prompt cluster (R1/R2/R7, one version bump), the cloze UI,
the frequency-seeding stack (R5), the scheduler changes (R3/R4), the vocab cap (R6), and validator
hardening (R8). Each change lands in the package that already owns its concern (`packages/shared`,
`packages/ai`, `packages/db`, `infra/lambda`, `apps/web`).

**Operational note (not a coding task):** after the generation-prompt tasks merge, the prompt body
must be pushed to Langfuse via `pnpm push-prompts` (per the requirements Uniform prompt-publish
rule and CLAUDE.md) — the runtime serves the Langfuse body, so a repo-only bump is a no-op. This is
a deploy step, excluded from the task list below.

## Steering Document Compliance

- File placement follows `tech.md` §4 monorepo layout (no `structure.md` exists).
- Prompt edits bump `GENERATION_PROMPT_VERSION` (CLAUDE.md rule); per-draft data goes in the user
  prompt to preserve Anthropic prompt caching (`tech.md` §7).
- The single DB migration is additive + forward-only (`tech.md` §5); no backfill.
- Per CLAUDE.md testing rule, each task writes/extends tests in the module's existing test file and
  must pass before the next task.

## Atomic Task Requirements
- **File Scope**: 1–3 related files per task
- **Time Boxing**: 15–30 minutes each
- **Single Purpose**: one testable outcome
- **Specific Files**: exact paths listed
- `_Requirements:_` references spec requirement IDs; `_Leverage:_` references existing code reused

## Tasks

### Phase 1 — Shared types + schema prerequisites

- [x] 1. Add optional `glossEn` to `ClozeContent`
  - File: `packages/shared/src/index.ts`
  - Add `glossEn?: string` to the `ClozeContent` type (after `context?`), with a doc comment: L1
    disambiguation gloss, A1–A2 only, must not spoil the answer
  - Purpose: type-level support for the R2 gloss before prompt/UI tasks consume it
  - _Leverage: packages/shared/src/index.ts (ClozeContent, existing optional `context`/`topicHint`)_
  - _Requirements: 2.3, 2.4, 2.6_

- [x] 2. Add optional `targetOverride` to `GrammarPoint`
  - File: `packages/shared/src/curriculum-types.ts`
  - Add `targetOverride?: number` to the `GrammarPoint` `Readonly<{...}>` type with a doc comment:
    per-cell distinct-exercise ceiling override
  - Purpose: lets a narrow grammar point declare a realistic target (R3)
  - _Leverage: packages/shared/src/curriculum-types.ts (GrammarPoint)_
  - _Requirements: 3.1, 3.2_

- [x] 3. Add forward-only migration + index def for the vocab per-word count cap
  - Files: `packages/db/migrations/<next>_vocab_word_index.sql`, `packages/db/src/schema/exercises.ts`
  - Add partial index `exercises_vocab_word_idx` on `(language, type, difficulty, grammar_point_key,
    (content_json->>'expectedWord'))` `WHERE review_status IN ('auto-approved','manual-approved','flagged')`;
    mirror it in the Drizzle schema's index block. **Column order matches `exercises_dedup_idx`**
    (`language, type, difficulty, grammar_point_key, …`) for consistency.
  - Purpose: make the R6 per-word count query cheap; additive, non-orphaning
  - _Leverage: packages/db/src/schema/exercises.ts (exercises_dedup_idx / exercises_pool_lookup_idx patterns), packages/db/migrations/*_ 
  - _Requirements: 6.3, 6.4_

### Phase 2 — Generation prompt cluster (R1, R2, R7) — coordinated, single version bump

- [x] 4. Add the universal whole-word "Blank granularity" rule and remove the buffer-consonant bullet
  - File: `packages/ai/src/generation-prompts.ts`
  - In `GENERATION_SYSTEM_PROMPT_TEMPLATE`: add a rule that the `___` blank is the entire inflected
    word in every language (never a suffix/stem fragment), with per-language mutation examples
    (TR `kahve→kahveyi`/`kitap→kitabı`; ES `volver→vuelven`/`buscar→busqué`; DE `fahren→fährt`);
    delete the existing "Buffer-consonant ambiguity" bullet (~line 176)
  - Purpose: R1 whole-word convention; retire the superseded buffer band-aid
  - _Leverage: packages/ai/src/generation-prompts.ts (GENERATION_SYSTEM_PROMPT_TEMPLATE)_
  - _Requirements: 1.1, 1.3, 1.4_

- [x] 5. Add the Turkish generic-instruction + level-gated L1-gloss rules
  - File: `packages/ai/src/generation-prompts.ts` (continue from task 4)
  - Add a rule: for TR case clozes use a generic instruction ("the correct form of the word in
    parentheses"); let context force the case; include `glossEn` for A1–A2 (omit B1+); the gloss
    must satisfy the existing "Spoiled blank" rule (no rule-outcome leak); show the lemma in
    parentheses
  - Purpose: R2 context-forced selection + disambiguating gloss
  - _Leverage: packages/ai/src/generation-prompts.ts (existing "Spoiled blank" rule)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 1.2_

- [x] 6. Add anti-leak / stay-on-target / single-correct-fill bullets
  - File: `packages/ai/src/generation-prompts.ts` (continue from task 5)
  - Add bullets: do not let the lemma/cue appear in the visible sentence/hint adjacent to the blank
    (anti-leak, with a negative example); the blank must require the cell's declared grammar point
    (stay-on-target); tighten single-correct-fill guidance referencing `acceptableAnswers`
  - Purpose: R7 generator-side reduction of `context spoils answer`/`grammarPointMatch=false`/`ambiguous`
  - _Leverage: packages/ai/src/generation-prompts.ts (existing ambiguity/acceptableAnswers rule)_
  - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [x] 7. Bump `GENERATION_PROMPT_VERSION` and extend generation-prompt tests
  - Files: `packages/ai/src/generation-prompts.ts`, `packages/ai/src/generation-prompts.test.ts`
  - Bump `GENERATION_PROMPT_VERSION` to `generate@YYYY-MM-DD`; update the byte-parity guard; add
    assertions for the whole-word rule + per-language examples present, buffer-consonant bullet
    absent, anti-leak/stay-on-target bullets present, version format
  - Purpose: lock the coordinated prompt edit (R1/R2/R7) and version cohorting
  - _Leverage: packages/ai/src/generation-prompts.test.ts (existing byte-parity/version tests)_
  - _Requirements: 1.7, 2.6, 7.4_

- [x] 8. Add optional `glossEn` to the cloze generation tool schema + parser
  - Files: `packages/ai/src/generate.ts`, `packages/ai/src/generate.test.ts`
  - Add optional `glossEn` to `CLOZE_GENERATION_TOOL.input_schema` (~line 74) and parse it via
    `optionalString` in `parseGeneratedClozeDraft` (~line 366), mirroring `context`/`topicHint`
    (~lines 380–405); add a parse test for present/absent `glossEn`
  - Purpose: let the generator emit and the pipeline persist the R2 gloss
  - _Leverage: packages/ai/src/generate.ts (CLOZE_GENERATION_TOOL, parseGeneratedClozeDraft, optionalString)_
  - _Requirements: 2.3, 2.6_

- [x] 8.1 Integration test: whole-word TR cloze does not regress the harmony gate
  - File: `packages/db/src/generation/run-one-cell.test.ts` (or `deterministic-checks.test.ts`)
  - Drive a small TR cloze batch through the generation path with a mocked Claude returning
    **whole-word** answers (e.g. `kahveyi`, `kitabı`, `köpeğe`); assert `applyDeterministicChecks` /
    `checkTurkishCloze` produce **no new false** `wrong-harmony`/`non-word-stem` verdicts on the full
    surface and that stored `correctAnswer` is the complete word
  - Purpose: explicit R1.5 no-regression coverage for the deterministic harmony gate on the new format
  - _Leverage: packages/db/src/generation/deterministic-checks.ts (applyDeterministicChecks), packages/ai/src (checkTurkishCloze), run-one-cell.test.ts harness_
  - _Requirements: 1.5_

### Phase 3 — Cloze UI gloss render (R2)

- [x] 9. Render `glossEn` in the cloze exercise component
  - Files: `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx`, `.../__tests__/cloze-exercise.test.tsx`
  - Render `content.glossEn` in the existing above-sentence slot (near the `content.context` render
    at ~line 97), visually muted/distinct; add a test that it renders when set and is absent when unset
  - Purpose: surface the R2 gloss to the learner
  - _Leverage: apps/web/.../cloze-exercise.tsx (content.context render), apps/web/lib/drill/cloze-blank.ts (splitClozeSentence — whole-word agnostic, no change needed)_
  - _Requirements: 2.4 (usability NFR)_

### Phase 4 — Frequency band accessor (R5a)

- [x] 10. Add `cefrRankWindow` + cached `frequencyBand` to the frequency module
  - File: `packages/ai/src/frequency/index.ts`
  - Add `cefrRankWindow(cefr)` (coarse mapping A1≈1–1000 … B2≈5000–10000) and
    `frequencyBand(language, rankMin, rankMax)` that scans the file once, excludes stopwords,
    dedupes by lemma, sorts by rank, and caches per `(language, band)` (mirror `LOOKUP_CACHE`)
  - Purpose: provide rank-banded seed candidates for R5
  - _Leverage: packages/ai/src/frequency/index.ts (FREQUENCY_BY_LANGUAGE, STOPWORDS_BY_LANGUAGE, LOOKUP_CACHE)_
  - _Requirements: 5.1, 5.2_

- [x] 11. Test the frequency band accessor
  - File: `packages/ai/src/frequency/index.test.ts`
  - Tests: stopwords excluded, lemma-deduped, rank-window restricted, rank-sorted, cache returns the
    same instance; `cefrRankWindow` boundaries
  - Purpose: guard R5 seed-candidate correctness
  - _Leverage: packages/ai/src/frequency/index.test.ts (if present) or create alongside_
  - _Requirements: 5.2_

### Phase 5 — Seed picker + generation wiring (R5b)

- [x] 12. Create the deterministic seed picker
  - Files: `packages/db/src/generation/seed-picker.ts`, `packages/db/src/generation/seed-picker.test.ts`
  - `pickSeeds({language, cefrLevel, batchSeed, count, exclude})` → `(string|null)[]`: index into
    `frequencyBand(cefrRankWindow(cefr))` by a hash of `(batchSeed, ordinal)`, skip `exclude` and
    already-chosen seeds, return `null` on exhaustion; tests for determinism, distinctness,
    exclude/stopword filtering, exhaustion `null`
  - Purpose: deterministic per-ordinal lexical seeds (R5)
  - _Leverage: packages/ai/src/frequency (frequencyBand, cefrRankWindow), packages/db/src/lib/deterministic-uuid.ts (hashing pattern)_
  - _Requirements: 5.1, 5.2, 5.3, 5.6_

- [x] 13. Thread `seedWords` through `GenerationSpec` and the user prompt
  - Files: `packages/ai/src/generate.ts`, `packages/ai/src/generation-prompts.ts`, `packages/ai/src/generation-prompts.test.ts`
  - Add `seedWords?: readonly (string|null)[]` to `GenerationSpec`; in `buildGenerationUserPrompt`
    append a loose seed instruction iff the ordinal's seed is non-null ("build around X; if it
    doesn't fit, choose a related content word of similar frequency"); assert the system prompt is
    unchanged (cache-prefix guard) and the user prompt includes the line only when seeded
  - Purpose: inject the seed in the uncached user prompt (R5.4/5.5), caching preserved
  - _Leverage: packages/ai/src/generate.ts (GenerationSpec), packages/ai/src/generation-prompts.ts (buildGenerationUserPrompt)_
  - _Requirements: 5.4, 5.5, 5.7_

- [x] 14. Persist the seed into `content_json` at insert
  - Files: `packages/db/src/generation/validate-and-insert.ts`, `packages/db/src/generation/validate-and-insert.test.ts`
  - For cloze/translation, write a writer-only `seedWord` into `contentWithKey` (next to `_dedupKey`)
    when the ordinal had a seed; test that the stored `content_json` carries `seedWord`
  - Purpose: enable the cross-run exclude set + measurement (R5.3)
  - _Leverage: packages/db/src/generation/validate-and-insert.ts (contentWithKey / `_dedupKey` write at ~line 298)_
  - _Requirements: 5.3, 5.7_

- [x] 15. Add `fetchPriorSeeds` and wire seeding into `runOneCell`
  - Files: `packages/db/src/generation/run-one-cell.ts`, `packages/db/src/generation/run-one-cell.test.ts`
  - Add `fetchPriorSeeds(db, cell)` reading `content_json->>'seedWord'` for the cell; for
    cloze/translation cells call `pickSeeds({..., exclude})` and set `spec.seedWords`; add
    `seedWord`/`seedRank` to the per-ordinal trace context; test that cloze/translation cells get
    seeds and vocab cells do not
  - Purpose: cross-run-deduped seeding end-to-end (R5)
  - _Leverage: packages/db/src/generation/run-one-cell.ts (fetchPriorVocabRecallSurfaces pattern, spec build), seed-picker.ts, packages/db/src/generation/validate-and-insert.ts (withLlmTrace ctx)_
  - _Requirements: 5.1, 5.3, 5.7_

### Phase 6 — Per-cell targets (R3)

- [x] 16. Create `cell-targets.ts` with the target resolver
  - Files: `infra/lambda/src/generation/cell-targets.ts`, `infra/lambda/src/generation/cell-targets.test.ts`
  - `CELL_TARGET_DEFAULTS: Record<ExerciseType, Partial<Record<CurriculumCefrLevel, number>>>` and
    `resolveCellTarget(cell)` = `grammarPoint.targetOverride ?? table[type][cefr] ?? TARGET_PER_CELL`;
    vocab_recall targets account for `N × distinctWords`; tests for the override > table > fallback
    precedence and a narrow A1/A2 cell resolving below 50
  - Purpose: realistic per-cell targets (R3, R6.6)
  - _Leverage: infra/lambda/src/generation/scheduler-decision.ts (TARGET_PER_CELL), packages/db (Cell, ExerciseType, CurriculumCefrLevel)_
  - _Requirements: 3.1, 3.2, 3.3, 6.6_

- [x] 17. Wire the resolved target into `decideEnqueue` and the scheduler
  - Files: `infra/lambda/src/generation/scheduler-decision.ts`, `infra/lambda/src/generation/scheduler.ts`, `infra/lambda/src/generation/scheduler-decision.test.ts`
  - Change `decideEnqueue` to take the resolved `target` as a parameter (stays pure); compute
    `need = target - approvedInPool` and `skip-target-reached` against it; call `resolveCellTarget`
    in `scheduler.ts` and pass it in; update existing decision tests + add the narrow-cell case
  - Purpose: scheduler enqueues to the per-cell target (R3)
  - _Leverage: infra/lambda/src/generation/scheduler-decision.ts (decideEnqueue), scheduler.ts (per-cell loop)_
  - _Requirements: 3.3, 3.4, 3.5_

### Phase 7 — Predictive suppression + within-run early-bail (R4)

- [x] 18. Add the predictive-suppression branch to `decideEnqueue`
  - Files: `infra/lambda/src/generation/scheduler-decision.ts`, `infra/lambda/src/generation/scheduler-decision.test.ts`
  - Add a branch that suppresses (or caps `need`) when `approvedInPool` is within a margin of the
    resolved target AND the most-recent job's dedup ratio was high — same tick, no prior full
    wasteful run required; place it so curriculum-version mismatch still clears it (after the
    existing version-check branch); add table-driven test cases
  - Purpose: predictive saturation suppression (R4.1, R4.4)
  - _Leverage: infra/lambda/src/generation/scheduler-decision.ts (SATURATED_DEDUP_* constants, version-mismatch branch, RecentJob.dedupGivenUpCount)_
  - _Requirements: 4.1, 4.4, 4.5_

- [x] 19. Add the early-bail circuit breaker to `runOutcomePool`
  - Files: `packages/db/src/generation/outcome-pool.ts`, `packages/db/src/generation/outcome-pool.test.ts`
  - Maintain a running `(resolved, dedupGivenUp)` counter as workers populate `results`; after
    `EARLY_BAIL_PROBE_COUNT` resolved, if `dedupGivenUp/resolved >= EARLY_BAIL_RATIO` trip a derived
    `AbortController` linked to the parent `signal` (workers already check `signal.aborted`);
    surface an `earlyBailed` flag; test bail-trips and no-bail-under-threshold
  - Purpose: stop grinding a saturated cell mid-run (R4.2)
  - _Leverage: packages/db/src/generation/outcome-pool.ts (signal.aborted check ~line 77, results Map)_
  - _Requirements: 4.2, 4.3_

- [x] 20. Record `earlyBailed` on `CellResult` and in the structured log
  - Files: `packages/db/src/generation/run-one-cell.ts`, `packages/db/src/generation/run-one-cell.test.ts`
  - Add `earlyBailed: boolean` to `CellResult`; set it from the pool result; keep the audit row
    `succeeded` with accurate counts; log the bail distinctly; test counts + status on bail
  - Purpose: observability for R4.3 without changing terminal status
  - _Leverage: packages/db/src/generation/run-one-cell.ts (CellResult, accumulator loop, structured log)_
  - _Requirements: 4.3_

### Phase 8 — `vocab_recall` ≤N-per-word (R6)

- [x] 21. Change the vocab dedup key to `word::cue`
  - Files: `packages/ai/src/generation-prompts.ts`, `packages/ai/src/generation-prompts.test.ts`
  - In `canonicalSurface`, change the `VOCAB_RECALL` branch to
    `normalize(expectedWord) + '::' + normalize(prompt)`; cloze/translation unchanged; unit test the
    new key (same word + different cue → different key; identical (word,cue) → same key)
  - Purpose: allow multiple cues per word while blocking exact dup (R6.1, R6.2)
  - _Leverage: packages/ai/src/generation-prompts.ts (canonicalSurface, normaliseSurface)_
  - _Requirements: 6.1, 6.2_

- [x] 22. Enforce the per-word count cap at insert
  - Files: `packages/db/src/generation/validate-and-insert.ts`, `packages/db/src/generation/validate-and-insert.test.ts`
  - For `vocab_recall`, before INSERT count approved/flagged rows for `(cell, expectedWord)` (using
    `exercises_vocab_word_idx`); if `>= VOCAB_MAX_PER_WORD` (config ≈3–4) route through the existing
    dedup-retry path (so a different word is requested); test cap-reached → retry → dedup-given-up
  - Purpose: bound concentration per word (R6.3)
  - _Leverage: packages/db/src/generation/validate-and-insert.ts (dedup-retry loop, MAX_DEDUP_RETRIES), exercises_vocab_word_idx (task 3)_
  - _Requirements: 6.3_

- [x] 23. Update prior-surface fetch to return at-cap words only
  - Files: `packages/db/src/generation/run-one-cell.ts`, `packages/db/src/generation/run-one-cell.test.ts`
  - Change `fetchPriorVocabRecallSurfaces` to return words that have reached `VOCAB_MAX_PER_WORD` as
    the avoid-set (group by `expectedWord` having count ≥ N); under-cap words may be re-proposed with
    a new cue; test the at-cap grouping
  - Purpose: fill toward `N × distinctWords` instead of `1 × distinctWords` (R6.5)
  - _Leverage: packages/db/src/generation/run-one-cell.ts (fetchPriorVocabRecallSurfaces)_
  - _Requirements: 6.5_

### Phase 9 — Validator-response parse hardening (R8)

- [x] 24. Make the reason arrays lenient and add `ValidationParseError`
  - Files: `packages/ai/src/validate.ts`, `packages/ai/src/validate.test.ts`
  - In `parseValidationResult`, coerce a missing/non-array `flaggedReasons`/`culturalIssues` to `[]`
    (non-load-bearing); throw a typed `ValidationParseError` (not a bare `Error`) for load-bearing
    failures (`qualityScore`/booleans); tests: missing `flaggedReasons` → `[]`; missing
    `qualityScore` → `ValidationParseError`
  - Purpose: fix the exact 2026-05-24 failure + enable per-draft isolation (R8.1, R8.2)
  - _Leverage: packages/ai/src/validate.ts (parseValidationResult, requireStringArray)_
  - _Requirements: 8.1, 8.2_

- [x] 25. Isolate a parse failure to one ordinal in the validator pool
  - Files: `packages/db/src/generation/validator-pool.ts`, `packages/db/src/generation/validator-pool.test.ts`
  - Catch `ValidationParseError` per worker and store a `{ kind: 'parse-failed', message }` sentinel
    in the results Map instead of rejecting the pool; let transport/abort errors propagate; test
    that one parse-failed draft isolates while others succeed, and a transport error still rejects
  - Purpose: one malformed validator response ≠ whole-cell failure (R8.2)
  - _Leverage: packages/db/src/generation/validator-pool.ts (worker, results Map, "first throw rejects" contract)_
  - _Requirements: 8.2, 8.4_

- [x] 26. Consume the parse-failed sentinel and count it
  - Files: `packages/db/src/generation/outcome-pool.ts`, `packages/db/src/generation/validate-and-insert.ts`, `packages/db/src/generation/run-one-cell.ts`
  - Route a `parse-failed` first-validation to a `rejected` ordinal; add
    `validatorParseFailedCount` to `CellResult` (mirror `parserFailedCount`); surface it in the log;
    extend `run-one-cell.test.ts` for the count
  - Purpose: complete R8 isolation + observability (R8.3)
  - _Leverage: packages/db/src/generation/{outcome-pool.ts, validate-and-insert.ts, run-one-cell.ts} (parserFailedCount precedent, DraftOutcome)_
  - _Requirements: 8.3, 8.5_

### Phase 10 — Final verification

- [x] 27. Run the full pre-push suite and fix any failures
  - Files: (repo root) — no source changes unless a failure is found
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test` from the repo root; resolve any failures
    introduced by Phases 1–9
  - Purpose: zero-failure gate before PR (CLAUDE.md Pre-Push Checks)
  - _Leverage: existing lint/typecheck/test pipeline_
  - _Requirements: all_
