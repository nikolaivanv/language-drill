# Conjugation / Inflection Drill (Exercise #14) — Design Spec

**Date:** 2026-06-16
**Status:** Approved design, pre-implementation
**Strategy reference:** `docs/exercise-strategy.md` §14

## Summary

Add **Conjugation / Inflection Drill** as the seventh `ExerciseType`. The learner is
given a **lemma + an explicit feature bundle** and must produce the inflected wordform
(free text, no options): e.g. `ir` + "condicional · 1ª persona del plural" → `iríamos`.

It isolates **form *production*** (the morphological machinery) from **form
*selection*** (which tense/mood/case the context demands) — the signal cloze and
translation fuse and therefore cannot attribute. An error here is unambiguously a
*formation* failure.

Per the strategy doc, this is **morphology-repair scaffolding, not standalone main
practice**: a decontextualized paradigm drill sits below the intermediate plateau the
app targets. This build ships the reusable *mechanism* (type + pool generation +
deterministic grading + renderer) and surfaces it as an **opt-in warm-up / explicit
drill**, explicitly NOT woven into the adaptive rotation. The documented
auto-remediation hook (cloze eval detects formation-vs-selection error → surfaces an
inline conjugation repair) is a clean follow-up that builds on this.

It is the cheapest exercise in the catalogue to run: **deterministic grading means $0
evaluation cost** (no Claude round-trip, no `ai_evaluation` bucket spend).

## Locked decisions

Resolved during brainstorming; load-bearing for the sections below.

1. **Scope = type now, remediation later.** Build the full `ExerciseType` (pool
   generation, deterministic local grading, web renderer, curriculum tagging) and
   surface it opt-in. Auto-remediation surfacing and weaving into adaptive rotation are
   a documented follow-up, out of scope for this branch.
2. **Languages = ES + TR + DE.** Each proves a distinct paradigm (ES verb conjugation /
   irregular stems; TR agglutinative suffix-stacking under vowel harmony; DE strong-verb
   Präteritum). **EN is excluded** (thin morphology, low yield per the strategy doc).
3. **Deterministic-only grading in v1.** Exact match against `targetForm ∪
   acceptableForms` via the existing `normalizeFluencyAnswer` (diacritics preserved;
   Turkish İ/I case-fold accepted as-is). No Claude variant-fallback. Accepted variants
   are enumerated at *generation* time and verified at *validation* time.
4. **Feature bundle is a display string; structured tagging reuses coverage axes.**
   Tense/mood is *implied by the grammar point* (e.g. `es-b1-present-subjunctive`); the
   drill varies person/number (and polarity for TR), captured by the existing `person` /
   `polarity` coverage tags. No parallel feature schema.
5. **Conjugation rides the existing pool pipeline uniformly** with cloze/translation/
   vocab/sentence-construction — new branches in the shared generation + validation
   prompts, not a separate prompt file. A validation pass **verifies the stored form is
   morphologically correct**, because deterministic grading trusts that value.
6. **Opt-in surfacing = a dedicated `/drill/conjugation` entry**, mirroring how
   `/drill/free-writing` is its own route. NOT added to the adaptive `today-plan`
   selection.
7. **v1 curriculum flagging is a small curated set** (~2–3 morphology-heavy grammar
   points per language) to prove the pipeline end-to-end; broader flagging follows later.

## Architecture — integration points

Adding an `ExerciseType` ripples across `shared`, `ai`, `db`, `infra/lambda`, and
`apps/web`. Each point below is a concrete file the implementation must touch.

### 1. Type & content shape — `packages/shared`

