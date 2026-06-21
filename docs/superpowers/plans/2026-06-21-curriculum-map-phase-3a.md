# Curriculum Map — Phase 3A (adaptive plan engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily plan **error-aware, scalable, and legibly-tagged** — the
engine + data half of Phase 3 (design spec
`docs/superpowers/specs/2026-06-20-curriculum-map-and-adaptive-plan-design.md`,
§3a–3d). The richer plan *surface* (rendering reasons, the inline daily-load
control, framing line, keep-going, /home cue) is the follow-on Sub-plan 3B.

**Architecture (approved scope + decisions).** Today the plan is a fixed 5-slot
shape (`V1_PLAN_SHAPE`) ranked by mastery-gap + prereqs, *blind to errors*, and
the displayed preview and the actually-drilled session are **independent** (the
preview is `composeFreshPlan` server-side; the drilled session is `POST /sessions`
with the client constant `DEFAULT_EXERCISE_COUNT=5`). 3A:
1. folds a **capped additive error term** into the ranker (so points the learner
   keeps getting wrong outrank equal-mastery points),
2. draws the pool **at-or-below** the active level,
3. **scales plan length** to the *existing* `dailyMinutes` preference via one
   **shared** `targetItemCount(dailyMinutes)` mapping used by *both* the preview
   (`composeFreshPlan`) and the real session (`POST /sessions` count) — keeping
   them coherent (no new preference, no migration; per the approved decision),
4. tags each plan item with a **`reason`** (`new`/`reinforce`/`review`/`error-fix`)
   on the wire (rendered in 3B).

**Tech Stack:** TypeScript, Hono (AWS Lambda), Drizzle, Zod, Next.js + React, Vitest.

## Global Constraints

- **Length is derived from the existing `dailyMinutes` preference** (5/10/20/30) —
  NO new preference field, NO migration. The mapping is one pure function
  `targetItemCount(dailyMinutes: number | null): number` in `@language-drill/shared`,
  imported by both the Lambda (preview size) and the web (drilled-session count),
  so the two stay in sync. Anchor values: `5→5, 10→8, 20→10, 30→12`; `null`/unknown
  → `8` (standard default). These are the spec's tunable anchors.
