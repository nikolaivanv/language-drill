# Curriculum Map — Phase 3B (adaptive plan surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plan **surface** half of Phase 3 (design spec
`docs/superpowers/specs/2026-06-20-curriculum-map-and-adaptive-plan-design.md`,
§3d render, §3e, §4, §5) — make the now-adaptive plan (3A, merged in #420)
**legible and controllable**, and close the one gap 3A left: the session you
actually drill is still fresh-first ordered, not error-aware ranked.

**Architecture.** 3A made `GET /sessions/today`'s *preview* error-aware, sized to
`dailyMinutes`, and tagged each item with a `reason` on the wire — but
`POST /sessions` (the session you DRILL) still orders fresh-first
(`freshFirstOrderBy`), so the adaptive ordering never reaches practice. 3B:
1. **Ranks `POST /sessions`** with the same error-aware context (extract a shared
   `buildRankContext`; over-fetch → rank → take N) so the main drill *and* any
   extra round reflect it,
2. **renders the `reason`** hint on plan rows,
3. adds an **inline daily-load control** (writes the existing `dailyMinutes` pref),
4. **upgrades the framing line** to compose from the plan's reasons + names
   (client-side; no curriculum import),
5. makes the plan **completable with "keep going →"** (an extra adaptive round),
6. adds the **/home linear-path cue** (from the existing curriculum-map data).

**Tech Stack:** TypeScript, Hono (AWS Lambda), Drizzle, TanStack Query, Next.js + React, Vitest.

## Global Constraints

- **`POST /sessions` ranking reuses 3A's machinery:** the same `rankPlanCandidates`
  + a `RankContext` built from `user_grammar_mastery` + 30-day `error_observations`
  counts (`COALESCE(errorGrammarPointKey, hostGrammarPointKey)`). Extract a shared
  `buildRankContext(userId, language, now)` so POST and the today route build the
  context identically. **`GET /sessions/today`'s response/behavior must not change**
  (refactor it to use the helper only if its tests stay green; otherwise leave it
  and note the duplication).
- **POST ranking pattern:** over-fetch the candidate pool (SQL `freshFirstOrderBy`
  as the exposure pre-order), map to `PoolDraw`, `rankPlanCandidates`, take the top
  `exerciseCount`. Targeted (`grammarPointKey`) + top-up logic stays — rank the
  merged candidate set. A single-point pool ranks ~uniformly on the error term and
  falls back to mastery-gap/exposure — harmless.
- **The web never imports `@language-drill/db`/curriculum.** The framing line and
  the /home cue are composed client-side from data already on the wire (the today
  plan's `reason` + `grammarPointName`; the curriculum-map response's
  `order`/`state`/`name`).
- **`reason` hint copy:** `new` → "new point"; `reinforce` → "reinforcing";
  `review` → "due for review"; `error-fix` → "recent error spot". (The per-item
  error *count* is not on the today wire — keep the error-fix hint countless; the
  count lives on the map / work-on-these.) Render as a quiet hint, not a loud badge.
- **Daily-load control** writes `dailyMinutes` (values 5/10/20/30) via the existing
  `useUpdatePreferences` PATCH; mirror the settings `goals-section` choice pattern.
  Settings already exposes it — both write the same pref, so they stay in sync.
- **"keep going" is non-gamified:** one extra adaptive round on demand (a normal
  quick-drill session, now error-aware after Task 1) — no auto-treadmill, no streak.
- **/home cue:** "you're around point N of A1 · next: **X** · see the map →",
  derived from the curriculum-map points (count of non-`not-started` for "point N";
  first `not-started` in order for "next: X"); link to `/progress`.
- **No DB migration.** Languages uppercase. App idiom (`--color-*`, shared
  `Button`/`Card`/`Chip`, `t-*`).
- **Build/test ordering:** `pnpm build` (turbo) before dependent web tests; `rm -rf
  infra/lambda/dist` before the Lambda suite. FULL gate serialized: `pnpm lint &&
  pnpm typecheck && pnpm turbo run test --concurrency=1`.
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Create** `infra/lambda/src/lib/mastery/rank-context.ts` — `buildRankContext(db, userId, language, now): Promise<RankContext>` (+ test).
- **Modify** `infra/lambda/src/routes/sessions.ts` — `POST /sessions`: over-fetch + rank; (optionally) `GET /sessions/today` to reuse the helper.
- **Modify** `infra/lambda/src/routes/sessions.test.ts`.
- **Modify** `apps/web/app/(dashboard)/_components/timeline-item.tsx` + `today-timeline.tsx` + `next-up-card.tsx` — thread + render `reason`.
- **Create** `apps/web/app/(dashboard)/_lib/reason-hint.ts` (+ test) — `reasonHint(reason)`.
- **Create** `apps/web/app/(dashboard)/_components/daily-load-control.tsx` (+ test) — the inline segmented control.
- **Modify** `apps/web/app/(dashboard)/_lib/framing-rules.ts` (+ test) — plan-based framing.
- **Modify** `apps/web/app/(dashboard)/_components/dashboard-header.tsx` — pass the plan to framing.
- **Modify** `apps/web/app/(dashboard)/_components/state-cards.tsx` (`AllDoneCard`) + `today-timeline.tsx` — "keep going →".
- **Create** `apps/web/app/(dashboard)/_lib/path-cue.ts` (+ test) — `composePathCue(curriculumMap)`.
- **Modify** `apps/web/app/(dashboard)/home/page.tsx` (+ a small cue component) — render the cue.

---

### Task 1: Error-aware `POST /sessions` (shared rank context)

**Files:**
- Create: `infra/lambda/src/lib/mastery/rank-context.ts` + `…/rank-context.test.ts`
- Modify: `infra/lambda/src/routes/sessions.ts` (POST handler)
- Modify: `infra/lambda/src/routes/sessions.test.ts`

**Interfaces:**
- Produces: `buildRankContext(db, userId, language, now): Promise<RankContext>` (mastery + 30-day error counts + `prereqsOf` via `getGrammarPoint`).

- [ ] **Step 1: Extract the helper (TDD-lite — it's a thin DB wrapper).** Create
  `rank-context.ts`: it runs the same two queries the today route runs inline (the
  `userGrammarMastery` select → `masteryByPoint`; the `errorObservations`
  `COALESCE(...)` 30-day group-by → `errorCountByPoint`) in a `Promise.all`, and
  returns `{ masteryByPoint, errorCountByPoint, prereqsOf: (k) => getGrammarPoint(k)?.prerequisiteKeys ?? [], now }`. Add a focused test (mock `db.select`) asserting it builds the maps from rows + resolves prereqs. (Mirror the today route's existing construction at `sessions.ts:336-372`.)

- [ ] **Step 2: Write the failing POST test** — extend `sessions.test.ts` (POST /sessions
  block): seed a candidate pool (via the POST query mocks) of several exercises whose
  grammar points have DIFFERENT recent-error counts + mastery; seed `buildRankContext`'s
  mastery + error rows; assert the returned `exercises` are ordered error-aware (the
  high-error point's exercise comes before an equal-mastery zero-error one) — i.e. the
  rank is applied, not raw fresh-first. (Read the POST harness; the over-fetch returns
  the seeded rows and the in-memory rank reorders them — so this is genuinely assertable.)

- [ ] **Step 3: Implement** in `POST /sessions`:
  - Replace the direct `.orderBy(freshFirstOrderBy(userId)).limit(exerciseCount)` selects
    with an **over-fetch** (e.g. `.limit(exerciseCount * 4)` or a constant like the
    today route's over-fetch) keeping `freshFirstOrderBy` as the SQL pre-order, for BOTH
    the targeted+topup branch and the untargeted branch.
  - After assembling the candidate rows, `const ctx = await buildRankContext(db, userId, language, now);`
    map rows → `PoolDraw[]` (`{id,type,topicHint:null,difficulty,grammarPointKey}` — use the
    row's `grammarPointKey`/`type`/`difficulty`; topicHint can be null), `rankPlanCandidates(draws, ctx)`,
    then take the top `exerciseCount` ids and select those full rows (preserve the ranked order).
  - Keep the `INSUFFICIENT_EXERCISES` guard (against the candidate count) and the insert/response unchanged.
  - **GET /sessions/today:** refactor its inline mastery+error construction to call
    `buildRankContext` IF the today tests stay green with the re-sequenced mocks; otherwise
    leave the today handler untouched and add a code comment that it builds the same context
    inline for its RTT budget. Either way, GET's response must be unchanged.

- [ ] **Step 4: Run** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda build && pnpm --filter @language-drill/lambda test -- sessions.test.ts rank-context.test.ts` → PASS (incl. existing POST + today tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/mastery/rank-context.ts infra/lambda/src/lib/mastery/rank-context.test.ts infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(lambda): error-aware ranking for POST /sessions (drilled session, not just preview)"
```

---

### Task 2: Render the `reason` hint on plan rows

**Files:**
- Create: `apps/web/app/(dashboard)/_lib/reason-hint.ts` + `…/__tests__/reason-hint.test.ts`
- Modify: `apps/web/app/(dashboard)/_components/timeline-item.tsx` + `today-timeline.tsx` + `next-up-card.tsx`
- Modify: the relevant component tests

**Interfaces:**
- Consumes: `TodayPlanItem.reason` (on the wire).
- Produces: `reasonHint(reason: PlanReason | null): string | null`.

- [ ] **Step 1: Write the failing helper test** — `reason-hint.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { reasonHint } from '../reason-hint';

describe('reasonHint', () => {
  it('maps each reason to its quiet hint', () => {
    expect(reasonHint('new')).toBe('new point');
    expect(reasonHint('reinforce')).toBe('reinforcing');
    expect(reasonHint('review')).toBe('due for review');
    expect(reasonHint('error-fix')).toBe('recent error spot');
  });
  it('returns null for a null reason', () => {
    expect(reasonHint(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/web test -- reason-hint` → FAIL.

- [ ] **Step 3: Implement** `reason-hint.ts`:

```typescript
import type { PlanReason } from '@language-drill/api-client';

const HINTS: Record<PlanReason, string> = {
  'new': 'new point',
  reinforce: 'reinforcing',
  review: 'due for review',
  'error-fix': 'recent error spot',
};

export function reasonHint(reason: PlanReason | null): string | null {
  return reason ? HINTS[reason] : null;
}
```

(If `PlanReason` isn't exported from `@language-drill/api-client`, export it from the today schema there — a one-line `export type PlanReason = …` mirroring the zod enum — and add it to the package index.)

- [ ] **Step 4: Render it** — thread `reason` from the wire item into `TimelineItem`
  (add a `reason` prop) and render `reasonHint(reason)` as a quiet hint in the row
  (e.g. a `t-micro text-ink-mute` chip after the subtitle; for `error-fix`, an accent
  tint is fine but keep it subtle — NOT a loud badge). Pass `item.reason` from
  `today-timeline.tsx` and `next-up-card.tsx`. Add a component test asserting the hint
  text renders for a seeded `reason` and is absent for `reason: null`.

- [ ] **Step 5: Run, verify pass** — `pnpm --filter @language-drill/web test -- reason-hint timeline-item today-timeline next-up-card` → PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/_lib/reason-hint.ts" "apps/web/app/(dashboard)/_lib/__tests__/reason-hint.test.ts" "apps/web/app/(dashboard)/_components/timeline-item.tsx" "apps/web/app/(dashboard)/_components/today-timeline.tsx" "apps/web/app/(dashboard)/_components/next-up-card.tsx" packages/api-client/src/index.ts
git commit -m "feat(web): render the per-item plan reason hint"
```

---

### Task 3: Inline daily-load control on the today plan

**Files:**
- Create: `apps/web/app/(dashboard)/_components/daily-load-control.tsx` + test
- Modify: `apps/web/app/(dashboard)/_components/today-timeline.tsx` (or `home/page.tsx`) to render it near the plan header

**Interfaces:**
- Consumes: `useUpdatePreferences` (PATCH `{ dailyMinutes }`), the current `dailyMinutes` (from `usePreferences`/`useGetPreferences`).
- Produces: `DailyLoadControl` — a segmented control over `DAILY_MINUTES` (5/10/20/30).

- [ ] **Step 1: Build the control** — a `radiogroup` of the 4 `DAILY_MINUTES` values
  (mirror `apps/web/components/settings/goals-section.tsx`'s `Choice` pattern), labelled
  e.g. "today's load" with each option showing "{m} min". On select, call the
  `useUpdatePreferences` mutation `{ dailyMinutes: m }` and optimistically reflect the
  choice; the selected value comes from the current pref. Keep it compact (it sits above
  the plan timeline). Props: `{ fetchFn }` (or accept `current` + `onChange` and let the
  page wire the hook — choose the simplest testable split; prefer the page wiring the hook
  and passing `current: number | null` + `onSelect: (m) => void` so the control is a pure
  presentational segmented control that's trivially testable).
- [ ] **Step 2: Test** — render with `current: 10`; assert the 4 options render, the
  current is selected, and clicking another calls `onSelect` with that value.
- [ ] **Step 3: Wire it** — in `today-timeline.tsx`/`home/page.tsx`, render `DailyLoadControl`
  near the plan header, wiring `useGetPreferences` (current `dailyMinutes`) +
  `useUpdatePreferences` (mutate on select; on success the today plan refetches so the
  length updates). Add/extend a test that selecting a value fires the preferences mutation.
- [ ] **Step 4: Run** — `pnpm --filter @language-drill/web test -- daily-load-control today-timeline` → PASS.
- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/_components/daily-load-control.tsx" "apps/web/app/(dashboard)/_components/__tests__/daily-load-control.test.tsx" "apps/web/app/(dashboard)/_components/today-timeline.tsx" "apps/web/app/(dashboard)/home/page.tsx"
git commit -m "feat(web): inline daily-load control on the today plan"
```

---

### Task 4: Plan-based framing line

**Files:**
- Modify: `apps/web/app/(dashboard)/_lib/framing-rules.ts` + its test
- Modify: `apps/web/app/(dashboard)/_components/dashboard-header.tsx`

**Interfaces:**
- Consumes: the today plan items (`reason` + `grammarPointName`).
- Produces: `composePlanFraming(items): FramingResult` (new pure fn; keeps the radar `computeFraming` as the fallback when there's no plan).

- [ ] **Step 1: Write the failing test** — `framing-rules.test.ts`: given plan items where
  two carry `reason: 'error-fix'` with names "Accusative …" and "Definite past …", the
  framing paragraph names both as the lead error spots; given an all-`new` plan, it frames
  "new ground"; given an empty/undefined plan, it falls back to the generic. Assert on the
  produced paragraph substrings.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `composePlanFraming(items)` — a pure function:
  - collect distinct `grammarPointName`s of `error-fix` items → if ≥1, paragraph leans on
    them ("today leans into **{a}**{ and **{b}**} — your liveliest error spot(s)").
  - else if the plan is mostly `new` → "today breaks new ground: **{first new name}**".
  - else if mostly `review` → "today is a review pass — keeping **{name}** fresh".
  - else a reinforce/generic line.
  Keep it copy-light and data-driven; export it alongside the existing `computeFraming`.

- [ ] **Step 4: Wire** — in `dashboard-header.tsx`, when the today plan is loaded, use
  `composePlanFraming(plan.items)`; fall back to `computeFraming(axes)` when the plan is
  absent/empty. (Thread the plan into `DashboardHeader` props — it currently gets `axes`.)

- [ ] **Step 5: Run** — `pnpm --filter @language-drill/web test -- framing-rules dashboard-header` → PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/_lib/framing-rules.ts" "apps/web/app/(dashboard)/_lib/__tests__/framing-rules.test.ts" "apps/web/app/(dashboard)/_components/dashboard-header.tsx"
git commit -m "feat(web): framing line composed from the plan's reasons, not the radar"
```

---

### Task 5: Completable plan — "keep going →"

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/state-cards.tsx` (`AllDoneCard`)
- Modify: `apps/web/app/(dashboard)/_components/today-timeline.tsx`
- Modify: the relevant tests

**Interfaces:**
- Consumes: the now-adaptive `POST /sessions` (Task 1) via `/drill?start=quick`.

- [ ] **Step 1: Update `AllDoneCard`** — it currently shows one button "start a fresh
  session →" (href `/drill?start=quick`). Reframe completion as done + optional continue:
  keep the "you're done for today" summary, and present a **"keep going →"** action
  (href `/drill?start=quick`) with copy that signals an *extra adaptive round*, not an
  obligation (e.g. subtitle "one more round, tuned to your weak spots"). It launches a
  normal quick-drill session — which is now error-aware (Task 1). Keep it a single, calm
  action (no auto-treadmill). Update the prop/label as needed.
- [ ] **Step 2: Test** — assert the all-done state renders the "keep going" action with the
  `/drill?start=quick` href and the done summary; update any existing AllDoneCard test copy.
- [ ] **Step 3: Run** — `pnpm --filter @language-drill/web test -- state-cards today-timeline` → PASS.
- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(dashboard)/_components/state-cards.tsx" "apps/web/app/(dashboard)/_components/today-timeline.tsx"
git commit -m "feat(web): completable plan with a calm keep-going extra round"
```

---

### Task 6: /home linear-path cue

**Files:**
- Create: `apps/web/app/(dashboard)/_lib/path-cue.ts` + test
- Modify: `apps/web/app/(dashboard)/home/page.tsx` (+ a small cue line/component)

**Interfaces:**
- Consumes: `useCurriculumMap` (already powers `/progress`); `CurriculumMapResponse`.
- Produces: `composePathCue(map: CurriculumMapResponse | undefined): { positionLabel: string; nextName: string | null } | null`.

- [ ] **Step 1: Write the failing test** — `path-cue.test.ts`: given a curriculum map with
  the active level's points (some solid/learning, the rest not-started in `order`), assert
  `composePathCue` returns `positionLabel` like "point 7 of A1" (count of non-`not-started`,
  or the highest touched order) and `nextName` = the first `not-started` point's `name`;
  returns null for undefined input; `nextName` null when all are touched.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `composePathCue` — pure: take the active level (the non-preview
  level, or `levels.find(l => l.level === map.activeLevel)`); `positionLabel` =
  `point {count of points whose state !== 'not-started'} of {activeLevel}` (or use the
  total for "of N"); `nextName` = the first point in `order` with `state === 'not-started'`
  (null if none). Return `{ positionLabel, nextName }`.

- [ ] **Step 4: Render** — in `home/page.tsx`, add `useCurriculumMap({ fetchFn, language })`;
  render a quiet line near the plan (e.g. under the timeline): "you're around **{positionLabel}**
  · next: **{nextName}** · [see the map →](/progress)". Hide when the cue is null. Keep it
  one calm line.

- [ ] **Step 5: Run** — `pnpm --filter @language-drill/web test -- path-cue "home/page"` → PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/_lib/path-cue.ts" "apps/web/app/(dashboard)/_lib/__tests__/path-cue.test.ts" "apps/web/app/(dashboard)/home/page.tsx"
git commit -m "feat(web): /home linear-path cue (point N of A1 · next: X · see the map)"
```

---

### Task 7: Full gate

- [ ] **Step 1:** `pnpm build` → exit 0.
- [ ] **Step 2:** `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1` → exit 0. Watch: POST /sessions test harness re-sequencing for the over-fetch + rank-context queries; any web fixture constructing a `TodayPlanItem` already carries `reason` (3A); the `DashboardHeader` prop change ripples to its callers/tests.
- [ ] **Step 3:** No separate commit (gate only).

---

## Self-Review

- **Spec coverage:** §3a-reach-into-practice (POST ranking) → Task 1; §3d render → Task 2;
  §3c control → Task 3; §3e framing → Task 4; §4 completable/keep-going → Task 5; §5 /home
  cue → Task 6. The decision "rank POST /sessions too" → Task 1. The decision "inline +
  settings" → Task 3 (inline) + existing settings.
- **Placeholder scan:** pure cores (reason-hint, framing compose, path-cue, rank-context)
  carry complete code or concrete signatures + tests; the POST-ranking integration gives
  the over-fetch→rank→take-N steps + points at the existing harness; UI placement is
  concrete (which component, which slot).
- **Type consistency:** `PlanReason` is the single union (3A's `today.ts` enum), consumed by
  `reasonHint`, the framing compose, and the row render. `buildRankContext` returns the same
  `RankContext` 3A's `rank.ts` defines, used by both POST and (optionally) the today route.
  `DAILY_MINUTES` (5/10/20/30) is the one source for the control + the `targetItemCount` map.
  The /home cue + framing consume only wire data (no curriculum import).
