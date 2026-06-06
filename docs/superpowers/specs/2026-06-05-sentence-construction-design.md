# Sentence Construction (Exercise #4) — Design Spec

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Strategy reference:** `docs/exercise-strategy.md` §4; `docs/exercise-generation-plan.md` Phase 6

## Summary

Add **Sentence Construction** as the fourth exercise type. The learner is given a
prompt — a set of keywords, a real-life situation, or an explicit grammar target —
and constructs a full sentence (free text) that satisfies it. It is the documented
Phase 2 next step: high learning impact (grammar *range*, not just accuracy), low
technical complexity because it reuses the existing generation → validation →
evaluation pipeline and the free-text submission UI.

The exercise bridges guided production (Cloze: fill one blank) and free production
(Paragraph: write everything), and is the natural warm-up for Free Writing (#6),
which shares its evaluation shape.

## Locked decisions

These were resolved during brainstorming and are load-bearing for the sections below.

1. **All three prompt modes** ship in v1: `keywords`, `situation`, `grammar_target` —
   one content shape discriminated by a `promptMode` field.
2. **Store 2–3 model answers** per exercise. They give the validator a concrete
   satisfiability check, power instant hints with no extra Claude call, and reinforce
   "multiple valid answers" for the learner.
3. **Opt-in per grammar point** via a new curriculum flag. Only flagged grammar points
   generate Sentence Construction cells. Mirrors the existing `clozeUnsuitable` pattern
   (but as an opt-in, not an opt-out).
4. **Mode is content variety, not a cell dimension.** One Sentence Construction cell per
   flagged grammar point; each generation batch produces a mix of the three modes. The
   cell-key shape is unchanged.
5. **No `EvaluationResult` change, no DB migration.** The shared evaluation tool/result
   is type-agnostic; `exercises.type` is a free `text` column and `content_json` is
   schema-agnostic `jsonb`.
6. **v1 curriculum flagging is a small curated set** (~3–5 grammar points per language,
   spanning A2–B2) to prove the pipeline end-to-end; broader flagging follows in later
   PRs.
7. **"Show an example" reveal ships in v1**, sourced from the stored `modelAnswers` (no
   marginal cost since the answers are already stored).

## Architecture

A new exercise type plugs into a small set of well-defined extension points. The enum
`ExerciseType` is the single source of truth; four `switch` statements use a TypeScript
`never` exhaustiveness check, so the compiler forces every dispatch site to be covered.

### 1. Content shape — `packages/shared/src/index.ts`

```ts
export enum ExerciseType {
  CLOZE = "cloze",
  TRANSLATION = "translation",
  VOCAB_RECALL = "vocab_recall",
  SENTENCE_CONSTRUCTION = "sentence_construction", // NEW
}

export type SentenceConstructionContent = {
  type: ExerciseType.SENTENCE_CONSTRUCTION;
  instructions: string;              // e.g. "Write one sentence in Spanish."
  promptMode: "keywords" | "situation" | "grammar_target";
  prompt: string;                    // the rendered task shown to the learner
  keywords?: string[];               // required & non-empty iff promptMode === "keywords"
  targetStructure?: string;          // human label for grammar_target mode (e.g. "past subjunctive")
  register?: "informal" | "neutral" | "formal";  // optional constraint
  modelAnswers: string[];            // 2–3 valid example sentences
  topicHint?: string;
};
```

- Added to the `ExerciseContent` union.
- New `isSentenceConstructionContent()` type guard, mirroring the existing three.
- Field invariants (`keywords` non-empty for keywords mode; `modelAnswers.length` in 2..3)
  are enforced at runtime in the generation parser, following the codebase convention
  (plain TS types + parser validation, no Zod in this layer).
- The target grammar point is carried by `grammar_point_key` / `exercise_tags` as for
  every type, so it is not duplicated inside `content`.

### 2. Evaluation — `packages/ai/src/{evaluate,prompts}.ts`

- **No schema change.** Returns the shared `EvaluationResult`
  (`score`, `grammarAccuracy`, `vocabularyRange`, `taskAchievement`, `feedback`,
  `errors`, `estimatedCefrEvidence`). The shared `EVALUATION_TOOL` is type-agnostic.
- Add `buildSentenceConstructionUserPrompt()` in `prompts.ts` and a case in the
  `buildUserPrompt()` switch (the `never` check forces it).
- The prompt hands Claude: the rendered prompt, `promptMode`, `keywords` (if present),
  the target grammar point, `register`, and the learner's sentence. It instructs Claude
  to:
  - fold "all keywords used / target structure used / communicative goal achieved" into
    `taskAchievement`;
  - award a complexity bonus when the learner reaches beyond the minimum (e.g. a
    subordinate clause where a simple sentence sufficed);
  - still flag errors outside the target grammar point (don't ignore a wrong article
    just because the target was the subjunctive).

### 3. Generation — `packages/ai/src/{generate,generation-prompts}.ts`

- `TOOL_NAME_BY_TYPE`: add `sentence_construction: "submit_sentence_construction_exercise"`.
- New `SENTENCE_CONSTRUCTION_GENERATION_TOOL` whose input schema emits
  `{ promptMode, prompt, keywords?, targetStructure?, register?, modelAnswers }`
  (modelAnswers: 2–3 items). Added to `GENERATION_TOOL_BY_TYPE`.
- New `parseGeneratedSentenceConstructionDraft()` enforcing the field invariants, plus a
  case in `parseToolInput()`'s switch.
- **Mode variety:** the generation system prompt instructs the model to vary `promptMode`
  across the batch and to choose a mode that suits the grammar point; the chosen mode is
  returned in the tool output. The `recentStems`-style in-batch diversification (already
  used by other types) keeps prompts distinct.
- `canonicalSurface()` (in `generation-prompts.ts`): add a case returning the normalized
  `prompt` as the dedup key (mirrors translation's `sourceText`).

### 4. Validation — `packages/ai/src/validation-prompts.ts`

- Add `buildSentenceConstructionValidationUserPrompt()` and a switch case (uses the shared
  `VALIDATION_TOOL`).
- The validator checks: the prompt is well-formed and unambiguous; it is satisfiable at the
  target CEFR level; **each of the 2–3 stored model answers actually satisfies the prompt
  and uses the target structure / keywords**; level match; grammar-point match. The stored
  model answers are what make this a strong, concrete check rather than a judgment of an
  empty prompt.

### 5. Routing & curriculum — `cells.ts`, `curriculum-types.ts`, `curriculum/{es,de,tr}.ts`

- Add optional `sentenceConstructionSuitable?: boolean` to `GrammarPoint`
  (`packages/shared/src/curriculum-types.ts`). Absent/`false` ⇒ no Sentence Construction
  cell. Opt-in, valid only on `kind: 'grammar'` entries.
- `compatibleTypes()` in `packages/db/src/generation/cells.ts`: for grammar points, append
  `ExerciseType.SENTENCE_CONSTRUCTION` when the flag is set. (Vocab umbrellas are
  unaffected.)
- **v1 authoring:** set the flag on a small curated set (~3–5 grammar points per language,
  spanning A2–B2) chosen so free production of the structure is pedagogically apt. Broader
  flagging is a follow-up. The scheduler/CLI and `--max-cost-usd` control actual spend.

### 6. Web UI — `apps/web/app/(dashboard)/drill/_components/`

- New `sentence-construction-exercise.tsx`, modeled on `translation-exercise.tsx`:
  renders `instructions` + `prompt`, keyword chips (keywords mode), a register/structure
  hint when present, and a multi-line free-text input; submits to the existing flow and
  renders the returned `EvaluationResult`.
- A **"Show an example"** affordance and the **post-submission alternatives** both draw
  from the stored `modelAnswers` — no extra Claude call.
- Add `if (isSentenceConstructionContent(content)) return <SentenceConstructionExercise … />`
  to the dispatcher in `exercise-pane.tsx`.

### 7. Tests

Following the project convention (tests next to the module, extend existing files):

- `packages/ai/src/generate.test.ts` — tool-name DRY check + `parseGeneratedSentenceConstructionDraft` cases (valid, missing keywords for keywords mode, wrong `modelAnswers` count).
- `packages/ai/src/evaluate.test.ts` — a `sentenceConstructionContent` fixture + `buildUserPrompt` test.
- `packages/ai/src/validate.test.ts` / validation-prompts — model-answer satisfiability prompt assembly.
- `packages/db/src/generation/cells.test.ts` — flagged point yields a Sentence Construction cell; unflagged point does not.
- `apps/web/.../__tests__/sentence-construction-exercise.test.tsx` — render + submit + example reveal.

### 8. Prompt-version & deploy notes

If the shared **system** prompts are edited to mention the new type, bump the matching
`*_PROMPT_VERSION` constants in the same commit per `CLAUDE.md`
(`GENERATION_PROMPT_VERSION`, `VALIDATION_PROMPT_VERSION`, `EVALUATION_SYSTEM_PROMPT_VERSION`),
and run the Langfuse `push-prompts` sync per environment as a post-merge deploy step.
The new per-type **user** prompts are in-repo code and require no Langfuse sync.

## Data flow

```
Generation (scheduled/CLI, per flagged grammar cell)
  → generateBatch(spec) emits N drafts, modes mixed
  → parseGeneratedSentenceConstructionDraft validates each draft's shape
  → validateDraft checks prompt + model answers + level + grammar match
  → router: auto-approved | flagged | rejected
  → insert into exercises (type='sentence_construction', content_json=…)

Runtime (learner does the exercise)
  → exercise-pane dispatches to SentenceConstructionExercise
  → learner types a sentence → submit
  → evaluateAnswer → shared EvaluationResult → feedback + model-answer alternatives
  → standard mastery/Bayesian update on the tagged grammar point(s)
```

## Out of scope (v1)

- The full progressive-hint scoring-weight system (cross-cutting; not built for any type yet).
- Error Correction (#5).
- Backfilling the entire curriculum with the `sentenceConstructionSuitable` flag.
- Per-mode pool-depth tracking (deliberately rejected — mode is content variety).

## File-change checklist

| Area | File | Change |
|---|---|---|
| Enum + content | `packages/shared/src/index.ts` | enum value, `SentenceConstructionContent`, union, type guard |
| Curriculum type | `packages/shared/src/curriculum-types.ts` | `sentenceConstructionSuitable?` flag |
| Eval prompt | `packages/ai/src/prompts.ts` | builder + switch case |
| Generation | `packages/ai/src/generate.ts` | tool-name map, tool schema, parser, `parseToolInput` case |
| Generation prompt | `packages/ai/src/generation-prompts.ts` | system-prompt mode guidance, `canonicalSurface` case |
| Validation prompt | `packages/ai/src/validation-prompts.ts` | builder + switch case |
| Routing | `packages/db/src/generation/cells.ts` | append type when flag set |
| Curriculum data | `packages/db/src/curriculum/{es,de,tr}.ts` | flag the curated v1 set |
| Web component | `apps/web/.../drill/_components/sentence-construction-exercise.tsx` | new |
| Web dispatch | `apps/web/.../drill/_components/exercise-pane.tsx` | guard branch |
| Tests | the five test files above | extend / add |
