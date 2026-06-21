# Daily-load redesign (quick/medium/long) + plan-resize bug fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall 4-row **minutes** load selector (5/10/20/30) with a compact 3-way **quick / medium / long** control on both /home and /settings (we don't actually measure minutes), and FIX the bug where changing the load does nothing because a started session freezes today's plan.

**Architecture (decisions locked).** Introduce a `dailyGoal` preference (`'quick'|'medium'|'long'`) that drives plan length — `quick≈5 / medium≈8 / long≈12` items. All existing users migrate to **medium** (a non-null column DEFAULT backfills them). The legacy `dailyMinutes` column + the onboarding minutes step stay **dormant** (still written, no longer drive length) — fully removing them + an onboarding redesign is a noted follow-up. Keep the rough "~N min planned" *derived* estimate. **Bug fix:** `GET /sessions/today` Path A (hydrate the stored session) must apply ONLY when the session is **completed OR has ≥1 attempt**; a started-but-untouched session falls through to Path B (a fresh, dailyGoal-sized preview), so the load control resizes the plan.

**Tech Stack:** TypeScript, Drizzle + Postgres (Neon), Hono (Lambda), Zod, TanStack Query, Next.js + React, Vitest.

## Global Constraints

- **`dailyGoal`** = `'quick' | 'medium' | 'long'` (a `text` column, `NOT NULL DEFAULT 'medium'`).
  `targetItemCount(goal)`: quick→5, medium→8, long→12, null→8 (medium). This REPLACES
  `targetItemCount(dailyMinutes)` — every caller passes a `DailyGoal` now.
- **Migration is non-destructive + backfills existing users to 'medium'** via the column
  DEFAULT (Postgres backfills `ADD COLUMN … NOT NULL DEFAULT 'medium'`). Forward-only Drizzle migration. `dailyMinutes` stays (dormant).
- **Both controls become 3-way quick/medium/long** (compact). They write `dailyGoal` via the
  preferences PATCH. The settings daily-target is already horizontal; the /home control stays compact.
- **Bug fix:** Path A gates on `session.completedAt !== null || attemptedIds.size > 0`. A started,
  zero-attempt session → Path B (fresh, `targetItemCount(dailyGoal)`-sized). This requires moving the
  attempt-set fetch BEFORE the A/B decision.
- **Migration runs on dev + prod** (forward-only). NO destructive drop of `dailyMinutes` in this change.
- **Onboarding + `dailyMinutes` are left as-is** (dormant for plan length). Out of scope here; note as a follow-up.
- The web never imports `@language-drill/db`/curriculum. App idiom (`Choice`, `--color-*`, `t-*`). Languages uppercase.
- **Build/test ordering:** after editing `packages/*` run `pnpm build` (turbo) before dependent
  typecheck/tests; before the Lambda suite `rm -rf infra/lambda/dist`. **Note:** changing
  `targetItemCount`'s signature (Task 1) breaks its lambda + web callers until Tasks 4 + 6 fix them —
  those tasks run TARGETED vitest (per-file) and the full package build is expected-red in between.
  FULL gate (Task 8): `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1`.
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Modify** `packages/shared/src/daily-goal.ts` (+ test) — `DailyGoal`, `DAILY_GOALS`, `targetItemCount(goal)`.
- **Modify** `packages/db/src/schema/users.ts` — add `dailyGoal` column; **generate** a Drizzle migration.
- **Modify** `packages/api-client/src/schemas/preferences.ts` (+ test) — `dailyGoal` on response + PATCH input.
- **Modify** `infra/lambda/src/routes/sessions.ts` (+ test) — read `dailyGoal`; **Path-A bug fix**.
- **Modify** `infra/lambda/src/routes/profiles.ts` (+ test) — GET/PATCH `dailyGoal`.
- **Modify** `apps/web/app/(dashboard)/drill/page.tsx` (+ test) — count from `dailyGoal`.
- **Modify** `apps/web/components/settings/goals-section.tsx` + `apps/web/app/(dashboard)/_components/daily-load-control.tsx` + `apps/web/app/(dashboard)/home/page.tsx` (+ tests) — quick/medium/long controls.

---

### Task 1: Shared `dailyGoal` + `targetItemCount(goal)`

