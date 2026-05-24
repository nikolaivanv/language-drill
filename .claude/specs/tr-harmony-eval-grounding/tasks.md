# Implementation Plan

## Task Overview

Five clusters, built bottom-up so each task compiles and tests green on its own: (A) the pure Turkish checker in `packages/ai`, (B) the routing combiner in `packages/db` and its two call-site wirings, (C) the live-path and revalidator integration tests, (D) the evaluator-prompt grounding, (E) the model-constant bump + doc reconciliation. The checker (A) lands first because both (B) and (C) depend on it; (D) and (E) are independent and can land in any order. All work is in the worktree on branch `worktree-tr-harmony-deterministic-checks`.

## Steering Document Compliance

- New pure modules sit beside peers and are re-exported from the package barrel (`packages/ai/src/index.ts`), per tech.md §4 layering — checker in `ai`, `RoutingDecision`-aware combiner in `db`, no cycle.
- Prompt edit (Task 11) bumps `EVALUATION_SYSTEM_PROMPT_VERSION` in the same commit, per CLAUDE.md "Prompt Editing".
- Tests are colocated and added to existing files where a module is only edited (model assertions, prompt tests), never orphaned, per CLAUDE.md "Testing".
- Forward-only / no schema changes; routing reuses the existing `review_status` enum + `flagged_reasons`.

## Atomic Task Requirements
**Each task must meet these criteria for optimal agent execution:**
- **File Scope**: Touches 1-3 related files maximum
- **Time Boxing**: Completable in 15-30 minutes
- **Single Purpose**: One testable outcome per task
- **Specific Files**: Must specify exact files to create/modify
- **Agent-Friendly**: Clear input/output with minimal context switching

## Tasks

### Cluster A — Pure Turkish checker (`packages/ai`)

- [x] 1. Create vowel tables + paradigm helpers in `packages/ai/src/turkish-harmony.ts`
  - File: `packages/ai/src/turkish-harmony.ts` (new)
  - Define `type TurkishVowel`, the frozen `VOWELS` table (front `e i ö ü`, back `a ı o u`, rounded `o ö u ü`, unrounded `a e ı i`), and pure helpers `lastVowel(word)` / `firstVowel(word)` returning `TurkishVowel | null` (scan Unicode letters; no locale lowercasing needed — `ı`/`i` are distinct codepoints).
  - Define `harmonize(stemLastVowel, paradigm: '2-way' | '4-way'): TurkishVowel` implementing: 2-way front→`e`/back→`a`; 4-way (back,unrounded)→`ı`,(back,rounded)→`u`,(front,unrounded)→`i`,(front,rounded)→`ü`.
  - Purpose: deterministic vowel-class + allomorph primitives.
  - _Requirements: 1.1_
  - _Leverage: none (pure linguistic constants)_

- [x] 2. Add stem extraction + invariant-suffix denylist to `turkish-harmony.ts`
  - File: `packages/ai/src/turkish-harmony.ts` (continue from task 1)
  - Add `extractSuffixalStem(sentence): string | null` — find `___`; if the char immediately before it is a Unicode letter return the trailing `/[\p{L}]+/u` run, else return `null` (lexical blank / no marker).
  - Add a frozen `INVARIANT_SUFFIXES` `Set` (`ken`, `leyin`, `gil`, `mtrak`, `imtırak`/`ımtırak`) and a predicate that matches the plain-lowercased `correctAnswer` against it.
  - Purpose: isolate suffixal blanks and exclude non-harmonic suffixes from the harmony veto.
  - _Requirements: 1.1, 2.5, design Error-Handling #4_
  - _Leverage: ai/src/generate.ts (the `___` blank convention)_

