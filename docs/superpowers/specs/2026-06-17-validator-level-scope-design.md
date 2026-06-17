# Curriculum-grounded CEFR level scope for generator + validator

**Date:** 2026-06-17
**Status:** Approved (design)
**Worktree/branch:** `worktree-feat+validator-level-scope`

## Problem

The exercise generator and validator both judge CEFR level-appropriateness from
**only the single target grammar point + a generic one-line-per-level CEFR
descriptor** (`packages/ai/src/prompts.ts` `CEFR_LEVEL_DESCRIPTORS`). Neither
prompt receives the curriculum, a list of what grammar/vocabulary is in scope at
the level, or even the sibling points at the same level. So `levelMatch` is
decided by the model's own (vague, drifting) sense of "what A2 means."

Consequence: **spurious level-mismatch rejections.** A draft that is genuinely
in-scope gets `levelMatch=false` because the validator's private notion of the
level diverges from the actual curriculum — e.g. it flags obligatory Turkish
morphology (vowel harmony, agglutination) as "too advanced," or penalizes a
construction merely for not being the target point. The generator and validator
are independent LLM calls with **no shared ground truth**, so they can disagree.

This affects all grammar-anchored types, not just free-writing.

## Goal

Give both the generator and the validator a **curriculum-derived "level scope"**
— the grammar points a learner at or below the target level has studied — so
`levelMatch` becomes "does this exceed the known scope?" instead of "does this
feel like the level?". Reduce false rejections without admitting genuinely
too-hard drafts.

Scope of this change (per design decisions):
- **Both** the generation and validation system prompts.
- **Grammar-anchored exercise types only**: `cloze`, `translation`,
  `sentence_construction`, `conjugation`. (`vocab_recall`, which shares
  `generation-prompts.ts`, plus free-writing/dictation/theory, are untouched.)

## Non-goals (YAGNI)

- Injecting `prerequisiteKeys` (the at/below-level list already subsumes them).
- Grounding `vocab_recall`, `dictation`, `free_writing`, or `theory`.
- A per-word vocabulary/frequency band (we have no such data).
- Changing the answer-**evaluation** prompt (`prompts.ts` evaluation), which is
  separate from generation validation.

## Design

### 1. Curriculum data helper (`packages/db`)

Add a pure helper (in `packages/db/src/curriculum/index.ts`, exported from the
package root):

```ts
function grammarPointsAtOrBelow(
  language: LearningLanguage,
  level: CurriculumCefrLevel,
): readonly GrammarPoint[]
```

- Orders levels by the existing `ROUND_1_CEFR_LEVELS = ['A1','A2','B1','B2']`
  (`packages/db/src/generation/cells.ts:26`). Add a small internal rank lookup
  from that array; throw/return empty for out-of-round levels (C1/C2 not in
  scope).
- Filters the language's curriculum array (`esCurriculum`/`trCurriculum`/
  `deCurriculum`, each `readonly GrammarPoint[]`) to `kind === 'grammar'`,
  matching `language`, with `rank(cefrLevel) <= rank(level)`.
- Returns points in curriculum order (stable). No formatting — that's a prompt
  concern.

### 2. Formatting + injection (`packages/ai`)

A renderer in `packages/ai` (alongside the other `render*Section` helpers in
`generation-prompts.ts`, reused by validation):

```ts
function renderLevelScopeSection(
  exerciseType: ExerciseType,
  language: Language,
  cefrLevel: CefrLevel,
): string
```

- Returns `""` unless `exerciseType` is one of `cloze`, `translation`,
  `sentence_construction`, `conjugation` — this is the **gate** (same
  conditional-omit pattern as `renderPriorPoolSection`/
  `renderSentenceConstructionSection`). Empty string → the `{{levelScope}}`
  placeholder collapses and the section disappears, leaving the cached prompt
  prefix unchanged for the untouched types.
- Otherwise calls `grammarPointsAtOrBelow(language, cefrLevel)`, groups names by
  level, and emits:

```
## Grammar in this learner's scope (CEFR ≤ {{cefrLevel}}, {{language}})

Treat any grammar or vocabulary within or below this scope as level-appropriate.

- A1: <name>; <name>; …
- A2: <name>; <name>; …

```

  (Trailing blank line so the template splices cleanly, like the other
  sections.) Names only — short and cached.

**Computed inside the prompt-var functions, not threaded through callers:**

- `computeGenerationPromptVars(inputs, recentStems)` (`generation-prompts.ts`)
  adds `levelScope: renderLevelScopeSection(inputs.exerciseType, inputs.language, inputs.cefrLevel)`
  to its returned vars. No change to `GenerationPromptInputs` or `runOneCell`.
- `computeValidationPromptVars(spec)` (`validation-prompts.ts`) adds the same,
  from `spec.exerciseType/language/cefrLevel`. No change to `GenerationSpec`.

