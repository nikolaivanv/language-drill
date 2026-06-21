# Curriculum Map — Phase 4 (readiness advance action) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Curriculum Map arc (design spec
`docs/superpowers/specs/2026-06-20-curriculum-map-and-adaptive-plan-design.md`,
§Phase 4 + §1 readiness). The readiness rollup + bar already ship on the map
(Phase 1); this **wires the "add {next level}" nudge** so accepting flips the
user's active `proficiencyLevel` — opt-in, never automatic.

**Architecture (web-only; no backend change).** The map's `ReadinessStrip` shows
an honest "you've made A1 solid …" line when `readyToAdvance` but **no action**
today. Phase 4 adds an **"add A2 →"** action there. The next level is the
curriculum response's **preview level** (the `isPreview` level). Accepting
rebuilds the user's FULL language-profile list (the existing write is
`PUT /profiles/languages` — an atomic replace requiring all profiles +
`primaryLanguage`), bumping only the active language's `proficiencyLevel` to the
next level, via the existing `useUpdateLanguages` mutation (the settings page
uses the same). On success the map + today plan + profiles refetch, so the whole
app re-resolves at the new active level. Reversible anytime in settings — so the
action is a single calm click (no confirm dialog), per the spec's opt-in framing.

**Tech Stack:** Next.js + React, TanStack Query, TypeScript, Vitest + Testing Library.

## Global Constraints

- **The write is `PUT /profiles/languages` via `useUpdateLanguages`** — an atomic
  replace of ALL profiles. Payload `{ profiles: [{language, proficiencyLevel}],
  primaryLanguage }`; `primaryLanguage` is REQUIRED and must be one of the
  submitted profiles. So the action must read the current full profile list
  (`useLanguageProfiles`, query `['languageProfiles']`) AND the current
  `primaryLanguage` (`useGetPreferences`), bump only the active language's level,
  and PUT the whole thing back. Mirror `apps/web/components/settings/languages-section.tsx`.
- **Next level = the preview level** of the curriculum response
  (`data.levels.find(l => l.isPreview)?.level`). If there is no preview level
  (e.g. the user is already at the top level), DO NOT render the action — even if
  `readyToAdvance` is true. The action shows only when `readyToAdvance` AND a next
  level exists.
- **Opt-in, never automatic, reversible:** a single "add {next} →" button (calm,
  with a quiet "you can change this anytime in settings" subtitle). No confirm
  dialog, no auto-advance.
- **On success, invalidate** so the app re-resolves at the new level:
  `['languageProfiles']`, `['curriculumMap', language]`, `['todayPlan', language]`,
  `['progressRadar', language]`.
- **The web never imports `@language-drill/db`/curriculum.** Levels come from the
  curriculum response (`level`/`isPreview` strings); `CefrLevel` enum is in
  `@language-drill/shared`.
- App idiom (shared `Button`, `--color-*`, `t-*`). No DB migration. Languages uppercase.
- **Build/test ordering:** `pnpm build` before dependent web tests. Gate:
  `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1`.
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Create** `apps/web/app/(dashboard)/progress/_lib/advance-level.ts` (+ test) — `withAdvancedLevel`.
- **Modify** `apps/web/app/(dashboard)/progress/_components/map-tab.tsx` — `ReadinessStrip` gains the action; `MapTab` threads it.
- **Modify** `apps/web/app/(dashboard)/progress/page.tsx` — wire the mutation + invalidation.
- **Modify** the relevant tests (`map-tab.test.tsx`, `progress/page.test.tsx`).

---

### Task 1: Pure `withAdvancedLevel` helper

**Files:**
- Create: `apps/web/app/(dashboard)/progress/_lib/advance-level.ts`
- Create: `apps/web/app/(dashboard)/progress/_lib/__tests__/advance-level.test.ts`

**Interfaces:**
- Produces: `withAdvancedLevel(profiles: Profile[], language: LearningLanguage, nextLevel: CefrLevel): Profile[]` where `Profile = { language: LearningLanguage; proficiencyLevel: CefrLevel }`. Returns a new array with the matching language's `proficiencyLevel` set to `nextLevel`; all other rows unchanged; if the language isn't present, returns the list unchanged (defensive).

- [ ] **Step 1: Write the failing test** — `advance-level.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import { withAdvancedLevel } from '../advance-level';

const p = (language: Language, proficiencyLevel: CefrLevel) => ({ language, proficiencyLevel });

describe('withAdvancedLevel', () => {
  it('bumps only the matching language, leaving the rest untouched', () => {
    const rows = [p(Language.TR, CefrLevel.A1), p(Language.ES, CefrLevel.B1)];
    const out = withAdvancedLevel(rows, Language.TR, CefrLevel.A2);
    expect(out).toEqual([p(Language.TR, CefrLevel.A2), p(Language.ES, CefrLevel.B1)]);
    expect(rows[0].proficiencyLevel).toBe(CefrLevel.A1); // input not mutated
  });
  it('returns the list unchanged when the language is absent', () => {
    const rows = [p(Language.ES, CefrLevel.B1)];
    expect(withAdvancedLevel(rows, Language.TR, CefrLevel.A2)).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/web test -- advance-level` → FAIL.

- [ ] **Step 3: Implement** `advance-level.ts`:

