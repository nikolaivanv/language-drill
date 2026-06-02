# Implementation Plan

## Task Overview

Two independent workstreams, each landing test-green before the other:

- **R1 (Tasks 1–6) — cell-type re-allocation:** add one optional `GrammarPoint` field, thread it through the single canonical cell enumerator, guard it with one curriculum invariant, flag the four TR-A2 points, and test. Pure data/enumeration; no migration.
- **R2–R4 (Tasks 7–11) — generation-prompt guardrails:** edit `GENERATION_SYSTEM_PROMPT_TEMPLATE` (vocab band, content safety, accusative forcing, `acceptableAnswers`), bump `GENERATION_PROMPT_VERSION` once, and pin the changes with tests. All static text → byte-parity preserved.
- **Task 12 — pre-push verification.**

**Out of scope as checkbox tasks** (manual / post-merge, not coding): `pnpm eval:gen` validation of the prompt change against a cell dataset (the real generation-quality gate — not `pnpm eval`, which only covers the answer-evaluation prompt; it is the gate for the model-judgment guardrails), and the post-merge `pnpm push-prompts` Langfuse sync + `bootstrap-prompts --check`. These are called out in the design's Testing Strategy and must run before/after merge respectively.

## Steering Document Compliance

- Shared types in `packages/shared/`, curriculum data + enumeration in `packages/db/`, prompt builders + version constant in `packages/ai/` (tech.md §4 monorepo layout).
- Same-commit `*_PROMPT_VERSION` bump on any `*_SYSTEM_PROMPT` body edit (CLAUDE.md prompt-editing convention); Langfuse sync deferred to post-merge.
- Forward-only, additive, no migration (tech.md §5).

## Atomic Task Requirements
- File Scope: 1–3 files each · Time Boxing: 15–30 min · Single testable outcome · Exact file paths · Leverage existing code.

## Tasks

### R1 — Cell-type re-allocation

