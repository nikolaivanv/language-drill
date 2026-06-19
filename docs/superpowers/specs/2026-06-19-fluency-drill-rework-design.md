# Fluency drill rework — design

**Date:** 2026-06-19
**Status:** approved
**Scope:** web-frontend only (`apps/web`). No backend, schema, grader, or API changes.

## Problem

Fluency mode ships half-baked relative to the standard drill:

1. **No special-character keyboard.** Learners can't type Turkish/Spanish/German
   diacritics, so `degil` is graded wrong against `değil`.
2. **The debrief is virtually empty** — a two-line "nice — that was fast" with no
   session metrics and no per-item recap.
3. **The cloze presentation diverges from the standard cloze drill.** Fluency
   renders a bare prompt string + a plain full-width input. It does **not** show
   the context eyebrow tag, the inline blank, or the meaning gloss that the
   standard `ClozeExercise` shows. This reads as a different, lower-quality
   exercise.
4. **Conjugation is broken in fluency.** `FLUENCY_ELIGIBLE_TYPES` includes
   `conjugation`, but `fluency-item.tsx`'s `promptText()` returns `''` for it, so
   conjugation items render an empty prompt.

Fluency deliberately skips LLM evaluation for speed (deterministic grader in
`packages/shared/src/fluency.ts`). The fix is **visual consistency** with the
standard drill, not reintroducing AI eval.

## Goals

- Fluency looks like a fast, no-feedback sibling of the standard drill: same
  prompt visuals for all three eligible types (cloze, vocab-recall,
  conjugation), special-character keyboard, and a substantive debrief.
- Reuse standard-drill presentational components so the two surfaces can't drift.
- Keep the deterministic (no-LLM) grading path and the timed-recall character of
  the mode intact.

## Non-goals

- No LLM evaluation, no Claude feedback paragraphs.
- No "retry the misses" mini-session (can be a follow-up).
- No backend / DB / grader / endpoint changes.
- No new metrics on the progress → fluency tab (debrief is computed client-side
  from the just-completed session).

## Approach

### 1. Extract shared prompt-presentation components

New directory `apps/web/components/drill/` holds pure presentational components
that render the **prompt area** of each exercise type, consumed by **both** the
standard drill exercises and the new fluency item renderers.

- **`ClozePrompt`** (`components/drill/cloze-prompt.tsx`)
  - Renders: the context eyebrow tag (colored dot + `content.context`), the hero
    `t-display-m` sentence with the **inline-growing blank input**, and the
    meaning gloss (`content.glossEn`). Falls back to the full sentence + a
    standalone field when the sentence has no `___`.
  - Controlled via props: `content`, `answer`, `onAnswerChange`, `blankState`
    (`'idle' | 'filled' | 'correct' | 'wrong'`), `disabled`, `onEnterSubmit`,
    `inputRef`.
  - Exports `BLANK_STATE_CLASS` and the `BlankState` type (moved here from
    `cloze-exercise.tsx`).
  - Does **not** own the accent picker, MC options, submit button, or feedback —
    those stay with each consumer, because they differ between drill and fluency.
- **`VocabPromptCard`** (`components/drill/vocab-prompt.tsx`)
  - Renders the `Card padding="lg"` with the `t-display-s` prompt.
- **`ConjugationPromptCard`** (`components/drill/conjugation-prompt.tsx`)
  - Renders the `Card` with lemma (`t-display-s`), `lemmaGloss`, and
    `featureBundle`.

The standard `ClozeExercise`, `VocabExercise`, and `ConjugationExercise` refactor
to consume these components. The extraction preserves rendered text, element
structure, and ARIA roles, so existing component tests stay valid (re-run to
confirm).

### 2. Fluency item renderers

`fluency-item.tsx` becomes a dispatcher on `content.type`:

- **cloze** → `ClozePrompt` (controlled) + `AccentPicker` + submit/feedback.
- **vocab-recall** → `VocabPromptCard` + standalone `Input` + `AccentPicker` +
  submit/feedback.
- **conjugation** → `ConjugationPromptCard` + standalone `Input` + `AccentPicker`
  + submit/feedback. (Fixes the empty-prompt bug.)

