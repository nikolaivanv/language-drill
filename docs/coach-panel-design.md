# Coach Panel — Make It Useful (Proposal)

**Status:** proposal · **Author:** design discussion, 2026-06-13

## Problem

The Coach panel — the left rail on desktop (`CoachRail`), the inline card on
mobile (`CoachCard`) — reads as anemic. It *looks* like a coach but it has no
memory and no content of its own.

Today `coachMessage()` in `apps/web/lib/drill/coach-messages.ts` picks one of a
handful of hardcoded strings from exactly two inputs:

- **before submit** — the exercise type (`idle` message), e.g.
  `"translate the meaning, not every word"`
- **after submit** — the score tier (`evaluated` message), e.g.
  `"the meaning lands · clean work"` for any score ≥ 0.95

It never sees the actual errors, the grammar point, or anything from earlier in
the session. Every C-tier translation gets the same praise string. That is why
it feels decorative — it *is* decorative.

On desktop the cost is worse: the panel consumes an entire left rail to display
one canned phrase.

### What the panel receives today

Only two props reach the component (`drill/page.tsx` → `CoachRail`/`CoachCard`):

1. `message: string` — the computed canned string
2. `exerciseType: ExerciseType` — used for styling / a commented-out future
   vocabulary tracker

### What's already available but thrown away

Every submission returns a structured evaluation (`EvaluationResult` in
`packages/api-client/src/schemas/exercise.ts`):

- `result.errors[]` — `{ type, severity, text, correction, explanation }`
- `result.score`, `result.grammarAccuracy`, `result.vocabularyRange`,
  `result.taskAchievement`, `result.feedback`
- the current exercise's `grammarPointKey`, `language`, `difficulty`

The session reducer (`drill/_components/session-reducer.ts`) keeps only the
**current** item's submission (`perItemSubmission`) plus `index` and
`skippedCount`. It discards each item's errors as soon as the user advances, so
no cross-item pattern can ever be surfaced.

## Decision: make it useful, don't kill it

Killing the panel is tempting — it would reclaim the desktop rail and remove
code. We should **not** do that. A coach that surfaces *recurring errors* is the
single most on-brand feature this product can put in that space. It is the
visible payoff of the error-analysis pipeline the product is built around:

- "skill-based mastery tracking (not XP/streaks/lessons)"
- "evidence-based, not time-based"
- "Claude evaluates free-form answers and returns structured JSON scores per
  dimension"

Throwing the panel away to show nothing is the wrong trade. The fix is not a
fancier random string — it is giving the coach **memory**.

## Proposed approach (phased)

### Phase 1 — within-session recurring-error tracker (cheapest, highest value)

No new backend, no new LLM call, no new latency or cost.

1. **Accumulate errors in the session reducer.** Instead of discarding
   `result.errors` on advance, append them (tagged with `grammarPointKey` and
   exercise index) to a session-scoped error log in `session-reducer.ts`.
2. **Summarize client-side with simple rules.** Group the accumulated errors by
   error `type` / `grammarPointKey`. When a pattern repeats (e.g. the same
   grammar point slips ≥ 2 times), promote it to a "headline."
3. **Thread the headline to `CoachRail` / `CoachCard`** as a richer message,
   replacing or supplementing the canned string.

Example output:

> **Watch:** verbal negation -mA slipped twice this session — the suffix
> harmonizes with the last vowel.

This turns the panel from wallpaper into the one thing the product claims to do
better than Duolingo, using data we already fetch.

### Phase 2 — LLM-narrated micro-summary (optional polish)

Once Phase 1 is live, the headline phrasing can be upgraded from rule-based
copy to an LLM-generated micro-summary (metered like other AI features). The
recurring-error *selection* still happens client-side; the LLM only rewrites the
chosen pattern into natural coaching language.

### Phase 3 — cross-session patterns

When a `/history` endpoint exists (already flagged as a TODO in
`coach-rail.tsx`), the coach can surface patterns *across* sessions, not just
within one — true longitudinal coaching tied to the mastery model.

## Cost / scope

The data plumbing is the real work, and it is modest:

- extend `SubmissionState` / the session reducer to keep a per-session error log
- thread that log to `CoachRail` and `CoachCard`
- write the grouping + headline-selection rules

No backend, schema, or LLM changes are required for Phase 1.

## Open design questions (resolve before coding)

- **Headline selection** — how to pick *the* error to surface when several
  repeat (most frequent? most severe? most recent? weighted by grammar-point
  CEFR level?).
- **Copy tone** — how terse, and how it coexists with the existing idle/praise
  strings (replace them, or only override when a pattern exists?).
- **Threshold** — how many repeats before a pattern becomes a headline (2?).
- **Mobile vs desktop** — the rail has room for more; the mobile card does not.
  Same content, or a condensed mobile variant?
- **Reset semantics** — does the error log reset per session, per language, per
  difficulty change?

## Files involved

- `apps/web/lib/drill/coach-messages.ts` — message selection logic
- `apps/web/app/(dashboard)/drill/_components/coach-rail.tsx` — desktop rail
- `apps/web/app/(dashboard)/drill/_components/coach-card.tsx` — mobile card
- `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` — session state
- `apps/web/app/(dashboard)/drill/page.tsx` — orchestration / prop wiring
- `packages/api-client/src/schemas/exercise.ts` — `EvaluationResult` shape