- [x] 3. Implement `checkTurkishCloze` verdict function in `turkish-harmony.ts`
  - File: `packages/ai/src/turkish-harmony.ts` (continue from task 2)
  - Define `type DeterministicVerdict = { kind:'ok' } | { kind:'not-applicable' } | { kind:'wrong-harmony'; expected; actual; stem } | { kind:'non-word-stem'; reconstructed; stem }`.
  - Implement `checkTurkishCloze(content: ClozeContent): DeterministicVerdict`: extract stem (null→`not-applicable`); denylist hit → skip harmony but still run word-formedness; else infer paradigm from `firstVowel(correctAnswer)` (low→2-way, high→4-way, none→`not-applicable`), compare to `harmonize(lastVowel(stem), paradigm)` → mismatch returns `wrong-harmony`.
  - Word-formedness: plain-lowercase stem; look up {bare stem, de-mutated stem (`b→p,c→ç,d→t,ğ→k`), `stem+correctAnswer`} via `loadFrequency(Language.TR).lookup`; none found → `non-word-stem`. Wrap the whole body so any throw degrades to `not-applicable`.
  - Purpose: the single deterministic entry point.
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_
  - _Leverage: ai/src/frequency/index.ts (loadFrequency), shared/src/index.ts (ClozeContent, Language)_

- [x] 4. Export the checker from the `@language-drill/ai` barrel
  - File: `packages/ai/src/index.ts` (modify)
  - Re-export `checkTurkishCloze`, `DeterministicVerdict`, and the testable helpers (`lastVowel`, `firstVowel`, `harmonize`, `extractSuffixalStem`, `VOWELS`) from `./turkish-harmony.js`.
  - Purpose: make the checker importable by `packages/db`.
  - _Requirements: 3.1_
  - _Leverage: ai/src/index.ts (existing export pattern, e.g. the frequency re-export)_

- [x] 5. Write unit tests for `turkish-harmony.ts`
  - File: `packages/ai/src/turkish-harmony.test.ts` (new)
  - Cover: `lastVowel`/`firstVowel` over all 8 vowels + no-vowel→null; `harmonize` all 4 four-way combos + both two-way; `extractSuffixalStem` (`domat___`→`domat`, space-before→null, no-marker→null).
  - End-to-end `checkTurkishCloze` against the real `tr.json`: `domat___/ler`→`wrong-harmony` (expected `a`, actual `e`); `domates___/ler`→`ok`; `kitab___/ı`→`ok` (de-mutation); `ev___/ler`→`ok`; `okul___/lar`→`ok`; `araba___/yı`→`ok`; `xyzq___/ler`→`non-word-stem`; `oku___/rken`→not `wrong-harmony` (denylist); lexical blank & consonant-only answer→`not-applicable`; empty `correctAnswer` / no `___`→`not-applicable` (no throw).
  - Purpose: pin the linguistic core and the motivating defect.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.5_
  - _Leverage: ai/src/frequency/tr.json (real lexicon)_

### Cluster B — Routing combiner + wiring (`packages/db`)

- [x] 6. Create `applyDeterministicChecks` combiner in `packages/db/src/generation/deterministic-checks.ts`
  - File: `packages/db/src/generation/deterministic-checks.ts` (new)
  - `applyDeterministicChecks(decision: RoutingDecision, content: ExerciseContent, language: LearningLanguage): RoutingDecision`: pass-through when `language !== Language.TR`, `!isClozeContent(content)`, or verdict `ok`/`not-applicable`; `wrong-harmony`→`{ reviewStatus:'rejected', flaggedReasons:['wrong vowel-harmony allomorph (deterministic): expected <x>, got <y>', ...decision.flaggedReasons] }`; `non-word-stem`→append `'suspected malformed surface form (deterministic): <form>'` and downgrade `auto-approved`→`flagged` (leave `flagged`/`rejected` as-is). Never upgrades.
  - Purpose: the one place verdict→routing precedence lives. Note (R3.6): this is post-LLM routing logic — do NOT touch `GENERATION_PROMPT_VERSION` or `VALIDATION_PROMPT_VERSION` in this or any Cluster A/B task.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_
  - _Leverage: db/src/generation/routing.ts (RoutingDecision, ReviewStatus), ai (checkTurkishCloze), shared (isClozeContent, Language)_