- [x] 1. Add `clozeUnsuitable?: boolean` to the `GrammarPoint` type
  - File: `packages/shared/src/curriculum-types.ts`
  - Add an optional `clozeUnsuitable?: boolean` field to the `Readonly<GrammarPoint>` type, immediately after `targetOverride`, with a doc comment explaining it suppresses the `cloze` cell for clause-linking/bipartite points (the blank's answer is leaked by the other half of the construction or near-synonym alternants both fit).
  - Purpose: data-driven, language-agnostic opt-in for cloze suppression.
  - _Leverage: the existing `targetOverride?: number` optional-field pattern (same file)._
  - _Requirements: 1.1, 1.3_

- [x] 2. Suppress the cloze cell for flagged points in the enumerator
  - File: `packages/db/src/generation/cells.ts`
  - Change `compatibleTypes(kind)` to `compatibleTypes(entry: GrammarPoint)`: for `kind === 'grammar'` return `[CLOZE, TRANSLATION]`, but return `[TRANSLATION]` when `entry.clozeUnsuitable === true`; keep `vocab` → `[VOCAB_RECALL]`. Update the single call site in `enumerateCurriculumCells` (`compatibleTypes(entry.kind)` → `compatibleTypes(entry)`).
  - Purpose: emit translation-only cells for flagged grammar points; unchanged otherwise.
  - _Leverage: `cells.ts` `compatibleTypes` / `enumerateCurriculumCells` (single private call site)._
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 3. Test cell enumeration with the flag
  - File: `packages/db/src/generation/cells.test.ts` (extend; it already tests `enumerateCurriculumCells`)
  - Add cases: a synthetic `kind:'grammar'` point with `clozeUnsuitable:true` yields exactly one `translation` cell and no `cloze` cell; an unflagged grammar point still yields `cloze` + `translation`; a `vocab` umbrella is unchanged; over `ALL_CURRICULA` the cell count drops by exactly the number of flagged points.
  - **Update the existing assertion** (`cells.test.ts:22`, currently `grammarCount * 2 + vocabCount`): once Task 5 flags the four points, flagged grammar points yield 1 cell not 2, so change it to subtract the flagged count (e.g. `grammarCount * 2 + vocabCount - flaggedCount`, deriving `flaggedCount` from the data) or it will fail.
  - Purpose: lock the enumeration contract.
  - _Leverage: existing `enumerateCurriculumCells` test cases / fixtures in this file._
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 4. Add the `clozeUnsuitable`→`kind:'grammar'` curriculum invariant
  - File: `packages/db/src/curriculum/index.ts`
  - In the `assertCurriculumInvariants` loop, add: if `entry.clozeUnsuitable` is truthy and `entry.kind !== 'grammar'`, throw `Curriculum invariant violated: '<key>' is clozeUnsuitable but not kind 'grammar'`.
  - Purpose: reject a meaningless flag on a `vocab` umbrella (which has no cloze cell).
  - _Leverage: the existing numbered-invariant loop in `assertCurriculumInvariants` (line ~99)._
  - _Requirements: 1.6_

- [x] 5. Flag the four cloze-unsuitable TR-A2 grammar points
  - File: `packages/db/src/curriculum/tr.ts`
  - Add `clozeUnsuitable: true` to the entries `tr-a2-converbs`, `tr-a2-correlative-conjunctions`, `tr-a2-nominalization`, and `tr-a2-relative-an`. Do NOT touch their `description` / `examplesPositive` / `examplesNegative` / `commonErrors` (audited in PR #220). No `CURRICULUM_VERSION_TR` bump is required (the bump is a generation-suppression-clearing signal for the prompt-version cohort; this enumeration change does not depend on it — but if landed alongside the prompt change, document the choice).
  - Purpose: opt the four bipartite points into translation-only generation.
  - _Leverage: existing entry objects in `tr.ts`._
  - _Requirements: 1.5_

- [x] 6. Test the invariant and the four flags
  - File: `packages/db/src/curriculum/curriculum.test.ts` (extend)
  - Add: `assertCurriculumInvariants()` still passes on the shipped curriculum; a synthetic `vocab` entry with `clozeUnsuitable:true` makes `assertCurriculumInvariants([...])` throw the new message; `getGrammarPoint('tr-a2-converbs')` (and the other three keys) has `clozeUnsuitable === true`.
  - Purpose: gate the invariant and the data flags.
  - _Leverage: existing `assertCurriculumInvariants` / `getGrammarPoint` test patterns in this file._
  - _Requirements: 1.5, 1.6_

### R2–R4 — Generation-prompt guardrails

- [x] 7. Strengthen the CEFR vocabulary-band rule in the generation prompt
  - File: `packages/ai/src/generation-prompts.ts` (`GENERATION_SYSTEM_PROMPT_TEMPLATE`)
  - Expand the existing line *"Vocabulary outside CEFR {{cefrLevel}} is forbidden unless the exercise explicitly tests it"* into an explicit rule: every content word must be high-frequency everyday vocabulary at/below `{{cefrLevel}}`; the **target grammatical form/construction is the only element that may be challenging**; non-target above-level words or structures are forbidden. Preserve the carve-out that the **target construction itself is exempt**, and keep the wording consistent with (not contradicting) the existing per-draft frequency seed-word injection in `buildGenerationUserPrompt`. Use only static text and the existing `{{cefrLevel}}` var — introduce no new `{{var}}`.
  - Purpose: cut the #1 flag driver (level mismatch).
  - _Leverage: existing hard-constraints block; `{{cefrLevel}}` var already in `computeGenerationPromptVars`._
  - _Requirements: 2.1, 2.2, 4.4_

- [x] 8. Add the content-safety / neutral-topic guardrail bullet
  - File: `packages/ai/src/generation-prompts.ts` (continue from Task 7)
  - Add a hard-constraint bullet instructing the model to avoid weapons/explosives (e.g. `bomba`), alcohol, violence, and culturally-sensitive/stereotyping topics, and to prefer neutral everyday contexts (home, food, daily routine, travel, weather, study/work). Static text only.
  - Purpose: remove wasted generate→reject spend on safety vetoes; additive to the validator's veto.
  - _Leverage: existing hard-constraints bullet list._
  - _Requirements: 3.1, 3.3_

- [x] 9. Tighten accusative definiteness forcing and `acceptableAnswers` enumeration
  - File: `packages/ai/src/generation-prompts.ts` (continue from Task 8)
  - In the "Turkish case clozes" bullet, reorder the accusative disambiguation so it **prefers in-sentence structural forcing** (prior mention / uniquely-identifiable referent / possessive) and demotes `glossEn` to an explicit fallback; add the worked example `"Denizde büyük bir dalga vardı. Çocuklar ___ gördü. (dalga)" → dalgayı`; keep the forcing in the sentence/context (never `instructions`) and obeying Task 7's vocab band. Reinforce the existing "One correct fill, or enumerate them" / "Ambiguous blank" rules so translations with multiple natural renderings and alternant-bearing clozes (`koşa koşa`/`koşarak`, `gezmek`/`gezme`) MUST populate `acceptableAnswers`. Static text only.
  - Purpose: cut the top flag tag (ambiguity); eliminate "correct answer marked wrong".
  - _Leverage: the existing accusative/`glossEn` rule, "One correct fill" and "Ambiguous blank" bullets._
  - _Requirements: 4.1, 4.2, 4.3, 4.5_

- [x] 10. Bump `GENERATION_PROMPT_VERSION` once
  - File: `packages/ai/src/generation-prompts.ts` (continue from Task 9)
  - Change `GENERATION_PROMPT_VERSION` to `generate@2026-05-30` — a single bump covering Tasks 7–9.
  - Purpose: cohort new-vs-old traces; clear prompt-version suppression so cells regenerate against the new body.
  - _Leverage: existing `GENERATION_PROMPT_VERSION` constant._
  - _Requirements: 2.3, 3.2, 4.6 (NFR Prompt Versioning & Sync)_

- [x] 11. Pin the prompt edits with tests
  - File: `packages/ai/src/generation-prompts.test.ts` (extend)
  - Confirm the existing "GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity" block still passes (no new vars → `missingVars` stays empty). **Add (do not replace)** assertions alongside the existing version-format test (`generation-prompts.test.ts:199–202`, the `/^generate@\d{4}-\d{2}-\d{2}$/` check): that the template contains the new guardrail phrases (a vocab-band phrase, a safety phrase, the `dalgayı` accusative example) and that `GENERATION_PROMPT_VERSION === 'generate@2026-05-30'`.
  - Purpose: gate the prompt change and protect cache-prefix byte-parity.
  - _Leverage: the existing byte-parity `assertParity` helper and template snapshot assertions._
  - _Requirements: 2.4, 2.3/3.2/4.6_

### Verification

- [x] 12. Run the full pre-push suite and fix any failures
  - Files: none new — run from repo root.
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test`; resolve any failures introduced by Tasks 1–11 (curriculum gate, cells, cell-targets, curriculum.test, generation-prompts byte-parity, seed-exercises). Confirm zero failures.
  - Purpose: enforce CLAUDE.md pre-push gate before opening the PR.
  - _Leverage: existing root scripts (`pnpm lint` / `typecheck` / `test`)._
  - _Requirements: all (NFR Maintainability / Compatibility)_
