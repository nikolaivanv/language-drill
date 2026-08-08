# Debrief headline: accuracy → movement

**Date:** 2026-08-09
**Status:** Approved (design); pending implementation plan
**Scope:** `apps/web` only — the session debrief header. No API, schema, DB, or migration change.

## Goal

Make the debrief headline report **what the session did to the learner's skills**, not what fraction of items they got right. Accuracy is inert — it drives nothing adaptive — and it actively contradicts the panel beneath it.

## Why

Accuracy has exactly three consumers, none of them adaptive:

- the debrief header title (`lib/drill/accuracy-tier.ts`),
- the today-plan session summary tile,
- admin triage (`infra/lambda/src/routes/admin.ts:1534` flags sessions under 50%).

Mastery, by contrast, drives exercise selection and ranking (`lib/mastery/rank.ts`, `rank-context.ts`), the curriculum map, `/progress`, and the re-engagement emails. The debrief was leading with the one signal the system ignores.

The two also disagree, visibly. Production session `ec7dd00f` rendered:

> **nice work.** you got 5 of 5 · accuracy 100%
> ▼ Impersonal third-person plural — slipped

Accuracy is binary at `CORRECT_THRESHOLD = 0.7`; mastery is continuous. The root cause of that specific contradiction is fixed (`2026-08-08-mastery-ceiling-fix-design.md`, PR #627) and the confidence cue is fixed (PR #628) — but the header still measures the wrong thing, so the two signals can still diverge whenever a correct-but-imperfect answer lands below a point's current estimate.

## Why this is cheap

`skillMovements` is **already** on `DebriefResponse` (`packages/api-client/src/schemas/debrief.ts:67`), already fetched by the debrief page, and already rendered by `SkillMovementsPanel`. The data the headline needs is on the client. This is a presentation change, not a plumbing one.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Header / panel division | Header states the **shape** of the session; the panel remains the only place point names and bands appear |
| Accuracy percentage | **Removed** from the debrief header |
| Item count | Kept, as a muted factual line (`5 items · 2 skipped`) carrying no verdict |
| Tone on slips | Named neutrally — a slip with no offsetting gain is stated, not softened |
| Number of states | Six, one per movement shape |
| `correctCount` in the API | **Unchanged** — admin triage and the today-plan tile still use it |

## Architecture

### New module — `apps/web/lib/drill/movement-summary.ts`

Pure, and structurally a sibling of the `accuracy-tier.ts` it replaces. Reads only the bands already present in the payload; **no banding logic moves to the client** (bands stay server-side, per the 2026-06-16 spec's trust-presentation decision).

```ts
export type MovementState =
  | 'none' | 'mixed' | 'slipped' | 'gained' | 'new' | 'steady';

export interface MovementSummary {
  state: MovementState;
  title: string;    // display title, lowercase
  subline: string;  // one line naming the shape, no point names
}

export function movementSummary(
  movements: readonly SkillMovement[],
): MovementSummary;
```

`SkillMovement` is imported from `@language-drill/shared` (the same type the panel uses).

> **Signature note.** `movementSummary` takes movements **only** — not the session counts. The subline describes movement shape and never mentions items or skips, and the factual line is assembled in the header from `exerciseCount` / `skippedCount`. Keeping counts out of the summary keeps it a pure function of the payload's bands and makes the six states exhaustively testable from a single input.
>
> This means state `none` is inferred from `movements.length === 0` rather than read from a skip count. That inference holds because `computeSkillMovements` emits one movement per grammar point the session's **graded** items touched: an all-skipped session yields `[]`, and any graded session yields at least one movement. If that invariant ever changes server-side, rule 1's subline ("nothing graded this round") becomes a lie — so the debrief route test asserting `skillMovements: []` for an all-skipped session is load-bearing for this copy.

### State precedence — first match wins

A session can be several shapes at once, so order is part of the contract:

| # | Condition | Title | Subline shape |
|---|---|---|---|
| 1 | `movements.length === 0` | `session done.` | `nothing graded this round` |
| 2 | gain **and** slip present | `mixed session.` | `two gained · one slipped` |
| 3 | slip, no gain | `worth another look.` | `one slipped` |
| 4 | gain, no slip | `solid session.` | `one skill gained · nothing slipped` |
| 5 | only `new` (no gain, no slip) | `new ground.` | `two skills · first evidence` |
| 6 | otherwise (all `steady`) | `steady session.` | `nothing shifted much — that's normal` |

- **Gain** = `strong-gain` **or** `gain`. The two are not distinguished in the header; the panel already separates them.
- **`new` never changes the title** when it appears alongside a gain or a slip — it is mentioned in the subline only. Rule 5 fires solely when `new` is the only mover.
- **Rule 3 is the tone decision**: an unoffset slip is named. It is the one state that could feel punishing, and it is stated plainly rather than buried behind a gain.
- Rule 6 is the catch-all: reachable only when every movement is `steady`.

### Number words

Counts in the **subline** are spelled out for one–nine and rendered as digits from ten up (`one skill gained`, `two gained`). Counts in the **factual line** stay digits (`5 items · 2 skipped`).

> This is a deliberate inconsistency, accepted at design time: the subline is prose and the factual line is data. Note that `SkillMovementsPanel` renders `3 skills held steady` in digits, so the subline is the odd one out. If it reads badly in situ, switching the subline to digits is a copy-only change.

### Header composition

`debrief-header.tsx` becomes:

```
session done · 13:56          ← eyebrow, unchanged
solid session.                ← movementSummary().title
one skill gained · nothing slipped   ← movementSummary().subline
5 items · 2 skipped           ← muted factual line, no verdict
```

The factual line uses `exerciseCount` for items and omits the `· N skipped` clause when `skippedCount === 0`. No percentage is rendered anywhere in the header.

`DebriefHeaderProps` keeps taking the whole `DebriefResponse` (unchanged signature) — `skillMovements` is already on it.

### Deletions

Once the header stops calling it, `accuracyTier` has no live consumer:

- `apps/web/lib/drill/accuracy-tier.ts` + `apps/web/lib/drill/__tests__/accuracy-tier.test.ts` — delete.
- `DebriefFooterProps.tier` — **dead today**: `DebriefFooter(_props)` ignores it, retained "for future tier-keyed copy variants" that never arrived. Remove the prop and the import.
- the `accuracyTier(...)` call and import in `drill/debrief/[sessionId]/page.tsx`.

Its doc comment claims three consumers (header, Debrief tab narrative, what's-next router); only the header is real. Verify with a repo-wide grep before deleting rather than trusting the comment.

## Edge cases

- **All items skipped / nothing graded** → the debrief route emits `skillMovements: []` → state `none`, title `session done.`. The factual line still reports `N items · N skipped`, so the session is accounted for.
- **Movements present but all `steady`** → state `steady`. Distinct from `none`: the learner did graded work, it just did not move anything. The panel independently shows its `N held steady` line.
- **A single point both gained and slipped** — impossible: `computeSkillMovements` emits one aggregated movement per grammar point.
- **Many movers** (say 4 gained, 3 slipped) → subline stays one line: `four gained · three slipped`. No truncation needed; the panel carries the detail.
- **`skillMovements` absent from an older cached payload** → the schema defaults it to `[]` (`debrief.ts:67`), so the header degrades to `session done.` rather than throwing.

## Out of scope

- The **conjugation review** surface (`conjugation-review.tsx`) passes `skillMovements: []` — it keeps whatever header it has; no movement headline there.
- `correctCount` / accuracy anywhere outside the debrief header: admin triage, the today-plan tile, `practice_sessions.correct_count`, and the API payload all stay.
- `CORRECT_THRESHOLD` and the per-item `✓ correct` chips on the review cards — unchanged. The chips are per-item verdicts, not a session-level judgement.
- Band thresholds, the confidence cue, and any server-side movement logic.
- Retiring the dead `spaced_repetition_cards` table (noticed during this work; unrelated).

## Testing

- **`movement-summary.test.ts`** (pure): each of the six states; the precedence boundaries that matter — gain+slip → `mixed`, slip+new → `slipped`, gain+new → `gained`, gain+slip+new → `mixed`; empty input → `none`; all-steady → `steady`; singular vs plural subline wording; the nine/ten boundary in number words.
- **`debrief-header.test.tsx`**: renders the movement title and subline; renders the factual line; **omits the skipped clause at zero**; and asserts the header contains **no `%` character** — the regression guard for this whole change.
- **`page.test.tsx`**: update the existing debrief page tests for the new copy (they currently assert accuracy strings).
- Grep the whole app for `nice work.` / `good attempt.` / `back next time?` before deleting — page-level tests render the header too, so the old strings will be asserted in more places than the header's own test file.
- Full gate before push: `pnpm lint && pnpm typecheck && pnpm test`. Run the web build as well (`next build`), since the pre-push gate does not cover prerender errors.

## Files touched (anticipated)

**New:**
- `apps/web/lib/drill/movement-summary.ts` (+ `__tests__/movement-summary.test.ts`)

**Modified:**
- `apps/web/app/(dashboard)/drill/debrief/_components/debrief-header.tsx`
- `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx` (drop the dead `tier` prop)
- `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx` (drop the `accuracyTier` call)
- `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-header.test.tsx`
- `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.test.tsx`

**Deleted:**
- `apps/web/lib/drill/accuracy-tier.ts`
- `apps/web/lib/drill/__tests__/accuracy-tier.test.ts`