- [x] 7. Write unit tests for `applyDeterministicChecks`
  - File: `packages/db/src/generation/deterministic-checks.test.ts` (new)
  - Assert: `wrong-harmony` forces `rejected` even from a high-score `auto-approved` input, reason prepended; `non-word-stem` downgrades `auto-approved`→`flagged` with reason appended, and leaves an already-`rejected`/`flagged` decision's status unchanged; non-TR / non-cloze (translation/vocab) / lexical-blank inputs return the decision unchanged; reason ordering matches the design.
  - Purpose: lock the precedence + ordering contract.
  - _Requirements: 3.2, 3.3, 3.4_
  - _Leverage: db/src/generation/routing.ts, ai/src/frequency/tr.json_

- [x] 8. Wire combiner into `validateAndInsertWithRetry`
  - File: `packages/db/src/generation/validate-and-insert.ts` (modify, ~line 208)
  - Replace `const decision = routeValidationResult(result);` with `const decision = applyDeterministicChecks(routeValidationResult(result), currentDraft.contentJson, opts.cell.language);`. Add the import.
  - Purpose: deterministic gate on the live generation path.
  - _Requirements: 3.1, 3.2, 3.3_
  - _Leverage: db/src/generation/deterministic-checks.ts, validate-and-insert.ts:208 (existing call site), Cell.language_

- [x] 9. Widen `decideDemotion` and wire combiner in the revalidator
  - File: `packages/db/scripts/revalidate-cloze-pool.ts` (modify, ~lines 321-351 and call site ~541)
  - Change `decideDemotion(currentStatus, result)` → `decideDemotion(currentStatus, result, content: ExerciseContent, language: LearningLanguage)`; inside, `const routed = applyDeterministicChecks(routeValidationResult(result), content, language);`. Update the call site at ~line 541 to `decideDemotion(row.reviewStatus as ReviewStatus, result, recon.draft.contentJson, row.language)`. Add imports.
  - Purpose: identical deterministic gate on the revalidation path (R3.1 single-source-of-truth).
  - _Requirements: 3.1, 3.5_
  - _Leverage: revalidate-cloze-pool.ts:321,332,541; db/src/generation/deterministic-checks.ts_

