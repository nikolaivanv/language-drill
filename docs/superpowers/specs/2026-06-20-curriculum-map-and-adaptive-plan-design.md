# Curriculum Map + Adaptive Plan — Design

**Status:** approved design (brainstorm) · **Date:** 2026-06-20 ·
**Next step:** visual / code-design pass by the author, then an implementation plan.

Extends [`progress-tracking.md`](../../../progress-tracking.md) and
[`progress-feedback-redesign.md`](../../../progress-feedback-redesign.md). The
error-stream redesign (#387–#404) made the *error* signal honest and
attributed; this design makes the *curriculum* visible and turns the daily plan
from a black box into a legible, error-aware, completable unit — and adds the
first CEFR-progression signal.

---

## Why (grounded in how the system works today)

The daily plan is already signal-driven, but three things are missing, and they
are the root of the author's feedback.

**How the plan is compiled today** (`GET /sessions/today`, Path B):
`sampleFreshPool` pulls approved exercises at the user's `proficiencyLevel`,
fresh-first; `rankPlanCandidates` (`infra/lambda/src/lib/mastery/rank.ts`) scores
each candidate by **mastery gap** (`1 − masteryScore × 30-day decay`), a
**growth-zone boost** (0.3–0.7), and a **prerequisite penalty** (×0.5 per unmet
prereq), tiebroken by exposure; `composeFreshPlan` fills a fixed 5-slot shape.

**The three gaps:**

1. **The error signal never reaches the plan.** `error_observations`
   (attribution shipped in #400/#404) powers only the separate `/insights/errors`
   "work on these" block. The ranker reinforces *low mastery*, not *what the
   learner keeps getting wrong*.
2. **Per-point mastery is invisible.** `user_grammar_mastery` (score, confidence,
   evidence, last-practiced) is computed and used for ranking but is exposed to
   **no UI**. The learner cannot see which curriculum points they haven't
   touched, are learning, or have mastered.
3. **No progression signal.** `proficiencyLevel` is a static profile field,
   changed only by a manual profile edit. Nothing aggregates per-level mastery
   or answers "is it time for A2?".

The curriculum itself is fully enumerable and ordered (`curriculumOrderOf`),
has a real prerequisite graph, one theory page per point, and a per-point
exercise-type matrix (`compatibleTypes()`). On-demand targeting mostly exists
(`POST /sessions {grammarPointKey}`, `/drill?start=quick&grammarPoint=`). The
ingredients are all present; they are not assembled into a learner-facing whole.

---

## Goals

- Make the curriculum **visible and honest**: every point's state (untouched →
  mastered) plus where it still generates errors.
- Make the daily plan **legible** ("why is this here?") and **error-aware**
  (reinforce real mistakes, not just the Bayesian gap).
- Add the **first CEFR-progression signal** (an honest, opt-in "ready for the
  next level").
- Provide a **power-user escape hatch** (drill any point, in any mode) without
  displacing the linear daily plan as the default.
- Let a learner **do more** (longer plans; continue after finishing) without
  gamification.

## Non-goals

- No streaks, XP, badges, or auto-advancing levels.
- No automated placement test / level reassessment (out of scope).
- No new exercise *types* — only new ways to target and surface existing ones.
- The radar (macro-skill) is kept as a supporting view, not removed.

---

## The design

### 1. The Curriculum Map (centerpiece of `/progress`)

A vertical, curriculum-ordered list of the **active level's** grammar points
(`kind:'grammar'`), grouped by CEFR level, becomes the primary content of
`/progress`. The macro-skill **radar is demoted** to a supporting "shape" view
(a secondary tab or a below-the-fold/expandable section). The fluency and
history tabs are unchanged.

**Each cell** shows a grammar point with:

- **Mastery state** — one of three, classified server-side:
  - **not-started** — no `user_grammar_mastery` row, or `evidenceCount === 0`.
  - **learning** — `evidenceCount ≥ 1` and not yet solid.
  - **solid** — `masteryScore ≥ 0.80` **and** `confidence ≥ 0.60`
    (`confidence` is the existing Bayesian confidence; 0.60 reuses the debrief's
    `CONFIDENCE_HIGH_CUTOFF`). *Initial thresholds — tunable.*
- **⚠ error-prone overlay** — an **overlay flag, not a fourth state**: ≥ 2
  `error_observations` attributed to the point (`errorGrammarPointKey`, falling
  back to `hostGrammarPointKey`) in the trailing 30 days. **It can co-exist with
  "solid"** — a point reading solid while still generating errors is precisely
  the dishonesty the redesign targets, so the map surfaces it.
- **Soft prerequisite cue** — when a prereq isn't solid, the cell is muted with a
  "builds on *vowel harmony*" hint and reads as up-next. **Never blocked** —
  every point is always tappable and drillable (matches the ranker, which only
  soft-penalizes prereqs). This is the power-user escape hatch.

**Tap → point detail** (a compact panel/sheet):
- state + last-practiced + a recurring-error sample (when error-prone),
- **"read the theory"** link (the per-point theory page already exists, mapped
  via `topicIdForGrammarPointKey`),
- **drill options**: a default **"drill this point"** (mixed, the existing
  `grammarPointKey` session) plus **mode chips** drawn from the point's
  `compatibleTypes()` — cloze / translation / sentence-construction /
  conjugation — each launching a single-mode targeted drill.

**Level boundary + readiness** (the progression signal):
- An honest rollup strip: **"21 of 26 A1 grammar points solid."**
- When the level crosses the readiness bar — **≥ 80% of the level's
  `kind:'grammar'` points are solid** (*initial, tunable*; vocab umbrellas do not
  gate) — a **non-blocking nudge** appears: *"You've made A1 solid — add A2?"*.
  Accepting flips the user's active `proficiencyLevel`; declining/ignoring does
  nothing. **Never automatic.**
- A **compact next-level preview** (the next level's first points, muted) sits
  below the active level so "what's next" is always visible.

### 2. New endpoint — `GET /progress/curriculum`

The first UI surface for per-point mastery. A pure server-side join of
curriculum × `user_grammar_mastery` × `error_observations` (counts). Response:

```
{
  language,
  activeLevel,                  // the user's proficiencyLevel
  levels: [
    {
      level: "A1",
      solidCount, total,        // grammar points only
      readyToAdvance: boolean,  // solidCount/total >= READINESS_RATIO
      points: [
        {
          key, name, cefrLevel, order,        // curriculumOrderOf
          state,                              // 'not-started' | 'learning' | 'solid'
          errorProne: boolean,                // overlay
          mastery, confidence, evidenceCount, // from user_grammar_mastery (nullable)
          lastPracticedAt,                    // nullable
          recentErrorCount,                   // trailing-window attributed count
          prereqKeys, prereqUnmet,            // prereqUnmet = any prereq not solid
          compatibleTypes,                    // ['cloze','translation',...]
          hasTheory                           // topicIdForGrammarPointKey != null
        }
      ]
    }
    // active level in full + a compact next-level preview
  ]
}
```

Grammar-point names and curriculum facts resolve server-side (the web bundle
never imports `@language-drill/db`/curriculum — same constraint as the rest of
the app). `user_grammar_mastery` is already indexed by `(userId, language)`.

### 3. Plan composition rework

**3a. Error-aware ranking** (`rank.ts`). The candidate priority gains an
**additive error term** scaled by the point's recent attributed-error count
(trailing window, capped), so a point the learner keeps getting wrong outranks
an equal-mastery point with none. The route already has `error_observations`
access (it writes them on submit); Path B fetches a per-point recent-error count
alongside `masteryByPoint`. Exact weighting is an initial constant tuned against
real data (the existing error-observation queries make this measurable).

**3b. At-or-below pool.** `sampleFreshPool` draws the active level **and below**
(not exactly the active level), so a still-weak A1 point keeps surfacing in the
daily plan after the learner advances to A2. Ranking already favors weak/error-
prone points, so lower-level mastered points won't crowd the plan.

**3c. Daily-goal length.** Replace the fixed 5-slot shape with a light skeleton
— **warm-up · core block · cool-down** — whose **core block scales to a
daily-goal setting**:

| Goal | Total items |
|---|---|
| short | ~5 |
| **standard (default)** | ~8 |
| long | ~12 |

The setting is a per-user preference (no gamification — it's "how much do you
want to do today"). The core block is filled from the error-aware, at-or-below
ranked candidates.

**3d. Per-item "why" reason** (plan legibility). Each plan item carries a
**`reason`** derived from its dominant ranking factor, rendered as a quiet hint
on the row:

| reason | when | example hint |
|---|---|---|
| **new** | no mastery yet (gap ≈ 1, prereqs met) | "new point" |
| **reinforce** | growth zone (0.3–0.7 boost fired) | "reinforcing" |
| **review** | was solid, decayed back (idle) | "due for review" |
| **error-fix** | high recent attributed-error count | "you've slipped here 7×" |

**3e. Framing-line upgrade.** The top "today's plan" line currently comes from a
generic radar rule (`framing-rules.ts`). Upgrade it to reflect the **actual plan
composition** — e.g. *"today leans into the accusative and definite-past — your
two liveliest error spots"* — derived from the plan items' reasons + the error
signal. This ties the framing to real drivers instead of the macro-skill radar.

### 4. Completing the daily plan

The daily plan stays a **completable unit**. On completion the existing
all-done summary (`AllDoneCard`) shows ("you're done for today"), now with a
**non-gamified "keep going →"** that generates an **extra ad-hoc round on
demand** from the same error-aware ranked pool. This is *not* a new "today's
plan" — just more practice when wanted. No infinite auto-treadmill (that would
fight the no-gamification ethos); no dead-end (the keen learner can always
continue, and the map is always there as the escape hatch).

### 5. `/home` linear-path cue

A quiet line on `/home`, derived from `curriculumOrderOf` + the readiness
rollup: *"you're around point N of the A1 sequence · next: **X** · see the map
→"*. `/home` is otherwise unchanged (it keeps the plan timeline + "work on
these").

### 6. Targeting plumbing + reuse

- **Conjugation targeting.** The conjugation drill currently fetches an
  *untargeted* random conjugation exercise. Make it accept a target grammar point
  (`?grammarPoint=`), so the map's conjugation mode-chip works. Only points with
  `conjugationSuitable` expose the chip.
- **Combined `{grammarPointKey + exerciseType}` filter.** Let `POST /sessions`
  filter by a grammar point **and** a single mode together (both fields exist
  individually today), so a mode-chip launches a single-mode targeted drill.
- **Reuse `work-on-these` on `/progress`.** The component (`/insights/errors`)
  lives only on `/home` today; render it on `/progress` too (your Q2).

---

## Phasing (one spec, independently shippable phases)

**Phase 1 — The Map (read-only) + reuse.** `GET /progress/curriculum` endpoint
+ state/readiness classification; the Map surface on `/progress` (radar demoted);
reuse `work-on-these` on `/progress`. Per-point mastery becomes visible. No plan
or targeting changes yet. Ships the bulk of the "anemic /progress" + "I can't
see the curriculum" fix.

**Phase 2 — On-demand from the Map.** Point-detail panel + mode chips; the
conjugation-targeting build + combined `{point + mode}` session filter. The map
becomes a launcher (your Q5).

**Phase 3 — Adaptive plan.** Error-aware ranker (3a), at-or-below pool (3b),
daily-goal length (3c), per-item reasons (3d), framing upgrade (3e),
completable-plan + on-demand extra rounds (§4), `/home` linear cue (§5).

**Phase 4 — Readiness action.** Wire the readiness nudge to flip
`proficiencyLevel` on acceptance (the rollup + bar already ship in Phase 1; this
adds the action).

---

## Tunable parameters (initial values, to calibrate on real data)

- Solid: `masteryScore ≥ 0.80`, `confidence ≥ 0.60`.
- Error-prone overlay: `≥ 2` attributed errors in trailing `30 days`.
- Readiness: `≥ 80%` of a level's grammar points solid.
- Daily-goal: short 5 / standard 8 / long 12 (default standard).
- Error-term weight in the ranker: initial constant, tuned via the error-
  observation queries (no eval harness exists for the plan ranker; calibrate by
  inspecting real plans for the dogfood account).

---

## Open decisions resolved (record)

- **Surface (A vs B):** one unified Map as the `/progress` centerpiece; radar
  demoted. *(A)*
- **Cell model:** 3 mastery states + error overlay; prerequisites **soft cue**,
  never locked. *(A)*
- **Readiness:** honest, **opt-in suggestion** (never automatic). *(A)*
- **Drill length:** **daily-goal setting** (short/standard/long), default
  standard.
- **Completed plan:** completable + **on-demand extra rounds** (not an endless
  auto-treadmill).

---

## Files likely in scope (reference, not prescriptive)

- Endpoint + classification: `infra/lambda/src/routes/progress.ts` (new
  `/progress/curriculum`), a new pure classifier in
  `infra/lambda/src/lib/` joining curriculum + `userGrammarMastery` +
  `errorObservations`; `packages/api-client` schema + hook.
- Ranker: `infra/lambda/src/lib/mastery/rank.ts` (error term),
  `infra/lambda/src/routes/sessions.ts` (at-or-below pool, daily-goal length,
  per-item reason), `today-plan.ts` (skeleton + `reason` on `PlanItem`),
  `packages/api-client` today schema (`reason`).
- Targeting: `infra/lambda/src/routes/sessions.ts` (combined filter), the
  conjugation drill route/page (`?grammarPoint`).
- Web: a new `/progress` Map view + point-detail + readiness strip;
  `framing-rules.ts` upgrade; `/home` cue; `work-on-these` reuse; daily-goal
  setting (profile/preferences).
- Preferences: `proficiencyLevel` flip on readiness accept (`/profiles/languages`
  already supports the write); daily-goal preference storage.
```