- **`src/index.ts`**
  - Add `CONJUGATION = "conjugation"` to the `ExerciseType` enum.
  - Add the `ConjugationContent` type to the discriminated union:

    ```ts
    export type ConjugationContent = {
      type: ExerciseType.CONJUGATION;
      instructions: string;        // "Write the correct form."
      lemma: string;               // citation form: "ir" / "fahren" / "gitmek"
      lemmaGloss: string;          // L1 meaning: "to go"
      featureBundle: string;       // display label: "condicional · 1ª pers. plural"
      targetForm: string;          // canonical answer: "iríamos"
      acceptableForms?: string[];  // regional/orthographic variants (rare)
      breakdown: string;           // post-answer teaching: stem + ending (ES/DE)
                                   //   or stem + ordered suffix gloss (TR)
      exampleSentences: string[];  // 1–2 short contextual sentences (teaching)
      topicHint?: string;
    };
    ```

  - Add to the `ExerciseContent` union and add `isConjugationContent()` guard.
- **`src/index.test.ts`** — update the exercise-type count assertion 6 → 7 and name the
  new member.

### 2. Grading — deterministic, zero-Claude

- **`packages/shared/src/fluency.ts`**
  - Add `"conjugation"` to `FLUENCY_ELIGIBLE_TYPES` (locally gradable; the ideal fluency
    drill).
  - Add an `isConjugationContent` branch to `gradeFluencyAnswer`: match
    `[targetForm, ...(acceptableForms ?? [])]` via `normalizeFluencyAnswer`.
- **`infra/lambda/src/routes/exercises.ts`** (`POST /exercises/:id/submit`) — add a
  conjugation branch alongside `isDictation` / `isFreeWriting` that **bypasses Claude
  entirely** and synthesizes an `EvaluationResult` locally:
  - binary `score` / `grammarAccuracy` (1 on match, 0 otherwise),
  - the stored `breakdown` + `exampleSentences` as the "every answer teaches" feedback,
  - no `ai_evaluation` usage-bucket increment (no Claude call).
  - Feeds the same Bayesian mastery update on the grammar point as other types.

### 3. Generation + validation — `packages/ai`

- **`src/generate.ts`** — add entries to `TOOL_NAME_BY_TYPE`, `GENERATION_TOOL_BY_TYPE`
  (new `CONJUGATION_GENERATION_TOOL` Anthropic.Tool schema), and a `parseToolInput` case
  that parses + validates the emitted `ConjugationContent`.
- **`src/generation-prompts.ts`** — add a `spec.exerciseType === CONJUGATION` branch to
  the system/user prompt builders. The prompt instructs Claude to emit lemma +
  featureBundle + targetForm + acceptableForms + breakdown + examples for the grammar
  point's implied tense/mood, varied across the coverage axes. **Bump
  `GENERATION_PROMPT_VERSION`.**
- **`src/validation-prompts.ts`** — add a `case CONJUGATION` to `buildValidationUserPrompt`
  whose prompt **verifies the stored `targetForm` is the morphologically correct form**
  for the given lemma + feature bundle (and that `acceptableForms` are genuine variants).
  **Bump `VALIDATION_PROMPT_VERSION`.**
- Routing through `routeValidationResult` (approve/flag/reject) is type-agnostic — no
  change.

### 4. Curriculum — `packages/shared` + `packages/db`

- **`packages/shared/src/curriculum-types.ts`** — add `conjugationSuitable?: boolean` to
  `GrammarPoint` (documented as only valid on `kind: 'grammar'`).
- **`packages/db/src/generation/cells.ts`** — in `compatibleTypes()`, append
  `ExerciseType.CONJUGATION` when `entry.conjugationSuitable` is set (mirrors
  `sentenceConstructionSuitable`).
- **`packages/db/src/curriculum/index.ts`** — add a curriculum invariant:
  `conjugationSuitable` only on `kind: 'grammar'`. Bump `CURRICULUM_VERSION_{ES,DE,TR}`
  so the scheduler enumerates the new cells (per the "curriculum bump to clear low-yield"
  rule).