- [x] 10. Extend live-path + revalidator integration tests
  - Files: `packages/db/src/generation/validate-and-insert.test.ts` (modify), `packages/db/scripts/revalidate-cloze-pool.test.ts` (modify)
  - validate-and-insert: a TR cloze the mock LLM auto-approves but which is `wrong-harmony` → `terminalStatus = 'rejected'`; a `non-word-stem` auto-approve → `inserted-flagged` with the deterministic reason persisted; assert token usage unchanged (no extra Claude calls).
  - revalidator: an `auto-approved` row matching the `domatler` pattern → `decideDemotion` returns `demote → rejected`; a `non-word-stem` row → `demote → flagged`; a clean row → `no-change`.
  - Purpose: end-to-end proof the gate fires on both paths and demotes existing offenders.
  - _Requirements: 3.2, 3.3, 3.5_
  - _Leverage: existing test scaffolds in both files (PR #177's R3.C.8 demotion tests as a pattern)_

### Cluster D — Evaluator prompt grounding (`packages/ai`)

- [x] 11. Ground the TR note in `EVALUATION_SYSTEM_PROMPT` and bump the version
  - File: `packages/ai/src/prompts.ts` (modify, TR note ~lines 79-82 and version ~line 45)
  - Replace the TR bullet with the explicit inventory (front `e i ö ü`; back `a ı o u`; rounded `o ö u ü`; unrounded `a e ı i`), the "suffix harmony is governed by the **last vowel** of the stem only" rule, and the borrowed/mixed-vowel note (`domates`: only the final `e` governs; do not mislabel a vowel's class). Add a comment citing `turkish-harmony.ts` `VOWELS` as the canonical source. Bump `EVALUATION_SYSTEM_PROMPT_VERSION` to `evaluate@2026-05-24`.
  - Purpose: stop fabricated vowel classifications in feedback.
  - _Requirements: 4.1, 4.2, 4.3_
  - _Leverage: ai/src/prompts.ts (EVALUATION_SYSTEM_PROMPT, CEFR descriptor pattern)_

- [x] 12. Update evaluator-prompt tests + registry/byte-parity assertions
  - Files: `packages/ai/src/evaluate.test.ts` and/or `packages/ai/src/prompts-registry.test.ts` (modify)
  - Update assertions to the new prompt text; assert the TR inventory substring is present and `EVALUATION_SYSTEM_PROMPT_VERSION === 'evaluate@2026-05-24'`; keep the Langfuse-fallback resolution test green.
  - Purpose: pin the grounded prompt and version.
  - _Requirements: 4.3, 4.4_
  - _Leverage: existing prompt/registry test patterns_

### Cluster E — Model upgrade + doc reconciliation

- [x] 13. Bump model constants to `claude-sonnet-4-6`
  - Files: `packages/ai/src/generate.ts` (`GENERATION_MODEL`, ~line 46), `packages/ai/src/validate.ts` (`VALIDATION_MODEL`, ~line 39), `packages/ai/src/evaluate.ts` (`MODEL`, ~line 224)
  - Swap the three `claude-sonnet-4-5` literals to `claude-sonnet-4-6`. (Theory constants are aliases of `GENERATION_MODEL` — no literal edit. `annotate.ts` stays `claude-haiku-4-5-20251001`.)
  - Purpose: pin the AI surface to the current Sonnet.
  - _Requirements: 5.1, 5.3, 5.5_
  - _Leverage: generate.ts:46, validate.ts:39, evaluate.ts:224_

- [x] 14. Update model-equality assertions across test files
  - Files: `packages/ai/src/{generate,validate,evaluate,theory-generate,theory-validate,observability}.test.ts` (modify)
  - Change the literal `claude-sonnet-4-5` assertions to `claude-sonnet-4-6`; keep/strengthen the gen=val=eval single-source-of-truth assertion so the three paths cannot drift again.
  - Purpose: green tests + preserved invariant.
  - _Requirements: 5.2_
  - _Leverage: existing model-assertion tests_

- [x] 15. Reconcile the model reference in docs
  - File: `CLAUDE.md` (and `.claude/steering/tech.md` if it still implies 4-5)
  - Confirm both already say `claude-sonnet-4-6`; if any text implies the code runs `4-5`, correct it. No prompt-version change from the model bump.
  - Purpose: close the doc/code drift.
  - _Requirements: 5.4_
  - _Leverage: CLAUDE.md tech-stack table, tech.md §2/§7_

### Final verification

- [x] 16. Run the full pre-push suite and the revalidator dry-run
  - Files: none (verification)
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test` from the repo root; fix any failures. Then run `pnpm revalidate:cloze --language TR --dry-run` and confirm the demotion summary lists the known `wrong-harmony`/`non-word-stem` offenders across TR A1+A2 (do not `--apply` here — that is an operational step post-merge).
  - **Status:** Pre-push suite green — `typecheck` 11/11, `lint` 6/6, `test` 11/11 (ai 501, web 1369; zero failures). The `revalidate:cloze --language TR --dry-run` and the subsequent `--apply` sweep across A1+A2 are deferred to **post-merge operational steps** (they need `DATABASE_URL`/`ANTHROPIC_API_KEY` and incur per-row Claude validation cost against the live pool). See PR test plan.
  - Purpose: confirm zero failures before push and sanity-check the sweep.
  - _Requirements: 3.5, plus CLAUDE.md "Pre-Push Checks"_
  - _Leverage: package scripts (lint/typecheck/test, revalidate:cloze)_