**Files:** Modify `packages/shared/src/daily-goal.ts` + `daily-goal.test.ts`; ensure exported from `packages/shared/src/index.ts` (it already `export * from './daily-goal'`).

- [ ] **Step 1: Rewrite the test** (`daily-goal.test.ts`) to the new mapping:

```typescript
import { describe, it, expect } from 'vitest';
import { targetItemCount, DAILY_GOAL_MAX_ITEMS, DAILY_GOALS } from './daily-goal';

describe('targetItemCount', () => {
  it('maps quick/medium/long to item counts', () => {
    expect(targetItemCount('quick')).toBe(5);
    expect(targetItemCount('medium')).toBe(8);
    expect(targetItemCount('long')).toBe(12);
  });
  it('defaults to medium (8) for null', () => {
    expect(targetItemCount(null)).toBe(8);
  });
  it('exposes the goals + the max', () => {
    expect(DAILY_GOALS).toEqual(['quick', 'medium', 'long']);
    expect(DAILY_GOAL_MAX_ITEMS).toBe(12);
  });
});
```

- [ ] **Step 2: Run RED** — `pnpm --filter @language-drill/shared test -- daily-goal`.
- [ ] **Step 3: Implement** — replace `daily-goal.ts`:

```typescript
// Daily-goal → plan length. The user-facing setting is a coarse "how much today"
// (quick/medium/long), since we don't measure real per-exercise minutes. Shared so
// the today-plan preview (Lambda) and the drilled-session count (web) agree.

export const DAILY_GOALS = ['quick', 'medium', 'long'] as const;
export type DailyGoal = (typeof DAILY_GOALS)[number];

export const DAILY_GOAL_MAX_ITEMS = 12;

const ITEMS_BY_GOAL: Readonly<Record<DailyGoal, number>> = {
  quick: 5,
  medium: 8,
  long: 12,
};

const MEDIUM_ITEMS = 8;

/** Target plan length for a daily goal; medium (8) when unset/unknown. */
export function targetItemCount(goal: DailyGoal | null): number {
  if (goal == null) return MEDIUM_ITEMS;
  return ITEMS_BY_GOAL[goal] ?? MEDIUM_ITEMS;
}
```

- [ ] **Step 4: Run GREEN** — `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- daily-goal`.
- [ ] **Step 5: Commit** — `feat(shared): dailyGoal (quick/medium/long) → targetItemCount`.

---

### Task 2: DB column + migration

**Files:** Modify `packages/db/src/schema/users.ts`; generate a migration under `packages/db/migrations/`.

- [ ] **Step 1: Add the column** — in `userPreferences` (after `dailyMinutes`):

```typescript
  dailyGoal: text('daily_goal').$type<DailyGoal>().notNull().default('medium'),
```

Import `DailyGoal` from `@language-drill/shared` (the schema file already imports shared types).

