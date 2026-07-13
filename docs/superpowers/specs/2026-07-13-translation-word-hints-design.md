# Translation word-hints — design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/translation-word-hints`

## Problem

Translation drill hints today are a client-only 3-rung ladder computed in
`apps/web/app/(dashboard)/drill/_components/translation-exercise.tsx`:

1. English gloss of the first glossable source token (`lookupGloss` /
   `gloss-en.ts`) — collapses silently to rung 2 when no token matches,
2. first half of `referenceTranslation` + ellipsis,
3. full `referenceTranslation`.

There is **no authored/stored hint** — `TranslationContent`
(`packages/shared/src/index.ts:120`) has only `topicHint` (a theme label,
not a solving aid). The ladder is also cosmetic: `hintCount` is computed by
the component but stripped before submission (`drill/page.tsx` handleSubmit
sends only `{ exerciseId, answer, sessionId }`), so hint use never affects
the mastery signal.

The real learner blocker is **not knowing the target word**, not spelling or
first-letters. And translation tests two things at once: choosing the right
word *and* inflecting/placing it. So revealing a word's **dictionary (base,
uninflected) form** is a legitimate, non-answer-leaking hint — the learner
still has to conjugate/decline and order it.

## Goal

Replace the weak per-exercise ladder with an on-demand, **click-a-word**
hint: the learner taps a source word they're stuck on and sees its
target-language **dictionary form**. Keep a "reveal full answer" give-up
exit. Make hint use count against the mastery signal. Work on the **existing
exercise pool with no regeneration**.

## Design decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Interaction surface | Click English source words |
| Lemma source | On-demand LLM lookup, server-cached, shared across users |
| Resolution granularity | **Single batch call per exercise** resolves the whole sentence; words reveal progressively client-side |
| Relation to old ladder | Replace the level-1 gloss + half-reference rung; keep "reveal full answer" |
| Grading | Any hint use down-weights the mastery evidence (full-answer weighted more than a single word) |
| Scope | No exercise regeneration; no generation/validation prompt changes |

## Why a batch call (not per-word)

The prototype does one LLM call per tapped word. We instead resolve the whole
sentence in **one call** on first hint-open:

- **Lower latency** — after the first fetch, every word reveals instantly with
  no per-tap round-trip.
- **Enables span grouping** — multi-word units like "account for" become a
  single hint, which a per-word call can't align.
- **Enables disabling non-meaningful words** — articles / function words are
  marked non-hintable and rendered inert, so learners aren't offered useless
  hints.
- **Cheaper metering** — one metered AI event per exercise-open instead of one
  per word.

## Architecture

### 1. Backend: `POST /exercises/:id/word-hints`

New route in `infra/lambda/src/routes/exercises.ts` (sibling to `/submit`).

- **Body:** `{ sessionId?: string }` (no other input; the exercise id is the
  path param).
- **Cache first:** Upstash Redis, key `wordhints:{exerciseId}`. Holds the full
  hint map. Cross-user and effectively permanent (exercises are immutable) —
  the first learner to open hints on an exercise pays the LLM call; everyone
  after gets a cache hit. Cache read/write mirrors existing Redis usage in the
  usage/limits layer.
- **On miss:** one Claude call (small model, small `max_tokens`) given
  `content.sourceText`, `content.referenceTranslation`, `sourceLanguage`,
  `targetLanguage`. Returns an ordered list of **hint units** covering the
  source text:

  ```jsonc
  [
    { "span": "The",         "hintable": false },
    { "span": "students",    "hintable": true,  "lemma": "öğrenci" },
    { "span": "account for", "hintable": true,  "lemma": "..." },   // multi-word unit
    ...
  ]
  ```

  Each unit maps to a contiguous run of source tokens. `hintable:false` units
  (articles, function words, punctuation) carry no `lemma`. `lemma` is the
  target-language dictionary/base form *as used in this sentence* (sense
  disambiguated by full-sentence context), with no case/person/tense suffixes.
- **Prompt:** new in-repo constant + `_VERSION` in `packages/ai/src/`
  (e.g. `WORD_HINT_*`), fetched via `getPromptOrFallback`, **added to the
  PROMPTS manifest** in `bootstrap-prompts.ts` (else it only ever serves the
  fallback). This is a *new* prompt, unrelated to the generation/validation
  prompts — no existing exercise is regenerated.
- **Metering:** new usage bucket `translation_word_hint` in
  `infra/lambda/src/usage/limits.ts` (free / boosted 10×, like the others),
  charged once per cache-miss fetch. Inherits the global kill-switch /
  daily-cap machinery automatically.
- **Response:** `{ units: HintUnit[], cached: boolean }`.

