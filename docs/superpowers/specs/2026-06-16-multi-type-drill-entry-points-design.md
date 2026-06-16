# Multi-Type Drill Entry Points — Design

**Date:** 2026-06-16
**Status:** Approved (design)

## Problem

The app originally had one practice surface: **"Drill"** — a one-click session of a
fixed 5-item mix (`V1_PLAN_SHAPE`: cloze → sentence-construction → translation →
vocab-recall → cloze), drawn fresh from the pool, configurable only by difficulty.

We are adding two new exercise types with very different granularity:

- **Dictation** — bite-sized (listen ~10–20s, transcribe). Already wired in as a
  normal `ExerciseType` that can occupy a session slot.
- **Free writing** — long, single-focus (one prompt, ~10–20 min) with its own
  multi-stage flow (`brief → composer → results → corrections → compare`).
  Currently a standalone page at `/drill/free-writing`.

They landed in the codebase asymmetrically (dictation in-session, free writing
standalone). This spec formalizes that asymmetry and defines the **entry points**
for a multi-type world: where each activity is reached, how the daily plan relates
to on-demand practice, and what "completing today" means.

## Guiding decisions (settled during brainstorming)

1. **The "today" plan is the spine.** The primary path is a guided daily plan the
   user follows; standalone entry points are escape hatches.
2. **Long tasks appear as distinct blocks** in the timeline, not inline items.
3. **On-demand access lives under a `/drill` hub**, not new top-level nav tabs.
4. **`/home` holds the plan; `/drill` holds the launchers** — no duplication.
5. **The plan is a bounded daily anchor**, not an infinite queue — "practice more"
   routes to the hub.

## Information architecture

Navigation is unchanged: `today · drill · read · review · theory · progress`.
**No new nav tabs.** Two existing screens change roles:

### `/home` ("today") — the plan spine

Renders the day's plan as a short **sequence of blocks** (not a flat 5-item rail).
Each block is a launch card. Composition:

- Most days: `[quick-drill]`
- Free-writing days: `[quick-drill, free-writing]`

### `/drill` — the on-demand launcher hub

Replaces the current "drill = session landing" role. Contains:

- A thin **`Today: …` status strip** summarizing plan progress, linking back to
  `/home` (e.g. "Today: quick drill ✓ · free writing ◦").
- A **row of launchers**: **Quick drill · Dictation · Free writing.**

This is the escape hatch — for doing a *specific* activity, or for *more* practice
after the plan is done.

> Mental model: **the plan (`/home`) is what you *should* do today; the hub
> (`/drill`) is where you go for *more* or for *something specific*.**

## Plan-block model

The plan evolves from a flat 5-slot list into a **list of blocks**, each able to
launch its own flow:

```
TodayPlan = Block[]
Block =
  | { kind: 'quick-drill', items: PlanCompositionSlot[] }  // existing 5-item mix
  | { kind: 'free-writing', promptRef: … }                 // multi-stage flow
```

- **Quick-drill block** = today's `V1_PLAN_SHAPE` session, unchanged. Same runner,
  same session state machine. It is now launched *through* a block instead of being
  the `/drill` landing page.
- **Free-writing block** = a single card that launches the existing standalone
  multi-stage flow. It is **never** inlined as "item 3 of 5" — being its own block
  is the whole point, because it is long and single-focus.

## Where each new type lives

Deliberately different per type, **by granularity**:

| Type | In the plan as… | Standalone access (`/drill` hub) |
|---|---|---|
| **Dictation** | A normal `ExerciseType` *inside* the quick-drill block (occupies a slot, like cloze/translation). **No separate block.** | "Dictation" launcher → a short dictation-only run |
| **Free writing** | Its **own block** in the timeline (some days). | "Free writing" launcher → the existing standalone flow |

Dictation is bite-sized, so it joins the mix. Free writing is long, so it is
promoted to a block. That asymmetry *is* the design.

## Free-writing cadence

Free writing should not appear daily (a ~15-min task daily becomes a chore).

- **v1 (this spec):** deterministic cadence — a free-writing block appears on a
  fixed rotation, e.g. **every 3rd day per active language**, derived from
  date + language so it is stable within a day and needs no new state.
- **Later (Phase 3+):** evidence-driven — surface free writing when the Writing
  macro-skill is stale or under-sampled relative to other skills. Depends on
  progress-tracking signals; out of scope for the first cut.

The cadence only governs the **nudge**, never access: the `/drill` hub's
"Free writing" launcher lets a user write on any off-day. That lets us keep the
cadence dumb without frustrating power users.

## Plan as a bounded anchor + "practice more"

The plan is a **once-daily curated anchor, not an infinite queue.** Its value as
the spine is the "did I do my practice today?" signal; regenerating an identical
plan on completion would dissolve that signal into a treadmill.

**There is no "regenerate my plan" concept.** After the user finishes the plan and
sees the debrief:

- A **"practice more"** affordance deep-links into the `/drill` hub.
- From the hub, **Quick drill** pulls a *fresh* quick-drill block (new items from
  the pool, fresh-first ordering) in one tap — repeatable. Dictation and Free
  writing launchers are available too (free writing even on a non-cadence day).

```
home (today plan) → finish plan → debrief
   → "practice more" → /drill hub
        → Quick drill   (fresh 5-item block, on demand, repeatable)
        → Dictation     (dictation-only run)
        → Free writing  (standalone flow — even on a non-cadence day)
```

**Boundary:** on-demand blocks launched from the hub are **not** added back into the
today plan retroactively — the plan stays the morning's curated thing. The extra
practice still counts toward progress/skills (it is the same exercises being
evaluated); it simply does not rewrite "today's plan."

## Out of scope

- Evidence-driven free-writing cadence (Phase 3+).
- A configurable "custom drill" builder (choosing arbitrary type mixes / counts).
  The hub's fixed launchers cover the on-demand need without a config surface.
- Changes to `read · review · theory · progress` nav or their screens.
- Any change to the quick-drill session runner or its state machine.

## Affected areas (for the implementation plan)

- **Plan model / generation** (`infra/lambda/src/lib/today-plan.ts`): flat slot list
  → list of blocks; add free-writing-day cadence.
- **`/home` timeline** (`apps/web/app/(dashboard)/home/…`, `TodayTimeline`): render
  blocks as launch cards; free-writing block card.
- **`/drill`** (`apps/web/app/(dashboard)/drill/page.tsx`): convert from session
  landing → launcher hub (status strip + launcher row); the session runner is
  launched from a block/launcher rather than being the landing.
- **Debrief**: add "practice more → `/drill` hub" affordance.
- **Dictation / free-writing launchers**: dictation-only run entry; reuse existing
  standalone free-writing flow.