- **Error signal** = `error_observations` count per *effective* point
  (`COALESCE(errorGrammarPointKey, hostGrammarPointKey)`) in the trailing **30 days**
  — same query shape `/progress/curriculum` already uses. Fed to the ranker via a
  `errorCountByPoint` map on `RankContext` (mirrors `masteryByPoint`); the error
  term is **additive and capped** (a few errors shouldn't swamp the mastery gap).
- **At-or-below pool:** `sampleFreshPool` draws exercises whose `difficulty` is the
  active level **or any lower CEFR level** (A1<A2<B1<B2). The ranker already favors
  weak/error points, so mastered lower-level points won't crowd the plan.
- **`reason`** is `'new' | 'reinforce' | 'review' | 'error-fix'` (a nullable wire
  field; `null` for items with no `grammarPointKey`). Classified by a pure
  `reasonFor(grammarPointKey, ctx)` from the same mastery + error context as the
  ranker. Computed on **both** GET /sessions/today paths (fresh + hydrate) so the
  tag is stable before and after the user starts.
- **The web bundle never imports `@language-drill/db`/curriculum** — grammar names
  already resolve server-side; `reason` is computed server-side too.
- **Do NOT render `reason`, add the inline daily-load control, change framing,
  keep-going, or the /home cue** — those are Sub-plan 3B. 3A only makes longer
  plans *display correctly* (variable-length section labels) and *drill at the
  right length*.
- **No DB migration.** Languages uppercase (TR/ES/DE).
- **Build/test ordering:** after editing `packages/*` run `pnpm build` (turbo)
  before dependent typecheck/tests; before the Lambda suite `rm -rf
  infra/lambda/dist`. FULL gate: `pnpm lint && pnpm typecheck && pnpm test` (serialized
  `pnpm turbo run test --concurrency=1` to dodge the known cross-package flake).
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Create** `packages/shared/src/daily-goal.ts` — `targetItemCount` + `DAILY_GOAL_MAX_ITEMS`; re-export from `packages/shared/src/index.ts`.
- **Create** `packages/shared/src/daily-goal.test.ts`.
- **Modify** `infra/lambda/src/lib/mastery/rank.ts` — `errorCountByPoint` on `RankContext`, additive error term, `reasonFor` classifier + `PlanReason` type.
- **Modify** `infra/lambda/src/lib/mastery/rank.test.ts` — error-term + reason tests.
- **Modify** `infra/lambda/src/lib/today-plan.ts` — `planSkeleton(targetCount)`; parameterize `composeFreshPlan(candidates, skeleton?)`.
- **Modify** `infra/lambda/src/lib/today-plan.test.ts` — skeleton + variable-length compose tests.
- **Modify** `infra/lambda/src/routes/sessions.ts` — Path B: at-or-below pool, dailyMinutes + error-count fetch, sized skeleton, `reason` per item (both paths).
- **Modify** `infra/lambda/src/routes/sessions.test.ts` — integration coverage.
- **Modify** `packages/api-client/src/schemas/today.ts` — `reason` field, `index` cap bump.
- **Modify** `packages/api-client/src/schemas/today.test.ts` (or its location) — schema coverage.
- **Modify** `apps/web/lib/drill/session-config.ts` + `apps/web/app/(dashboard)/drill/page.tsx` — drilled-session count from `targetItemCount(dailyMinutes)`.
- **Modify** `apps/web/app/(dashboard)/_lib/timeline-labels.ts` + callers — variable-length section prefix.
- **Modify** the relevant web tests (drill page, timeline-labels).

---

### Task 1: Shared `targetItemCount(dailyMinutes)` mapping

**Files:**
- Create: `packages/shared/src/daily-goal.ts`
- Create: `packages/shared/src/daily-goal.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `targetItemCount(dailyMinutes: number | null): number`, `DAILY_GOAL_MAX_ITEMS = 12`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/daily-goal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { targetItemCount, DAILY_GOAL_MAX_ITEMS } from './daily-goal';

describe('targetItemCount', () => {
  it('maps the four dailyMinutes anchors to item counts', () => {
    expect(targetItemCount(5)).toBe(5);
    expect(targetItemCount(10)).toBe(8);
    expect(targetItemCount(20)).toBe(10);
    expect(targetItemCount(30)).toBe(12);
  });
  it('defaults to standard (8) for null / unknown values', () => {
    expect(targetItemCount(null)).toBe(8);
    expect(targetItemCount(0)).toBe(8);
    expect(targetItemCount(15)).toBe(8);
  });
  it('never exceeds DAILY_GOAL_MAX_ITEMS', () => {
    expect(DAILY_GOAL_MAX_ITEMS).toBe(12);
    expect(targetItemCount(30)).toBeLessThanOrEqual(DAILY_GOAL_MAX_ITEMS);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/shared test -- daily-goal` → FAIL (module missing).

- [ ] **Step 3: Implement** — `packages/shared/src/daily-goal.ts`:

```typescript
// Daily-goal → plan length. Length derives from the existing `dailyMinutes`
// preference (5/10/20/30) — no separate preference. Shared so the today-plan
// preview (Lambda) and the drilled-session count (web) use one source of truth.

export const DAILY_GOAL_MAX_ITEMS = 12;

const ITEMS_BY_MINUTES: Readonly<Record<number, number>> = {
  5: 5,
  10: 8,
  20: 10,
  30: 12,
};

const STANDARD_ITEMS = 8;

/** Target plan length for a `dailyMinutes` value; standard (8) when unset/unknown. */
export function targetItemCount(dailyMinutes: number | null): number {
  if (dailyMinutes == null) return STANDARD_ITEMS;
  return ITEMS_BY_MINUTES[dailyMinutes] ?? STANDARD_ITEMS;
}
```

Add to `packages/shared/src/index.ts`: `export { targetItemCount, DAILY_GOAL_MAX_ITEMS } from './daily-goal';`.

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- daily-goal` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/daily-goal.ts packages/shared/src/daily-goal.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): targetItemCount — daily-goal length from dailyMinutes"
```

---

### Task 2: Error-aware ranker + `reasonFor` classifier

**Files:**
- Modify: `infra/lambda/src/lib/mastery/rank.ts`
- Modify: `infra/lambda/src/lib/mastery/rank.test.ts`

**Interfaces:**
- Consumes: `PointMastery`, `PoolDraw`.
- Produces: `RankContext` gains `errorCountByPoint: ReadonlyMap<string, number>`; `priorityOf` gains an additive capped error term; `reasonFor(grammarPointKey: string | null, ctx: RankContext): PlanReason`; `type PlanReason = 'new' | 'reinforce' | 'review' | 'error-fix'`.

- [ ] **Step 1: Write the failing tests** — add to `rank.test.ts` (mirror the existing `ctx` fixture there; it currently builds `{ masteryByPoint, prereqsOf, now }` — extend with `errorCountByPoint`):

```typescript
// helper: ctx({ mastery: {key: {masteryScore, lastPracticedAt}}, errors: {key: n} })
describe('error-aware priority', () => {
  it('an equal-mastery point with recent errors outranks one with none', () => {
    const now = new Date('2026-06-21T00:00:00Z');
    const practiced = new Date('2026-06-20T00:00:00Z');
    const candidates = [
      { id: 'a', type: ExerciseType.CLOZE, topicHint: null, difficulty: CefrLevel.A1, grammarPointKey: 'p-clean' },
      { id: 'b', type: ExerciseType.CLOZE, topicHint: null, difficulty: CefrLevel.A1, grammarPointKey: 'p-erroring' },
    ];
    const ctx = {
      masteryByPoint: new Map([
        ['p-clean', { masteryScore: 0.5, lastPracticedAt: practiced }],
        ['p-erroring', { masteryScore: 0.5, lastPracticedAt: practiced }],
      ]),
      errorCountByPoint: new Map([['p-erroring', 4]]),
      prereqsOf: () => [],
      now,
    };
    const ranked = rankPlanCandidates(candidates, ctx);
    expect(ranked[0].grammarPointKey).toBe('p-erroring');
  });
  it('caps the error term (10 errors ≈ the cap, not 10× weight)', () => {
    // assert priority for errorCount 100 equals priority for errorCount === ERROR_CAP
    // (export a small helper or compare two rankings) — see implementation for ERROR_CAP.
  });
});

describe('reasonFor', () => {
  const now = new Date('2026-06-21T00:00:00Z');
  const base = { prereqsOf: () => [], now };
  it('error-fix when recent errors are high', () => {
    const ctx = { ...base, masteryByPoint: new Map([['p', { masteryScore: 0.9, lastPracticedAt: now }]]), errorCountByPoint: new Map([['p', 3]]) };
    expect(reasonFor('p', ctx)).toBe('error-fix');
  });
  it('new when there is no mastery row', () => {
    const ctx = { ...base, masteryByPoint: new Map(), errorCountByPoint: new Map() };
    expect(reasonFor('p', ctx)).toBe('new');
  });
  it('review when a once-solid point has decayed below solid', () => {
    const old = new Date('2026-03-01T00:00:00Z'); // long idle
    const ctx = { ...base, masteryByPoint: new Map([['p', { masteryScore: 0.9, lastPracticedAt: old }]]), errorCountByPoint: new Map() };
    expect(reasonFor('p', ctx)).toBe('review');
  });
  it('reinforce for a mid-mastery point recently practiced', () => {
    const ctx = { ...base, masteryByPoint: new Map([['p', { masteryScore: 0.5, lastPracticedAt: now }]]), errorCountByPoint: new Map() };
    expect(reasonFor('p', ctx)).toBe('reinforce');
  });
});
```

- [ ] **Step 2: Run, verify fail** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- rank.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `rank.ts`:
- Add to `RankContext`: `errorCountByPoint: ReadonlyMap<string, number>;`.
- Add constants: `const ERROR_WEIGHT = 0.15;` `const ERROR_CAP = 5;` `const ERROR_FIX_MIN = 2;` `const SOLID_MASTERY = 0.8;`.
- In `priorityOf`, after computing `gap * penalty`, add the error term:

```typescript
  const errorCount = ctx.errorCountByPoint.get(c.grammarPointKey) ?? 0;
  const errorTerm = ERROR_WEIGHT * Math.min(errorCount, ERROR_CAP);
  return gap * penalty + errorTerm;
```

- Add the classifier + type:

```typescript
export type PlanReason = 'new' | 'reinforce' | 'review' | 'error-fix';

/** Classifies a plan item's dominant driver, from the same context as the ranker. */
export function reasonFor(grammarPointKey: string | null, ctx: RankContext): PlanReason {
  if (!grammarPointKey) return 'reinforce';
  const errorCount = ctx.errorCountByPoint.get(grammarPointKey) ?? 0;
  if (errorCount >= ERROR_FIX_MIN) return 'error-fix';
  const m = ctx.masteryByPoint.get(grammarPointKey);
  if (m == null) return 'new';
  const days = Math.max(0, (ctx.now.getTime() - m.lastPracticedAt.getTime()) / MS_PER_DAY);
  const effMastery = m.masteryScore * Math.exp(-days / HALFLIFE_DAYS);
  // was solid, decayed back below solid → due for review
  if (m.masteryScore >= SOLID_MASTERY && effMastery < SOLID_MASTERY) return 'review';
  return 'reinforce';
}
```

- [ ] **Step 4: Run, verify pass** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- rank.test.ts` → PASS. (Fill in the cap test concretely using `ERROR_CAP`.)

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/mastery/rank.ts infra/lambda/src/lib/mastery/rank.test.ts
git commit -m "feat(lambda): error-aware ranking + reason classifier for the plan"
```

---

### Task 3: Variable-length plan skeleton

**Files:**
- Modify: `infra/lambda/src/lib/today-plan.ts`
- Modify: `infra/lambda/src/lib/today-plan.test.ts`

**Interfaces:**
- Produces: `planSkeleton(targetCount: number): PlanCompositionSlot[]`; `composeFreshPlan(candidates, skeleton?: readonly PlanCompositionSlot[])` (skeleton defaults to `V1_PLAN_SHAPE` for back-compat).

- [ ] **Step 1: Write the failing tests** — add to `today-plan.test.ts`:

```typescript
describe('planSkeleton', () => {
  it('produces warm-up first, cool-down last, core in between, sized to targetCount', () => {
    const s = planSkeleton(8);
    expect(s).toHaveLength(8);
    expect(s[0].prefix).toBe('warm-up');
    expect(s[7].prefix).toBe('cool-down');
    expect(s.slice(1, 7).every((x) => x.prefix === 'core')).toBe(true);
    expect(s.map((x) => x.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('handles small counts gracefully (1, 2)', () => {
    expect(planSkeleton(1)).toHaveLength(1);
    expect(planSkeleton(2)).toHaveLength(2);
  });
  it('varies core types across the block (not all one type)', () => {
    const types = new Set(planSkeleton(8).map((x) => x.type));
    expect(types.size).toBeGreaterThan(1);
  });
});

describe('composeFreshPlan with a sized skeleton', () => {
  it('fills an 8-slot skeleton to 8 items from a rich pool', () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({
      id: `e${i}`, type: [ExerciseType.CLOZE, ExerciseType.TRANSLATION, ExerciseType.VOCAB_RECALL, ExerciseType.SENTENCE_CONSTRUCTION][i % 4],
      topicHint: null, difficulty: CefrLevel.A1, grammarPointKey: `p${i}`,
    }));
    const { items } = composeFreshPlan(candidates, planSkeleton(8));
    expect(items).toHaveLength(8);
    expect(items.map((it) => it.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- today-plan.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `today-plan.ts`:
- Add the generator (a warm-up cloze, a cool-down cloze, and a cycling core type pattern):

```typescript
const CORE_TYPE_CYCLE: readonly ExerciseType[] = [
  ExerciseType.SENTENCE_CONSTRUCTION,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
  ExerciseType.CLOZE,
];

/** Generates a warm-up · core×(N-2) · cool-down skeleton of `targetCount` slots. */
export function planSkeleton(targetCount: number): PlanCompositionSlot[] {
  const n = Math.max(1, Math.floor(targetCount));
  const slots: PlanCompositionSlot[] = [];
  for (let i = 0; i < n; i++) {
    const index = i + 1;
    let prefix: PlanSlotPrefix;
    let type: ExerciseType;
    if (i === 0 && n > 1) { prefix = 'warm-up'; type = ExerciseType.CLOZE; }
    else if (i === n - 1 && n > 1) { prefix = 'cool-down'; type = ExerciseType.CLOZE; }
    else { prefix = 'core'; type = CORE_TYPE_CYCLE[(i - 1 + CORE_TYPE_CYCLE.length) % CORE_TYPE_CYCLE.length]; }
    slots.push({ index, prefix, type });
  }
  return slots;
}
```

- Change `composeFreshPlan(candidates: readonly PoolDraw[])` to
  `composeFreshPlan(candidates: readonly PoolDraw[], skeleton: readonly PlanCompositionSlot[] = V1_PLAN_SHAPE)`,
  and replace the two `V1_PLAN_SHAPE` references in its body with the `skeleton`
  parameter (`skeleton.map(...)` in Pass 1; `skeleton[i].index` in Pass 2). The
  rest (per-type queues, backfill, re-index) is unchanged. Existing callers/tests
  passing no skeleton keep the v1 behavior.

- [ ] **Step 4: Run, verify pass** — same command → PASS (incl. existing 5-slot tests via the default).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/today-plan.ts infra/lambda/src/lib/today-plan.test.ts
git commit -m "feat(lambda): variable-length plan skeleton (warm-up·core×N·cool-down)"
```

---

### Task 4: Wire the today route — at-or-below pool, error-aware sized plan, `reason`

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts` (GET /sessions/today + `sampleFreshPool`)
- Modify: `infra/lambda/src/routes/sessions.test.ts`
- Modify: `packages/api-client/src/schemas/today.ts` (+ its test)

**Interfaces:**
- Consumes: `targetItemCount` (Task 1), `errorCountByPoint`/`reasonFor`/`PlanReason` (Task 2), `planSkeleton` (Task 3).
- Produces: today wire items gain `reason: PlanReason | null`; `index` cap raised to `DAILY_GOAL_MAX_ITEMS` (12).

- [ ] **Step 1: api-client schema first (TDD)** — in `today.ts`: add to `TodayPlanItemSchema`
  `reason: z.enum(['new','reinforce','review','error-fix']).nullable().default(null),`
  and change `index: z.number().int().min(1).max(5)` → `.max(12)`. Add/extend a schema
  test: a 12-index item with `reason:'error-fix'` parses; a missing `reason` defaults to null;
  an unknown reason rejects. Run its package test RED→GREEN; `pnpm --filter @language-drill/api-client build`.

- [ ] **Step 2: at-or-below pool** — in `sampleFreshPool` (`sessions.ts`), the query filters
  `eq(exercises.difficulty, difficulty)`. Replace with an at-or-below filter: compute the
  set of CEFR levels ≤ the active level (use the curriculum/shared CEFR ordering — e.g.
  `inArray(exercises.difficulty, levelsAtOrBelow(proficiencyLevel))`) and filter by that set.
  Add a small helper `levelsAtOrBelow(level): CefrLevel[]` (A1→[A1]; A2→[A1,A2]; B1→[A1,A2,B1];
  B2→[A1,A2,B1,B2]) near the route or in shared. Keep the over-fetch + ranking unchanged.

- [ ] **Step 3: fetch dailyMinutes + per-point recent-error counts (both paths)** — in the
  GET /sessions/today handler: fetch the user's `dailyMinutes` from `userPreferences`
  (nullable) and a per-point recent-error count map (group-by `COALESCE(errorGrammarPointKey,
  hostGrammarPointKey)`, `gte(occurredAt, now − 30d)`, like `/progress/curriculum`). Build
  `errorCountByPoint`. Fetch `masteryByPoint` for BOTH paths (move the mastery fetch ahead of
  the Path A/B split if needed) so `reason` can be computed on hydrated items too.

- [ ] **Step 4: size + compose + reason** — Path B: `const size = targetItemCount(dailyMinutes);`
  `const ranked = rankPlanCandidates(draws, { masteryByPoint, prereqsOf, now, errorCountByPoint });`
  `const { items, insufficient } = composeFreshPlan(ranked, planSkeleton(size));`. In `toWireItem`
  (used by both paths), add `reason: reasonFor(item.grammarPointKey, { masteryByPoint, prereqsOf, now, errorCountByPoint })`.

- [ ] **Step 5: test** — extend `sessions.test.ts` (mirror its existing GET /sessions/today
  harness — it stubs `db.select` chains + `sampleFreshPool`'s rows + mastery rows; extend the
  `@language-drill/db` mock with `userPreferences` + `errorObservations` table stubs as the
  Phase-1/2 progress tests did). Assert: (a) with `dailyMinutes: 30` the fresh plan returns
  **12** items; with no prefs row, **8**; (b) a point with seeded recent errors is ranked into
  the plan and its item carries `reason: 'error-fix'`; (c) a not-started point's item carries
  `reason: 'new'`; (d) the at-or-below pool includes a lower-level exercise when the active
  level is A2. RED first where practical, then implement, then GREEN.

- [ ] **Step 6: run** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda build && pnpm --filter @language-drill/lambda test -- sessions.test.ts` + `pnpm --filter @language-drill/api-client test -- today` → PASS (incl. existing today tests).

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts packages/api-client/src/schemas/today.ts packages/api-client/src/schemas/today.test.ts
git commit -m "feat(lambda): error-aware, daily-goal-sized today plan with per-item reason"
```

---

### Task 5: Web — drill the goal length + variable-length section labels

**Files:**
- Modify: `apps/web/lib/drill/session-config.ts`
- Modify: `apps/web/app/(dashboard)/drill/page.tsx`
- Modify: `apps/web/app/(dashboard)/_lib/timeline-labels.ts` (+ callers, e.g. `timeline-item.tsx`)
- Modify: the relevant web tests (`drill/page.test.tsx`, `timeline-labels` test if present)

**Interfaces:**
- Consumes: `targetItemCount` (Task 1); `usePreferences` (existing hook, exposes `dailyMinutes`).

- [ ] **Step 1: drilled-session count from dailyMinutes** — in `drill/page.tsx`, read prefs via
  `usePreferences({ fetchFn })` and compute the quick-drill `exerciseCount` as
  `targetItemCount(prefs?.dailyMinutes ?? null)` (replacing the constant `DEFAULT_EXERCISE_COUNT`
  in the non-dictation config branch). Dictation keeps `DICTATION_RUN_COUNT`. Keep
  `DEFAULT_EXERCISE_COUNT` exported (other callers/tests may use it) but it's no longer the
  quick-drill source. Test (extend `drill/page.test.tsx`): with `usePreferences` mocked to
  `dailyMinutes: 30`, starting a quick drill calls `createSession.mutate` with `exerciseCount: 12`;
  with no prefs, `8`.

- [ ] **Step 2: variable-length section prefix** — `timeline-labels.ts` currently maps
  `PREFIX_BY_INDEX` for 1..5 and `composeTitle(index, type)`. Make the prefix a function of
  `(index, total)`: index 1 → `warm-up`, index === total → `cool-down`, else `core`
  (drop the index-3 `production` special-case). Update `composeTitle` to take the total
  (e.g. `composeTitle(index, total, type)`) and update its callers (`timeline-item.tsx` —
  it has `data.items.length` available). Test: index 1 of 8 → "warm-up · …"; index 8 of 8 →
  "cool-down · …"; index 4 of 8 → "core · …".

- [ ] **Step 3: run** — `pnpm --filter @language-drill/web test -- drill/page timeline` → PASS; `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web lint` → 0.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/lib/drill/session-config.ts" "apps/web/app/(dashboard)/drill/page.tsx" "apps/web/app/(dashboard)/_lib/timeline-labels.ts" "apps/web/app/(dashboard)/_components/today-timeline.tsx"
git commit -m "feat(web): drill the daily-goal length + variable-length plan section labels"
```

---

### Task 6: Full gate

- [ ] **Step 1:** `pnpm build` → exit 0.
- [ ] **Step 2:** `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1` → exit 0. Watch: existing today/sessions tests now need the `userPreferences`/`errorObservations` mock stubs; any web fixture constructing a `TodayPlanItem` now needs `reason` (defaults to null in the schema, but typed fixtures may need it); timeline-label callers updated for the new signature.
- [ ] **Step 3:** No separate commit (gate only).

---

## Self-Review

- **Spec coverage (3A):** 3a error-aware ranking → Task 2 (+ Task 4 feeds it). 3b at-or-below pool → Task 4 Step 2. 3c daily-goal length, coherent across preview + real session → Task 1 (shared mapping) + Task 4 (preview size) + Task 5 (drilled count) + Task 3 (skeleton). 3d per-item reason → Task 2 (classifier) + Task 4 (wire). Variable-length plans display correctly → Task 5 Step 2. **Deferred to 3B** (correctly not here): rendering the reason hint, the inline daily-load control, the framing-line upgrade, completable/keep-going, the /home cue.
- **Placeholder scan:** pure cores (Tasks 1–3, 5-labels) carry complete code; the integration (Task 4) gives concrete SQL/composition steps + points at the existing harness pattern (the Phase-1/2 progress tests already extended the same `@language-drill/db` mock with table stubs). The ranker cap test is left to fill against the named `ERROR_CAP`.
- **Type consistency:** `PlanReason` ('new'|'reinforce'|'review'|'error-fix') is identical in `rank.ts`, the `today.ts` zod enum, and the wire. `targetItemCount(dailyMinutes: number|null)` has one definition (shared), consumed by both Lambda (Task 4) and web (Task 5). `RankContext` gains `errorCountByPoint` consistently across `priorityOf`, `reasonFor`, and the route's two call sites. `composeFreshPlan`'s new optional `skeleton` param defaults to `V1_PLAN_SHAPE`, so existing callers are unbroken.