### 2. Frontend: `translation-exercise.tsx`

- Add a "need a hint" toggle (replaces the old hint button). Toggling on
  fetches `/exercises/:id/word-hints` (loading state), then enters hint mode.
- In hint mode, tokenize `sourceText` against the returned units:
  - `hintable:false` spans render inert/greyed (not tappable).
  - `hintable:true` spans are tappable; multi-word units highlight as one.
- Tapping a hintable span reveals its `english → dictionary-form` row
  **instantly** from the already-fetched map (no per-tap network). A hints
  panel lists revealed rows with a "dict. form" tag; header tracks
  "N words revealed". Empty-state copy states the pedagogy: base meaning only,
  not the exact form.
- **Remove** the level-1 gloss and half-reference rungs. **Keep** a single
  "reveal full answer" button (old level-3) as the give-up exit.
- Track hint usage locally: number of units revealed + whether full-answer was
  revealed. Surface it through `SubmissionMeta` (already carries `hintCount`).

**Design-system adherence:** map the prototype's raw tokens/classes
(`--hilite`, `.btn`, card styling, hint panel) onto the app's existing
design-system tokens and `<Button>` component rather than copying prototype
values — same approach as the free-writing prototype port. If a highlight
token equivalent to `--hilite` is missing from the app design system, add it
to the design-system layer, not ad-hoc in the component.

### 3. Grading: down-weight the mastery evidence

Mirror the review/SRS path, which already downgrades a hint-assisted correct
answer (`grading.ts:94`, `scheduler.ts:119`). The main drill path is the
continuous-weight analogue.

- **Accept hint usage on submit.** Extend `SubmitAnswerSchema`
  (`exercises.ts:77`) with an optional hint-usage field; thread through
  `SubmitAnswerParams` + body builder (`packages/api-client/.../useExercise.ts`)
  and stop dropping `meta` in `drill/page.tsx` handleSubmit.
- **Apply a deterministic down-weight.** Thread an `evidenceWeight ∈ (0,1]`
  from `applyGrammarMastery` (`exercises.ts:130`) into `updateMastery`, applied
  to the observation weight `obsW` at `packages/db/src/mastery/update.ts:70`.
  A hinted-correct answer moves mastery less while confidence still accrues via
  `evidenceCount`. Full-answer reveal weights more heavily than a single-word
  reveal; exact curve is a tuning detail for the plan.
- **Persist for replay.** Store hint usage on `userExerciseHistory` (small
  schema add) so `replayHistory` / the backfill CLI (`update.ts:86`) recompute
  with the same penalty instead of defaulting to weight `1.0`.

## Data flow

```
learner taps "need a hint"
  → POST /exercises/:id/word-hints
      → Redis wordhints:{exerciseId} hit?  → return units
      → miss: Claude batch call → cache → return units + meter translation_word_hint
  → component renders tappable/greyed spans
learner taps a hintable word
  → reveal lemma row instantly from fetched map (no network)
learner submits
  → POST /exercises/:id/submit  { answer, sessionId, hintUsage }
      → evaluate → applyGrammarMastery(..., evidenceWeight) → updateMastery (obsW *= weight)
      → persist hintUsage on userExerciseHistory
```

## Error handling

- Word-hints fetch failure → toast ("couldn't fetch hints — try again"),
  hint mode stays closed; submission unaffected.
- Metering limit hit (`translation_word_hint` bucket exhausted / global cap) →
  standard limit response surfaced as a toast; no partial state.
- LLM returns malformed units → validate shape server-side; on failure return a
  safe empty/`hintable:false`-only map and do not cache it, so a later attempt
  can retry.
- Cache is best-effort: a Redis error falls back to a live LLM call.

## Testing

- **Backend unit:** cache hit vs miss; metering charged only on miss; malformed
  LLM output handled; span/lemma shape validation.
- **Mastery unit:** `updateMastery` with `evidenceWeight < 1` produces a
  smaller mastery delta than weight `1.0`; `replayHistory` honors persisted
  hint usage.
- **Component:** toggle fetches once; hintable spans tappable and reveal from
  the map without further network; non-hintable spans inert; old gloss/half
  rungs gone; full-answer button present; hint usage flows into `SubmissionMeta`.
- **Submit wiring:** `SubmitAnswerSchema` accepts hint usage; `drill/page.tsx`
  no longer drops it.

## Out of scope

- Regenerating or backfilling stored translation exercises.
- Changing generation / validation prompts (`generation-prompts.ts`,
  `validation-prompts.ts`) — this is a new, separate prompt.
- Other exercise types (cloze, vocab-recall, etc.).
- Prefetching hints before the learner asks (lazy-on-open only).
```