- **`packages/db/src/curriculum/{es,de,tr}.ts`** — flag ~2–3 morphology-heavy points each
  and ensure each has a `coverageSpec` with a `person` axis (TR negatives also use
  `polarity`). Candidate set (final selection during planning):
  - **ES:** preterite irregulars; present subjunctive.
  - **DE:** strong-verb Präteritum.
  - **TR:** aorist (geniş zaman); a vowel-harmony-bearing tense (e.g. di'li geçmiş).
- **`packages/shared/src/coverage.ts`** — add `CONJUGATION` to the monitoring branch of
  `coverageAxesFor` (monitor `polarity` like other grammar types; `person` comes from the
  cell's `coverageSpec`).

### 5. Serving / surfacing — opt-in, NOT adaptive rotation

- **NOT** added to adaptive selection in `infra/lambda/src/lib/today-plan.ts` selection
  logic. Exhaustiveness entries still required (these are `Record<ExerciseType, …>`):
  `ESTIMATED_MINUTES_BY_TYPE` (short, ~vocab), `ITEM_COUNT_BY_TYPE` (small batch).
- **`infra/lambda/src/lib/progress-aggregation.ts`** — add `CONJUGATION` → grammar axis
  in `axisForExerciseType()`.
- **`apps/web`**
  - New route/entry **`/drill/conjugation`** mirroring `/drill/free-writing`: pick a
    flagged grammar point, drill its forms from the pool.
  - **`drill/_components/exercise-pane.tsx`** — add `isConjugationContent →
    <ConjugationExercise>` branch.
  - New **`drill/_components/conjugation-exercise.tsx`** — single text field + feature-
    bundle prompt; renders the stored `breakdown` + example sentences on submit. Visually
    a near-clone of `vocab-exercise.tsx`.
  - **`(dashboard)/_lib/timeline-labels.ts`** — add a `TYPE_LABELS` entry.

## Data flow

```
Generation (background Lambda)
  scheduler enumerates (lang, level, grammar_point, conjugation) cells
    → generate.ts: Claude emits ConjugationContent (lemma, features, targetForm,
        acceptableForms, breakdown, examples)
    → validation-prompts.ts: second Claude pass verifies targetForm is correct
    → routeValidationResult → approve/flag/reject → stored in exercises.content_json

Serving + submission
  /drill/conjugation → GET exercise (content_json as-is)
    → learner types form
    → POST /exercises/:id/submit
        → deterministic branch: gradeFluencyAnswer-style match (NO Claude)
        → synthesize EvaluationResult locally (binary + stored breakdown feedback)
        → Bayesian mastery update on the grammar point (grammar axis)
```

## Testing

- **`packages/shared`** — type-count assertion (7); `gradeFluencyAnswer` conjugation
  cases (exact match, diacritic-sensitive miss, acceptableForms hit, TR İ/I); guard.
- **`packages/db`** — `compatibleTypes()` appends `conjugation` iff flagged;
  `enumerateCurriculumCells` emits the new cells; curriculum invariant rejects
  `conjugationSuitable` on non-grammar kinds; `assertCurriculumInvariants` passes on the
  shipped curriculum.
- **`packages/ai`** — `parseToolInput` parses/validates a conjugation draft; generation
  + validation prompt builders include the conjugation branch.
- **`infra/lambda`** — submit route grades a conjugation answer deterministically without
  a Claude call and produces a valid `EvaluationResult`; `axisForExerciseType` →
  grammar; exhaustiveness maps cover the new member.
- **`apps/web`** — `exercise-pane` renders `ConjugationExercise`; submit flow shows
  breakdown on result. Grep the app for any `ExerciseType` exhaustive maps the renderer
  change touches.

Per CLAUDE.md: full `pnpm lint && pnpm typecheck && pnpm test` green before push; run
`pnpm turbo run test --concurrency=1` to dodge the known parallel-load flake, and
`rm -rf infra/lambda/dist` to avoid stale compiled test files.

## Out of scope (explicit)

- **Auto-remediation surfacing** — cloze/sentence-construction eval classifying
  formation-vs-selection errors and surfacing an inline conjugation repair. Documented
  follow-up; depends on evaluation-prompt changes.
- **Weaving into the adaptive `today-plan` rotation.**
- **EN conjugation cells.**
- **Claude variant-fallback grading** — deferred; v1 enumerates variants at generation
  time.
