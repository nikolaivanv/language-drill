# TR A1 Dictation: validator level-scope + seed-word diversity

**Date:** 2026-06-23
**Status:** Approved

## Problem

The TR A1 dictation pool is stuck at **6 servable exercises** (auto-approved + audio-ready); **7 more are flagged**, all for the same reason: `level-mismatch`. The generated clips use `consonant softening` (kitap→kitabı), `accusative -ı`, possessives, and present-continuous `-iyor` — which the dictation **validator** rules A2 on its own judgment.

But those features **are A1 curriculum points** (`tr-a1-stem-changes` = "consonant softening & vowel drop", `tr-a1-present-continuous`). The validator flags them only because it receives **no curriculum context** — unlike grammar-anchored types (cloze/translation/SC/conjugation), which get a `levelScopePoints` list ("treat anything in/below this scope as level-appropriate").

Two root causes:
1. **Validator over-rejects on level** — dictation is the one generated type that never received the level-scope list (and the generator likewise).
2. **Low diversity** — dictation is the only generated type with neither a frequency seed nor an avoid-list; it relies solely on an 8-domain rotation, so drafts collapse onto "reading a book at home."

A third, separate fact: with **6 approved against a per-cell target of 6**, the scheduler computes `need = 0` and generates nothing — so even a fix would not refill the pool without raising the target.

## Design

Two changes, both reusing existing machinery — no new generation mode, no new infra.

### A. Validator + generator level-scope

The spec already carries `levelScopePoints` (`run-one-cell.ts:654`, populated for every cell). Only the ai-side formatter (`renderLevelScopeSection`, gated to 4 grammar-anchored types) excludes dictation.

- `packages/ai/src/level-scope.ts` — add `ExerciseType.DICTATION` to `LEVEL_SCOPE_TYPES`.
- `packages/ai/src/dictation-validation-prompts.ts` — add a `{{levelScopeSection}}` block to the template; render it from `spec.levelScopePoints`; change the `levelMatch` instruction to *"if a grammar-scope list is provided, use it as ground truth for what a learner at this level has studied"* (mirrors `validation-prompts.ts:123`); bump `DICTATION_VALIDATION_PROMPT_VERSION` → `dictation-validate@2026-06-23`.
- `packages/ai/src/dictation-generation-prompts.ts` — add the same `{{levelScopeSection}}` block; render from `inputs.levelScopePoints`; bump `DICTATION_GENERATION_PROMPT_VERSION` → `dictation-generate@2026-06-23`.

This recovers **level-mismatch false-positives only**. Drafts with genuine quality issues (title↔reference mismatch, "tested feature not in surface text") stay flagged — correctly.

### B. Seed-word diversity (match cloze/translation)

- `packages/db/src/generation/run-one-cell.ts` — `seedKindFor` returns `'frequency'` for `DICTATION`. `buildSeedWords` then loads the level's frequency band (`vocab_lemma`, now populated: 12k TR lemmas) and picks per-ordinal seeds with `batchSeed` rotation. **No avoid-list** (decision: match cloze/translation, not vocab_recall) — `priorSeeds` stays the empty set for dictation.
- `packages/ai/src/dictation-generation-prompts.ts` — `buildDictationGenerationUserPrompt` accepts a per-ordinal `seedWord` and renders a **loose-mode** instruction: *"build the clip around the word X, or a closely related word of similar frequency if it doesn't fit naturally."* The existing `dictationDomainForOrdinal` rotation stays as a secondary topical axis.
- `packages/ai/src/generate.ts` — pass `spec.seedWords?.[ordinal] ?? null` into `buildDictationGenerationUserPrompt` (currently only non-dictation paths pass the seed).

### Target + retrigger

- `packages/db/src/curriculum/tr.ts` — set `targetOverride: 15` on the `tr-a1-dictation` grammar point (per-point, **TR-only**; leaves ES/DE A1 dictation at the table default of 6). Bump `CURRICULUM_VERSION` to clear the `tr-a1-dictation` low-yield suppression and ship the override.

## Rollout

1. Merge → `pnpm push-prompts` the two dictation system templates to dev + prod (template text changed).
2. Deploy carries the `CURRICULUM_VERSION` bump; the next ~04:00 UTC scheduler run sees `need = 15 − 6 = 9` for `tr-a1-dictation` and regenerates with level-aware validation + seed diversity.
3. The existing 7 flagged rows: leave them (excluded from serving; new clips use different seed lemmas → no dedup collision). Optional, non-blocking: revalidate via `docs/runbooks/prompt-update-and-revalidate.md` to recover the pure level false-positives.
4. Review tomorrow; if good, raise targets and add overrides for other languages/levels.

## Tests

- `dictation-validation-prompts.test.ts` — level-scope section + var rendered; level instruction present.
- `dictation-generation-prompts.test.ts` — level-scope section rendered; user prompt renders the seed word (loose mode).
- `run-one-cell` tests — `seedKindFor(dictation) === 'frequency'`; dictation cell gets `seedWords`.
- `generate` tests — dictation draft path passes the per-ordinal seed.
- `cell-targets` / curriculum tests — `tr-a1-dictation` resolves to 15.

## Out of scope

Translation-reuse as a dictation source (a new generation mode + TTS register concerns); free-writing's title-only dedup looseness; raising targets for other cells (a follow-up after the TR A1 trial).