Each renders:
- the elapsed-time line (`X.Xs`) above the prompt, as today;
- `AccentPicker` for ES/DE/TR (the mode's only languages), wired to the item's
  `inputRef`;
- a submit button while unanswered.

**Scaffolds are intentionally omitted** in fluency: cloze MC options and vocab
hint rows both lower production demand and undercut timed recall.

### 3. Post-answer state reuses `FeedbackShell`

Replace the plain `✗ — kalkmıyor · 61.0s` status line with the drill's
`FeedbackShell`:

- `tier`: `sage` when correct, `terracotta` when wrong.
- `label`: `correct` / `not quite`.
- `scoreChipText`: the **latency** (e.g. `4.8s`) — repurposing the chip for a
  speed-oriented mode.
- children: the correct answer (`t-display-m`) plus also-accepted alternatives
  when present.
- `onNext` / `nextLabel` (`next` / `finish`) as today.

For cloze, `blankState` becomes `correct` / `wrong` after grading, so the inline
blank also fills green/terracotta — matching the standard cloze graded look.

`FeedbackShell`'s `useDrillAction()` returns an inert default when no
`DrillActionProvider` is present (it already does this for standalone tests), so
on the fluency page it renders its inline `next` button on every viewport. No
provider is added to fluency.

### 4. Debrief

The runner currently discards per-item outcomes. It will **accumulate** a result
per item and pass the array to `onDone`:

```ts
type FluencyItemResult = {
  index: number;
  type: string;          // ExerciseType
  promptLabel: string;   // sentence (cloze) | prompt (vocab) | lemma · featureBundle (conjugation)
  userAnswer: string;
  correct: boolean;
  correctAnswer: string; // from the attempt response
  latencyMs: number;     // the clamped value the server returned
};
```

A new **`FluencyDebrief`** component (`fluency/_components/fluency-debrief.tsx`)
renders, entirely from this array (no new API):

- **Headline metrics:**
  - median latency this session (`X.Xs`),
  - accuracy (`N / M correct`),
  - fastest and slowest item latency,
  - the existing pointer: "Your latency trend is on the progress page → fluency
    tab."
- **Per-item recap list:** one row per item — ✓/✗ with tier tint (sage / 
  terracotta), the `promptLabel`, the user's answer, the correct answer when
  wrong, and the per-item latency.

The page swaps the current inline "done" block for `<FluencyDebrief results=… />`.

## Components & boundaries

| Unit | Responsibility | Consumed by |
|---|---|---|
| `components/drill/cloze-prompt.tsx` | Cloze prompt visual (eyebrow + inline blank + gloss); exports `BLANK_STATE_CLASS`, `BlankState` | `ClozeExercise`, fluency cloze item |
| `components/drill/vocab-prompt.tsx` | Vocab prompt card | `VocabExercise`, fluency vocab item |
| `components/drill/conjugation-prompt.tsx` | Conjugation prompt card | `ConjugationExercise`, fluency conjugation item |
| `fluency/_components/fluency-item.tsx` | Per-type fluency item: prompt + accent keys + timer + submit + `FeedbackShell` | `FluencyRunner` |
| `fluency/_components/fluency-runner.tsx` | Timer + grading round-trip + **per-item result accumulation** | `FluencyPage` |
| `fluency/_components/fluency-debrief.tsx` | Headline metrics + per-item recap from the result array | `FluencyPage` |

## Data flow

```
FluencyPage
  └─ FluencyRunner (timer, submit → /fluency/attempts, accumulate results[])
       └─ FluencyItem (dispatch by type → shared prompt + AccentPicker + FeedbackShell)
  └─ on done → FluencyDebrief(results[])  // client-side metrics, no API
```

Grading, latency clamping (60s ceiling), and the `/fluency/*` endpoints are
unchanged.

## Error handling

- Network error on submit keeps today's behavior: the item stays answerable and
  the timer restarts from now (so retry latency reflects fresh think-time).
- A result is only accumulated once a verdict is received, so a failed submit
  contributes no row to the debrief.
- Debrief metrics guard against an empty/edge result set (e.g. session abandoned
  with zero answered items renders nothing rather than dividing by zero).

## Testing

- **Unit:** update `fluency-item` / `fluency-runner` tests for the new dispatch,
  accent picker presence, `FeedbackShell` post-answer state, and result
  accumulation. New `fluency-debrief` test for metric math (median/accuracy/
  fastest/slowest) and the recap rows.
- **Drill components:** re-run `cloze-exercise` / `vocab-exercise` /
  `conjugation-exercise` tests to confirm the prompt extraction is transparent.
- **E2E:** verify `apps/web/e2e/tests/authenticated/fluency.spec.ts` selectors
  still match (verdict now lives in `FeedbackShell`); update if needed.
- Full suite (`pnpm lint && pnpm typecheck && pnpm test`) green before pushing.