- [ ] **Step 2: Generate the migration** — `pnpm --filter @language-drill/db exec drizzle-kit generate` (or the repo's `db:generate` script). Confirm the generated `.sql` is `ALTER TABLE "user_preferences" ADD COLUMN "daily_goal" text NOT NULL DEFAULT 'medium';` (Postgres backfills existing rows to 'medium'). Inspect the generated file + `meta/_journal.json` are consistent. Do NOT hand-edit the snapshot.
- [ ] **Step 3: Build** — `pnpm --filter @language-drill/db build` → exit 0. (Do NOT run `pnpm db:migrate` — that hits the shared dev branch; CI applies it.)
- [ ] **Step 4: Commit** — `feat(db): add user_preferences.daily_goal (default medium)` (include the migration `.sql` + `meta/`).

---

### Task 3: api-client preferences schema

**Files:** Modify `packages/api-client/src/schemas/preferences.ts` + its test.

- [ ] **Step 1: Tests first** — assert `PreferencesResponseSchema` parses a payload with `dailyGoal: 'medium'`; `UpdatePreferencesInputSchema` accepts `{ dailyGoal: 'long' }` and rejects `{ dailyGoal: 'huge' }`. (Keep the existing `dailyMinutes` cases — that field stays.)
- [ ] **Step 2: RED** — `pnpm --filter @language-drill/api-client test -- preferences`.
- [ ] **Step 3: Implement** — add to `PreferencesResponseSchema`: `dailyGoal: z.enum(['quick','medium','long'])` (non-nullable — the GET always returns one, see Task 5). Add to `UpdatePreferencesInputSchema`: `dailyGoal: z.enum(['quick','medium','long']).optional()`. Keep `dailyMinutes` in both for back-compat.
- [ ] **Step 4: GREEN** — `pnpm --filter @language-drill/api-client build && pnpm --filter @language-drill/api-client test -- preferences` + `typecheck`.
- [ ] **Step 5: Commit** — `feat(api-client): dailyGoal on preferences response + PATCH input`.

---

### Task 4: Lambda today route — read `dailyGoal` + the Path-A bug fix

**Files:** Modify `infra/lambda/src/routes/sessions.ts` + `sessions.test.ts`. (This task FIXES the `targetItemCount` build break from Task 1 in this file.)

- [ ] **Step 1: read dailyGoal** — the today handler fetches `prefsRows` (currently `dailyMinutes`). Add `dailyGoal: userPreferences.dailyGoal` to that select; `const dailyGoal = prefsRows[0]?.dailyGoal ?? null;`. Replace `const size = targetItemCount(dailyMinutes)` with `targetItemCount(dailyGoal)`. (Leave the dailyMinutes fetch or drop it — your call; it's no longer used for sizing.)
- [ ] **Step 2: Path-A engagement gate (the bug fix)** — currently `if (todayRows.length > 0) { …fetch itemRows → build attemptedIds… hydrate → return }`. Restructure so the attempt info gates the path: when a today session exists, fetch its `itemRows`/`attemptedIds` FIRST, then:
  - if `session.completedAt !== null || attemptedIds.size > 0` → Path A (hydrate the stored session, as today).
  - else → fall through to Path B (a fresh, `targetItemCount(dailyGoal)`-sized preview). The started-but-untouched session does NOT lock the plan; the load control resizes it.
  Keep Path A's response shape (incl. `resumeSessionId`) for the engaged case.
- [ ] **Step 3: tests** — extend `sessions.test.ts` (mirror its harness; add `dailyGoal` to the `@language-drill/db` `userPreferences` stub + seed it): (a) a today session with **0 attempts** + `dailyGoal: 'long'` → the response is a **12-item fresh plan** (Path B), NOT the stored 5; (b) a today session **with ≥1 attempt** → Path A (hydrated stored items, with done/queued); (c) a **completed** today session → Path A (summary); (d) `dailyGoal: 'quick'` fresh (no session) → 5 items, `'long'` → 12. Update the existing today tests that seeded `dailyMinutes` for sizing to seed `dailyGoal`.
- [ ] **Step 4: build + test** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda build` → exit 0 (closes the Task-1 break in this file) ; `pnpm --filter @language-drill/lambda test -- sessions.test.ts` → PASS.
- [ ] **Step 5: Commit** — `fix(lambda): today plan sizes to dailyGoal; untouched session no longer locks it`.

---

### Task 5: Lambda profiles route — GET/PATCH `dailyGoal`

**Files:** Modify `infra/lambda/src/routes/profiles.ts` + `profiles.test.ts`.

- [ ] **Step 1: GET** — add `dailyGoal: row.dailyGoal` to the `GET /profiles/preferences` response; in the no-row default object, add `dailyGoal: 'medium'`.
- [ ] **Step 2: PATCH** — add `dailyGoal: z.enum(['quick','medium','long']).optional()` to the lambda `UpdatePreferencesSchema`; add `dailyGoal: userPreferences.dailyGoal` to the `.returning(...)`. (The `.set({ ...bodyResult.data })` already writes any provided `dailyGoal`.) The `PUT /profiles/languages` seed insert needs no change — the column DEFAULT 'medium' covers new rows.
- [ ] **Step 3: tests** — `profiles.test.ts`: GET returns `dailyGoal`; a no-row GET returns `dailyGoal: 'medium'`; PATCH `{ dailyGoal: 'long' }` persists + returns it. Extend the `userPreferences` db stub with `dailyGoal`.
- [ ] **Step 4: build + test** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda build && pnpm --filter @language-drill/lambda test -- profiles.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(lambda): preferences GET/PATCH expose + accept dailyGoal`.

---

### Task 6: Web drill page — count from `dailyGoal`

**Files:** Modify `apps/web/app/(dashboard)/drill/page.tsx` + `page.test.tsx`. (FIXES the Task-1 web build break.)

- [ ] **Step 1:** change `exerciseCount: targetItemCount(prefsData?.dailyMinutes ?? null)` → `targetItemCount(prefsData?.dailyGoal ?? null)`.
- [ ] **Step 2: test** — update the drill page test's `useGetPreferences` mock to return `dailyGoal` (e.g. `'long'` → asserts `exerciseCount: 12`; no prefs → 8).
- [ ] **Step 3:** `pnpm --filter @language-drill/web test -- drill/page` → PASS; `pnpm --filter @language-drill/web typecheck` → 0 (closes the web build break).
- [ ] **Step 4: Commit** — `feat(web): quick-drill length from dailyGoal`.

---

### Task 7: Web controls — quick/medium/long

**Files:** Modify `apps/web/components/settings/goals-section.tsx`, `apps/web/app/(dashboard)/_components/daily-load-control.tsx`, `apps/web/app/(dashboard)/home/page.tsx` + their tests.

- [ ] **Step 1: settings `goals-section.tsx`** — replace the `DAILY_MINUTES` daily-target radiogroup with a 3-option `DAILY_GOALS` (`['quick','medium','long']`) radiogroup (keep the horizontal `grid`/`Choice` idiom — `grid-cols-3`). Read `prefsQuery.data.dailyGoal`; `pickGoal(g)` → `update.mutate({ dailyGoal: g })`. Label each option with the goal word (capitalized) + a small hint (e.g. quick "~5", medium "~8", long "~12" — or just the words). Update its test.
- [ ] **Step 2: home `daily-load-control.tsx`** — change props to `current: DailyGoal | null` + `onSelect: (g: DailyGoal) => void`; map over `DAILY_GOALS` (3 compact `Choice` buttons labelled quick/medium/long). Keep the flex-wrap + "today's load" label. Update its test.
- [ ] **Step 3: home `page.tsx`** — the daily-load wiring: read `prefs.data?.dailyGoal`, pass to `DailyLoadControl current={...}`; `onSelect` → `updatePrefs.mutate({ dailyGoal: g }, { onSuccess: invalidate ['todayPlan', activeLanguage] })`. (Rename the handler from minutes → goal.) Update the home test's mock + the daily-load assertions.
- [ ] **Step 4:** `pnpm --filter @language-drill/web test -- daily-load-control goals-section "home/page"` → PASS; `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web lint` → 0.
- [ ] **Step 5: Commit** — `feat(web): quick/medium/long daily-load control on /home and /settings`.

---

### Task 8: Full gate

- [ ] **Step 1:** `pnpm build` → exit 0.
- [ ] **Step 2:** `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1` → exit 0. Watch: any remaining `targetItemCount(dailyMinutes)` / `prefs…dailyMinutes`-for-sizing reads; tests that seed `dailyMinutes` for plan length must seed `dailyGoal`; the migration journal is consistent.
- [ ] **Step 3:** No separate commit.

---

## Self-Review

- **Coverage:** quick/medium/long replaces minutes on /home (Task 7 control + home wiring) and /settings (Task 7 goals-section); migration → medium (Task 2 column DEFAULT); `targetItemCount` mapping quick/medium/long → 5/8/12 (Task 1); the plan-resize bug (Task 4 Path-A engagement gate); the drilled session length from dailyGoal (Task 6). The rough "~N min planned" derived estimate is untouched (still computed from per-item estimates).
- **Deferred (noted):** removing `dailyMinutes` + the onboarding minutes step (still dormant) — a follow-up; out of this scope per the /home + /settings ask.
- **Placeholder scan:** Tasks 1–3, 5–7 carry concrete code/signatures + tests; Task 4 (the bug fix) gives the exact gate (`completedAt !== null || attemptedIds.size > 0`) + restructure + the harness note. The cross-task build-break window (Task 1 breaks the lambda/web `targetItemCount` callers until Tasks 4/6) is flagged with targeted-test instructions.
- **Type consistency:** `DailyGoal` is the single union (shared), consumed by `targetItemCount`, the DB column `$type`, the api-client enums, the lambda reads, and both controls. `targetItemCount(goal: DailyGoal|null)` has one signature; every caller passes a `DailyGoal`. The Path-A gate uses `session.completedAt` + `attemptedIds.size`, both already computed in the today handler.
