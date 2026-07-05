# Deterministic-Match Evaluation Short-Circuit — Design

**Date:** 2026-07-05
**Status:** Approved

## Problem

For cloze and vocab-recall exercises, the evaluation prompt already mandates
score 1.0 with no errors when the user's answer exactly matches the
exercise's `correctAnswer` / `acceptableAnswers` (`expectedWord` for vocab).
The LLM call is a ~7-second, ~$0.01 rubber stamp on every correct answer —
the majority of drill submissions. Conjugation drills already skip the LLM
entirely (deterministic grading via `gradeFluencyAnswer`, zero metering);
this design extends that precedent to the match case of cloze/vocab.

## Decisions (user-approved)

- **Match policy:** conjugation precedent — deterministic matches are FREE
  (no `ai_evaluation` usage event, no per-user cap check, no global capacity
  gate) and return instantly with canned feedback.
- **Enrichment:** an on-demand **"Explain why"** button fetches LLM feedback
  for a deterministic submission. That call IS metered and gated (it is a
  real AI call).
- **Non-matches are unchanged:** they fall through to the normal LLM
  evaluation — acceptable-answers lists are non-exhaustive by design, and an
  unlisted answer may still be valid (holistic judgment required).

## Components

### 1. Route short-circuit (`infra/lambda/src/routes/exercises.ts`)

Generalize the existing conjugation short-circuit block: before the AI
gates, when `exercise.type` is `CLOZE` or `VOCAB_RECALL` and
`gradeFluencyAnswer(content, userAnswer)` returns true, synthesize:

```ts
{
  score: 1, grammarAccuracy: 1, taskAchievement: 1, errors: [],
  vocabularyRange: exercise.difficulty,        // same convention as conjugation
  estimatedCefrEvidence: exercise.difficulty,
  feedback: `Correct — ${userAnswer.trim()}.`, // canned; echoes the learner's own (matched) form
  evaluationSource: 'deterministic',
}
```

History row (`user_exercise_history`) and mastery/error-observation
recording behave exactly as the conjugation block does today (score-1
submissions produce no error observations). No usage event, no Langfuse
trace (no LLM ran). On non-match, fall through unchanged.

Normalization is entirely `gradeFluencyAnswer`'s: NFC, whitespace collapse,
trailing sentence punctuation dropped, dual EN/TR case folds (the İ/ı
mobile-keyboard fix from #521), diacritics NOT stripped. No new
normalization logic is introduced.

### 2. `evaluationSource` marker

- Add optional `evaluationSource: 'deterministic' | 'llm'` to the submit
  response, to `EvaluationResultSchema` in `packages/api-client`, and to the
  stored `responseJson.evaluation`.
- The LLM path stamps `'llm'` at the route (not inside `packages/ai` — the
  evaluator stays metering/transport-agnostic). Absent field (historical
  rows) is treated as `'llm'`.
- The conjugation block adopts the marker too (`'deterministic'`) for
  consistency, but its UI keeps the baked-in `breakdown` feedback (no
  Explain button there).

### 3. "Explain why" endpoint

`POST /exercises/:id/submissions/:submissionId/explain`

- Auth: standard JWT; the history row must belong to the caller and
  reference exercise `:id`; 404 otherwise.
- Only valid for submissions whose stored evaluation is
  `evaluationSource: 'deterministic'` (400 `NOT_EXPLAINABLE` otherwise).
- If `responseJson.explanation` already exists → return it (cached; free).
- Otherwise: run the standard AI gates (kill switch, global cap, per-user
  `ai_evaluation` cap), call `evaluateAnswer` with the stored answer +
  grammar guidance/attribution (same wiring as the submit path, same
  Langfuse trace metadata with `requestId: submissionId`), persist
  `responseJson.explanation = evaluation.feedback`, record an
  `ai_evaluation` usage event, return `{ explanation }`.
- The stored score/mastery signal is NOT retroactively modified — the
  deterministic verdict stands; the LLM call is feedback enrichment only.

### 4. Web UI

- In the drill feedback surface for cloze/vocab results: when the submit
  response has `evaluationSource === 'deterministic'`, render an
  **Explain why** button under the correct-state feedback.
- Click → `useExplainSubmission` mutation (new TanStack hook in
  `packages/api-client`) → swap the canned line for the returned
  explanation; pending state on the button; error → existing toast pattern.
- No streaks/gamification, no change to incorrect-answer UX.

## Data flow (match case)

```
submit → session guard → type is cloze/vocab → gradeFluencyAnswer → MATCH
  → synth result (evaluationSource: deterministic)
  → insert history row (+ mastery signal)
  → respond (<100ms, $0)
[user taps Explain why]
  → POST .../explain → ownership + explainable checks → cached? return
  → AI gates → evaluateAnswer (metered, traced) → cache into responseJson
  → respond { explanation }
```

## Error handling

- Malformed content on the short-circuit path → same 500
  `EXERCISE_CONTENT_INVALID` pattern as conjugation.
- Explain endpoint: LLM failure → 502 `AI_UNAVAILABLE` (same mapping as
  submit); cap exhausted → 429 (same as submit); refusal →
  ContentRejectedError mapping as submit.
- Web: explain failure leaves the canned feedback in place.

## Testing

- Route tests: match returns 1.0/deterministic with no usage event and no
  Claude client call; non-match calls Claude; each type (cloze with
  acceptableAnswers, vocab expectedWord); TR case-fold match via the
  existing normalizer; LLM path stamps `evaluationSource: 'llm'`.
- Explain tests: ownership 404, non-deterministic 400, cache hit skips
  Claude + usage, cold call meters + persists, cap-exhausted 429.
- api-client: schema accepts/omits `evaluationSource`; new hook.
- Web component tests: button renders only for deterministic results;
  swap-on-success; pending/error states. (Mind the `**/profiles/languages`
  mock requirement for dashboard-shell specs.)

## Out of scope

- Extending the short-circuit to translation/sentence-construction (no
  exact-match semantics).
- Retroactive re-scoring, streaming explain, client-side pre-check.
- Changing conjugation UX.