```typescript
import type { CefrLevel, LearningLanguage } from '@language-drill/shared';

export type LanguageProfileRow = {
  language: LearningLanguage;
  proficiencyLevel: CefrLevel;
};

/** Returns a new profile list with `language`'s level set to `nextLevel`; other rows unchanged. */
export function withAdvancedLevel(
  profiles: readonly LanguageProfileRow[],
  language: LearningLanguage,
  nextLevel: CefrLevel,
): LanguageProfileRow[] {
  return profiles.map((p) =>
    p.language === language ? { ...p, proficiencyLevel: nextLevel } : p,
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @language-drill/web test -- advance-level` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/progress/_lib/advance-level.ts" "apps/web/app/(dashboard)/progress/_lib/__tests__/advance-level.test.ts"
git commit -m "feat(web): withAdvancedLevel — bump one language's level in the profile list"
```

---

### Task 2: Wire the readiness "add {next} →" action

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_components/map-tab.tsx`
- Modify: `apps/web/app/(dashboard)/progress/page.tsx`
- Modify: `apps/web/app/(dashboard)/progress/_components/__tests__/map-tab.test.tsx`
- Modify: `apps/web/app/(dashboard)/progress/page.test.tsx`

**Interfaces:**
- Consumes: `withAdvancedLevel` (Task 1); `useLanguageProfiles`, `useGetPreferences`, `useUpdateLanguages` (api-client); the curriculum data (`readyToAdvance`, the preview level).

- [ ] **Step 1: `ReadinessStrip` + `MapTab` props** — `ReadinessStrip` gains optional
  `nextLevel?: string` + `onAdvance?: () => void` + `advancing?: boolean`. In the
  existing `readyToAdvance` block, when `nextLevel` AND `onAdvance` are provided,
  render a shared `Button` **"add {nextLevel} →"** (calls `onAdvance`, disabled +
  shows a pending label while `advancing`) plus a quiet subtitle "you can change
  this anytime in settings". Keep the honest "you've made {level} solid …" line.
  `MapTab` gains `onAdvance?` + `advancing?` props and computes `nextLevel` from
  `data.levels.find(l => l.isPreview)?.level`, passing all three to the active
  `ReadinessStrip`. (When there's no preview level, `nextLevel` is undefined → no
  button, even if `readyToAdvance`.)

- [ ] **Step 2: Wire `progress/page.tsx`** — the page already builds `fetchFn` +
  `useCurriculumMap`. Add `useLanguageProfiles({ fetchFn })`, `useGetPreferences({ fetchFn })`,
  `useUpdateLanguages({ fetchFn })`, and `useQueryClient()`. Implement `handleAdvance`:
  - read `profiles = languageProfiles.data?.profiles`, `primaryLanguage = prefs.data?.primaryLanguage`,
    and the next level from `curriculum.data` (`levels.find(l => l.isPreview)?.level`, as a `CefrLevel`).
  - guard: if any are missing, no-op.
  - `const nextProfiles = withAdvancedLevel(profiles, activeLanguage, nextLevel);`
    `update.mutate({ profiles: nextProfiles, primaryLanguage }, { onSuccess: () => { invalidate ['languageProfiles'], ['curriculumMap', activeLanguage], ['todayPlan', activeLanguage], ['progressRadar', activeLanguage]; } });`
  - pass `onAdvance={handleAdvance}` + `advancing={update.isPending}` to `MapTab` (only on the `map` tab panel).

- [ ] **Step 3: Tests**
  - `map-tab.test.tsx`: with a fixture where the active level `readyToAdvance: true`
    and a preview level "A2" exists, the readiness strip renders an "add A2 →" button
    that calls `onAdvance` on click; with no preview level (or `readyToAdvance: false`),
    no button renders.
  - `progress/page.test.tsx`: mock `useLanguageProfiles` (TR @ A1 + another lang),
    `useGetPreferences` (primaryLanguage), `useUpdateLanguages` (capture mutate),
    `useCurriculumMap` (active A1 `readyToAdvance: true` + preview A2); clicking
    "add A2 →" calls the update mutation with `profiles` carrying TR @ **A2** (others
    unchanged) + the `primaryLanguage`; on success the invalidations fire (capture the
    `onSuccess` + assert `invalidateQueries` with the curriculum-map key). Mirror how
    the existing page tests mock the api-client hooks + queryClient.

- [ ] **Step 4: Run** — `pnpm --filter @language-drill/web test -- map-tab "progress/page" advance-level` → PASS; `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web lint` → 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/progress"
git commit -m "feat(web): readiness advance action — accept the nudge to add the next level"
```

---

### Task 3: Full gate

- [ ] **Step 1:** `pnpm build` → exit 0.
- [ ] **Step 2:** `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1` → exit 0. Watch: the `/progress` page now fetches more hooks — any existing page test must mock `useLanguageProfiles`/`useGetPreferences`/`useUpdateLanguages` or they'll be undefined; the `map-tab` fixture's readiness fields.
- [ ] **Step 3:** No separate commit (gate only).

---

## Self-Review

- **Spec coverage:** §Phase 4 (wire the nudge to flip `proficiencyLevel` on accept) →
  Tasks 1+2. §1 readiness (opt-in, never automatic, only when ≥80% solid → the
  endpoint's `readyToAdvance`; next-level preview already shown) → the action gates
  on `readyToAdvance` + a preview level. Reversible (settings) → single calm click,
  no confirm. Declining/ignoring does nothing → the action is purely additive.
- **Placeholder scan:** Task 1 carries complete code; Task 2 gives the exact hooks,
  payload shape (`{ profiles, primaryLanguage }`), next-level source (the preview
  level), and the four invalidation keys, plus the settings precedent to mirror.
- **Type consistency:** `withAdvancedLevel(profiles, language, nextLevel)` returns the
  same `{ language, proficiencyLevel }[]` shape the PUT expects; `nextLevel` is a
  `CefrLevel` derived from the preview level string (cast/validate against `CefrLevel`).
  The action's gating (`readyToAdvance` + preview level) matches the endpoint's
  `readyToAdvance` + `isPreview` fields. Invalidation keys match the live query keys
  (`['curriculumMap', language]`, `['todayPlan', language]`, `['languageProfiles']`,
  `['progressRadar', language]`).