Determinism: the curriculum is static, so both functions remain deterministic in
their inputs — the existing "same inputs → identical bytes" tests still hold, and
the block is stable per `(language, level)` so prompt-cache hits are preserved
across ordinals within a cell.

### 3. Prompt text changes

**Generation** (`GENERATION_SYSTEM_PROMPT_TEMPLATE`): splice the
`{{levelScope}}` section right after `{{cefrDescriptors}}` (before
`{{priorPoolSection}}`), and add one hard-constraint line:

> Keep all grammar and vocabulary within the learner's scope listed above; do
> not require constructions above CEFR {{cefrLevel}}.

**Validation** (`VALIDATION_SYSTEM_PROMPT_TEMPLATE`): splice the
`{{levelScope}}` section after `{{cefrDescriptors}}` (before "Dimensions to
score"), and reword the `levelMatch` dimension from the current
*"does the difficulty match {{cefrLevel}}?"* to:

> **levelMatch** (boolean): Use the in-scope grammar list above as the ground
> truth for what the learner has studied. Set `false` only if the exercise
> **requires** a grammatical construction clearly **above** CEFR {{cefrLevel}}
> (beyond the scope), or is trivially **below** it. Do NOT set `false` merely
> because a construction is not the target point — anything within or below the
> learner's scope is fair game. Obligatory morphology inherent to {{language}}
> (e.g. Turkish vowel harmony and agglutination) is never "above level."

The two-sided nature of `levelMatch` (too-hard / too-easy) is preserved; the
"too-hard" side is now grounded by the scope.

### 4. Version bumps + Langfuse push (REQUIRED post-merge)

Both system prompts are Langfuse-registered and fetched at runtime via
`getPromptWithVarsOrFallback` (`prompts-registry.ts`), so the in-repo edit alone
does not change live behavior.

- Bump `GENERATION_PROMPT_VERSION` (`generation-prompts.ts`) and
  `VALIDATION_PROMPT_VERSION` (`validation-prompts.ts`) to today's date in the
  same commit as the template edits (per `CLAUDE.md`).
- **After merge**, run `push-prompts` for `generate-system-prompt` and
  `validate-system-prompt` against **both dev and prod** Langfuse projects (the
  documented procedure in `CLAUDE.md`). Until pushed, the runtime serves the old
  body. This is a real deployment step (unlike a code-only/uncached change).

## Tests

- **`packages/db`** (`curriculum.test.ts`): `grammarPointsAtOrBelow` returns the
  correct at/below-level grammar set for a sample (e.g. TR A2 includes A1+A2
  grammar points, excludes vocab/dictation/free-writing kinds and B1+; ES B1
  includes A1?/A2?/B1 grammar — note ES A1/A2 grammar is currently disabled, so
  assert against actual data).
- **`packages/ai`** (`generation-prompts.test.ts`, `validation-prompts.test.ts`):
  - The rendered system prompt contains the level-scope header + a known
    in-scope point name for a grammar-anchored type.
  - The section is **absent** for `vocab_recall` (gate works).
  - The validator template includes the reworded `levelMatch` guidance and the
    obligatory-morphology carve-out.
  - Determinism / byte-parity tests stay green.

## Verification

- **`eval:gen` A/B**: baseline = `main` (scope off) vs candidate = this branch
  (scope on), over a dataset built with `eval:gen:export` biased to cells that
  previously had level-related rejections (and a TR A1/A2 cell, where the
  vowel-harmony false-rejection is most likely). Expect approval-rate **up** and
  level/`levelMatch`-related rejection reasons **down**, with no rise in genuine
  quality flags. Since the validator change is in-repo code, A/B by comparing the
  branch against a `main` checkout/stash (same approach as a code-only change).
- **Manual spot-check**: feed a previously-spuriously-rejected draft through the
  validator with and without the scope and confirm the verdict flips correctly.
- Full gate: `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1`.

## Affected files

| File | Change |
|---|---|
| `packages/db/src/curriculum/index.ts` | add `grammarPointsAtOrBelow` helper + export |
| `packages/db/src/curriculum/curriculum.test.ts` | helper tests |
| `packages/ai/src/generation-prompts.ts` | import db helper; `renderLevelScopeSection`; add `levelScope` var; template `{{levelScope}}` + hard-constraint line; bump `GENERATION_PROMPT_VERSION` |
| `packages/ai/src/validation-prompts.ts` | add `levelScope` var; template `{{levelScope}}` + reworded `levelMatch`; bump `VALIDATION_PROMPT_VERSION` |
| `packages/ai/src/generation-prompts.test.ts` | scope-present / gate / determinism assertions |
| `packages/ai/src/validation-prompts.test.ts` | scope-present + reworded-levelMatch assertions |

Post-merge (not a code change): `push-prompts` to dev + prod Langfuse.
